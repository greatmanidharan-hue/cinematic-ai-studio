import { describe, expect, it } from "vitest";
import { scheduleParticleEmissions } from "./particle-emission-scheduler";

describe("scheduleParticleEmissions", () => {
  it("produces the same event timestamps when an interval is split into frames", () => {
    const whole = scheduleParticleEmissions(0, 1, 24, 0, 100);
    let remainder = 0;
    const splitTimes: number[] = [];

    for (let frame = 1; frame <= 60; frame++) {
      const result = scheduleParticleEmissions((frame - 1) / 60, frame / 60, 24, remainder, 100 - splitTimes.length);
      splitTimes.push(...result.emissionTimes);
      remainder = result.remainder;
    }

    expect(splitTimes).toHaveLength(24);
    expect(splitTimes).toEqual(whole.emissionTimes);
    expect(remainder).toBeCloseTo(whole.remainder, 12);
  });

  it("retains fractional progress but discards whole emissions beyond capacity", () => {
    const result = scheduleParticleEmissions(2, 3, 5.5, 0.25, 2);

    expect(result.emissionTimes).toHaveLength(2);
    expect(result.emissionTimes[0]).toBeCloseTo(2 + 0.75 / 5.5, 12);
    expect(result.emissionTimes[1]).toBeCloseTo(2 + 1.75 / 5.5, 12);
    expect(result.remainder).toBeCloseTo(0.75, 12);
  });

  it("returns no emissions for invalid or empty intervals", () => {
    expect(scheduleParticleEmissions(1, 1, 10, 0.5, 10)).toEqual({
      emissionTimes: [],
      remainder: 0.5,
    });
    expect(scheduleParticleEmissions(0, 1, Number.NaN, 0.5, 10)).toEqual({
      emissionTimes: [],
      remainder: 0.5,
    });
  });

  it("does not create more events than available capacity", () => {
    const result = scheduleParticleEmissions(0, 1, 100, 0, 3);
    expect(result.emissionTimes).toHaveLength(3);
    expect(result.remainder).toBe(0);
  });
});
