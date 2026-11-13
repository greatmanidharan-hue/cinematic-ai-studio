import {
  type Particle,
  type ParticleEffect,
  type ParticleConfig,
  type EmitterState,
  type Vector3,
  DEFAULT_PARTICLE_CONFIG,
} from "./particle-types";

type RandomSource = () => number;

function generateId(random: RandomSource): string {
  return random().toString(36).substring(2, 11);
}

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
  private randomState = 0x6d2b79f5;
  private particleSequence = 0;

  /**
   * Set the deterministic random seed before resetting and simulating an export.
   * The same seed and update sequence produce the same particle simulation.
   */
  setRandomSeed(seed: number): void {
    this.randomState = (seed >>> 0) || 0x6d2b79f5;
    this.particleSequence = 0;
  }

  private nextRandom = (): number => {
    // Mulberry32: compact, fast, deterministic, and independent of Math.random.
    let value = (this.randomState += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

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
    this.effects.set(effect.id, effect);
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
    this.notifyChange();
  }

  updateEffect(effectId: string, updates: Partial<ParticleConfig>): void {
    const effect = this.effects.get(effectId);
    if (effect) {
      effect.config = { ...effect.config, ...updates };
      this.notifyChange();
    }
  }

  updateEffectTiming(effectId: string, startTime: number, duration: number): void {
    const effect = this.effects.get(effectId);
    if (effect) {
      effect.startTime = startTime;
      effect.duration = duration;
      this.notifyChange();
    }
  }

  getEffect(effectId: string): ParticleEffect | undefined {
    return this.effects.get(effectId);
  }

  getAllEffects(): ParticleEffect[] {
    return Array.from(this.effects.values());
  }

  getEffectsForClip(clipId: string): ParticleEffect[] {
    return Array.from(this.effects.values()).filter(e => e.clipId === clipId);
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
    center: Vector3
  ): Particle {
    const config = effect.config;
    const random = this.nextRandom;
    const position = getEmissionPosition(config, center, random);
    const velocity = getInitialVelocity(config, effect.type, center, position, random);
    const colorIndex = Math.floor(random() * config.colors.length);

    return {
      id: `particle-${++this.particleSequence}-${generateId(random)}`,
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
    // Ignore invalid or backwards simulation steps. Timeline scrubbing must use
    // seekToTime(), which rebuilds the deterministic state from the start.
    if (!Number.isFinite(currentTime) || !Number.isFinite(deltaTime) || deltaTime <= 0) {
      return;
    }

    for (const [effectId, emitter] of this.emitters) {
      const effect = this.effects.get(effectId);
      if (!effect) {
        emitter.active = false;
        emitter.particles = [];
        emitter.emissionAccumulator = 0;
        continue;
      }
      if (!effect.enabled) {
        emitter.active = false;
        emitter.particles = [];
        emitter.emissionAccumulator = 0;
        continue;
      }

      const effectStarted = currentTime >= effect.startTime;
      const effectEnded = currentTime >= effect.startTime + effect.duration;

      if (!effectStarted || effectEnded) {
        emitter.active = false;
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

      emitter.emissionAccumulator += config.emissionRate * deltaTime;
      while (
        emitter.emissionAccumulator >= 1 &&
        emitter.particles.length < config.particleCount
      ) {
        emitter.particles.push(this.createParticle(effect, center));
        emitter.emissionAccumulator -= 1;
      }

      for (const particle of emitter.particles) {
        if (!particle.active) continue;

        particle.velocity.x += (particle.acceleration.x + config.wind.x) * deltaTime;
        particle.velocity.y += (particle.acceleration.y + config.wind.y) * deltaTime;
        particle.velocity.z += (particle.acceleration.z + config.wind.z) * deltaTime;

        if (config.turbulence > 0) {
          particle.velocity.x += randomRange(-config.turbulence, config.turbulence, this.nextRandom) * deltaTime;
          particle.velocity.y += randomRange(-config.turbulence, config.turbulence, this.nextRandom) * deltaTime;
        }

        particle.position.x += particle.velocity.x * deltaTime;
        particle.position.y += particle.velocity.y * deltaTime;
        particle.position.z += particle.velocity.z * deltaTime;

        particle.rotation += particle.rotationSpeed * deltaTime;
        particle.age += deltaTime;

        const lifeProgress = particle.lifetime > 0
          ? Math.max(0, Math.min(1, particle.age / particle.lifetime))
          : 1;
        const fadeIn = Math.max(0, Math.min(1, Number.isFinite(config.fadeIn) ? config.fadeIn : 0));
        const fadeOut = Math.max(0, Math.min(1, Number.isFinite(config.fadeOut) ? config.fadeOut : 0));

        if (fadeIn > 0 && lifeProgress <= fadeIn) {
          particle.opacity = config.opacity.start * (lifeProgress / fadeIn);
        } else if (fadeOut > 0 && lifeProgress >= 1 - fadeOut) {
          const fadeProgress = (1 - lifeProgress) / fadeOut;
          particle.opacity = config.opacity.end + (config.opacity.start - config.opacity.end) * fadeProgress;
        } else {
          const middleDuration = 1 - fadeIn - fadeOut;
          const midProgress = middleDuration > 0
            ? (lifeProgress - fadeIn) / middleDuration
            : 1;
          particle.opacity = config.opacity.start + (config.opacity.end - config.opacity.start) * midProgress;
        }
        particle.opacity = Number.isFinite(particle.opacity)
          ? Math.max(0, Math.min(1, particle.opacity))
          : 0;

        if (particle.age >= particle.lifetime) {
          particle.active = false;
        }
      }

      emitter.particles = emitter.particles.filter((p) => p.active);
    }
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
    for (const emitter of this.emitters.values()) {
      emitter.particles = [];
      emitter.elapsedTime = 0;
      emitter.emissionAccumulator = 0;
      emitter.active = false;
    }
  }

  /**
   * Rebuild the simulation at an absolute timeline position.
   * Replaying from zero avoids accumulating stale particles when the editor
   * playhead is scrubbed, paused, or moved backwards.
   */
  seekToTime(
    targetTime: number,
    fixedStep = 1 / 30,
    seed?: number,
  ): void {
    const safeTarget = Number.isFinite(targetTime) ? Math.max(0, targetTime) : 0;
    const safeStep = Number.isFinite(fixedStep) && fixedStep > 0
      ? Math.min(fixedStep, 1 / 10)
      : 1 / 30;

    if (seed !== undefined) this.setRandomSeed(seed);
    else this.setRandomSeed(0x6d2b79f5);
    this.reset();

    let simulatedTime = 0;
    while (simulatedTime + safeStep <= safeTarget) {
      simulatedTime += safeStep;
      this.update(simulatedTime, safeStep);
    }

    const remainder = safeTarget - simulatedTime;
    if (remainder > 1e-8) {
      this.update(safeTarget, remainder);
    }
  }

  dispose(): void {
    this.emitters.clear();
    this.effects.clear();
  }
}

/**
 * Stable seed shared by editor preview and export for the same VFX setup.
 */
export function getParticleEffectsSeed(effects: readonly ParticleEffect[]): number {
  const signature = JSON.stringify(
    [...effects]
      .map((effect) => ({
        ...effect,
        config: {
          ...effect.config,
          wind: { ...effect.config.wind },
          colors: [...effect.config.colors],
          size: { ...effect.config.size },
          opacity: { ...effect.config.opacity },
          lifetime: { ...effect.config.lifetime },
        },
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
  let seed = 0x811c9dc5;
  for (let index = 0; index < signature.length; index++) {
    seed ^= signature.charCodeAt(index);
    seed = Math.imul(seed, 0x01000193);
  }
  return seed >>> 0;
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
