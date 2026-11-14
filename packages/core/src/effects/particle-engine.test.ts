import { describe, expect, it } from "vitest";
import { ParticleEngine } from "./particle-engine";
import { DEFAULT_PARTICLE_CONFIG, type ParticleEffect } from "./particle-types";

describe("ParticleEngine blend mode propagation", () => {
  it.each(["normal", "add", "multiply", "screen"] as const)(
    "preserves the %s blend mode on emitted particles",
    (blendMode) => {
      const engine = new ParticleEngine();
      const effect: ParticleEffect = {
        id: `effect-${blendMode}`,
        clipId: "clip-1",
        type: "dissolve",
        startTime: 0,
        duration: 5,
        enabled: true,
        config: {
          ...DEFAULT_PARTICLE_CONFIG,
          blendMode,
          particleCount: 1,
          emissionRate: 1,
          lifetime: { min: 10, max: 10 },
          fadeIn: 0.1,
          fadeOut: 0.1,
        },
      };

      engine.addEffect(effect);
      engine.update(0, 1);

      expect(engine.getParticles(effect.id)).toHaveLength(1);
      expect(engine.getParticles(effect.id)[0].blendMode).toBe(blendMode);
      engine.dispose();
    },
  );
});


describe("ParticleEngine effect updates", () => {
  const makeEffect = (id: string): ParticleEffect => ({
    id,
    clipId: "clip-1",
    type: "dissolve",
    startTime: 1,
    duration: 5,
    enabled: true,
    config: { ...DEFAULT_PARTICLE_CONFIG, colors: ["#ffffff"] },
  });

  it("applies configuration updates to an existing effect ID", () => {
    const engine = new ParticleEngine();
    const effect = makeEffect("editable-effect");
    engine.addEffect(effect);

    engine.updateEffect(effect.id, { blendMode: "screen", emissionRate: 12 });

    expect(engine.getEffect(effect.id)?.config.blendMode).toBe("screen");
    expect(engine.getEffect(effect.id)?.config.emissionRate).toBe(12);
    engine.dispose();
  });

  it("updates timing and enabled state for an existing effect", () => {
    const engine = new ParticleEngine();
    const effect = makeEffect("timed-effect");
    engine.addEffect(effect);

    engine.updateEffectTiming(effect.id, 3, 8);
    engine.toggleEffect(effect.id, false);

    expect(engine.getEffect(effect.id)).toMatchObject({
      startTime: 3,
      duration: 8,
      enabled: false,
    });
    engine.dispose();
  });
});


describe("ParticleEngine configuration ownership", () => {
  it("does not retain mutable config references supplied by the caller", () => {
    const engine = new ParticleEngine();
    const effect = {
      id: "isolated-effect",
      clipId: "clip-1",
      type: "dissolve" as const,
      startTime: 0,
      duration: 5,
      enabled: true,
      config: {
        ...DEFAULT_PARTICLE_CONFIG,
        wind: { ...DEFAULT_PARTICLE_CONFIG.wind },
        colors: ["#ffffff"],
        size: { ...DEFAULT_PARTICLE_CONFIG.size },
        opacity: { ...DEFAULT_PARTICLE_CONFIG.opacity },
        lifetime: { ...DEFAULT_PARTICLE_CONFIG.lifetime },
      },
    };

    engine.addEffect(effect);
    effect.config.wind.x = 42;
    effect.config.colors[0] = "#000000";
    effect.config.size.min = 99;

    expect(engine.getEffect(effect.id)?.config.wind.x).toBe(0);
    expect(engine.getEffect(effect.id)?.config.colors).toEqual(["#ffffff"]);
    expect(engine.getEffect(effect.id)?.config.size.min).toBe(DEFAULT_PARTICLE_CONFIG.size.min);
    engine.dispose();
  });

  it("copies nested values supplied through partial configuration updates", () => {
    const engine = new ParticleEngine();
    const effect: ParticleEffect = {
      id: "update-isolation",
      clipId: "clip-1",
      type: "dissolve",
      startTime: 0,
      duration: 5,
      enabled: true,
      config: { ...DEFAULT_PARTICLE_CONFIG },
    };
    const wind = { x: 1, y: 2, z: 3 };
    const colors = ["#123456"];

    engine.addEffect(effect);
    engine.updateEffect(effect.id, { wind, colors });
    wind.x = 99;
    colors[0] = "#ffffff";

    expect(engine.getEffect(effect.id)?.config.wind.x).toBe(1);
    expect(engine.getEffect(effect.id)?.config.colors).toEqual(["#123456"]);
    engine.dispose();
  });
});


describe("ParticleEngine timeline behavior", () => {
  const makeTimelineEffect = (): ParticleEffect => ({
    id: "timeline-effect",
    clipId: "clip-1",
    type: "dissolve",
    startTime: 0,
    duration: 10,
    enabled: true,
    config: {
      ...DEFAULT_PARTICLE_CONFIG,
      particleCount: 10,
      emissionRate: 2,
      lifetime: { min: 20, max: 20 },
      turbulence: 0,
    },
  });

  it("clears simulated future particles when the playhead moves backwards", () => {
    const engine = new ParticleEngine();
    const effect = makeTimelineEffect();
    engine.addEffect(effect);

    engine.update(2, 1);
    expect(engine.getParticles(effect.id).length).toBeGreaterThan(0);

    engine.update(1, 0);
    expect(engine.getParticles(effect.id)).toHaveLength(0);

    engine.dispose();
  });

  it("clears particles and emission remainder when an effect is disabled", () => {
    const engine = new ParticleEngine();
    const effect = makeTimelineEffect();
    engine.addEffect(effect);

    engine.update(2, 1);
    expect(engine.getParticles(effect.id).length).toBeGreaterThan(0);

    engine.toggleEffect(effect.id, false);
    engine.update(2, 0);

    expect(engine.getParticles(effect.id)).toHaveLength(0);
    expect(engine.getActiveEffectIds()).not.toContain(effect.id);
    engine.dispose();
  });

  it("does not age particles during the frame in which they are emitted", () => {
    const engine = new ParticleEngine();
    const effect = makeTimelineEffect();
    effect.config.emissionRate = 1;
    effect.config.particleCount = 1;
    engine.addEffect(effect);

    engine.update(1, 1);

    expect(engine.getParticles(effect.id)).toHaveLength(1);
    expect(engine.getParticles(effect.id)[0].age).toBe(0);

    engine.dispose();
  });

  it("does not advance particle age for negative or non-finite frame deltas", () => {
    const engine = new ParticleEngine();
    const effect = makeTimelineEffect();
    engine.addEffect(effect);

    engine.update(1, 1);
    const particle = engine.getParticles(effect.id)[0];
    expect(particle).toBeDefined();
    const originalAge = particle.age;

    engine.update(1, Number.NaN);
    expect(particle.age).toBe(originalAge);
    engine.update(1, -1);
    expect(particle.age).toBe(originalAge);

    engine.dispose();
  });
});
