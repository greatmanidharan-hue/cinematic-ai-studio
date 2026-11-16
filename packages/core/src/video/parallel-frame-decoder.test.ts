import { describe, expect, it, vi } from "vitest";
import { ParallelFrameDecoder } from "./parallel-frame-decoder";

describe("ParallelFrameDecoder frame cache", () => {
  it("closes the previous bitmap when the same frame key is replaced", () => {
    const decoder = Object.create(
      ParallelFrameDecoder.prototype,
    ) as ParallelFrameDecoder & {
      frameCache: Map<string, { bitmap: ImageBitmap; timestamp: number }>;
      maxCacheSize: number;
      addToCache: (key: string, bitmap: ImageBitmap) => void;
    };
    decoder.frameCache = new Map();
    decoder.maxCacheSize = 100;

    const previousBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const replacementBitmap = { close: vi.fn() } as unknown as ImageBitmap;

    decoder.addToCache("clip-a:1.000", previousBitmap);
    decoder.addToCache("clip-a:1.000", replacementBitmap);

    expect(previousBitmap.close).toHaveBeenCalledOnce();
    expect(decoder.frameCache.size).toBe(1);
    expect(decoder.frameCache.get("clip-a:1.000")?.bitmap).toBe(
      replacementBitmap,
    );
    expect(replacementBitmap.close).not.toHaveBeenCalled();
  });

  it("continues replacing an entry if closing the old bitmap throws", () => {
    const decoder = Object.create(
      ParallelFrameDecoder.prototype,
    ) as ParallelFrameDecoder & {
      frameCache: Map<string, { bitmap: ImageBitmap; timestamp: number }>;
      maxCacheSize: number;
      addToCache: (key: string, bitmap: ImageBitmap) => void;
    };
    decoder.frameCache = new Map();
    decoder.maxCacheSize = 100;

    const previousBitmap = {
      close: vi.fn(() => {
        throw new Error("bitmap already closed");
      }),
    } as unknown as ImageBitmap;
    const replacementBitmap = { close: vi.fn() } as unknown as ImageBitmap;

    decoder.addToCache("clip-a:1.000", previousBitmap);
    expect(() =>
      decoder.addToCache("clip-a:1.000", replacementBitmap),
    ).not.toThrow();

    expect(decoder.frameCache.size).toBe(1);
    expect(decoder.frameCache.get("clip-a:1.000")?.bitmap).toBe(
      replacementBitmap,
    );
  });

  it("rejects pending requests even when terminating a failed worker throws", () => {
    const decoder = Object.create(ParallelFrameDecoder.prototype) as ParallelFrameDecoder & {
      workers: Array<{
        worker: { terminate: ReturnType<typeof vi.fn> };
        failed: boolean;
        busy: boolean;
        pendingRequests: Map<string, { reject: (error: Error) => void; timeoutId: ReturnType<typeof setTimeout> }>;
      }>;
      requestQueue: Array<{ reject: (error: Error) => void }>;
      processQueue: () => void;
      failWorker: (state: (typeof decoder.workers)[number], error: Error) => void;
    };
    const rejectPending = vi.fn();
    const terminate = vi.fn(() => { throw new Error("termination failed"); });
    const state = {
      worker: { terminate },
      failed: false,
      busy: true,
      pendingRequests: new Map([
        ["request-1", { reject: rejectPending, timeoutId: setTimeout(() => undefined, 60000) }],
      ]),
    };
    decoder.workers = [state];
    decoder.requestQueue = [];
    decoder.processQueue = vi.fn();

    expect(() => decoder.failWorker(state, new Error("worker crashed"))).not.toThrow();
    expect(terminate).toHaveBeenCalledOnce();
    expect(rejectPending).toHaveBeenCalledWith(expect.any(Error));
    expect(state.pendingRequests.size).toBe(0);
    expect(decoder.processQueue).toHaveBeenCalledOnce();
  });

  it("rejects pending and queued requests when the last worker fails", () => {
    const decoder = Object.create(
      ParallelFrameDecoder.prototype,
    ) as ParallelFrameDecoder & {
      workers: Array<{
        worker: { terminate: ReturnType<typeof vi.fn> };
        failed: boolean;
        busy: boolean;
        pendingRequests: Map<string, { reject: (error: Error) => void }>;
      }>;
      requestQueue: Array<{
        request: { clipId: string; blob: Blob; time: number; width: number; height: number };
        resolve: (result: never) => void;
        reject: (error: Error) => void;
      }>;
      initialized: boolean;
      failWorker: (
        state: {
          worker: { terminate: ReturnType<typeof vi.fn> };
          failed: boolean;
          busy: boolean;
          pendingRequests: Map<string, { reject: (error: Error) => void }>;
        },
        error: Error,
      ) => void;
    };

    const pendingReject = vi.fn();
    const queuedReject = vi.fn();
    const workerState = {
      worker: { terminate: vi.fn() },
      failed: false,
      busy: true,
      pendingRequests: new Map([
        ["req-1", { reject: pendingReject }],
      ]),
    };
    decoder.workers = [workerState];
    decoder.requestQueue = [{
      request: {
        clipId: "clip-b",
        blob: new Blob(),
        time: 1,
        width: 10,
        height: 10,
      },
      resolve: vi.fn(),
      reject: queuedReject,
    }];
    decoder.initialized = true;

    decoder.failWorker(workerState, new Error("worker crashed"));

    expect(workerState.worker.terminate).toHaveBeenCalledOnce();
    expect(pendingReject).toHaveBeenCalledWith(expect.any(Error));
    expect(queuedReject).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "All parallel decode workers have failed",
      }),
    );
    expect(decoder.requestQueue).toHaveLength(0);
  });

});


  it("keeps a replacement cache entry when an older bitmap clone fails", async () => {
    const decoder = Object.create(
      ParallelFrameDecoder.prototype,
    ) as ParallelFrameDecoder & {
      frameCache: Map<string, { bitmap: ImageBitmap; timestamp: number }>;
      cacheHits: number;
      cacheMisses: number;
      blobIds: WeakMap<Blob, number>;
      nextBlobId: number;
      getFromCache: (request: { clipId: string; blob: Blob; time: number; width: number; height: number }) => Promise<ImageBitmap | null>;
    };
    decoder.frameCache = new Map();
    decoder.cacheHits = 0;
    decoder.cacheMisses = 0;
    decoder.blobIds = new WeakMap();
    decoder.nextBlobId = 1;

    const source = new Blob(["source"]);
    const oldBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const newBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const key = "clip-a:1:1.000:10x10";
    const oldEntry = { bitmap: oldBitmap, timestamp: 1 };
    const newEntry = { bitmap: newBitmap, timestamp: 2 };
    decoder.frameCache.set(key, oldEntry);

    let rejectClone!: (error: Error) => void;
    const clone = vi.spyOn(globalThis, "createImageBitmap").mockImplementation(
      () => new Promise((_resolve, reject) => {
        rejectClone = reject;
      }),
    );

    const request = { clipId: "clip-a", blob: source, time: 1, width: 10, height: 10 };
    const pendingClone = decoder.getFromCache(request);
    decoder.frameCache.set(key, newEntry);
    rejectClone(new Error("source bitmap was closed"));

    await expect(pendingClone).resolves.toBeNull();
    expect(decoder.frameCache.get(key)).toBe(newEntry);
    clone.mockRestore();
  });

