import {
  type Particle,
  type ParticleEffect,
  type ParticleConfig,
  type EmitterState,
  type Vector3,
  DEFAULT_PARTICLE_CONFIG,
} from "./particle-types";
import { createSeededRandom } from "./particle-random";
import { getBoundedSimulationWindow } from "./particle-simulation-window";
import { scheduleParticleEmissions } from "./particle-emission-scheduler";

function cloneParticleConfig(config: ParticleConfig): ParticleConfig {
  return {
    ...config,
    wind: { ...config.wind },
    colors: [...config.colors],
    size: { ...config.size },
    opacity: { ...config.opacity },
    lifetime: { ...config.lifetime },
  };
}

type RandomSource = () => number;

function randomRange(min: number, max: number, random: RandomSource): number {
  return min + random() * (max - min);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { r: 255, g: 255, b: 255 };
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

function lerpColor(color1: string, color2: string, t: number): string {
  const c1 = hexToRgb(color1);
  const c2 = hexToRgb(color2);
  const r = Math.round(c1.r + (c2.r - c1.r) * t);
  const g = Math.round(c1.g + (c2.g - c1.g) * t);
  const b = Math.round(c1.b + (c2.b - c1.b) * t);
  return `rgb(${r},${g},${b})`;
}

function getEmissionPosition(config: ParticleConfig, center: Vector3, random: RandomSource): Vector3 {
  switch (config.emissionShape) {
    case "circle": {
      const angle = random() * Math.PI * 2;
      const r = random() * config.emissionRadius;
      return {
        x: center.x + Math.cos(angle) * r,
        y: center.y + Math.sin(angle) * r,
        z: center.z,
      };
    }
    case "sphere": {
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      const r = random() * config.emissionRadius;
      return {
        x: center.x + r * Math.sin(phi) * Math.cos(theta),
        y: center.y + r * Math.sin(phi) * Math.sin(theta),
        z: center.z + r * Math.cos(phi),
      };
    }
    case "rectangle": {
      return {
        x: center.x + randomRange(-config.emissionRadius, config.emissionRadius, random),
        y: center.y + randomRange(-config.emissionRadius, config.emissionRadius, random),
        z: center.z,
      };
    }
    case "line": {
      return {
        x: center.x + randomRange(-config.emissionRadius, config.emissionRadius, random),
        y: center.y,
        z: center.z,
      };
    }
    case "point":
    default:
      return { ...center };
  }
}

function getInitialVelocity(
  config: ParticleConfig,
  effectType: string,
  center: Vector3,
  position: Vector3,
  random: RandomSource
): Vector3 {
  const speed = config.speed + randomRange(-config.speedVariance, config.speedVariance, random);

  switch (effectType) {
    case "explode": {
      const dx = position.x - center.x;
      const dy = position.y - center.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      return {
        x: (dx / dist) * speed + randomRange(-20, 20, random),
        y: (dy / dist) * speed + randomRange(-20, 20, random),
        z: randomRange(-speed * 0.5, speed * 0.5, random),
      };
    }
    case "implode": {
      const dx = center.x - position.x;
      const dy = center.y - position.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      return {
        x: (dx / dist) * speed,
        y: (dy / dist) * speed,
        z: 0,
      };
    }
    case "confetti": {
      return {
        x: randomRange(-speed, speed, random),
        y: -Math.abs(speed) * randomRange(0.5, 1.5, random),
        z: randomRange(-speed * 0.3, speed * 0.3, random),
      };
    }
    case "dust":
    case "sparkle": {
      const angle = random() * Math.PI * 2;
      return {
        x: Math.cos(angle) * speed * 0.3,
        y: Math.sin(angle) * speed * 0.3 - speed * 0.2,
        z: randomRange(-10, 10, random),
      };
    }
    case "disintegrate": {
      return {
        x: randomRange(-speed * 0.5, speed * 0.5, random),
        y: -speed * randomRange(0.3, 0.8, random),
        z: randomRange(-speed * 0.2, speed * 0.2, random),
      };
    }
    case "shatter": {
      const angle = random() * Math.PI * 2;
      return {
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed - speed * 0.5,
        z: randomRange(-speed * 0.5, speed * 0.5, random),
      };
    }
    case "dissolve":
    default: {
      const angle = random() * Math.PI * 2;
      return {
        x: Math.cos(angle) * speed * 0.5,
        y: Math.sin(angle) * speed * 0.5,
        z: 0,
      };
    }
  }
}

export class ParticleEngine {
  private emitters: Map<string, EmitterState> = new Map();
  private effects: Map<string, ParticleEffect> = new Map();
  private canvasWidth: number = 1920;
  private canvasHeight: number = 1080;
  private changeListeners: Set<() => void> = new Set();
  private changeVersion: number = 0;
  private lastUpdateTime: number | null = null;
  private fixedStepAccumulator = 0;
  private readonly fixedStep = 1 / 120;
  private readonly maxFixedStepsPerUpdate = 8;
  private randomGenerators = new Map<string, RandomSource>();
  private particleCounters = new Map<string, number>();

  onEffectsChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  private notifyChange(): void {
    this.changeVersion++;
    for (const listener of this.changeListeners) {
      listener();
    }
  }

  getChangeVersion(): number {
    return this.changeVersion;
  }

  setCanvasSize(width: number, height: number): void {
    this.canvasWidth = width;
    this.canvasHeight = height;
  }

  addEffect(effect: ParticleEffect): void {
    // Keep engine state independent from mutable objects owned by the UI.
    this.effects.set(effect.id, {
      ...effect,
      config: cloneParticleConfig(effect.config),
    });
    this.randomGenerators.set(effect.id, createSeededRandom(effect.id));
    this.particleCounters.set(effect.id, 0);
    this.emitters.set(effect.id, {
      effectId: effect.id,
      particles: [],
      elapsedTime: 0,
      emissionAccumulator: 0,
      active: false,
    });
    this.notifyChange();
  }

  removeEffect(effectId: string): void {
    this.effects.delete(effectId);
    this.emitters.delete(effectId);
    this.randomGenerators.delete(effectId);
    this.particleCounters.delete(effectId);
    this.notifyChange();
  }

  updateEffect(effectId: string, updates: Partial<ParticleConfig>): void {
    const effect = this.effects.get(effectId);
    if (effect) {
      effect.config = cloneParticleConfig({ ...effect.config, ...updates });
      this.resetEmitterForEffect(effectId);
      this.notifyChange();
    }
  }

  updateEffectTiming(effectId: string, startTime: number, duration: number): void {
    const effect = this.effects.get(effectId);
    if (effect) {
      effect.startTime = startTime;
      effect.duration = duration;
      this.resetEmitterForEffect(effectId);
      this.notifyChange();
    }
  }

  /** Clears only the edited effect's simulation state and restarts its seed. */
  private resetEmitterForEffect(effectId: string): void {
    const emitter = this.emitters.get(effectId);
    if (emitter) {
      emitter.particles = [];
      emitter.elapsedTime = 0;
      emitter.emissionAccumulator = 0;
      emitter.active = false;
    }
    this.randomGenerators.set(effectId, createSeededRandom(effectId));
    this.particleCounters.set(effectId, 0);
  }

  private cloneEffect(effect: ParticleEffect): ParticleEffect {
    return {
      ...effect,
      config: cloneParticleConfig(effect.config),
    };
  }

  getEffect(effectId: string): ParticleEffect | undefined {
    const effect = this.effects.get(effectId);
    return effect ? this.cloneEffect(effect) : undefined;
  }

  getAllEffects(): ParticleEffect[] {
    return Array.from(this.effects.values(), effect => this.cloneEffect(effect));
  }

  getEffectsForClip(clipId: string): ParticleEffect[] {
    return Array.from(this.effects.values())
      .filter(effect => effect.clipId === clipId)
      .map(effect => this.cloneEffect(effect));
  }

  toggleEffect(effectId: string, enabled: boolean): void {
    const effect = this.effects.get(effectId);
    if (effect) {
      effect.enabled = enabled;
      this.notifyChange();
    }
  }

  private createParticle(
    effect: ParticleEffect,
    center: Vector3,
    random: RandomSource,
    birthTime: number,
  ): Particle {
    const config = effect.config;
    const position = getEmissionPosition(config, center, random);
    const velocity = getInitialVelocity(config, effect.type, center, position, random);
    const colorIndex = Math.floor(random() * config.colors.length);

    return {
      id: `${effect.id}-particle-${this.particleCounters.get(effect.id) ?? 0}`,
      birthTime,
      blendMode: config.blendMode,
      position,
      velocity,
      acceleration: { x: 0, y: config.gravity, z: 0 },
      color: config.colors[colorIndex],
      size: randomRange(config.size.min, config.size.max, random),
      opacity: config.opacity.start,
      rotation: random() * Math.PI * 2,
      rotationSpeed: randomRange(-config.rotationSpeed, config.rotationSpeed, random),
      lifetime: randomRange(config.lifetime.min, config.lifetime.max, random),
      age: 0,
      active: true,
    };
  }

  update(currentTime: number, deltaTime: number): void {
    // A backwards timeline seek invalidates particles simulated in the future.
    if (this.lastUpdateTime !== null && currentTime < this.lastUpdateTime) {
      this.reset();
    }
    this.lastUpdateTime = currentTime;
    const safeDeltaTime = Number.isFinite(deltaTime) ? Math.max(0, deltaTime) : 0;
    const frameStartTime = currentTime - safeDeltaTime;
    const simulationWindow = getBoundedSimulationWindow(
      frameStartTime,
      safeDeltaTime,
      this.fixedStepAccumulator,
      this.fixedStep,
      this.maxFixedStepsPerUpdate,
    );
    this.fixedStepAccumulator = simulationWindow.remainder;

    for (const [effectId, emitter] of this.emitters) {
      const effect = this.effects.get(effectId);
      if (!effect || !effect.enabled) {
        emitter.active = false;
        emitter.particles = [];
        emitter.emissionAccumulator = 0;
        continue;
      }

      const effectStarted = currentTime >= effect.startTime;
      const effectEnded = currentTime > effect.startTime + effect.duration;

      if (!effectStarted || effectEnded) {
        emitter.active = false;
        emitter.particles = [];
        emitter.emissionAccumulator = 0;
        continue;
      }

      emitter.active = true;
      emitter.elapsedTime = currentTime - effect.startTime;

      const config = effect.config;
      const center: Vector3 = {
        x: this.canvasWidth / 2,
        y: this.canvasHeight / 2,
        z: 0,
      };


      // Process every accepted fixed step chronologically. Emissions are
      // created at their scheduled timestamp before that step is integrated,
      // so a new particle receives only the portion after its birth time.
      const effectEndTime = effect.startTime + effect.duration;
      for (let stepIndex = 0; stepIndex < simulationWindow.steps; stepIndex++) {
        const stepStart = simulationWindow.startTime + stepIndex * this.fixedStep;
        const stepEnd = stepStart + this.fixedStep;
        const activeStepStart = Math.max(stepStart, effect.startTime);
        const activeStepEnd = Math.min(stepEnd, effectEndTime);

        if (activeStepEnd > activeStepStart) {
          const schedule = scheduleParticleEmissions(
            activeStepStart,
            activeStepEnd,
            config.emissionRate,
            emitter.emissionAccumulator,
            Math.max(0, config.particleCount - emitter.particles.length),
          );
          emitter.emissionAccumulator = schedule.remainder;

          for (const emissionTime of schedule.emissionTimes) {
            const random = this.randomGenerators.get(effectId) ?? createSeededRandom(effectId);
            this.randomGenerators.set(effectId, random);
            emitter.particles.push(this.createParticle(effect, center, random, emissionTime));
            this.particleCounters.set(effectId, (this.particleCounters.get(effectId) ?? 0) + 1);
          }
        }

        for (const particle of emitter.particles) {
          if (!particle.active || particle.birthTime >= stepEnd) continue;

          const integrationStart = Math.max(stepStart, particle.birthTime);
          const integrationEnd = Math.min(stepEnd, effectEndTime);
          const stepDelta = Math.max(0, integrationEnd - integrationStart);
          if (stepDelta <= 0) continue;

          particle.velocity.x += (particle.acceleration.x + config.wind.x) * stepDelta;
          particle.velocity.y += (particle.acceleration.y + config.wind.y) * stepDelta;
          particle.velocity.z += (particle.acceleration.z + config.wind.z) * stepDelta;

          if (config.turbulence > 0) {
            const random = this.randomGenerators.get(effectId) ?? createSeededRandom(effectId);
            this.randomGenerators.set(effectId, random);
            particle.velocity.x += randomRange(-config.turbulence, config.turbulence, random) * stepDelta;
            particle.velocity.y += randomRange(-config.turbulence, config.turbulence, random) * stepDelta;
          }

          particle.position.x += particle.velocity.x * stepDelta;
          particle.position.y += particle.velocity.y * stepDelta;
          particle.position.z += particle.velocity.z * stepDelta;
          particle.rotation += particle.rotationSpeed * stepDelta;
          particle.age += stepDelta;

          const lifeProgress = particle.age / particle.lifetime;
          if (lifeProgress < config.fadeIn) {
            particle.opacity = config.opacity.start * (lifeProgress / config.fadeIn);
          } else if (lifeProgress > 1 - config.fadeOut) {
            const fadeProgress = (1 - lifeProgress) / config.fadeOut;
            particle.opacity = config.opacity.end + (config.opacity.start - config.opacity.end) * fadeProgress;
          } else {
            const midProgress = (lifeProgress - config.fadeIn) / (1 - config.fadeIn - config.fadeOut);
            particle.opacity = config.opacity.start + (config.opacity.end - config.opacity.start) * midProgress;
          }

          if (particle.age >= particle.lifetime) particle.active = false;
        }

        emitter.particles = emitter.particles.filter((particle) => particle.active);
        if (emitter.particles.length >= config.particleCount) {
          emitter.emissionAccumulator %= 1;
        }
      }

      // Keep the emitter's fractional emission progress; whole due emissions
      // are discarded at capacity and are never banked for a later burst.
      emitter.particles = emitter.particles.filter((particle) => particle.active);
    }
  }

  private seekTargetTime: number | null = null;
  private seekCursorTime = 0;

  /**
   * Starts a deterministic rebuild from timeline zero to the requested time.
   * Call advanceSeek() repeatedly to spread the work across animation frames.
   */
  beginSeek(targetTime: number): void {
    this.reset();
    this.seekTargetTime = Number.isFinite(targetTime) ? Math.max(0, targetTime) : 0;
    this.seekCursorTime = 0;
    this.update(0, 0);
  }

  /**
   * Advances at most maxFixedStepsPerUpdate fixed steps toward the seek target.
   * Returns true when the target time has been reconstructed.
   */
  advanceSeek(): boolean {
    if (this.seekTargetTime === null) return true;
    const remaining = this.seekTargetTime - this.seekCursorTime;
    if (remaining <= 0) {
      this.seekTargetTime = null;
      return true;
    }

    const maxDelta = this.fixedStep * this.maxFixedStepsPerUpdate;
    const deltaTime = Math.min(remaining, maxDelta);
    this.seekCursorTime += deltaTime;
    this.update(this.seekCursorTime, deltaTime);

    if (this.seekCursorTime >= this.seekTargetTime) {
      this.seekTargetTime = null;
      return true;
    }
    return false;
  }

  isSeeking(): boolean {
    return this.seekTargetTime !== null;
  }

  getParticles(effectId?: string): Particle[] {
    if (effectId) {
      const emitter = this.emitters.get(effectId);
      return emitter ? emitter.particles : [];
    }

    const allParticles: Particle[] = [];
    for (const emitter of this.emitters.values()) {
      if (emitter.active) {
        allParticles.push(...emitter.particles);
      }
    }
    return allParticles;
  }

  getActiveEffectIds(): string[] {
    const activeIds: string[] = [];
    for (const [effectId, emitter] of this.emitters) {
      if (emitter.active) {
        activeIds.push(effectId);
      }
    }
    return activeIds;
  }

  reset(): void {
    this.lastUpdateTime = null;
    this.fixedStepAccumulator = 0;
    for (const [effectId, emitter] of this.emitters) {
      this.randomGenerators.set(effectId, createSeededRandom(effectId));
      this.particleCounters.set(effectId, 0);
      emitter.particles = [];
      emitter.elapsedTime = 0;
      emitter.emissionAccumulator = 0;
      emitter.active = false;
    }
  }

  dispose(): void {
    this.emitters.clear();
    this.effects.clear();
    this.randomGenerators.clear();
    this.particleCounters.clear();
  }
}

let engineInstance: ParticleEngine | null = null;

export function getParticleEngine(): ParticleEngine {
  if (!engineInstance) {
    engineInstance = new ParticleEngine();
  }
  return engineInstance;
}

export function disposeParticleEngine(): void {
  if (engineInstance) {
    engineInstance.dispose();
    engineInstance = null;
  }
}

export { DEFAULT_PARTICLE_CONFIG, lerpColor };
