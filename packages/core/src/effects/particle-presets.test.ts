import { describe, expect, it } from "vitest";
import {
  PARTICLE_PRESETS,
  createEffectFromPreset,
  getParticlePresetById,
} from "./particle-presets";

describe("cinematic particle presets", () => {
  it("keeps preset identifiers unique", () => {
    const ids = PARTICLE_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each([
    ["fire-plume", "Fire Plume"],
    ["smoke-column", "Smoke Column"],
    ["lightning-impact-sparks", "Lightning Impact Sparks"],
  ])("registers the %s preset", (id, name) => {
    const preset = getParticlePresetById(id);
    expect(preset).toBeDefined();
    expect(preset?.name).toBe(name);
    expect(preset?.config.particleCount).toBeGreaterThan(0);
    expect(preset?.config.emissionRate).toBeGreaterThan(0);
    expect(preset?.config.lifetime.min).toBeGreaterThan(0);
    expect(preset?.config.lifetime.max).toBeGreaterThanOrEqual(
      preset?.config.lifetime.min ?? 0,
    );
  });

  it("creates a clip-scoped effect from each new preset", () => {
    for (const presetId of [
      "fire-plume",
      "smoke-column",
      "lightning-impact-sparks",
    ]) {
      const effect = createEffectFromPreset(
        presetId,
        `test-${presetId}`,
        "test-clip",
        1.5,
        3,
      );
      expect(effect).not.toBeNull();
      expect(effect?.clipId).toBe("test-clip");
      expect(effect?.startTime).toBe(1.5);
      expect(effect?.duration).toBe(3);
      expect(effect?.enabled).toBe(true);
    }
  });
});
