export interface DecodeRequest {
  type: "decode";
  requestId: string;
  clipId: string;
  blob: Blob;
  time: number;
  width: number;
  height: number;
}

export interface DecodeResponse {
  type: "decoded";
  requestId: string;
  clipId: string;
  bitmap: ImageBitmap | null;
  time: number;
  error?: string;
}

export interface InitRequest {
  type: "init";
}

export interface InitResponse {
  type: "ready";
  workerId: number;
  mediabunnyAvailable?: boolean;
}

export type WorkerRequest = DecodeRequest | InitRequest;
export type WorkerResponse = DecodeResponse | InitResponse;

export interface CachedResource {
  input: unknown;
  sink: unknown;
  videoTrack: unknown;
  blob: Blob;
  width: number;
  height: number;
  activeUses: number;
  disposePending: boolean;
}

const MAX_CACHED_RESOURCES = 20;
const resourceCache = new Map<string, CachedResource>();
const resourcePromises = new Map<string, Promise<CachedResource | null>>();

export function disposeResource(resource: CachedResource): void {
  if (resource.activeUses > 0) {
    resource.disposePending = true;
    return;
  }
  const input = resource.input as { [Symbol.dispose]?: () => void };
  try {
    input[Symbol.dispose]?.();
  } catch {
    // Resource eviction must continue even if a decoder is already disposed.
  }
}

export function acquireResource(resource: CachedResource): CachedResource {
  resource.activeUses++;
  return resource;
}

export function releaseResource(resource: CachedResource): void {
  resource.activeUses = Math.max(0, resource.activeUses - 1);
  if (resource.activeUses === 0 && resource.disposePending) {
    resource.disposePending = false;
    disposeResource(resource);
  }
}

function evictResource(clipId: string): void {
  const resource = resourceCache.get(clipId);
  if (!resource) return;
  resourceCache.delete(clipId);
  disposeResource(resource);
}
let workerId = 0;
let mediabunnyModule: typeof import("mediabunny") | null = null;

async function loadMediaBunny(): Promise<typeof import("mediabunny") | null> {
  if (mediabunnyModule) {
    return mediabunnyModule;
  }
  try {
    mediabunnyModule = await import("mediabunny");
    return mediabunnyModule;
  } catch {
    try {
      mediabunnyModule = (await import(
        "https://esm.sh/mediabunny@1.25.3" as string
      )) as typeof import("mediabunny");
      return mediabunnyModule;
    } catch {
      return null;
    }
  }
}

export async function getOrCreateResources(
  clipId: string,
  blob: Blob,
  width: number,
  height: number,
): Promise<CachedResource | null> {
  while (true) {
    const cached = resourceCache.get(clipId);
    if (
      cached &&
      cached.blob === blob &&
      cached.width === width &&
      cached.height === height
    ) {
      // Refresh insertion order for LRU eviction.
      resourceCache.delete(clipId);
      resourceCache.set(clipId, cached);
      return acquireResource(cached);
    }

    const inFlight = resourcePromises.get(clipId);
    if (inFlight) {
      // Another request is creating/replacing this clip's resource. Wait for
      // that exact attempt, then re-check both cache and in-flight state.
      // Several waiters may resume together; the loop prevents them from
      // starting duplicate replacements for the same clip.
      await inFlight;
      continue;
    }

    if (cached) evictResource(clipId);

    const creation = createResources(clipId, blob, width, height);
    resourcePromises.set(clipId, creation);
    try {
      // createResources reserves the creator's lease before publishing.
      return await creation;
    } finally {
      if (resourcePromises.get(clipId) === creation) {
        resourcePromises.delete(clipId);
      }
    }
  }
}
async function createResources(
  clipId: string,
  blob: Blob,
  width: number,
  height: number,
): Promise<CachedResource | null> {
  let input: unknown = null;
  try {
    const mediabunny = await loadMediaBunny();
    if (!mediabunny) {
      return null;
    }
    const { Input, ALL_FORMATS, BlobSource, CanvasSink } = mediabunny;

    input = new Input({
      source: new BlobSource(blob),
      formats: ALL_FORMATS,
    }) as unknown;

    const videoTrack = await (
      input as { getPrimaryVideoTrack: () => Promise<unknown> }
    ).getPrimaryVideoTrack();
    if (!videoTrack) {
      disposeResource({ input, sink: null, videoTrack: null, blob, width, height, activeUses: 0, disposePending: false });
      return null;
    }

    const sink = new CanvasSink(videoTrack as never, {
      width,
      height,
      fit: "contain",
    }) as unknown;

    const resource: CachedResource = {
      input,
      sink,
      videoTrack,
      blob,
      width,
      height,
      // Reserve the creating caller's lease before the resource is visible to
      // concurrent cache eviction or replacement.
      activeUses: 1,
      disposePending: false,
    };

    resourceCache.set(clipId, resource);
    while (resourceCache.size > MAX_CACHED_RESOURCES) {
      const oldestClipId = resourceCache.keys().next().value;
      if (oldestClipId === undefined) break;
      evictResource(oldestClipId);
    }
    return resource;
  } catch (error) {
    if (input) {
      disposeResource({ input, sink: null, videoTrack: null, blob, width, height, activeUses: 0, disposePending: false });
    }
    console.error(
      `[DecodeWorker ${workerId}] Failed to create resources for ${clipId}:`,
      error,
    );
    return null;
  }
}

