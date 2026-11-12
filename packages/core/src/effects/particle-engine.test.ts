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
