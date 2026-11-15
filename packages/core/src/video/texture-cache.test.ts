import { describe, expect, it, vi } from "vitest";
import { TextureCache } from "./texture-cache";

function createTexture() {
  return { destroy: vi.fn() } as unknown as GPUTexture;
}

describe("TextureCache eviction reliability", () => {
  it("removes and destroys entries even when the eviction callback throws", () => {
    const firstTexture = createTexture();
    const secondTexture = createTexture();
    const callbackError = new Error("observer failed");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const cache = new TextureCache({
      maxSize: 8,
      onEvict: () => {
        throw callbackError;
      },
    });

    try {
      cache.set("clip-a", 0, firstTexture, 4);
      cache.set("clip-b", 1, secondTexture, 4);

      cache.evict("clip-a");

      expect(firstTexture.destroy).toHaveBeenCalledOnce();
      expect(cache.has("clip-a", 0)).toBe(false);
      expect(cache.getMemoryUsage()).toBe(4);
      expect(cache.getCount()).toBe(1);
      expect(warn).toHaveBeenCalledWith(
        "[TextureCache] Eviction callback failed:",
        callbackError,
      );

      cache.clear();

      expect(secondTexture.destroy).toHaveBeenCalledOnce();
      expect(cache.getMemoryUsage()).toBe(0);
      expect(cache.getCount()).toBe(0);
    } finally {
      warn.mockRestore();
    }
  });

  it("keeps memory accounting correct when replacing an existing key", () => {
    const oldTexture = createTexture();
    const newTexture = createTexture();
    const cache = new TextureCache({ maxSize: 16 });

    cache.set("clip-a", 0, oldTexture, 8);
    cache.set("clip-a", 0, newTexture, 4);

    expect(oldTexture.destroy).toHaveBeenCalledOnce();
    expect(cache.get("clip-a", 0)).toBe(newTexture);
    expect(cache.getMemoryUsage()).toBe(4);
    expect(cache.getCount()).toBe(1);
  });
});
