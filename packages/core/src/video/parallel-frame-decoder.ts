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
  private maxCacheSize = 100;
  private cacheHits = 0;
  private cacheMisses = 0;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
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

    this.initPromise = this.doInitialize().catch((error: unknown) => {
      // A rejected initialization must not permanently poison future retries.
      this.initPromise = null;
      throw error;
    });
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    this.workers = [];
    const workerPromises: Promise<WorkerState>[] = [];

    for (let i = 0; i < this.workerCount; i++) {
      workerPromises.push(this.createWorker(i));
    }

    // Wait for every startup attempt so workers that succeeded after another
    // worker failed are also included in cleanup.
    const results = await Promise.allSettled(workerPromises);
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

  private async createWorker(index: number): Promise<WorkerState> {
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

    state.pendingRequests.delete(response.requestId);
    state.busy = state.pendingRequests.size > 0;

    const decodeTime = performance.now() - pending.startTime;
    state.totalDecodes++;
    state.totalDecodeTime += decodeTime;

    let bitmapForCaller: ImageBitmap | null = null;

    if (response.bitmap) {
      const cacheKey = `${response.clipId}:${response.time.toFixed(3)}`;
      this.addToCache(cacheKey, response.bitmap);
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
        old?.bitmap.close();
        this.frameCache.delete(oldestKey);
      }
    }

    this.frameCache.set(key, { bitmap, timestamp: performance.now() });
  }

  private async getFromCache(
    clipId: string,
    time: number,
  ): Promise<ImageBitmap | null> {
    const cacheKey = `${clipId}:${time.toFixed(3)}`;
    const cached = this.frameCache.get(cacheKey);

    if (cached) {
      cached.timestamp = performance.now();
      this.cacheHits++;
      try {
        return await createImageBitmap(cached.bitmap);
      } catch {
        this.frameCache.delete(cacheKey);
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
      worker.pendingRequests.delete(requestId);
      reject(workerError);
      this.failWorker(worker, workerError);
    }
  }

  async decodeFrame(request: FrameDecodeRequest): Promise<FrameDecodeResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const cached = await this.getFromCache(request.clipId, request.time);
    if (cached) {
      return {
        clipId: request.clipId,
        bitmap: cached,
        time: request.time,
      };
    }

    return new Promise((resolve, reject) => {
      const worker = this.getLeastBusyWorker();

      if (worker && worker.pendingRequests.size < 2) {
        this.sendDecodeRequest(worker, request, resolve, reject);
      } else if (!worker) {
        reject(new Error("No healthy parallel decode workers are available"));
      } else {
        this.requestQueue.push({ request, resolve, reject });
      }
    });
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
      cached.bitmap.close();
    }
    this.frameCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  dispose(): void {
    for (const worker of this.workers) {
      for (const [, pending] of worker.pendingRequests) {
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
