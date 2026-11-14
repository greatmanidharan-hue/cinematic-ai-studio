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

  it("produces the same fixed-step count for equal elapsed time at 30 and 60 FPS", () => {
    const fixedStep = 1 / 120;
    let thirtyAccumulator = 0;
    let sixtyAccumulator = 0;
    let thirtySteps = 0;
    let sixtySteps = 0;

    for (let frame = 0; frame < 30; frame++) {
      const result = consumeFixedSteps(1 / 30, thirtyAccumulator, fixedStep, 8);
      thirtyAccumulator = result.remainder;
      thirtySteps += result.steps;
    }

    for (let frame = 0; frame < 60; frame++) {
      const result = consumeFixedSteps(1 / 60, sixtyAccumulator, fixedStep, 8);
      sixtyAccumulator = result.remainder;
      sixtySteps += result.steps;
    }

    expect(thirtySteps).toBe(120);
    expect(sixtySteps).toBe(120);
    expect(thirtyAccumulator).toBeCloseTo(sixtyAccumulator);
    expect(thirtyAccumulator).toBeCloseTo(0);
  });

  it("keeps each ordinary frame within the configured catch-up budget", () => {
    const result = consumeFixedSteps(1 / 30, 0, 1 / 120, 8);
    expect(result.steps).toBe(4);
    expect(result.droppedTime).toBe(0);
  });

});
