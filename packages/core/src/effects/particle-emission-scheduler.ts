function normalizeFraction(value: number): number {
  return Number.isFinite(value) ? ((value % 1) + 1) % 1 : 0;
}

export interface EmissionSchedule {
  /** Timeline timestamps at which particles should be created. */
  emissionTimes: number[];
  /** Fractional emission progress carried into the next interval. */
  remainder: number;
}

/**
 * Schedules emissions over a timeline interval without tying their timestamps
 * to render-frame boundaries. Call once per simulation interval, in order.
 *
 * Whole emissions that cannot fit are discarded; only fractional progress is
 * retained, matching the engine's bounded-capacity behavior.
 */
export function scheduleParticleEmissions(
  startTime: number,
  endTime: number,
  emissionRate: number,
  accumulator: number,
  availableCapacity: number,
): EmissionSchedule {
  if (
    !Number.isFinite(startTime) ||
    !Number.isFinite(endTime) ||
    !Number.isFinite(emissionRate) ||
    !Number.isFinite(accumulator) ||
    !Number.isFinite(availableCapacity) ||
    endTime <= startTime ||
    emissionRate <= 0
  ) {
    return { emissionTimes: [], remainder: normalizeFraction(accumulator) };
  }

  const duration = endTime - startTime;
  const initialProgress = Math.min(1 - Number.EPSILON, normalizeFraction(accumulator));
  const totalProgress = initialProgress + emissionRate * duration;
  const dueCount = Math.floor(totalProgress + Number.EPSILON * Math.max(1, totalProgress));
  // Floating-point tolerance may round a value just below an integer up.
  // Keep the carried progress in the valid fractional range in that case.
  const remainder = Math.min(1 - Number.EPSILON, Math.max(0, totalProgress - dueCount));
  const emitCount = Math.min(dueCount, Math.max(0, Math.floor(availableCapacity)));
  const firstOffset = (1 - initialProgress) / emissionRate;
  const emissionTimes = Array.from(
    { length: emitCount },
    (_, index) => Math.min(endTime, startTime + firstOffset + index / emissionRate),
  );

  return { emissionTimes, remainder };
}
