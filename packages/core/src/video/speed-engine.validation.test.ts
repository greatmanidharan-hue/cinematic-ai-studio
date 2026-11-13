import { describe, expect, it } from "vitest";
import { SpeedEngine } from "./speed-engine";

describe("SpeedEngine input validation", () => {
  it("rejects non-finite speed values instead of storing NaN", () => {
    const engine = new SpeedEngine();
    for (const speed of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => engine.setClipSpeed("clip", speed, 10)).toThrow(RangeError);
    }
    expect(engine.getClipSpeed("clip")).toBe(1);
  });

  it("rejects invalid original durations", () => {
    const engine = new SpeedEngine();
    for (const duration of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => engine.setClipSpeed("clip", 1, duration)).toThrow(RangeError);
    }
  });

  it("allows finite speed values and clamps them to supported bounds", () => {
    const engine = new SpeedEngine();
    engine.setClipSpeed("slow", 0.01, 10);
    engine.setClipSpeed("fast", 100, 10);
    expect(engine.getClipSpeed("slow")).toBe(0.1);
    expect(engine.getClipSpeed("fast")).toBe(20);
  });

  it("rejects speed keyframes outside the clip's source-time range", () => {
    const engine = new SpeedEngine();
    engine.initializeClip("clip", 10);
    expect(() => engine.addSpeedKeyframe("clip", -0.1, 1)).toThrow(RangeError);
    expect(() => engine.addSpeedKeyframe("clip", 10.1, 1)).toThrow(RangeError);
    expect(() => engine.addSpeedKeyframe("clip", Number.NaN, 1)).toThrow(RangeError);
  });

  it("rejects invalid freeze-frame ranges", () => {
    const engine = new SpeedEngine();
    engine.initializeClip("clip", 10);
    expect(() => engine.createFreezeFrame("clip", 11, 0, 1)).toThrow(RangeError);
    expect(() => engine.createFreezeFrame("clip", 5, -1, 1)).toThrow(RangeError);
    expect(() => engine.createFreezeFrame("clip", 5, 0, 0)).toThrow(RangeError);
    expect(() => engine.createFreezeFrame("clip", 5, 0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
