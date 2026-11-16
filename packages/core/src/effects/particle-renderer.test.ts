import { describe, expect, it, vi } from "vitest";
import type { Particle } from "./particle-types";
import { renderParticles } from "./particle-renderer";

function makeParticle(overrides: Partial<Particle> = {}): Particle {
  return {
    id: "particle-1",
    position: { x: 24, y: 48, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    acceleration: { x: 0, y: 0, z: 0 },
    color: "#ff8a00",
    blendMode: "normal",
    size: 6,
    opacity: 0.8,
    rotation: 0.25,
    rotationSpeed: 0,
    lifetime: 1,
    age: 0.2,
    active: true,
    ...overrides,
  };
}

function makeContext() {
  const gradient = { addColorStop: vi.fn() };
  const compositeOperations: string[] = [];
  const context = {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    createRadialGradient: vi.fn(() => gradient),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    set globalAlpha(_value: number) {},
    set globalCompositeOperation(value: GlobalCompositeOperation) {
      compositeOperations.push(value);
    },
    set fillStyle(_value: string | CanvasGradient | CanvasPattern) {},
  };
  return { context, gradient, compositeOperations };
}

describe("renderParticles", () => {
  it("draws active visible particles with a radial glow", () => {
    const { context, gradient } = makeContext();

    renderParticles(context as unknown as CanvasRenderingContext2D, [
      makeParticle(),
    ]);

    expect(context.createRadialGradient).toHaveBeenCalledOnce();
    expect(gradient.addColorStop).toHaveBeenCalledTimes(3);
    expect(context.arc).toHaveBeenCalledOnce();
    expect(context.fill).toHaveBeenCalledOnce();
    expect(context.save).toHaveBeenCalledTimes(2);
    expect(context.restore).toHaveBeenCalledTimes(2);
  });

  it("skips inactive, transparent and zero-size particles", () => {
    const { context } = makeContext();

    renderParticles(context as unknown as CanvasRenderingContext2D, [
      makeParticle({ active: false }),
      makeParticle({ opacity: 0 }),
      makeParticle({ size: 0 }),
    ]);

    expect(context.createRadialGradient).not.toHaveBeenCalled();
    expect(context.fill).not.toHaveBeenCalled();
  });

  it("uses each particle's configured blend mode", () => {
    const { context, compositeOperations } = makeContext();

    renderParticles(context as unknown as CanvasRenderingContext2D, [
      makeParticle({ blendMode: "add" }),
      makeParticle({ blendMode: "screen" }),
      makeParticle({ blendMode: "multiply" }),
      makeParticle({ blendMode: "normal" }),
    ]);

    expect(compositeOperations).toEqual([
      "lighter",
      "screen",
      "multiply",
      "source-over",
    ]);
  });

  it("allows the additive option to override particle blend modes", () => {
    const { context, compositeOperations } = makeContext();

    renderParticles(
      context as unknown as CanvasRenderingContext2D,
      [makeParticle({ blendMode: "normal" })],
      { additive: true },
    );

    expect(compositeOperations).toEqual(["lighter"]);
  });

  it("does not draw when layer opacity is zero", () => {
    const { context } = makeContext();

    renderParticles(
      context as unknown as CanvasRenderingContext2D,
      [makeParticle()],
      { opacity: 0 },
    );

    expect(context.save).not.toHaveBeenCalled();
  });
});