async function decodeFrame(request: DecodeRequest): Promise<DecodeResponse> {
  const { requestId, clipId, blob, time, width, height } = request;

  let resources: CachedResource | null = null;
  try {
    resources = await getOrCreateResources(clipId, blob, width, height);
    if (!resources) {
      return {
        type: "decoded",
        requestId,
        clipId,
        bitmap: null,
        time,
        error: "Failed to create decode resources",
      };
    }

    const sink = resources.sink as {
      getCanvas: (time: number) => Promise<{
        canvas: HTMLCanvasElement | OffscreenCanvas;
        timestamp: number;
        duration: number;
      } | null>;
    };

    const frameResult = await sink.getCanvas(time);
    if (!frameResult?.canvas) {
      return {
        type: "decoded",
        requestId,
        clipId,
        bitmap: null,
        time,
        error: "No frame at requested time",
      };
    }

    const bitmap = await createImageBitmap(frameResult.canvas);

    return {
      type: "decoded",
      requestId,
      clipId,
      bitmap,
      time,
    };
  } catch (error) {
    return {
      type: "decoded",
      requestId,
      clipId,
      bitmap: null,
      time,
      error: error instanceof Error ? error.message : "Unknown decode error",
    };
  } finally {
    if (resources) releaseResource(resources);
  }
}

export function clearCache(clipId?: string): void {
  if (clipId) {
    const cached = resourceCache.get(clipId);
    if (cached) evictResource(clipId);
  } else {
    for (const clipId of resourceCache.keys()) {
      evictResource(clipId);
    }
  }
}

if (typeof self !== "undefined") {
  const workerSelf = self as unknown as {
    onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
    postMessage: (
      message: unknown,
      options?: { transfer?: Transferable[] },
    ) => void;
  };

  workerSelf.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  switch (request.type) {
    case "init":
      workerId = Math.floor(Math.random() * 10000);
      await loadMediaBunny();
      const initResponse: InitResponse = { type: "ready", workerId };
      workerSelf.postMessage(initResponse);
      break;

    case "decode":
      const response = await decodeFrame(request);
      if (response.bitmap) {
        workerSelf.postMessage(response, { transfer: [response.bitmap] });
      } else {
        workerSelf.postMessage(response);
      }
      break;
    }
  };
}

