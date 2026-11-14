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
    splitTimes.forEach((time, index) => {
      expect(time).toBeCloseTo(whole.emissionTimes[index], 12);
    });
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
  it("produces matching timestamps for 30 FPS and irregular frame partitions", () => {
    const whole = scheduleParticleEmissions(0, 2, 17.5, 0.3, 100);
    const partitions = [0.07, 0.19, 0.23, 0.41, 0.62, 0.48];
    let cursor = 0;
    let remainder = 0.3;
    const times: number[] = [];

    for (const delta of partitions) {
      const result = scheduleParticleEmissions(cursor, cursor + delta, 17.5, remainder, 100 - times.length);
      times.push(...result.emissionTimes);
      remainder = result.remainder;
      cursor += delta;
    }

    expect(cursor).toBeCloseTo(2, 12);
    expect(times).toHaveLength(35);
    expect(times).toHaveLength(whole.emissionTimes.length);
    times.forEach((time, index) => {
      expect(time).toBeCloseTo(whole.emissionTimes[index], 11);
    });
    expect(remainder).toBeCloseTo(whole.remainder, 11);
  });

  it("keeps event timestamps stable across long high-frequency partitions", () => {
    const whole = scheduleParticleEmissions(0, 10, 29.97, 0.37, 1000);
    let remainder = 0.37;
    const partitionedTimes: number[] = [];
    const frameCount = 1200;

    for (let frame = 1; frame <= frameCount; frame++) {
      const start = ((frame - 1) / frameCount) * 10;
      const end = (frame / frameCount) * 10;
      const result = scheduleParticleEmissions(start, end, 29.97, remainder, 1000 - partitionedTimes.length);
      partitionedTimes.push(...result.emissionTimes);
      remainder = result.remainder;
    }

    expect(partitionedTimes).toHaveLength(whole.emissionTimes.length);
    partitionedTimes.forEach((time, index) => {
      expect(time).toBeCloseTo(whole.emissionTimes[index], 9);
    });
    expect(remainder).toBeCloseTo(whole.remainder, 9);
  });

  it("keeps the fractional remainder when capacity is zero", () => {
    const result = scheduleParticleEmissions(0, 0.5, 3, 0.25, 0);

    expect(result.emissionTimes).toHaveLength(0);
    expect(result.remainder).toBeCloseTo(0.75, 12);
  });

  it("normalizes negative fractional progress for empty intervals", () => {
    const result = scheduleParticleEmissions(1, 1, 2, -0.25, 10);

    expect(result.emissionTimes).toHaveLength(0);
    expect(result.remainder).toBeCloseTo(0.75, 12);
  });

  it("keeps rounded boundary emissions inside the requested interval", () => {
    const result = scheduleParticleEmissions(0, 0.1, 10, 0, 10);

    expect(result.emissionTimes).toHaveLength(1);
    expect(result.emissionTimes[0]).toBeLessThanOrEqual(0.1);
    expect(result.emissionTimes[0]).toBeCloseTo(0.1, 12);
    expect(result.remainder).toBeGreaterThanOrEqual(0);
    expect(result.remainder).toBeLessThan(1);
  });

  it("normalizes negative fractional accumulators without emitting early", () => {
    const result = scheduleParticleEmissions(0, 0.25, 2, -0.25, 10);

    expect(result.emissionTimes).toHaveLength(0);
    expect(result.remainder).toBeCloseTo(0.5, 12);
  });

});
