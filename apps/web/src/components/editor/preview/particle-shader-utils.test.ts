import { describe, expect, it } from "vitest";
import {
  groupParticlesIntoBlendRuns,
  injectParticleShaderAttributes,
} from "./particle-shader-utils";

describe("injectParticleShaderAttributes", () => {
  it("declares per-particle alpha and size attributes in the vertex shader", () => {
    const shader = {
      vertexShader: [
        "#include <common>",
        "void main() {",
        "  #include <project_vertex>",
        "  #include <color_vertex>",
        "}",
      ].join("\n"),
      fragmentShader: [
        "#include <common>",
        "void main() {",
        "  #include <color_fragment>",
        "}",
      ].join("\n"),
    };

    injectParticleShaderAttributes(shader);

    expect(shader.vertexShader).toContain("attribute float alpha;");
    expect(shader.vertexShader).toContain("attribute float particleSize;");
    expect(shader.vertexShader).toContain("gl_PointSize = particleSize;");
    expect(shader.vertexShader).toContain("vParticleAlpha = alpha;");
    expect(shader.fragmentShader).toContain("diffuseColor.a *= vParticleAlpha;");
  });


  it("replaces the built-in PointsMaterial size assignment", () => {
    const shader = {
      vertexShader: [
        "#include <common>",
        "void main() {",
        "  #include <project_vertex>",
        "  gl_PointSize = size;",
        "}",
      ].join("\n"),
      fragmentShader: "#include <common>\nvoid main() {}",
    };

    injectParticleShaderAttributes(shader);

    expect(shader.vertexShader).toContain("gl_PointSize = particleSize;");
    expect(shader.vertexShader).not.toContain("gl_PointSize = size;");
  });

  it("keeps shader source unchanged when expected Three.js chunks are absent", () => {
    const shader = { vertexShader: "void main() {}", fragmentShader: "void main() {}" };

    injectParticleShaderAttributes(shader);

    expect(shader.vertexShader).toBe("void main() {}");
    expect(shader.fragmentShader).toBe("void main() {}");
  });
});

describe("groupParticlesIntoBlendRuns", () => {
  it("keeps interleaved blend modes in their original run order", () => {
    const particles = [
      { id: "a", blendMode: "add" as const },
      { id: "b", blendMode: "normal" as const },
      { id: "c", blendMode: "add" as const },
      { id: "d", blendMode: "add" as const },
      { id: "e", blendMode: "screen" as const },
    ];

    const runs = groupParticlesIntoBlendRuns(particles);

    expect(runs.map((run) => run.blendMode)).toEqual([
      "add", "normal", "add", "screen",
    ]);
    expect(runs.flatMap((run) => run.particles.map((particle) => particle.id)))
      .toEqual(["a", "b", "c", "d", "e"]);
  });

  it("returns no runs for an empty particle list", () => {
    expect(groupParticlesIntoBlendRuns([])).toEqual([]);
  });
});
