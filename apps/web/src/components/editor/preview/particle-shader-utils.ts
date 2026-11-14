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
    .replace(
      "#include <project_vertex>",
      "#include <project_vertex>\ngl_PointSize = particleSize;"
    )
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
