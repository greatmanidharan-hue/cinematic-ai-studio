import React, { useEffect, useRef } from "react";
import { renderLightningBolt } from "@fairarena/core";
import type { LightningEffectClip } from "@fairarena/core";

interface LightningRendererProps {
  effects: readonly LightningEffectClip[];
  width: number;
  height: number;
  currentTime: number;
}

const stableSeed = (id: string, frame: number): number => {
  let hash = 0x811c9dc5;
  const value = `${id}:${frame}`;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/** Canvas overlay for timeline lightning effects in the live preview. */
export const LightningRenderer: React.FC<LightningRendererProps> = ({
  effects,
  width,
  height,
  currentTime,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;

    const render = () => {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const backingWidth = Math.max(1, Math.round(width * pixelRatio));
      const backingHeight = Math.max(1, Math.round(height * pixelRatio));

      // Keep drawing coordinates in project pixels while allocating a sharper
      // backing store for high-DPI displays, matching the particle WebGL layer.
      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth;
        canvas.height = backingHeight;
      }
      canvas.style.width = "100%";
      canvas.style.height = "100%";

      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);

      for (const effect of effects) {
        if (
          !effect.enabled ||
          !Number.isFinite(effect.startTime) ||
          !Number.isFinite(effect.duration) ||
          effect.duration <= 0 ||
          currentTime < effect.startTime ||
          currentTime >= effect.startTime + effect.duration
        ) {
          continue;
        }

        const intensity = Math.max(0, Math.min(1, effect.intensity));
        if (intensity <= 0) continue;
        const frame = Math.floor((currentTime - effect.startTime) * 30);
        context.save();
        context.globalAlpha = intensity;
        renderLightningBolt(context, {
          start: { x: effect.start.x * width, y: effect.start.y * height },
          end: { x: effect.end.x * width, y: effect.end.y * height },
          segments: effect.segments ?? 18,
          branches: effect.branches ?? 2,
          amplitude: effect.amplitude ?? 24,
          color: effect.color ?? "#9bdcff",
          // Match the export renderer so preview and exported frames use the same stroke profile.
          lineWidth: 1.5 + intensity * 3.5,
          glow: 8 + intensity * 22,
          seed: stableSeed(effect.id, frame),
        });
        context.restore();
      }
    };

    render();
    window.addEventListener("resize", render);
    return () => window.removeEventListener("resize", render);
  }, [effects, width, height, currentTime]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full"
      style={{ width: "100%", height: "100%" }}
      aria-hidden="true"
    />
  );
};

export default LightningRenderer;
