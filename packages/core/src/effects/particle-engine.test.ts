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
