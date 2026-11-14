/** Calculates simulation delta from the editor timeline clock, not wall-clock time. */
export const getParticleFrameDelta = (
  currentTimelineTime: number,
  previousTimelineTime: number,
): number => {
  if (!Number.isFinite(currentTimelineTime) || !Number.isFinite(previousTimelineTime)) {
    return 0;
  }
  return Math.max(0, currentTimelineTime - previousTimelineTime);
};
