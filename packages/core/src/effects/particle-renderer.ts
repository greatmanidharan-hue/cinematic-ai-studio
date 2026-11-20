import type { Particle } from "./particle-types";

/**
 * Draws the current particle snapshot into a 2D canvas context.
 *
 * The caller owns the animation loop and canvas sizing. This keeps rendering
 * deterministic with respect to the supplied particle state and lets the same
 * renderer target an HTML canvas or an OffscreenCanvas.
 */
export type ParticleCanvasContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

export interface ParticleRenderOptions {
  /** Global opacity multiplier for the entire particle layer. */
  opacity?: number;
  /** Additional glow radius in multiples of particle size. */
  glow?: number;
  /** Override each particle's configured blend mode for the whole layer. */
  additive?: boolean;
}

export function renderParticles(
  context: ParticleCanvasContext,
  particles: readonly Particle[],
  options: ParticleRenderOptions = {},
): void {
  const layerOpacity = Math.max(0, Math.min(1, options.opacity ?? 1));
  const glow = Math.max(0, options.glow ?? 1.8);
  if (layerOpacity === 0 || particles.length === 0) return;

  context.save();

  for (const particle of particles) {
    if (!particle.active || particle.opacity <= 0 || particle.size <= 0) continue;

    const blendMode = options.additive === true
      ? "add"
      : options.additive === false
        ? "normal"
        : particle.blendMode;
    context.globalCompositeOperation = blendMode === "add"
      ? "lighter"
      : blendMode === "multiply"
        ? "multiply"
        : blendMode === "screen"
          ? "screen"
          : "source-over";

    const alpha = Math.max(0, Math.min(1, particle.opacity * layerOpacity));
    const radius = Math.max(0.5, particle.size);
    const glowRadius = radius * (1 + glow);

    context.save();
    context.globalAlpha = alpha;
    context.translate(particle.position.x, particle.position.y);
    context.rotate(particle.rotation);

    const gradient = context.createRadialGradient(0, 0, 0, 0, 0, glowRadius);
    gradient.addColorStop(0, particle.color);
    gradient.addColorStop(0.35, particle.color);
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

    context.fillStyle = gradient;
    context.beginPath();
    context.arc(0, 0, glowRadius, 0, Math.PI * 2);
    context.fill();

    context.restore();
  }

  context.restore();
}
