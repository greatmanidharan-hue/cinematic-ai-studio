export interface ParticleShaderSource {
  vertexShader: string;
  fragmentShader: string;
}

/** Adds per-particle size and opacity attributes to Three.js PointsMaterial. */
export const injectParticleShaderAttributes = (shader: ParticleShaderSource): void => {
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      "#include <common>\nattribute float alpha;\nattribute float particleSize;\nvarying float vParticleAlpha;"
    )
    .replace("gl_PointSize = size;", "gl_PointSize = particleSize;")
    .replace(
      "#include <color_vertex>",
      "#include <color_vertex>\nvParticleAlpha = alpha;"
    );

  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      "#include <common>\nvarying float vParticleAlpha;"
    )
    .replace(
      "#include <color_fragment>",
      "#include <color_fragment>\ndiffuseColor.a *= vParticleAlpha;"
    );
};

export interface ParticleBlendRun<T> {
  blendMode: "normal" | "add" | "multiply" | "screen";
  particles: T[];
}

/**
 * Groups only adjacent particles with the same blend mode.
 * Unlike a global mode bucket, this preserves the original run order.
 */
export const groupParticlesIntoBlendRuns = <
  T extends { blendMode: ParticleBlendRun<T>["blendMode"] },
>(
  particles: readonly T[],
): ParticleBlendRun<T>[] => {
  const runs: ParticleBlendRun<T>[] = [];

  for (const particle of particles) {
    const lastRun = runs[runs.length - 1];
    if (lastRun?.blendMode === particle.blendMode) {
      lastRun.particles.push(particle);
    } else {
      runs.push({ blendMode: particle.blendMode, particles: [particle] });
    }
  }

  return runs;
};


/**
 * Applies predictable draw-call and particle budgets without reordering runs.
 * A partially retained final run keeps only its leading particles.
 */
export const limitParticleBlendRuns = <T>(
  runs: readonly ParticleBlendRun<T>[],
  maxRuns: number,
  maxParticles: number,
): ParticleBlendRun<T>[] => {
  const runLimit = Math.max(0, Math.floor(maxRuns));
  let remaining = Math.max(0, Math.floor(maxParticles));
  const limited: ParticleBlendRun<T>[] = [];

  for (const run of runs) {
    if (limited.length >= runLimit || remaining === 0) break;
    const count = Math.min(run.particles.length, remaining);
    if (count === 0) continue;
    limited.push({
      blendMode: run.blendMode,
      particles: run.particles.slice(0, count),
    });
    remaining -= count;
  }

  return limited;
};
