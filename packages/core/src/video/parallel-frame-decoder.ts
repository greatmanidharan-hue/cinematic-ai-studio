import type {
  DecodeRequest,
  DecodeResponse,
  WorkerResponse,
} from "./decode-worker";
import { createDecodeWorkerUrl } from "./decode-worker";

export interface FrameDecodeRequest {
  clipId: string;
  blob: Blob;
  time: number;
  width: number;
  height: number;
}

export interface FrameDecodeResult {
  clipId: string;
  bitmap: ImageBitmap | null;
  time: number;
  error?: string;
}

interface PendingRequest {
  resolve: (result: FrameDecodeResult) => void;
  reject: (error: Error) => void;
  clipId: string;
  startTime: number;
  timeoutId: ReturnType<typeof setTimeout>;
  cacheKey: string;
}

interface InFlightDecode {
  promise: Promise<FrameDecodeResult>;
  consumers: number;
}

interface WorkerState {
  worker: Worker;
  workerId: number;
  busy: boolean;
  pendingRequests: Map<string, PendingRequest>;
  totalDecodes: number;
  totalDecodeTime: number;
  mediabunnyAvailable: boolean;
  failed: boolean;
}

export interface ParallelDecoderStats {
  workerCount: number;
  totalDecodes: number;
  averageDecodeTime: number;
  pendingRequests: number;
  cacheHits: number;
  cacheMisses: number;
}

export class ParallelFrameDecoder {
  private workers: WorkerState[] = [];
  private workerUrls: string[] = [];
  private requestQueue: Array<{
    request: FrameDecodeRequest;
    resolve: (result: FrameDecodeResult) => void;
    reject: (error: Error) => void;
  }> = [];
  private frameCache: Map<string, { bitmap: ImageBitmap; timestamp: number }> =
    new Map();
  private readonly blobIds = new WeakMap<Blob, number>();
  private readonly inFlightDecodes = new Map<string, InFlightDecode>();
  private nextBlobId = 1;
  private maxCacheSize = 100;
  private readonly requestTimeoutMs = 30000;
  private readonly maxQueueSize = 500;
  private cacheHits = 0;
  private cacheMisses = 0;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private lifecycleGeneration = 0;
  private requestIdCounter = 0;
  private mediabunnyAvailable = false;

  constructor(private workerCount: number = 4) {
    this.workerCount = Math.max(
      1,
      Math.min(workerCount, navigator.hardwareConcurrency || 4),
    );
  }

  isAvailable(): boolean {
    return this.initialized && this.mediabunnyAvailable;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    const generation = this.lifecycleGeneration;
    let attempt: Promise<void>;
    attempt = this.doInitialize(generation).catch((error: unknown) => {
      // An older attempt must not clear a newer attempt started after dispose.
      if (this.initPromise === attempt) this.initPromise = null;
      throw error;
    });
    this.initPromise = attempt;
    return attempt;
  }

  private async doInitialize(generation: number): Promise<void> {
    this.workers = [];
    const workerPromises: Promise<WorkerState>[] = [];

    for (let i = 0; i < this.workerCount; i++) {
      workerPromises.push(this.createWorker(i, generation));
    }

    // Wait for every startup attempt so workers that succeeded after another
    // worker failed are also included in cleanup.
    const results = await Promise.allSettled(workerPromises);
    if (generation !== this.lifecycleGeneration) {
      throw new Error("Decoder disposed during initialization");
    }
    const failed = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    if (failed) {
      this.cleanupWorkers(new Error("Parallel decoder initialization failed"));
      throw failed.reason;
    }

    this.mediabunnyAvailable = this.workers.some(
      (worker) => worker.mediabunnyAvailable,
    );
    this.initialized = true;
  }