describe("ParallelFrameDecoder worker initialization", () => {
  it("terminates every partially-created worker when one worker fails to initialize", async () => {
    const instances: Array<{
      onmessage: ((event: MessageEvent) => void) | null;
      onerror: ((event: ErrorEvent) => void) | null;
      onmessageerror: (() => void) | null;
      terminate: ReturnType<typeof vi.fn>;
      postMessage: ReturnType<typeof vi.fn>;
    }> = [];

    class MockWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      terminate = vi.fn();
      postMessage = vi.fn();
      constructor() {
        instances.push(this);
      }
    }

    const createUrl = vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:worker-0")
      .mockReturnValueOnce("blob:worker-1");
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL");
    vi.stubGlobal("Worker", MockWorker);

    const decoder = new ParallelFrameDecoder(2);
    const initialization = decoder.initialize();

    instances[0].onerror?.({ message: "startup failed" } as ErrorEvent);
    instances[1].onmessage?.({
      data: { type: "ready", workerId: 1, mediabunnyAvailable: true },
    } as MessageEvent);

    await expect(initialization).rejects.toThrow("startup failed");
    expect(instances).toHaveLength(2);
    expect(instances[0].terminate).toHaveBeenCalledOnce();
    expect(instances[1].terminate).toHaveBeenCalledOnce();
    expect(revokeUrl).toHaveBeenCalledWith("blob:worker-0");
    expect(revokeUrl).toHaveBeenCalledWith("blob:worker-1");

    decoder.dispose();
    createUrl.mockRestore();
    revokeUrl.mockRestore();
    vi.unstubAllGlobals();
  });

  it("allows initialization to be retried after a failed attempt", async () => {
    const instances: Array<{
      onmessage: ((event: MessageEvent) => void) | null;
      onerror: ((event: ErrorEvent) => void) | null;
      onmessageerror: (() => void) | null;
      terminate: ReturnType<typeof vi.fn>;
      postMessage: ReturnType<typeof vi.fn>;
    }> = [];

    class MockWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      terminate = vi.fn();
      postMessage = vi.fn();
      constructor() {
        instances.push(this);
      }
    }

    vi.spyOn(URL, "createObjectURL").mockImplementation(
      () => `blob:worker-${instances.length}`,
    );
    vi.stubGlobal("Worker", MockWorker);

    const decoder = new ParallelFrameDecoder(1);
    const firstAttempt = decoder.initialize();
    instances[0].onerror?.({ message: "first attempt failed" } as ErrorEvent);
    await expect(firstAttempt).rejects.toThrow("first attempt failed");

    const secondAttempt = decoder.initialize();
    instances[1].onmessage?.({
      data: { type: "ready", workerId: 0, mediabunnyAvailable: true },
    } as MessageEvent);
    await expect(secondAttempt).resolves.toBeUndefined();
    expect(decoder.isAvailable()).toBe(true);

    decoder.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("does not let an initialization complete after the decoder is disposed", async () => {
    const instances: Array<{
      onmessage: ((event: MessageEvent) => void) | null;
      onerror: ((event: ErrorEvent) => void) | null;
      onmessageerror: (() => void) | null;
      terminate: ReturnType<typeof vi.fn>;
      postMessage: ReturnType<typeof vi.fn>;
    }> = [];

    class MockWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      terminate = vi.fn();
      postMessage = vi.fn();
      constructor() {
        instances.push(this);
      }
    }

    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:worker-init-race");
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL");
    vi.stubGlobal("Worker", MockWorker);

    const decoder = new ParallelFrameDecoder(1);
    const initialization = decoder.initialize();
    decoder.dispose();

    expect(instances[0].terminate).toHaveBeenCalledOnce();
    expect(revokeUrl).toHaveBeenCalledWith("blob:worker-init-race");

    instances[0].onmessage?.({
      data: { type: "ready", workerId: 0, mediabunnyAvailable: true },
    } as MessageEvent);

    await expect(initialization).rejects.toThrow(
      "Decoder disposed during initialization",
    );
    expect(decoder.isAvailable()).toBe(false);
    expect(decoder.getStats().workerCount).toBe(0);

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

});

describe("ParallelFrameDecoder request timeout", () => {
  it("rejects a stalled request and retires the unresponsive worker", async () => {
    vi.useFakeTimers();
    const decoder = Object.create(ParallelFrameDecoder.prototype) as ParallelFrameDecoder & {
      workers: Array<{
        worker: { terminate: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> };
        failed: boolean;
        busy: boolean;
        pendingRequests: Map<string, {
          resolve: (result: never) => void;
          reject: (error: Error) => void;
          clipId: string;
          startTime: number;
          timeoutId: ReturnType<typeof setTimeout>;
        }>;
        totalDecodes: number;
        totalDecodeTime: number;
        workerId: number;
        mediabunnyAvailable: boolean;
      }>;
      requestQueue: Array<{ reject: (error: Error) => void }>;
      requestIdCounter: number;
      requestTimeoutMs: number;
      sendDecodeRequest: (
        worker: (typeof decoder.workers)[number],
        request: { clipId: string; blob: Blob; time: number; width: number; height: number },
        resolve: (result: never) => void,
        reject: (error: Error) => void,
      ) => void;
    };

    const worker = {
      terminate: vi.fn(),
      postMessage: vi.fn(),
    };
    const state = {
      worker,
      workerId: 0,
      busy: false,
      pendingRequests: new Map(),
      totalDecodes: 0,
      totalDecodeTime: 0,
      mediabunnyAvailable: true,
      failed: false,
    };
    decoder.workers = [state];
    decoder.requestQueue = [];
    decoder.requestIdCounter = 0;
    decoder.requestTimeoutMs = 30000;

    const rejected = new Promise<Error>((resolve) => {
      decoder.sendDecodeRequest(
        state,
        { clipId: "clip-timeout", blob: new Blob(), time: 1, width: 10, height: 10 },
        () => undefined as never,
        resolve,
      );
    });

    expect(state.pendingRequests.size).toBe(1);
    await vi.advanceTimersByTimeAsync(30000);
    await expect(rejected).resolves.toMatchObject({
      message: expect.stringContaining("Decode request timed out"),
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(state.pendingRequests.size).toBe(0);
    vi.useRealTimers();
  });
});

describe("ParallelFrameDecoder request identity", () => {
  it("uses blob identity and output dimensions in the frame cache key", () => {
    const decoder = Object.create(ParallelFrameDecoder.prototype) as ParallelFrameDecoder & {
      blobIds: WeakMap<Blob, number>;
      nextBlobId: number;
      getCacheKey: (request: {
        clipId: string;
        blob: Blob;
        time: number;
        width: number;
        height: number;
      }) => string;
    };
    decoder.blobIds = new WeakMap();
    decoder.nextBlobId = 1;

    const blobA = new Blob(["a"]);
    const blobB = new Blob(["b"]);
    const base = {
      clipId: "clip-a",
      blob: blobA,
      time: 1.25,
      width: 640,
      height: 360,
    };

    const originalKey = decoder.getCacheKey(base);
    expect(decoder.getCacheKey({ ...base })).toBe(originalKey);
    expect(decoder.getCacheKey({ ...base, blob: blobB })).not.toBe(originalKey);
    expect(decoder.getCacheKey({ ...base, width: 1280 })).not.toBe(originalKey);
    expect(decoder.getCacheKey({ ...base, height: 720 })).not.toBe(originalKey);
  });
});

describe("ParallelFrameDecoder in-flight cleanup", () => {
  it("retains fan-out entries during dispose so final consumers can release shared bitmaps", () => {
    const decoder = Object.create(ParallelFrameDecoder.prototype) as ParallelFrameDecoder & {
      workers: Array<never>;
      workerUrls: string[];
      frameCache: Map<string, { bitmap: ImageBitmap; timestamp: number }>;
      inFlightDecodes: Map<string, { promise: Promise<{ clipId: string; bitmap: ImageBitmap | null; time: number }>; consumers: number }>;
      requestQueue: Array<{ reject: (error: Error) => void }>;
      initialized: boolean;
      initPromise: Promise<void> | null;
      lifecycleGeneration: number;
      clearCache: () => void;
      dispose: () => void;
    };

    const sharedBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const entry = {
      promise: Promise.resolve({ clipId: "clip-a", bitmap: sharedBitmap, time: 1 }),
      consumers: 1,
    };
    decoder.workers = [];
    decoder.workerUrls = [];
    decoder.frameCache = new Map();
    decoder.inFlightDecodes = new Map([["clip-a", entry]]);
    decoder.requestQueue = [];
    decoder.initialized = true;
    decoder.initPromise = null;
    decoder.lifecycleGeneration = 0;

    decoder.dispose();

    expect(decoder.inFlightDecodes.get("clip-a")).toBe(entry);
    expect(sharedBitmap.close).not.toHaveBeenCalled();
  });
});

describe("ParallelFrameDecoder cache race handling", () => {
  it("does not delete a replacement cache entry when an older bitmap clone fails", async () => {
    const decoder = Object.create(ParallelFrameDecoder.prototype) as ParallelFrameDecoder & {
      frameCache: Map<string, { bitmap: ImageBitmap; timestamp: number }>;
      cacheHits: number;
      cacheMisses: number;
      getCacheKey: (request: { clipId: string; blob: Blob; time: number; width: number; height: number }) => string;
      getFromCache: (request: { clipId: string; blob: Blob; time: number; width: number; height: number }) => Promise<ImageBitmap | null>;
    };
    const blob = new Blob(["source"]);
    const request = { clipId: "clip-a", blob, time: 1, width: 10, height: 10 };
    const original = { close: vi.fn() } as unknown as ImageBitmap;
    const replacement = { close: vi.fn() } as unknown as ImageBitmap;
    decoder.frameCache = new Map([["frame-key", { bitmap: original, timestamp: 1 }]]);
    decoder.cacheHits = 0;
    decoder.cacheMisses = 0;
    decoder.getCacheKey = vi.fn(() => "frame-key");

    let rejectClone!: (error: Error) => void;
    vi.stubGlobal("createImageBitmap", () => new Promise<ImageBitmap>((_, reject) => {
      rejectClone = reject;
    }));

    const lookup = decoder.getFromCache(request);
    decoder.frameCache.set("frame-key", { bitmap: replacement, timestamp: 2 });
    rejectClone(new Error("source bitmap closed"));

    await expect(lookup).resolves.toBeNull();
    expect(decoder.frameCache.get("frame-key")?.bitmap).toBe(replacement);
    vi.unstubAllGlobals();
  });

  it("continues cache eviction when the evicted bitmap close throws", () => {
    const decoder = Object.create(ParallelFrameDecoder.prototype) as ParallelFrameDecoder & {
      frameCache: Map<string, { bitmap: ImageBitmap; timestamp: number }>;
      maxCacheSize: number;
      addToCache: (key: string, bitmap: ImageBitmap) => void;
    };
    const stale = { close: vi.fn(() => { throw new Error("already closed"); }) } as unknown as ImageBitmap;
    const fresh = { close: vi.fn() } as unknown as ImageBitmap;
    decoder.frameCache = new Map([["old", { bitmap: stale, timestamp: 1 }]]);
    decoder.maxCacheSize = 1;

    expect(() => decoder.addToCache("new", fresh)).not.toThrow();
    expect(decoder.frameCache.has("old")).toBe(false);
    expect(decoder.frameCache.get("new")?.bitmap).toBe(fresh);
  });
});

describe("ParallelFrameDecoder worker scheduling", () => {
  it("rotates equally-loaded workers instead of favoring the first worker", () => {
    const decoder = Object.create(
      ParallelFrameDecoder.prototype,
    ) as ParallelFrameDecoder & {
      workers: Array<{
        workerId: number;
        failed: boolean;
        pendingRequests: Map<string, unknown>;
      }>;
      nextWorkerIndex: number;
      getLeastBusyWorker: () => { workerId: number } | null;
    };
    decoder.workers = [0, 1, 2].map((workerId) => ({
      workerId,
      failed: false,
      pendingRequests: new Map(),
    }));
    decoder.nextWorkerIndex = 0;

    expect([
      decoder.getLeastBusyWorker()?.workerId,
      decoder.getLeastBusyWorker()?.workerId,
      decoder.getLeastBusyWorker()?.workerId,
      decoder.getLeastBusyWorker()?.workerId,
    ]).toEqual([0, 1, 2, 0]);
  });

  it("chooses the least-loaded healthy worker while skipping failed workers", () => {
    const decoder = Object.create(
      ParallelFrameDecoder.prototype,
    ) as ParallelFrameDecoder & {
      workers: Array<{
        workerId: number;
        failed: boolean;
        pendingRequests: Map<string, unknown>;
      }>;
      nextWorkerIndex: number;
      getLeastBusyWorker: () => { workerId: number } | null;
    };
    decoder.workers = [
      { workerId: 0, failed: false, pendingRequests: new Map([["a", {}]]) },
      { workerId: 1, failed: true, pendingRequests: new Map() },
      { workerId: 2, failed: false, pendingRequests: new Map() },
    ];
    decoder.nextWorkerIndex = 0;

    expect(decoder.getLeastBusyWorker()?.workerId).toBe(2);
  });
});


describe("ParallelFrameDecoder response disposal race", () => {
  it("rejects a response whose caller bitmap clone completes after dispose", async () => {
    const decoder = Object.create(ParallelFrameDecoder.prototype) as ParallelFrameDecoder & {
      workers: Array<{
        failed: boolean;
        busy: boolean;
        pendingRequests: Map<string, {
          resolve: (result: never) => void;
          reject: (error: Error) => void;
          startTime: number;
          timeoutId: ReturnType<typeof setTimeout>;
          cacheKey: string;
          lifecycleGeneration?: number;
          settled?: boolean;
        }>;
        totalDecodes: number;
        totalDecodeTime: number;
        worker: { terminate: ReturnType<typeof vi.fn> };
      }>;
      activeResponseHandlers: Set<{
        reject: (error: Error) => void;
        lifecycleGeneration?: number;
        settled?: boolean;
      }>;
      frameCache: Map<string, { bitmap: ImageBitmap; timestamp: number }>;
      workerUrls: string[];
      requestQueue: Array<{ reject: (error: Error) => void }>;
      inFlightDecodes: Map<string, { promise: Promise<never>; consumers: number }>;
      initialized: boolean;
      initPromise: Promise<void> | null;
      lifecycleGeneration: number;
      maxCacheSize: number;
      cacheHits: number;
      cacheMisses: number;
      handleDecodeResponse: (state: (typeof decoder.workers)[number], response: {
        requestId: string; clipId: string; time: number; bitmap: ImageBitmap;
      }) => Promise<void>;
      dispose: () => void;
      processQueue: () => void;
      addToCache: (key: string, bitmap: ImageBitmap) => void;
    };

    let finishClone!: (bitmap: ImageBitmap) => void;
    const callerBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const cachedBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    vi.stubGlobal("createImageBitmap", () => new Promise<ImageBitmap>((resolve) => {
      finishClone = resolve;
    }));

    const rejectPending = vi.fn();
    const pending = {
      resolve: vi.fn(),
      reject: rejectPending,
      startTime: performance.now(),
      timeoutId: setTimeout(() => undefined, 60000),
      cacheKey: "frame-key",
      lifecycleGeneration: 0,
      settled: false,
    };
    const state = {
      failed: false,
      busy: true,
      pendingRequests: new Map([["request-1", pending]]),
      totalDecodes: 0,
      totalDecodeTime: 0,
      worker: { terminate: vi.fn() },
    };
    decoder.workers = [state];
    decoder.activeResponseHandlers = new Set();
    decoder.frameCache = new Map();
    decoder.workerUrls = [];
    decoder.requestQueue = [];
    decoder.inFlightDecodes = new Map();
    decoder.initialized = true;
    decoder.initPromise = null;
    decoder.lifecycleGeneration = 0;
    decoder.maxCacheSize = 100;
    decoder.cacheHits = 0;
    decoder.cacheMisses = 0;
    decoder.processQueue = vi.fn();
    decoder.addToCache = () => {
      decoder.frameCache.set("frame-key", { bitmap: cachedBitmap, timestamp: 1 });
    };

    const responseHandling = decoder.handleDecodeResponse(state, {
      requestId: "request-1",
      clipId: "clip-a",
      time: 1,
      bitmap: { close: vi.fn() } as unknown as ImageBitmap,
    });
    await Promise.resolve();

    decoder.dispose();
    expect(rejectPending).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Decoder disposed" }),
    );

    finishClone(callerBitmap);
    await responseHandling;

    expect(callerBitmap.close).toHaveBeenCalledOnce();
    expect(pending.resolve).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});


describe("ParallelFrameDecoder cache disposal race", () => {
  it("closes a cached bitmap clone that completes after dispose", async () => {
    const decoder = Object.create(ParallelFrameDecoder.prototype) as ParallelFrameDecoder & {
      frameCache: Map<string, { bitmap: ImageBitmap; timestamp: number }>;
      cacheHits: number;
      cacheMisses: number;
      lifecycleGeneration: number;
      getCacheKey: (request: { clipId: string; blob: Blob; time: number; width: number; height: number }) => string;
      getFromCache: (request: { clipId: string; blob: Blob; time: number; width: number; height: number }) => Promise<ImageBitmap | null>;
    };
    const source = { close: vi.fn() } as unknown as ImageBitmap;
    const lateClone = { close: vi.fn() } as unknown as ImageBitmap;
    decoder.frameCache = new Map([["frame-key", { bitmap: source, timestamp: 1 }]]);
    decoder.cacheHits = 0;
    decoder.cacheMisses = 0;
    decoder.lifecycleGeneration = 0;
    decoder.getCacheKey = vi.fn(() => "frame-key");

    let finishClone!: (bitmap: ImageBitmap) => void;
    vi.stubGlobal("createImageBitmap", () => new Promise<ImageBitmap>((resolve) => {
      finishClone = resolve;
    }));

    const lookup = decoder.getFromCache({
      clipId: "clip-a", blob: new Blob(["source"]), time: 1, width: 10, height: 10,
    });
    decoder.lifecycleGeneration++;
    finishClone(lateClone);

    await expect(lookup).resolves.toBeNull();
    expect(lateClone.close).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});


describe("ParallelFrameDecoder worker failure during response cloning", () => {
  it("rejects an active response clone when its worker fails", async () => {
    const decoder = Object.create(ParallelFrameDecoder.prototype) as ParallelFrameDecoder & {
      workers: Array<{
        failed: boolean;
        busy: boolean;
        pendingRequests: Map<string, {
          resolve: (result: never) => void;
          reject: (error: Error) => void;
          startTime: number;
          timeoutId: ReturnType<typeof setTimeout>;
          cacheKey: string;
          settled?: boolean;
        }>;
        totalDecodes: number;
        totalDecodeTime: number;
        worker: { terminate: ReturnType<typeof vi.fn> };
      }>;
      activeResponseHandlers: Map<object, unknown>;
      frameCache: Map<string, { bitmap: ImageBitmap; timestamp: number }>;
      requestQueue: Array<{ reject: (error: Error) => void }>;
      lifecycleGeneration: number;
      maxCacheSize: number;
      handleDecodeResponse: (state: (typeof decoder.workers)[number], response: {
        requestId: string; clipId: string; time: number; bitmap: ImageBitmap;
      }) => Promise<void>;
      failWorker: (state: (typeof decoder.workers)[number], error: Error) => void;
      processQueue: () => void;
      addToCache: (key: string, bitmap: ImageBitmap) => void;
    };

    let finishClone!: (bitmap: ImageBitmap) => void;
    const callerBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    vi.stubGlobal("createImageBitmap", () => new Promise<ImageBitmap>((resolve) => {
      finishClone = resolve;
    }));

    const rejectPending = vi.fn();
    const pending = {
      resolve: vi.fn(),
      reject: rejectPending,
      startTime: performance.now(),
      timeoutId: setTimeout(() => undefined, 60000),
      cacheKey: "frame-key",
      settled: false,
    };
    const state = {
      failed: false,
      busy: true,
      pendingRequests: new Map([["request-1", pending]]),
      totalDecodes: 0,
      totalDecodeTime: 0,
      worker: { terminate: vi.fn() },
    };
    decoder.workers = [state];
    decoder.activeResponseHandlers = new Map();
    decoder.frameCache = new Map();
    decoder.requestQueue = [];
    decoder.lifecycleGeneration = 0;
    decoder.maxCacheSize = 100;
    decoder.processQueue = vi.fn();
    decoder.addToCache = vi.fn();
    const handling = decoder.handleDecodeResponse(state, {
      requestId: "request-1",
      clipId: "clip-a",
      time: 1,
      bitmap: { close: vi.fn() } as unknown as ImageBitmap,
    });
    await Promise.resolve();

    decoder.failWorker(state, new Error("worker crashed"));
    expect(rejectPending).toHaveBeenCalledWith(
      expect.objectContaining({ message: "worker crashed" }),
    );

    finishClone(callerBitmap);
    await handling;
    expect(callerBitmap.close).toHaveBeenCalledOnce();
    expect(pending.resolve).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});


describe("ParallelFrameDecoder fan-out disposal race", () => {
  it("closes a caller clone that finishes after dispose", async () => {
    const decoder = Object.create(ParallelFrameDecoder.prototype) as ParallelFrameDecoder & {
      initialized: boolean;
      lifecycleGeneration: number;
      inFlightDecodes: Map<string, {
        promise: Promise<{ clipId: string; bitmap: ImageBitmap; time: number }>;
        consumers: number;
      }>;
      getCacheKey: (request: { clipId: string; blob: Blob; time: number; width: number; height: number }) => string;
      getFromCache: () => Promise<null>;
    };
    const sharedBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const callerBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    let finishClone!: (bitmap: ImageBitmap) => void;
    vi.stubGlobal("createImageBitmap", () => new Promise<ImageBitmap>((resolve) => {
      finishClone = resolve;
    }));

    decoder.initialized = true;
    decoder.lifecycleGeneration = 0;
    decoder.getCacheKey = vi.fn(() => "frame-key");
    decoder.getFromCache = vi.fn(async () => null);
    decoder.inFlightDecodes = new Map([["frame-key", {
      promise: Promise.resolve({ clipId: "clip-a", bitmap: sharedBitmap, time: 1 }),
      consumers: 0,
    }]]);

    const decoding = decoder.decodeFrame({
      clipId: "clip-a", blob: new Blob(["source"]), time: 1, width: 10, height: 10,
    });
    await Promise.resolve();
    await Promise.resolve();

    decoder.lifecycleGeneration++;
    finishClone(callerBitmap);

    await expect(decoding).rejects.toThrow("Decoder disposed");
    expect(callerBitmap.close).toHaveBeenCalledOnce();
    expect(sharedBitmap.close).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
