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
});
