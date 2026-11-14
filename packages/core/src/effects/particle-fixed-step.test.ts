import { describe, expect, it } from "vitest";
import { consumeFixedSteps } from "./particle-fixed-step";

describe("consumeFixedSteps", () => {
  it("accumulates fractional frame time until a full step is available", () => {
    const first = consumeFixedSteps(0.004, 0, 0.01, 8);
    expect(first).toEqual({ steps: 0, remainder: 0.004, droppedTime: 0 });

    const second = consumeFixedSteps(0.008, first.remainder, 0.01, 8);
    expect(second.steps).toBe(1);
    expect(second.remainder).toBeCloseTo(0.002);
    expect(second.droppedTime).toBe(0);
  });

  it("limits catch-up work and reports discarded whole-step time", () => {
    const result = consumeFixedSteps(0.105, 0.005, 0.01, 4);
    expect(result.steps).toBe(4);
    expect(result.remainder).toBeCloseTo(0);
    expect(result.droppedTime).toBeCloseTo(0.07);
  });

  it("does not create steps from negative elapsed time", () => {
    expect(consumeFixedSteps(-1, 0, 0.01, 8)).toEqual({
      steps: 0,
      remainder: 0,
      droppedTime: 0,
    });
  });

  it("rejects invalid step configuration safely", () => {
    expect(consumeFixedSteps(1, 0, 0, 8)).toEqual({
      steps: 0,
      remainder: 0,
      droppedTime: 0,
    });
    expect(consumeFixedSteps(1, 0, 0.01, 0)).toEqual({
      steps: 0,
      remainder: 0,
      droppedTime: 0,
    });
  });
});
