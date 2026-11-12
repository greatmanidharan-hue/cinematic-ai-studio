import { describe, expect, it, vi } from "vitest";
import { renderLightningBolt } from "./lightning-bolt-renderer";

function createContext() {
  const lineTo = vi.fn();
  return {
    lineToMock: lineTo,
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo,
    stroke: vi.fn(),
    set globalCompositeOperation(_value: string) {},
    set lineCap(_value: string) {},
    set lineJoin(_value: string) {},
    set strokeStyle(_value: string) {},
    set shadowColor(_value: string) {},
    set shadowBlur(_value: number) {},
    set lineWidth(_value: number) {},
  } as unknown as CanvasRenderingContext2D & { lineToMock: ReturnType<typeof vi.fn> };
}

describe("lightning bolt renderer", () => {
  it("draws a main bolt and configured branches", () => {
    const context = createContext();
    renderLightningBolt(context, {
      start: { x: 10, y: 10 },
      end: { x: 210, y: 180 },
      segments: 12,
      branches: 3,
    });

    expect(context.save).toHaveBeenCalledOnce();
    expect(context.stroke).toHaveBeenCalledTimes(5);
    expect(context.restore).toHaveBeenCalledOnce();
  });

  it("is deterministic for the same seed and geometry", () => {
    const first = createContext();
    const second = createContext();
    const options = {
      start: { x: 0, y: 0 },
      end: { x: 100, y: 160 },
      seed: 987,
      branches: 2,
    };

    renderLightningBolt(first, options);
    renderLightningBolt(second, options);

    expect(first.lineToMock.mock.calls).toEqual(second.lineToMock.mock.calls);
  });

  it("does not draw when both endpoints are identical", () => {
    const context = createContext();
    renderLightningBolt(context, {
      start: { x: 5, y: 5 },
      end: { x: 5, y: 5 },
    });

    expect(context.stroke).not.toHaveBeenCalled();
  });
});
