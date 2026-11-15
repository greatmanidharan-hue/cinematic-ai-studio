import { describe, expect, it, vi } from "vitest";
import { WebGPURenderer } from "./webgpu-renderer-impl";

describe("WebGPURenderer device-loss handling", () => {
  it("retries device recovery after an attempt throws", async () => {
    vi.useFakeTimers();
    const renderer = Object.create(
      WebGPURenderer.prototype,
    ) as WebGPURenderer;
    const recreateDevice = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary recreation failure"))
      .mockResolvedValueOnce(true);
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    Reflect.set(renderer, "recreateDevice", recreateDevice);

    try {
      const recovery = Reflect.get(
        renderer,
        "attemptDeviceRecreation",
      ).call(renderer) as Promise<void>;

      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);
      await recovery;

      expect(recreateDevice).toHaveBeenCalledTimes(2);
      expect(Reflect.get(renderer, "deviceRecreationInProgress")).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        "[WebGPURenderer] Device recreation attempt 1 failed:",
        expect.any(Error),
      );
    } finally {
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("continues notifying subscribers and starts recovery when a callback throws", async () => {
    const renderer = Object.create(
      WebGPURenderer.prototype,
    ) as WebGPURenderer;
    const secondCallback = vi.fn();
    const recover = vi.fn().mockResolvedValue(undefined);
    const callbackError = new Error("subscriber cleanup failed");
    const firstCallback = vi.fn(() => {
      throw callbackError;
    });
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    Reflect.set(renderer, "device", {
      lost: Promise.resolve({
        reason: "unknown",
        message: "test device loss",
      }),
    });
    Reflect.set(renderer, "deviceLostCallbacks", [
      firstCallback,
      secondCallback,
    ]);
    Reflect.set(renderer, "attemptDeviceRecreation", recover);

    try {
      Reflect.get(renderer, "setupDeviceLossHandling").call(renderer);
      await Promise.resolve();
      await Promise.resolve();

      expect(firstCallback).toHaveBeenCalledTimes(1);
      expect(secondCallback).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        "[WebGPURenderer] Device-loss callback failed:",
        callbackError,
      );
      expect(recover).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
