import { describe, expect, it } from "vitest";
import { getBoundedSimulationWindow } from "./particle-simulation-window";

describe("getBoundedSimulationWindow", () => {
  it("keeps the newest bounded steps when a long frame exceeds the budget", () => {
    const result = getBoundedSimulationWindow(2, 0.1, 0, 1 / 120, 8);

    expect(result.steps).toBe(8);
    expect(result.endTime).toBeCloseTo(2.1, 12);
    expect(result.startTime).toBeCloseTo(2.1 - 8 / 120, 12);
    expect(result.droppedTime).toBeCloseTo(4 / 120, 12);
    expect(result.remainder).toBeCloseTo(0, 12);
  });

  it("includes fractional time carried from the previous update", () => {
    const result = getBoundedSimulationWindow(5, 0.004, 0.004, 0.008, 8);

    expect(result.steps).toBe(1);
    expect(result.startTime).toBeCloseTo(4.996, 12);
    expect(result.endTime).toBeCloseTo(5.004, 12);
    expect(result.remainder).toBeCloseTo(0, 12);
  });

  it("retains the sub-step remainder without inventing a simulation step", () => {
    const result = getBoundedSimulationWindow(0, 0.003, 0, 0.008, 8);

    expect(result.steps).toBe(0);
    expect(result.startTime).toBeCloseTo(0, 12);
    expect(result.endTime).toBeCloseTo(0.003, 12);
    expect(result.remainder).toBeCloseTo(0.003, 12);
    expect(result.droppedTime).toBe(0);
  });

  it("does not subtract the fractional remainder twice when steps are retained", () => {
    const result = getBoundedSimulationWindow(0, 0.011, 0, 0.008, 8);

    expect(result.steps).toBe(1);
    expect(result.startTime).toBeCloseTo(0, 12);
    expect(result.endTime).toBeCloseTo(0.008, 12);
    expect(result.remainder).toBeCloseTo(0.003, 12);
  });

  it("keeps the retained step window contiguous after carrying a remainder", () => {
    const first = getBoundedSimulationWindow(0, 0.011, 0, 0.008, 8);
    const second = getBoundedSimulationWindow(0.011, 0.005, first.remainder, 0.008, 8);

    expect(first.steps).toBe(1);
    expect(second.steps).toBe(1);
    expect(second.startTime).toBeCloseTo(first.endTime, 12);
    expect(second.endTime).toBeCloseTo(0.016, 12);
    expect(second.remainder).toBeCloseTo(0, 12);
  });

  it("keeps retained, dropped, and fractional time balanced across frame sizes", () => {
    const fixedStep = 1 / 120;
    const cases = [
      { start: 0, delta: 0.003, accumulator: 0 },
      { start: 0.003, delta: 0.014, accumulator: 0.003 },
      { start: 0.017, delta: 0.1, accumulator: 0.001 },
      { start: 0.117, delta: 0.25, accumulator: 0.004 },
      { start: 0.367, delta: 0.016, accumulator: 0.002 },
    ];

    for (const sample of cases) {
      const result = getBoundedSimulationWindow(
        sample.start,
        sample.delta,
        sample.accumulator,
        fixedStep,
        8,
      );
      const retainedDuration = result.steps * fixedStep;
      const suppliedDuration = sample.delta + sample.accumulator;

      expect(result.startTime + retainedDuration).toBeCloseTo(result.endTime, 10);
      expect(result.droppedTime + retainedDuration + result.remainder).toBeCloseTo(
        suppliedDuration,
        10,
      );
    }
  });

  it("returns an empty safe window for invalid inputs", () => {
    expect(getBoundedSimulationWindow(1, Number.NaN, 0)).toEqual({
      startTime: 1,
      endTime: 1,
      steps: 0,
      droppedTime: 0,
      remainder: 0,
    });
  });
});