  private async createWorker(
    index: number,
    generation: number,
  ): Promise<WorkerState> {
    return new Promise((resolve, reject) => {
      const workerUrl = createDecodeWorkerUrl();
      this.workerUrls.push(workerUrl);

      let worker: Worker;
      try {
        worker = new Worker(workerUrl, { type: "module" });
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Worker creation failed"));
        return;
      }

      const state: WorkerState = {
        worker,
        workerId: index,
        busy: false,
        pendingRequests: new Map(),
        totalDecodes: 0,
        totalDecodeTime: 0,
        mediabunnyAvailable: false,
        failed: false,
      };
      // Track workers immediately, not only after all workers become ready.
      if (generation !== this.lifecycleGeneration) {
        state.failed = true;
        worker.terminate();
        reject(new Error("Decoder disposed during initialization"));
        return;
      }
      this.workers.push(state);

      const initTimeout = setTimeout(() => {
        const error = new Error(`Worker ${index} initialization timed out`);
        this.failWorker(state, error);
        reject(error);
      }, 10000);

      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const response = event.data;

        if (state.failed) {
          if (response.type === "decoded") response.bitmap?.close();
          return;
        }

        if (response.type === "ready") {
          clearTimeout(initTimeout);
          state.workerId = response.workerId;
          state.mediabunnyAvailable = response.mediabunnyAvailable ?? false;
          if (state.mediabunnyAvailable) {
          } else {
          }
          resolve(state);
          return;
        }

        if (response.type === "decoded") {
          this.handleDecodeResponse(state, response);
        }
      };

      worker.onerror = (event) => {
        console.error(`[ParallelFrameDecoder] Worker ${index} error:`, event);
        clearTimeout(initTimeout);
        const error = new Error(
          event.message || `Worker ${index} failed`,
        );
        this.failWorker(state, error);
        reject(error);
      };

      worker.onmessageerror = () => {
        const error = new Error(`Worker ${index} message could not be decoded`);
        clearTimeout(initTimeout);
        this.failWorker(state, error);
        reject(error);
      };

      try {
        worker.postMessage({ type: "init" });
      } catch (error) {
        clearTimeout(initTimeout);
        const workerError = error instanceof Error
          ? error
          : new Error(`Worker ${index} initialization message failed`);
        this.failWorker(state, workerError);
        reject(workerError);
      }
    });
  }

  private cleanupWorkers(error: Error): void {
    for (const state of this.workers) {
      state.failed = true;
      state.busy = false;
      try {
        state.worker.terminate();
      } catch {
        // Continue cleaning up the remaining workers.
      }
      for (const pending of state.pendingRequests.values()) {
        clearTimeout(pending.timeoutId);
        pending.reject(error);
      }
      state.pendingRequests.clear();
    }
    this.workers = [];

    for (const url of this.workerUrls) {
      URL.revokeObjectURL(url);
    }
    this.workerUrls = [];
    this.mediabunnyAvailable = false;
    this.initialized = false;
  }

  private async handleDecodeResponse(
    state: WorkerState,
    response: DecodeResponse,
  ): Promise<void> {
    const pending = state.pendingRequests.get(response.requestId);
    if (!pending) {
      // A late response can arrive after its request was rejected or disposed.
      response.bitmap?.close();
      console.warn(
        `[ParallelFrameDecoder] No pending request for ${response.requestId}`,
      );
      return;
    }

    clearTimeout(pending.timeoutId);
    state.pendingRequests.delete(response.requestId);
    state.busy = state.pendingRequests.size > 0;

    const decodeTime = performance.now() - pending.startTime;
    state.totalDecodes++;
    state.totalDecodeTime += decodeTime;

    let bitmapForCaller: ImageBitmap | null = null;

    if (response.bitmap) {
      this.addToCache(pending.cacheKey, response.bitmap);
      try {
        bitmapForCaller = await createImageBitmap(response.bitmap);
      } catch {
        bitmapForCaller = null;
      }
    }

    pending.resolve({
      clipId: response.clipId,
      bitmap: bitmapForCaller,
      time: response.time,
      error: response.error,
    });

    this.processQueue();
  }

  private addToCache(key: string, bitmap: ImageBitmap): void {
    // Re-decoding an already cached frame must release the previous bitmap.
    const existing = this.frameCache.get(key);
    if (existing) {
      try {
        existing.bitmap.close();
      } catch {
        // Continue replacing the entry even if the old bitmap is already closed.
      }
      this.frameCache.delete(key);
    }

    if (this.frameCache.size >= this.maxCacheSize) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;

      for (const [k, v] of this.frameCache) {
        if (v.timestamp < oldestTime) {
          oldestTime = v.timestamp;
          oldestKey = k;
        }
      }

      if (oldestKey) {
        const old = this.frameCache.get(oldestKey);
        try {
          old?.bitmap.close();
        } catch {
          // Eviction must continue even if a bitmap was already released.
        }
        this.frameCache.delete(oldestKey);
      }
    }

    this.frameCache.set(key, { bitmap, timestamp: performance.now() });
  }

  private getCacheKey(request: FrameDecodeRequest): string {
    let blobId = this.blobIds.get(request.blob);
    if (blobId === undefined) {
      blobId = this.nextBlobId++;
      this.blobIds.set(request.blob, blobId);
    }
    return `${request.clipId}:${blobId}:${request.time.toFixed(3)}:${request.width}x${request.height}`;
  }

  private async getFromCache(
    request: FrameDecodeRequest,
  ): Promise<ImageBitmap | null> {
    const cacheKey = this.getCacheKey(request);
    const cached = this.frameCache.get(cacheKey);

    if (cached) {
      cached.timestamp = performance.now();
      this.cacheHits++;
      try {
        return await createImageBitmap(cached.bitmap);
      } catch {
        // A replacement may have been inserted while cloning was pending.
        // Only remove the entry whose bitmap actually failed to clone.
        if (this.frameCache.get(cacheKey) === cached) {
          this.frameCache.delete(cacheKey);
        }
        return null;
      }
    }

    this.cacheMisses++;
    return null;
  }

  private failWorker(state: WorkerState, error: Error): void {
    if (state.failed) return;
    state.failed = true;
    state.busy = false;
    state.worker.terminate();

    for (const pending of state.pendingRequests.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(error);
    }
    state.pendingRequests.clear();
    this.processQueue();
  }

  private getLeastBusyWorker(): WorkerState | null {
    let leastBusy: WorkerState | null = null;
    let minPending = Infinity;

    for (const worker of this.workers) {
      if (worker.failed) continue;
      if (worker.pendingRequests.size < minPending) {
        minPending = worker.pendingRequests.size;
        leastBusy = worker;
      }
    }

    return leastBusy;
  }

  private processQueue(): void {
    while (this.requestQueue.length > 0) {
      const worker = this.getLeastBusyWorker();
      if (!worker) {
        const error = new Error("All parallel decode workers have failed");
        for (const item of this.requestQueue.splice(0)) {
          item.reject(error);
        }
        break;
      }
      if (worker.pendingRequests.size >= 2) {
        break;
      }

      const item = this.requestQueue.shift();
      if (item) {
        this.sendDecodeRequest(worker, item.request, item.resolve, item.reject);
      }
    }
  }

  private sendDecodeRequest(
    worker: WorkerState,
    request: FrameDecodeRequest,
    resolve: (result: FrameDecodeResult) => void,
    reject: (error: Error) => void,
  ): void {
    const requestId = `req_${this.requestIdCounter++}`;

    const pending: PendingRequest = {
      resolve,
      reject,
      clipId: request.clipId,
      startTime: performance.now(),
      cacheKey: this.getCacheKey(request),
      timeoutId: setTimeout(() => {
        if (!worker.pendingRequests.has(requestId)) return;
        worker.pendingRequests.delete(requestId);
        worker.busy = worker.pendingRequests.size > 0;
        const timeoutError = new Error(
          `Decode request timed out after ${this.requestTimeoutMs}ms (clip: ${request.clipId})`,
        );
        reject(timeoutError);
        // A worker that stops responding is no longer safe to schedule.
        this.failWorker(worker, timeoutError);
      }, this.requestTimeoutMs),
    };

    worker.pendingRequests.set(requestId, pending);
    worker.busy = true;

    const decodeRequest: DecodeRequest = {
      type: "decode",
      requestId,
      clipId: request.clipId,
      blob: request.blob,
      time: request.time,
      width: request.width,
      height: request.height,
    };

    try {
      worker.worker.postMessage(decodeRequest);
    } catch (error) {
      const workerError =
        error instanceof Error
          ? error
          : new Error("Failed to send decode request to worker");
      clearTimeout(pending.timeoutId);
      worker.pendingRequests.delete(requestId);
      reject(workerError);
      this.failWorker(worker, workerError);
    }
  }

  async decodeFrame(request: FrameDecodeRequest): Promise<FrameDecodeResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const cacheKey = this.getCacheKey(request);
    const cached = await this.getFromCache(request);
    if (cached) {
      return {
        clipId: request.clipId,
        bitmap: cached,
        time: request.time,
      };
    }

    let entry = this.inFlightDecodes.get(cacheKey);
    if (!entry) {
      const promise = new Promise<FrameDecodeResult>((resolve, reject) => {
        const worker = this.getLeastBusyWorker();

        if (worker && worker.pendingRequests.size < 2) {
          this.sendDecodeRequest(worker, request, resolve, reject);
        } else if (!worker) {
          reject(new Error("No healthy parallel decode workers are available"));
        } else if (this.requestQueue.length >= this.maxQueueSize) {
          reject(new Error("Parallel decode queue is full"));
        } else {
          this.requestQueue.push({ request, resolve, reject });
        }
      });
      entry = { promise, consumers: 0 };
      this.inFlightDecodes.set(cacheKey, entry);
    }

    entry.consumers++;
    try {
      const shared = await entry.promise;
      let bitmap: ImageBitmap | null = null;
      if (shared.bitmap) {
        try {
          bitmap = await createImageBitmap(shared.bitmap);
        } catch {
          bitmap = null;
        }
      }
      return { ...shared, bitmap };
    } finally {
      entry.consumers--;
      if (entry.consumers === 0 && this.inFlightDecodes.get(cacheKey) === entry) {
        this.inFlightDecodes.delete(cacheKey);
        // The shared bitmap is an internal fan-out source; each caller receives
        // its own clone and the shared source is released after the final clone.
        try {
          const settled = await entry.promise;
          settled.bitmap?.close();
        } catch {
          // Cleanup must not turn a completed decode into a rejected request.
        }
      }
    }
  }

  async decodeFrames(
    requests: FrameDecodeRequest[],
  ): Promise<Map<string, FrameDecodeResult>> {
    if (!this.initialized) {
      await this.initialize();
    }

    const results = new Map<string, FrameDecodeResult>();
    const pending: Promise<FrameDecodeResult>[] = [];

    for (const request of requests) {
      pending.push(this.decodeFrame(request));
    }

    const resolved = await Promise.all(pending);
    for (const result of resolved) {
      results.set(result.clipId, result);
    }

    return results;
  }

  async decodeClipsAtTime(
    clips: Array<{ clipId: string; blob: Blob; time: number }>,
    width: number,
    height: number,
  ): Promise<Map<string, ImageBitmap>> {
    const requests: FrameDecodeRequest[] = clips.map((clip) => ({
      clipId: clip.clipId,
      blob: clip.blob,
      time: clip.time,
      width,
      height,
    }));

    const results = await this.decodeFrames(requests);
    const bitmaps = new Map<string, ImageBitmap>();

    for (const [clipId, result] of results) {
      if (result.bitmap) {
        bitmaps.set(clipId, result.bitmap);
      }
    }

    return bitmaps;
  }

  getStats(): ParallelDecoderStats {
    let totalDecodes = 0;
    let totalTime = 0;
    let pendingCount = 0;

    for (const worker of this.workers) {
      totalDecodes += worker.totalDecodes;
      totalTime += worker.totalDecodeTime;
      pendingCount += worker.pendingRequests.size;
    }

    return {
      workerCount: this.workers.length,
      totalDecodes,
      averageDecodeTime: totalDecodes > 0 ? totalTime / totalDecodes : 0,
      pendingRequests: pendingCount + this.requestQueue.length,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
    };
  }

  clearCache(): void {
    for (const [, cached] of this.frameCache) {
      try {
        cached.bitmap.close();
      } catch {
        // Continue clearing the remaining cached bitmaps.
      }
    }
    this.frameCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  dispose(): void {
    // Invalidate any in-flight initialization before terminating its workers.
    this.lifecycleGeneration++;
    for (const worker of this.workers) {
      for (const [, pending] of worker.pendingRequests) {
        clearTimeout(pending.timeoutId);
        pending.reject(new Error("Decoder disposed"));
      }
      worker.worker.terminate();
    }
    this.workers = [];

    for (const url of this.workerUrls) {
      URL.revokeObjectURL(url);
    }
    this.workerUrls = [];

    this.clearCache();
    // Keep fan-out entries until their consumers settle. Each entry owns a
    // shared bitmap that is released by the final consumer in decodeFrame().
    // Clearing this map here would prevent that final-consumer cleanup.

    for (const item of this.requestQueue) {
      item.reject(new Error("Decoder disposed"));
    }
    this.requestQueue = [];

    this.initialized = false;
    this.initPromise = null;
  }
}

let parallelDecoderInstance: ParallelFrameDecoder | null = null;

export function getParallelFrameDecoder(): ParallelFrameDecoder {
  if (!parallelDecoderInstance) {
    const workerCount = Math.min(4, navigator.hardwareConcurrency || 4);
    parallelDecoderInstance = new ParallelFrameDecoder(workerCount);
  }
  return parallelDecoderInstance;
}

export async function initializeParallelDecoder(
  workerCount?: number,
): Promise<ParallelFrameDecoder> {
  if (parallelDecoderInstance) {
    parallelDecoderInstance.dispose();
  }
  parallelDecoderInstance = new ParallelFrameDecoder(workerCount);
  await parallelDecoderInstance.initialize();
  return parallelDecoderInstance;
}

export function disposeParallelDecoder(): void {
  if (parallelDecoderInstance) {
    parallelDecoderInstance.dispose();
    parallelDecoderInstance = null;
  }
}
