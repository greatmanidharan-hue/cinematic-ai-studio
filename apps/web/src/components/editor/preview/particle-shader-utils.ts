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