export const decodeWorkerCode = `
const MAX_CACHED_RESOURCES = 20;
const resourceCache = new Map();
const resourcePromises = new Map();
let workerId = 0;
let mediabunnyModule = null;
let mediabunnyAvailable = false;

async function loadMediaBunny() {
 if (mediabunnyModule) {
 return mediabunnyModule;
 }
 try {
 mediabunnyModule = await import("mediabunny");
 mediabunnyAvailable = true;
 return mediabunnyModule;
 } catch (error) {
 try {
 mediabunnyModule = await import("https://esm.sh/mediabunny@1.25.3");
 mediabunnyAvailable = true;
 return mediabunnyModule;
 } catch (cdnError) {
 mediabunnyAvailable = false;
 return null;
 }
 }
}

function disposeResource(resource) {
 if (resource.activeUses > 0) {
 resource.disposePending = true;
 return;
 }
 try {
 resource.input[Symbol.dispose]?.();
 } catch (error) {
 // Continue cleanup even if the input is already disposed.
 }
}

function acquireResource(resource) {
 resource.activeUses++;
 return resource;
}

function releaseResource(resource) {
 resource.activeUses = Math.max(0, resource.activeUses - 1);
 if (resource.activeUses === 0 && resource.disposePending) {
 resource.disposePending = false;
 disposeResource(resource);
 }
}

function evictResource(clipId) {
 const resource = resourceCache.get(clipId);
 if (!resource) return;
 resourceCache.delete(clipId);
 disposeResource(resource);
}

async function getOrCreateResources(clipId, blob, width, height) {
 if (!mediabunnyAvailable || !mediabunnyModule) return null;

 while (true) {
 const cached = resourceCache.get(clipId);
 if (cached && cached.blob === blob && cached.width === width && cached.height === height) {
 resourceCache.delete(clipId);
 resourceCache.set(clipId, cached);
 return acquireResource(cached);
 }

 const inFlight = resourcePromises.get(clipId);
 if (inFlight) {
 // Re-check after every waiter resumes to serialize replacements per clip.
 await inFlight;
 continue;
 }

 if (cached) evictResource(clipId);

 const creation = createResources(clipId, blob, width, height);
 resourcePromises.set(clipId, creation);
 try {
 // The creator lease is reserved before the resource enters the cache.
 return await creation;
 } finally {
 if (resourcePromises.get(clipId) === creation) resourcePromises.delete(clipId);
 }
 }
}
async function createResources(clipId, blob, width, height) {
 let input = null;
 try {
 const { Input, ALL_FORMATS, BlobSource, CanvasSink } = mediabunnyModule;

 input = new Input({
 source: new BlobSource(blob),
 formats: ALL_FORMATS,
 });

 const videoTrack = await input.getPrimaryVideoTrack();
 if (!videoTrack) {
 disposeResource({ input, activeUses: 0, disposePending: false });
 return null;
 }

 const sink = new CanvasSink(videoTrack, {
 width,
 height,
 fit: "contain",
 });

 const resource = { input, sink, videoTrack, blob, width, height, activeUses: 1, disposePending: false };
 resourceCache.set(clipId, resource);
 while (resourceCache.size > MAX_CACHED_RESOURCES) {
 const oldestClipId = resourceCache.keys().next().value;
 if (oldestClipId === undefined) break;
 evictResource(oldestClipId);
 }
 return resource;
 } catch (error) {
 if (input) disposeResource({ input, activeUses: 0, disposePending: false });
 return null;
 }
}

async function decodeFrame(request) {
 const { requestId, clipId, blob, time, width, height } = request;

 if (!mediabunnyAvailable) {
 return {
 type: "decoded",
 requestId,
 clipId,
 bitmap: null,
 time,
 error: "MediaBunny not available in worker",
 };
 }

 let resources = null;
 try {
 resources = await getOrCreateResources(clipId, blob, width, height);
 if (!resources) {
 return {
 type: "decoded",
 requestId,
 clipId,
 bitmap: null,
 time,
 error: "Failed to create decode resources",
 };
 }

 const frameResult = await resources.sink.getCanvas(time);
 if (!frameResult?.canvas) {
 return {
 type: "decoded",
 requestId,
 clipId,
 bitmap: null,
 time,
 error: "No frame at requested time",
 };
 }

 const bitmap = await createImageBitmap(frameResult.canvas);

 return {
 type: "decoded",
 requestId,
 clipId,
 bitmap,
 time,
 };
 } catch (error) {
 return {
 type: "decoded",
 requestId,
 clipId,
 bitmap: null,
 time,
 error: error instanceof Error ? error.message : "Unknown decode error",
 };
 } finally {
 if (resources) releaseResource(resources);
 }
}

self.onmessage = async (event) => {
 const request = event.data;

 switch (request.type) {
 case "init":
 workerId = Math.floor(Math.random() * 10000);
 await loadMediaBunny();
 self.postMessage({ type: "ready", workerId, mediabunnyAvailable });
 break;

 case "decode":
 const response = await decodeFrame(request);
 if (response.bitmap) {
 self.postMessage(response, [response.bitmap]);
 } else {
 self.postMessage(response);
 }
 break;
 }
};
`;

export function createDecodeWorkerBlob(): Blob {
  return new Blob([decodeWorkerCode], { type: "application/javascript" });
}

export function createDecodeWorkerUrl(): string {
  const blob = createDecodeWorkerBlob();
  return URL.createObjectURL(blob);
}
