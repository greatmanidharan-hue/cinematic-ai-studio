import { describe, expect, it } from "vitest";
import { getClipFilmstripThumbnailCount, generateWaveformPath } from "./utils";

describe("timeline clip rendering helpers", () => {
  describe("getClipFilmstripThumbnailCount", () => {
    it("returns one cell for clips narrower than a thumbnail cell", () => {
      expect(getClipFilmstripThumbnailCount(12)).toBe(1);
      expect(getClipFilmstripThumbnailCount(59)).toBe(1);
    });

    it("scales thumbnail count with clip width", () => {
      expect(getClipFilmstripThumbnailCount(60)).toBe(1);
      expect(getClipFilmstripThumbnailCount(240)).toBe(4);
    });

    it("caps filmstrip DOM work for very wide clips", () => {
      expect(getClipFilmstripThumbnailCount(60_000)).toBe(96);
    });

    it("handles invalid dimensions safely", () => {
      expect(getClipFilmstripThumbnailCount(Number.NaN)).toBe(1);
      expect(getClipFilmstripThumbnailCount(Number.POSITIVE_INFINITY)).toBe(1);
      expect(getClipFilmstripThumbnailCount(600, 0)).toBe(1);
      expect(getClipFilmstripThumbnailCount(600, 60, 0)).toBe(1);
    });

    it("supports an explicit cap and cell width", () => {
      expect(getClipFilmstripThumbnailCount(500, 50, 6)).toBe(6);
      expect(getClipFilmstripThumbnailCount(500, 100, 20)).toBe(5);
    });
  });

  describe("generateWaveformPath", () => {
    it("returns a stable baseline for empty waveform data", () => {
      expect(generateWaveformPath([], 100)).toBe("M0,20 L100,20");
    });

    it("creates a bounded number of points for a waveform", () => {
      const path = generateWaveformPath([0, 0.5, -1, 0.25], 4);
      expect(path.split(" L")).toHaveLength(4);
      expect(path.startsWith("M0,20")).toBe(true);
    });
  });
});
