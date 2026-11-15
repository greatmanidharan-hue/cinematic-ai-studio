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
      failWorker: (state: (typeof decoder.workers)[number], error: Error) => void;
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
