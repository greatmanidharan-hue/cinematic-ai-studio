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
