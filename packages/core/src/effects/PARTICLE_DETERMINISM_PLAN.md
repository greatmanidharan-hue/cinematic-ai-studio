# Particle Simulation Determinism Plan

## Status

Design checkpoint only. The emission scheduler helper is implemented and tested independently, but it is not integrated into `ParticleEngine`. Do not claim playback/seek parity until the engine-level acceptance tests pass.

## Current behavior and constraints

- `ParticleEngine.update(currentTime, deltaTime)` consumes at most eight fixed steps of 1/120 second per call.
- Whole fixed steps beyond that budget are dropped; the fractional remainder is retained.
- Existing particles are integrated before new particles are emitted at the end of the update call.
- Emission progress currently uses the active timeline interval, even when simulation catch-up steps were dropped.
- `beginSeek` resets the engine and `advanceSeek` reconstructs the timeline in bounded chunks.
- Turbulence consumes a per-effect seeded random stream while particles are integrated. Emission also consumes that stream to generate particle attributes.
- Therefore, merely calling the timestamp scheduler once per render frame cannot guarantee equivalent particle state: emission ordering, particle age, turbulence random consumption, and dropped simulation time must share one canonical ordering.

## Required simulation contract

1. **Canonical clock:** define one simulation-time cursor that advances only through accepted canonical simulation steps. Playback and seek must use the same step sequence and end-of-target policy.
2. **Emission event ordering:** schedule each particle at a deterministic timeline timestamp. Events must be processed in timestamp order, with a stable tie-breaker (effect ID, then per-effect emission index).
3. **Birth-time integration:** a particle must receive only the portion of a simulation interval after its birth timestamp. It must not age or move before it exists.
4. **Random-stream ordering:** particle creation and turbulence must consume random values in the same deterministic order regardless of render-frame partitioning.
5. **Capacity policy:** when capacity is exhausted, discard whole due emissions and retain only fractional progress. Do not accumulate a burst for later.
6. **Bounded work:** preserve the per-update catch-up budget. A long frame must not trigger unbounded simulation work.
7. **Effect boundaries:** emission is restricted to the intersection of the simulation interval and the effect's active interval. Disabling, editing, or retiming an effect must reset only that effect's deterministic state as currently intended.

## Implementation sequence

1. Add a canonical fixed-tick cursor and explicit dropped-time policy.
2. Add a deterministic event queue per effect, driven by the scheduler helper.
3. Integrate existing particles and newly born particles in chronological sub-intervals, splitting a tick at emission timestamps when necessary.
4. Ensure the seeded random stream is consumed in stable chronological order.
5. Make incremental seek call the same canonical tick/event processor as playback.
6. Add engine-level tests before changing renderer behavior.

## Acceptance tests (must all pass)

- Equal final particle state for 30 FPS, 60 FPS, and irregular frame partitions over the same accepted simulation interval.
- Equal final particle state for normal playback and incremental seek to the same timestamp.
- Newly emitted particles have age and position corresponding to their exact birth timestamps.
- Identical seeded replay after rewind, including non-zero turbulence.
- Stable behavior at effect start/end boundaries and when capacity is reached.
- A long frame respects the catch-up budget and the documented dropped-time policy.
- No regression in pause/resume, config edit isolation, or renderer buffer limits.

## Explicitly not verified yet

- No browser/GPU visual parity.
- No runtime or Vitest execution from the GitHub-only workflow.
- No claim of exact determinism until the acceptance tests above are implemented and executed in CI.
