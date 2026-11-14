import { describe, expect, it } from "vitest";
import { injectParticleShaderAttributes } from "./particle-shader-utils";

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
