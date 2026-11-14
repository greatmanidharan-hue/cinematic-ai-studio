export interface SimulationWindow {
  /** Start time of the oldest fixed step retained for this update. */
  startTime: number;
  /** End time of the newest fixed step retained for this update. */
  endTime: number;
  /** Number of fixed steps to simulate in this update. */
  steps: number;
  /** Whole fixed-step time intentionally skipped to keep work bounded. */
  droppedTime: number;
  /** Fractional time carried into the next update. */
  remainder: number;
}

/**
 * Selects the most recent bounded fixed-step window from a timeline interval.
 *
 * When a frame exceeds the catch-up budget, old whole steps are skipped and
 * the returned window remains aligned to the newest timeline time. Callers
 * must treat droppedTime as a deliberate simulation discontinuity; emissions
 * inside that skipped interval must not be silently replayed later.
 */
export function getBoundedSimulationWindow(
  startTime: number,
  deltaTime: number,
  accumulator: number,
  fixedStep = 1 / 120,
  maxSteps = 8,
): SimulationWindow {
  if (
    !Number.isFinite(startTime) ||
    !Number.isFinite(deltaTime) ||
    !Number.isFinite(accumulator) ||
    !Number.isFinite(fixedStep) ||
    !Number.isFinite(maxSteps) ||
    fixedStep <= 0 ||
    maxSteps < 1
  ) {
    const safeStart = Number.isFinite(startTime) ? startTime : 0;
    return {
      startTime: safeStart,
      endTime: safeStart,
      steps: 0,
      droppedTime: 0,
      remainder: 0,
    };
  }

  const safeDelta = Math.max(0, deltaTime);
  const safeAccumulator = Math.max(0, accumulator);
  const total = safeDelta + safeAccumulator;
  const availableSteps = Math.floor((total + Number.EPSILON) / fixedStep);
  const steps = Math.min(availableSteps, Math.floor(maxSteps));
  const remainder = Math.max(0, total - availableSteps * fixedStep);
  const droppedSteps = Math.max(0, availableSteps - steps);
  const droppedTime = droppedSteps * fixedStep;
  const endTime = startTime + safeDelta;
  const simulatedDuration = steps * fixedStep;

  return {
    startTime: endTime - simulatedDuration,
    endTime: endTime - remainder,
    steps,
    droppedTime,
    remainder,
  };
}
