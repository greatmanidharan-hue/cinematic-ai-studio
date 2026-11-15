import { describe, expect, it, vi } from "vitest";
import { VideoEngine } from "./video-engine";

type CacheTestEngine = VideoEngine & {
  frameCache: Map<string, { image: ImageBitmap; sizeBytes: number }>;
  gifFrameCache: Map<string, { frames: ImageBitmap[] }>;
  interpFrameCache: Map<string, { bitmap: ImageBitmap; time: number }>;
  cacheStats: { hits: number; misses: number };
  cacheConfig: { maxFrames: number; maxSizeBytes: number };
  cacheFrame: (key: string, image: ImageBitmap, mediaId: string) => void;
  setCachedInterpFrame: (key: string, bitmap: ImageBitmap) => void;
  getTotalCacheSize: () => number;
};

function createEngine(): CacheTestEngine {
  const engine = Object.create(VideoEngine.prototype) as CacheTestEngine;
  engine.frameCache = new Map();
  engine.gifFrameCache = new Map();
  engine.interpFrameCache = new Map();
  engine.cacheStats = { hits: 0, misses: 0 };
  engine.cacheConfig = { maxFrames: 10, maxSizeBytes: 1024 * 1024 };
  return engine;
}

function createBitmap(width = 10, height = 10) {
  return {
    width,
    height,
    close: vi.fn(),
  } as unknown as ImageBitmap;
}

describe("VideoEngine frame cache ownership", () => {
  it("closes an existing decoded frame when its cache key is replaced", () => {
    const engine = createEngine();
    const previous = createBitmap();
    const replacement = createBitmap();

    engine.cacheFrame("media-a:1.0000", previous, "media-a");
    engine.cacheFrame("media-a:1.0000", replacement, "media-a");

    expect(previous.close).toHaveBeenCalledOnce();
    expect(engine.frameCache.size).toBe(1);
    expect(engine.frameCache.get("media-a:1.0000")?.image).toBe(replacement);
    expect(engine.getTotalCacheSize()).toBe(400);
  });

  it("closes interpolation cache bitmaps when the frame cache is cleared", () => {
    const engine = createEngine();
    const interpolationBitmap = createBitmap();
    engine.setCachedInterpFrame("media-a:1.0000", interpolationBitmap);

    engine.clearCache();

    expect(interpolationBitmap.close).toHaveBeenCalledOnce();
    expect(engine.interpFrameCache.size).toBe(0);
  });

  it("closes an interpolation bitmap when the same key is replaced", () => {
    const engine = createEngine();
    const previous = createBitmap();
    const replacement = createBitmap();

    engine.setCachedInterpFrame("media-a:1.0000", previous);
    engine.setCachedInterpFrame("media-a:1.0000", replacement);

    expect(previous.close).toHaveBeenCalledOnce();
    expect(engine.interpFrameCache.size).toBe(1);
    expect(engine.interpFrameCache.get("media-a:1.0000")?.bitmap).toBe(
      replacement,
    );
  });
});
