import { describe, expect, it } from "vitest";
import { getParticleFrameDelta } from "./particle-time-utils";

describe("getParticleFrameDelta", () => {
  it("uses timeline-time differences, including fractional frame steps", () => {
    expect(getParticleFrameDelta(2.04, 2)).toBeCloseTo(0.04);
  });

  it("returns zero for paused frames and backwards seeks", () => {
    expect(getParticleFrameDelta(3, 3)).toBe(0);
    expect(getParticleFrameDelta(1, 3)).toBe(0);
  });

  it("rejects non-finite clock values", () => {
    expect(getParticleFrameDelta(Number.NaN, 1)).toBe(0);
    expect(getParticleFrameDelta(2, Number.POSITIVE_INFINITY)).toBe(0);
  });
});
