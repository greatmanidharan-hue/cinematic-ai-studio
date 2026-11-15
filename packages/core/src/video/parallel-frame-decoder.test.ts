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
