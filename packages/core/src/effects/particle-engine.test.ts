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
