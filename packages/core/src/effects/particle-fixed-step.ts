export interface FixedStepResult {
  steps: number;
  remainder: number;
  droppedTime: number;
}

/**
 * Splits elapsed simulation time into bounded fixed-size steps.
 * Excess whole steps are discarded to avoid an unbounded catch-up spiral;
 * the fractional remainder is retained for the next frame.
 */
export function consumeFixedSteps(
  deltaTime: number,
  accumulator: number,
  fixedStep = 1 / 120,
  maxSteps = 8,
): FixedStepResult {
  if (
    !Number.isFinite(deltaTime) ||
    !Number.isFinite(accumulator) ||
    !Number.isFinite(fixedStep) ||
    !Number.isFinite(maxSteps) ||
    fixedStep <= 0 ||
    maxSteps < 1
  ) {
    return { steps: 0, remainder: 0, droppedTime: 0 };
  }

  const safeDelta = Math.max(0, deltaTime);
  const safeAccumulator = Math.max(0, accumulator);
  const total = safeDelta + safeAccumulator;
  const availableSteps = Math.floor((total + Number.EPSILON) / fixedStep);
  const steps = Math.min(availableSteps, Math.floor(maxSteps));
  const remainder = Math.max(0, total - availableSteps * fixedStep);

  return {
    steps,
    remainder,
    droppedTime: (availableSteps - steps) * fixedStep,
  };
}
