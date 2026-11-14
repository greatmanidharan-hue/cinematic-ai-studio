import { describe, expect, it } from "vitest";
import { ParticleEngine } from "./particle-engine";
import { DEFAULT_PARTICLE_CONFIG, type ParticleEffect } from "./particle-types";

function advanceEngine(engine: ParticleEngine, currentTime: number, deltaTime: number, frames = 15): void {
  const frameDelta = deltaTime / frames;
  const startTime = currentTime - deltaTime;
  for (let frame = 0; frame < frames; frame++) {
    const frameTime = startTime + frameDelta * (frame + 1);
    engine.update(frameTime, frameDelta);
  }
}

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
      advanceEngine(engine, 0, 1);

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

  it("resets only the edited effect's particles when its configuration changes", () => {
    const engine = new ParticleEngine();
    const edited = makeEffect("edited-effect");
    const untouched = makeEffect("untouched-effect");
    edited.config.emissionRate = 10;
    untouched.config.emissionRate = 10;
    edited.config.particleCount = 1;
    untouched.config.particleCount = 1;
    engine.addEffect(edited);
    engine.addEffect(untouched);

    advanceEngine(engine, 1, 1);
    expect(engine.getParticles(edited.id)).toHaveLength(1);
    expect(engine.getParticles(untouched.id)).toHaveLength(1);

    engine.updateEffect(edited.id, { blendMode: "screen" });

    expect(engine.getParticles(edited.id)).toHaveLength(0);
    expect(engine.getParticles(untouched.id)).toHaveLength(1);

    engine.update(1.1, 0.1);
    expect(engine.getParticles(edited.id).every((particle) => particle.blendMode === "screen")).toBe(true);
    engine.dispose();
  });

  it("resets only the edited effect's particles when its timing changes", () => {
    const engine = new ParticleEngine();
    const edited = makeEffect("retimed-effect");
    const untouched = makeEffect("stable-effect");
    edited.config.emissionRate = 10;
    untouched.config.emissionRate = 10;
    edited.config.particleCount = 1;
    untouched.config.particleCount = 1;
    engine.addEffect(edited);
    engine.addEffect(untouched);

    advanceEngine(engine, 1, 1);
    expect(engine.getParticles(edited.id)).toHaveLength(1);
    expect(engine.getParticles(untouched.id)).toHaveLength(1);

    engine.updateEffectTiming(edited.id, 3, 5);

    expect(engine.getParticles(edited.id)).toHaveLength(0);
    expect(engine.getParticles(untouched.id)).toHaveLength(1);
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

  it("recreates the same particle state after resetting with the same effect seed", () => {
    const firstEngine = new ParticleEngine();
    const secondEngine = new ParticleEngine();
    const effect = makeTimelineEffect();
    effect.config.emissionRate = 3;
    effect.config.particleCount = 8;
    effect.config.turbulence = 4;

    firstEngine.addEffect(effect);
    secondEngine.addEffect(effect);

    advanceEngine(firstEngine, 1, 1);
    advanceEngine(secondEngine, 1, 1);

    expect(firstEngine.getParticles(effect.id)).toEqual(
      secondEngine.getParticles(effect.id)
    );

    firstEngine.reset();
    secondEngine.reset();
    advanceEngine(firstEngine, 1, 1);
    advanceEngine(secondEngine, 1, 1);

    expect(firstEngine.getParticles(effect.id)).toEqual(
      secondEngine.getParticles(effect.id)
    );

    firstEngine.dispose();
    secondEngine.dispose();
  });

  it("clears simulated future particles when the playhead moves backwards", () => {
    const engine = new ParticleEngine();
    const effect = makeTimelineEffect();
    engine.addEffect(effect);

    advanceEngine(engine, 2, 1);
    expect(engine.getParticles(effect.id).length).toBeGreaterThan(0);

    engine.update(1, 0);
    expect(engine.getParticles(effect.id)).toHaveLength(0);

    engine.dispose();
  });

  it("clears particles and emission remainder when an effect is disabled", () => {
    const engine = new ParticleEngine();
    const effect = makeTimelineEffect();
    engine.addEffect(effect);

    advanceEngine(engine, 2, 1);
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

    advanceEngine(engine, 1, 1);

    expect(engine.getParticles(effect.id)).toHaveLength(1);
    expect(engine.getParticles(effect.id)[0].age).toBe(0);

    engine.dispose();
  });

  it("does not release a burst from emissions banked while at capacity", () => {
    const engine = new ParticleEngine();
    const effect = makeTimelineEffect();
    effect.config.particleCount = 2;
    effect.config.emissionRate = 10;
    effect.config.lifetime = { min: 0.1, max: 0.1 };
    engine.addEffect(effect);

    advanceEngine(engine, 1, 1);
    expect(engine.getParticles(effect.id)).toHaveLength(2);

    engine.updateEffect(effect.id, { emissionRate: 0.1 });
    advanceEngine(engine, 2, 1);

    expect(engine.getParticles(effect.id)).toHaveLength(0);
    engine.dispose();
  });

  it("does not advance particle age for negative or non-finite frame deltas", () => {
    const engine = new ParticleEngine();
    const effect = makeTimelineEffect();
    engine.addEffect(effect);

    advanceEngine(engine, 1, 1);
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


describe("ParticleEngine bounded emission time", () => {
  it("does not emit particles for timeline time dropped by the catch-up budget", () => {
    const engine = new ParticleEngine();
    const effect: ParticleEffect = {
      id: "bounded-emission-window",
      clipId: "clip-1",
      type: "dissolve",
      startTime: 0,
      duration: 10,
      enabled: true,
      config: {
        ...DEFAULT_PARTICLE_CONFIG,
        particleCount: 100,
        emissionRate: 120,
        lifetime: { min: 10, max: 10 },
        turbulence: 0,
      },
    };

    engine.addEffect(effect);
    engine.update(1, 1);

    // The engine simulates only the newest eight 1/120-second steps.
    expect(engine.getParticles(effect.id)).toHaveLength(8);
    engine.dispose();
  });
});


describe("ParticleEngine fixed-step integration", () => {
  it("bounds particle aging to the configured catch-up steps", () => {
    const engine = new ParticleEngine();
    const effect: ParticleEffect = {
      id: "fixed-step-effect",
      clipId: "clip-1",
      type: "dissolve",
      startTime: 0,
      duration: 10,
      enabled: true,
      config: {
        ...DEFAULT_PARTICLE_CONFIG,
        particleCount: 1,
        emissionRate: 1,
        lifetime: { min: 10, max: 10 },
        turbulence: 0,
      },
    };

    engine.addEffect(effect);
    advanceEngine(engine, 1, 1);
    const particle = engine.getParticles(effect.id)[0];
    expect(particle).toBeDefined();
    expect(particle.age).toBe(0);

    engine.update(1.1, 0.1);
    expect(particle.age).toBeCloseTo(8 / 120);
    engine.dispose();
  });

  it("clears the fixed-step remainder on timeline rewind", () => {
    const engine = new ParticleEngine();
    const effect: ParticleEffect = {
      id: "fixed-step-rewind",
      clipId: "clip-1",
      type: "dissolve",
      startTime: 0,
      duration: 10,
      enabled: true,
      config: { ...DEFAULT_PARTICLE_CONFIG, emissionRate: 0, turbulence: 0 },
    };

    engine.addEffect(effect);
    engine.update(2, 0.005);
    engine.update(1, 0);
    engine.update(1.005, 0.005);
    expect(engine.getParticles(effect.id)).toHaveLength(0);
    engine.dispose();
  });
});


describe("ParticleEngine frame-rate consistency", () => {
  it("keeps existing particle motion consistent across 30 FPS and 60 FPS updates", () => {
    const makeEngine = () => {
      const engine = new ParticleEngine();
      const effect: ParticleEffect = {
        id: "fps-consistency",
        clipId: "clip-1",
        type: "dissolve",
        startTime: 0,
        duration: 10,
        enabled: true,
        config: {
          ...DEFAULT_PARTICLE_CONFIG,
          particleCount: 1,
          emissionRate: 1,
          lifetime: { min: 10, max: 10 },
          turbulence: 8,
          gravity: 12,
          wind: { x: 2, y: -1, z: 0 },
        },
      };
      engine.addEffect(effect);
      advanceEngine(engine, 0, 1);
      engine.updateEffect(effect.id, { emissionRate: 0 });
      return engine;
    };

    const thirtyFps = makeEngine();
    const sixtyFps = makeEngine();
    for (let frame = 1; frame <= 30; frame++) {
      thirtyFps.update(frame / 30, 1 / 30);
    }
    for (let frame = 1; frame <= 60; frame++) {
      sixtyFps.update(frame / 60, 1 / 60);
    }

    const particle30 = thirtyFps.getParticles("fps-consistency")[0];
    const particle60 = sixtyFps.getParticles("fps-consistency")[0];
    expect(particle30).toBeDefined();
    expect(particle60).toBeDefined();
    expect(particle30.age).toBeCloseTo(particle60.age, 8);
    expect(particle30.position.x).toBeCloseTo(particle60.position.x, 8);
    expect(particle30.position.y).toBeCloseTo(particle60.position.y, 8);
    expect(particle30.velocity.x).toBeCloseTo(particle60.velocity.x, 8);
    expect(particle30.velocity.y).toBeCloseTo(particle60.velocity.y, 8);

    thirtyFps.dispose();
    sixtyFps.dispose();
  });
});


  it("emits the same particle count over equal time at 30 FPS and 60 FPS", () => {
    const makeEngine = () => {
      const engine = new ParticleEngine();
      const effect: ParticleEffect = {
        id: "emission-fps-consistency",
        clipId: "clip-1",
        type: "dissolve",
        startTime: 0,
        duration: 10,
        enabled: true,
        config: {
          ...DEFAULT_PARTICLE_CONFIG,
          particleCount: 100,
          emissionRate: 24,
          lifetime: { min: 10, max: 10 },
          turbulence: 0,
        },
      };
      engine.addEffect(effect);
      engine.update(0, 0);
      return engine;
    };

    const thirtyFps = makeEngine();
    const sixtyFps = makeEngine();
    for (let frame = 1; frame <= 30; frame++) {
      thirtyFps.update(frame / 30, 1 / 30);
    }
    for (let frame = 1; frame <= 60; frame++) {
      sixtyFps.update(frame / 60, 1 / 60);
    }

    expect(thirtyFps.getParticles("emission-fps-consistency")).toHaveLength(24);
    expect(sixtyFps.getParticles("emission-fps-consistency")).toHaveLength(24);
    thirtyFps.dispose();
    sixtyFps.dispose();
  });


describe("ParticleEngine pause and resume timing", () => {
  it("preserves a fractional fixed-step remainder while paused", () => {
    const engine = new ParticleEngine();
    const effect: ParticleEffect = {
      id: "pause-resume-remainder",
      clipId: "clip-1",
      type: "dissolve",
      startTime: 0,
      duration: 10,
      enabled: true,
      config: {
        ...DEFAULT_PARTICLE_CONFIG,
        particleCount: 10,
        emissionRate: 120,
        lifetime: { min: 10, max: 10 },
        turbulence: 0,
      },
    };

    engine.addEffect(effect);
    engine.update(0, 0);
    engine.update(0.004, 0.004);
    const particle = engine.getParticles(effect.id)[0];
    expect(particle).toBeUndefined();

    // A paused frame contributes no simulation time and must not consume
    // the fractional remainder accumulated before the pause.
    engine.update(0.004, 0);
    engine.update(0.008, 0.004);

    expect(engine.getParticles(effect.id)).toHaveLength(0);
    engine.update(0.016, 0.008);
    expect(engine.getParticles(effect.id)).toHaveLength(1);
    engine.dispose();
  });

  it("does not advance existing particle age during a paused update", () => {
    const engine = new ParticleEngine();
    const effect: ParticleEffect = {
      id: "pause-freeze",
      clipId: "clip-1",
      type: "dissolve",
      startTime: 0,
      duration: 10,
      enabled: true,
      config: {
        ...DEFAULT_PARTICLE_CONFIG,
        particleCount: 1,
        emissionRate: 1,
        lifetime: { min: 10, max: 10 },
        turbulence: 0,
      },
    };

    engine.addEffect(effect);
    engine.update(0, 0);
    engine.update(1 / 120, 1 / 120);
    const particle = engine.getParticles(effect.id)[0];
    expect(particle).toBeDefined();
    const ageBeforePause = particle.age;

    engine.update(1 / 120, 0);
    expect(particle.age).toBe(ageBeforePause);
    engine.dispose();
  });
});


describe("ParticleEngine effect time boundaries", () => {
  it("does not emit before an effect's start-time interval begins", () => {
    const engine = new ParticleEngine();
    const effect: ParticleEffect = {
      id: "start-boundary",
      clipId: "clip-1",
      type: "dissolve",
      startTime: 0.5,
      duration: 2,
      enabled: true,
      config: {
        ...DEFAULT_PARTICLE_CONFIG,
        particleCount: 20,
        emissionRate: 10,
        lifetime: { min: 5, max: 5 },
        turbulence: 0,
      },
    };

    engine.addEffect(effect);
    advanceEngine(engine, 0.5, 0.5);
    expect(engine.getParticles(effect.id)).toHaveLength(0);

    advanceEngine(engine, 0.6, 0.1);
    expect(engine.getParticles(effect.id)).toHaveLength(1);
    engine.dispose();
  });

  it("clears particles after the effect end-time boundary", () => {
    const engine = new ParticleEngine();
    const effect: ParticleEffect = {
      id: "end-boundary",
      clipId: "clip-1",
      type: "dissolve",
      startTime: 0,
      duration: 0.5,
      enabled: true,
      config: {
        ...DEFAULT_PARTICLE_CONFIG,
        particleCount: 20,
        emissionRate: 10,
        lifetime: { min: 5, max: 5 },
        turbulence: 0,
      },
    };

    engine.addEffect(effect);
    engine.update(0.5, 0.5);
    expect(engine.getParticles(effect.id).length).toBeGreaterThan(0);

    engine.update(0.6, 0.1);
    expect(engine.getParticles(effect.id)).toHaveLength(0);
    expect(engine.getActiveEffectIds()).not.toContain(effect.id);
    engine.dispose();
  });
});


  it("replays identical seeded particle state after rewinding to the timeline start", () => {
    const engine = new ParticleEngine();
    const effect = makeTimelineEffect();
    effect.config.emissionRate = 18;
    effect.config.particleCount = 40;
    effect.config.turbulence = 6;
    engine.addEffect(effect);

    for (let frame = 1; frame <= 60; frame++) {
      engine.update(frame / 60, 1 / 60);
    }
    const firstPlayback = engine.getParticles(effect.id).map((particle) => ({ ...particle,
      position: { ...particle.position },
      velocity: { ...particle.velocity },
      acceleration: { ...particle.acceleration },
    }));

    engine.update(0, 0);
    expect(engine.getParticles(effect.id)).toHaveLength(0);

    for (let frame = 1; frame <= 60; frame++) {
      engine.update(frame / 60, 1 / 60);
    }
    expect(engine.getParticles(effect.id)).toEqual(firstPlayback);
    engine.dispose();
  });


describe("ParticleEngine read isolation", () => {
  const makeEffect = (id: string, clipId = "clip-read"): ParticleEffect => ({
    id,
    clipId,
    type: "dissolve",
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
  });

  it("does not expose mutable internal state through effect getters", () => {
    const engine = new ParticleEngine();
    engine.addEffect(makeEffect("read-isolation"));

    const single = engine.getEffect("read-isolation")!;
    single.config.wind.x = 99;
    single.config.colors[0] = "#000000";
    single.startTime = 99;

    const all = engine.getAllEffects();
    all[0].config.size.min = 99;

    const byClip = engine.getEffectsForClip("clip-read");
    byClip[0].config.opacity.start = 0;

    expect(engine.getEffect("read-isolation")).toMatchObject({
      startTime: 0,
      config: {
        wind: { x: 0 },
        colors: ["#ffffff"],
        size: { min: DEFAULT_PARTICLE_CONFIG.size.min },
        opacity: { start: DEFAULT_PARTICLE_CONFIG.opacity.start },
      },
    });
    engine.dispose();
  });
});


describe("ParticleEngine incremental seek reconstruction", () => {
  const makeEffect = (): ParticleEffect => ({
    id: "incremental-seek",
    clipId: "clip-seek",
    type: "dissolve",
    startTime: 0,
    duration: 20,
    enabled: true,
    config: {
      ...DEFAULT_PARTICLE_CONFIG,
      particleCount: 100,
      emissionRate: 24,
      lifetime: { min: 20, max: 20 },
      turbulence: 5,
    },
  });

  const finishSeek = (engine: ParticleEngine): void => {
    let iterations = 0;
    while (!engine.advanceSeek()) {
      iterations++;
      expect(iterations).toBeLessThan(100);
    }
  };

  it("reconstructs identical state across independent seeks to the same time", () => {
    const first = new ParticleEngine();
    const second = new ParticleEngine();
    const effect = makeEffect();
    first.addEffect(effect);
    second.addEffect(effect);

    first.beginSeek(2);
    second.beginSeek(2);
    finishSeek(first);
    finishSeek(second);

    expect(first.isSeeking()).toBe(false);
    expect(first.getParticles(effect.id)).toEqual(second.getParticles(effect.id));
    first.dispose();
    second.dispose();
  });

  it("supports restarting an in-progress seek at a new target", () => {
    const engine = new ParticleEngine();
    engine.addEffect(makeEffect());

    engine.beginSeek(8);
    expect(engine.advanceSeek()).toBe(false);
    engine.beginSeek(0.25);
    finishSeek(engine);

    expect(engine.isSeeking()).toBe(false);
    expect(engine.getParticles("incremental-seek")).toHaveLength(6);
    engine.dispose();
  });
});
