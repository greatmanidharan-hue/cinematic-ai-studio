import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
  clampParticlePointSize,
  getParticleBufferCapacity,
  groupParticlesIntoBlendRuns,
  injectParticleShaderAttributes,
  limitParticleBlendRuns,
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


describe("limitParticleBlendRuns", () => {
  it("caps run count and total particles without changing retained order", () => {
    const runs = groupParticlesIntoBlendRuns([
      { id: "a", blendMode: "add" as const },
      { id: "b", blendMode: "normal" as const },
      { id: "c", blendMode: "screen" as const },
      { id: "d", blendMode: "multiply" as const },
    ]);

    const limited = limitParticleBlendRuns(runs, 3, 2);

    expect(limited.map((run) => run.blendMode)).toEqual(["add", "normal"]);
    expect(limited.flatMap((run) => run.particles.map((particle) => particle.id)))
      .toEqual(["a", "b"]);
  });

  it("keeps a leading portion of the final run when the particle budget ends mid-run", () => {
    const runs = groupParticlesIntoBlendRuns([
      { id: "a", blendMode: "add" as const },
      { id: "b", blendMode: "add" as const },
      { id: "c", blendMode: "add" as const },
      { id: "d", blendMode: "normal" as const },
    ]);

    const limited = limitParticleBlendRuns(runs, 10, 2);

    expect(limited).toEqual([{ blendMode: "add", particles: [{ id: "a", blendMode: "add" }, { id: "b", blendMode: "add" }] }]);
  });



  it("never exceeds either budget or changes the retained particle prefix (property-based)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.nat(),
            blendMode: fc.constantFrom("normal" as const, "add" as const, "multiply" as const, "screen" as const),
          }),
          { maxLength: 100 },
        ),
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 100 }),
        (particles, maxRuns, maxParticles) => {
          const runs = groupParticlesIntoBlendRuns(particles);
          const limited = limitParticleBlendRuns(runs, maxRuns, maxParticles);
          const retained = limited.flatMap((run) => run.particles);
          const originalPrefix = particles.slice(0, retained.length);

          expect(limited.length).toBeLessThanOrEqual(maxRuns);
          expect(retained.length).toBeLessThanOrEqual(maxParticles);
          expect(retained).toEqual(originalPrefix);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("returns no runs for zero or negative budgets", () => {
    const runs = groupParticlesIntoBlendRuns([{ id: "a", blendMode: "add" as const }]);

    expect(limitParticleBlendRuns(runs, 0, 10)).toEqual([]);
    expect(limitParticleBlendRuns(runs, 10, -1)).toEqual([]);
  });
});


describe("getParticleBufferCapacity", () => {
  it("starts small and grows geometrically to fit required particles", () => {
    expect(getParticleBufferCapacity(1, 0, 10000)).toBe(1);
    expect(getParticleBufferCapacity(5, 1, 10000)).toBe(8);
    expect(getParticleBufferCapacity(9, 8, 10000)).toBe(16);
  });

  it("reuses sufficient capacity without shrinking", () => {
    expect(getParticleBufferCapacity(4, 16, 10000)).toBe(16);
  });

  it("never exceeds the configured maximum", () => {
    expect(getParticleBufferCapacity(9000, 8192, 10000)).toBe(10000);
    expect(getParticleBufferCapacity(20000, 0, 10000)).toBe(10000);
  });

  it("handles zero and negative inputs safely", () => {
    expect(getParticleBufferCapacity(-2, 0, 10000)).toBe(0);
    expect(getParticleBufferCapacity(10, 0, -1)).toBe(0);
  });
});


describe("clampParticlePointSize", () => {
  it("clamps sizes to the supported range", () => {
    expect(clampParticlePointSize(-2, 64)).toBe(0);
    expect(clampParticlePointSize(24, 64)).toBe(24);
    expect(clampParticlePointSize(120, 64)).toBe(64);
  });

  it("safely handles non-finite sizes and invalid device limits", () => {
    expect(clampParticlePointSize(Number.NaN, 64)).toBe(0);
    expect(clampParticlePointSize(10, Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampParticlePointSize(10, 0)).toBe(0);
  });
});
