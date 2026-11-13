import { describe, expect, it } from "vitest";
import { ParticleEngine } from "./particle-engine";
import { DEFAULT_PARTICLE_CONFIG, type ParticleEffect } from "./particle-types";

function createEngine(seed: number): ParticleEngine {
  const engine = new ParticleEngine();
  engine.setCanvasSize(1280, 720);
  engine.setRandomSeed(seed);
  const effect: ParticleEffect = {
    id: "fire-test",
    clipId: "clip-test",
    type: "dissolve",
    startTime: 0,
    duration: 5,
    enabled: true,
    config: {
      ...DEFAULT_PARTICLE_CONFIG,
      particleCount: 24,
      emissionRate: 12,
      turbulence: 18,
      colors: ["#ff3300", "#ffaa00"],
      lifetime: { min: 1, max: 2 },
    },
  };
  engine.addEffect(effect);
  return engine;
}

function simulate(seed: number) {
  const engine = createEngine(seed);
  for (let frame = 1; frame <= 30; frame++) {
    engine.update(frame / 30, 1 / 30);
  }
  return engine.getParticles();
}

describe("deterministic particle simulation", () => {
  it("produces identical particles for the same seed and update sequence", () => {
    expect(simulate(123456)).toEqual(simulate(123456));
  });

  it("changes the particle pattern when the seed changes", () => {
    expect(simulate(123456)).not.toEqual(simulate(654321));
  });

  it("reconstructs the same particles when seeking directly to an absolute time", () => {
    const sequential = createEngine(777);
    for (let frame = 1; frame <= 90; frame++) {
      sequential.update(frame / 30, 1 / 30);
    }

    const sought = createEngine(123);
    sought.seekToTime(3, 1 / 30, 777);

    expect(sought.getParticles()).toEqual(sequential.getParticles());
  });

  it("clears particles and resets deterministically when seeking backwards", () => {
    const engine = createEngine(99);
    engine.seekToTime(4, 1 / 30, 99);
    const laterParticles = engine.getParticles();

    engine.seekToTime(1, 1 / 30, 99);
    const earlierParticles = engine.getParticles();
    engine.seekToTime(4, 1 / 30, 99);

    expect(earlierParticles).not.toEqual(laterParticles);
    expect(engine.getParticles()).toEqual(laterParticles);
  });

  it("stops an emitter at its exact end time when no particles remain", () => {
    const engine = createEngine(321);
    engine.updateEffectTiming("fire-test", 1, 1);

    engine.update(1, 1 / 30);
    expect(engine.getActiveEffectIds()).toEqual(["fire-test"]);

    engine.update(2, 1 / 30);
    expect(engine.getActiveEffectIds()).toEqual([]);
  });

  it("lets existing particles finish after the effect stops emitting", () => {
    const engine = createEngine(654);
    engine.updateEffectTiming("fire-test", 0, 0.5);
    engine.updateEffect("fire-test", {
      particleCount: 24,
      emissionRate: 30,
      turbulence: 0,
      lifetime: { min: 1, max: 1 },
    });

    engine.update(0.4, 0.4);
    expect(engine.getParticles().length).toBeGreaterThan(0);

    engine.update(0.6, 0.2);
    expect(engine.getActiveEffectIds()).toEqual(["fire-test"]);
    expect(engine.getParticles().length).toBeGreaterThan(0);

    engine.update(1.1, 0.5);
    expect(engine.getActiveEffectIds()).toEqual([]);
    expect(engine.getParticles()).toEqual([]);
  });

  it("clears active particles immediately when an effect is disabled", () => {
    const engine = createEngine(88);
    engine.update(0.5, 0.5);
    expect(engine.getParticles().length).toBeGreaterThan(0);

    engine.toggleEffect("fire-test", false);
    engine.update(0.6, 0.1);

    expect(engine.getActiveEffectIds()).toEqual([]);
    expect(engine.getParticles()).toEqual([]);
  });

  it("keeps opacity finite when fade ranges meet or overlap", () => {
    const engine = createEngine(55);
    engine.updateEffect("fire-test", {
      particleCount: 24,
      emissionRate: 30,
      lifetime: { min: 1, max: 1 },
      fadeIn: 0.5,
      fadeOut: 0.5,
    });

    engine.update(0.5, 0.5);
    const particles = engine.getParticles();

    expect(particles.length).toBeGreaterThan(0);
    expect(particles.every((particle) =>
      Number.isFinite(particle.opacity) &&
      particle.opacity >= 0 &&
      particle.opacity <= 1
    )).toBe(true);
  });

  it("ignores invalid and backwards simulation time steps", () => {
    const engine = createEngine(73);
    engine.update(0.5, 0.5);
    const beforeInvalidSteps = engine.getParticles();

    engine.update(Number.NaN, 1 / 30);
    engine.update(0.6, Number.NaN);
    engine.update(0.4, -0.1);
    engine.update(0.6, 0);

    expect(engine.getParticles()).toEqual(beforeInvalidSteps);
  });

  it("treats negative seek times as the start of the timeline", () => {
    const engine = createEngine(12);
    engine.seekToTime(-5, 1 / 30, 12);
    expect(engine.getParticles()).toEqual([]);
  });

  it("replays the same simulation after resetting and reseeding", () => {
    const engine = createEngine(42);
    for (let frame = 1; frame <= 20; frame++) {
      engine.update(frame / 30, 1 / 30);
    }
    const firstRun = engine.getParticles();

    engine.reset();
    engine.setRandomSeed(42);
    for (let frame = 1; frame <= 20; frame++) {
      engine.update(frame / 30, 1 / 30);
    }

    expect(engine.getParticles()).toEqual(firstRun);
  });
});
