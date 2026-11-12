import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ParticleEffect } from "@fairarena/core";
import type { SnapSettings } from "../../../stores/ui-store";

interface ParticleEffectLaneProps {
  effects: readonly ParticleEffect[];
  pixelsPerSecond: number;
  duration: number;
  snapSettings: SnapSettings;
  snapPoints: readonly number[];
  playheadPosition: number;
  markerTimes: readonly number[];
  onUpdate: (effectId: string, updates: Partial<ParticleEffect>) => void;
}

type DragMode = "move" | "trim";

const labels: Record<ParticleEffect["type"], string> = {
  dissolve: "Dissolve",
  explode: "Burst",
  implode: "Implode",
  confetti: "Confetti",
  dust: "Dust",
  sparkle: "Sparkle",
  disintegrate: "Disintegrate",
  pixelate: "Pixelate",
  shatter: "Shatter",
  morph: "Morph",
};

export const ParticleEffectLane: React.FC<ParticleEffectLaneProps> = ({
  effects,
  pixelsPerSecond,
  duration,
  snapSettings,
  snapPoints,
  playheadPosition,
  markerTimes,
  onUpdate,
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dragRef = useRef<{
    id: string;
    mode: DragMode;
    startX: number;
    originalStart: number;
    originalDuration: number;
  } | null>(null);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = (event.clientX - drag.startX) / Math.max(1, pixelsPerSecond);
    const rawTime = drag.mode === "move"
      ? Math.max(0, drag.originalStart + delta)
      : Math.max(0.05, drag.originalDuration + delta);
    const rawEdge = drag.mode === "move" ? rawTime : drag.originalStart + rawTime;
    let snappedEdge = rawEdge;
    if (snapSettings.enabled) {
      const candidates: number[] = [];
      if (snapSettings.snapToGrid && snapSettings.gridSize > 0) {
        candidates.push(Math.round(rawEdge / snapSettings.gridSize) * snapSettings.gridSize);
      }
      if (snapSettings.snapToClips) candidates.push(...snapPoints);
      if (snapSettings.snapToPlayhead) candidates.push(playheadPosition);
      if (snapSettings.snapToMarkers) candidates.push(...markerTimes);
      const threshold = snapSettings.snapThreshold / Math.max(1, pixelsPerSecond);
      const nearest = candidates
        .filter((candidate) => Number.isFinite(candidate) && candidate >= 0)
        .reduce<{ time: number; distance: number } | null>((best, candidate) => {
          const distance = Math.abs(candidate - rawEdge);
          return distance <= threshold && (!best || distance < best.distance)
            ? { time: candidate, distance }
            : best;
        }, null);
      if (nearest) snappedEdge = nearest.time;
    }
    if (drag.mode === "move") {
      onUpdate(drag.id, { startTime: Math.max(0, snappedEdge) });
    } else {
      onUpdate(drag.id, { duration: Math.max(0.05, snappedEdge - drag.originalStart) });
    }
  }, [onUpdate, pixelsPerSecond, snapSettings, snapPoints, playheadPosition, markerTimes]);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [handlePointerMove, handlePointerUp]);

  const beginDrag = (event: React.PointerEvent, effect: ParticleEffect, mode: DragMode) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(effect.id);
    dragRef.current = {
      id: effect.id,
      mode,
      startX: event.clientX,
      originalStart: effect.startTime,
      originalDuration: effect.duration,
    };
    document.body.style.cursor = mode === "trim" ? "ew-resize" : "grabbing";
    document.body.style.userSelect = "none";
  };

  return (
    <div className="relative h-11 border-b border-border/60 bg-background-secondary/30">
      <div className="absolute inset-y-0 left-0 right-0 pointer-events-none opacity-30"
        style={{ backgroundImage: "linear-gradient(to right, currentColor 1px, transparent 1px)", backgroundSize: `${pixelsPerSecond}px 100%` }} />
      {effects.map((effect) => {
        const left = effect.startTime * pixelsPerSecond;
        const width = Math.max(22, effect.duration * pixelsPerSecond);
        const active = selectedId === effect.id;
        const tint = effect.type === "explode" || effect.type === "sparkle" || effect.type === "confetti"
          ? "bg-amber-500/20 border-amber-400/70 text-amber-200"
          : "bg-orange-500/20 border-orange-400/70 text-orange-200";
        return (
          <div key={effect.id}
            role="button"
            tabIndex={0}
            aria-label={`${labels[effect.type]} particle effect at ${effect.startTime.toFixed(2)} seconds`}
            onPointerDown={(event) => beginDrag(event, effect, "move")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setSelectedId(effect.id);
              }
            }}
            className={`absolute top-1 h-8 rounded border flex items-center gap-1 px-2 text-[10px] font-semibold overflow-hidden select-none ${effect.enabled ? tint : "bg-slate-500/15 border-slate-500/50 text-slate-400"} ${active ? "ring-1 ring-white/70" : ""}`}
            style={{ left, width, minWidth: 22, touchAction: "none" }}
            title={`${labels[effect.type]} · ${effect.startTime.toFixed(2)}s – ${(effect.startTime + effect.duration).toFixed(2)}s · Clip ${effect.clipId}`}
          >
            <span className="truncate">✦ {labels[effect.type]}</span>
            <button type="button" aria-label="Trim particle effect duration"
              onPointerDown={(event) => beginDrag(event, effect, "trim")}
              className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-amber-300/40 hover:bg-amber-200/80" />
          </div>
        );
      })}
      {duration > 0 && <span className="sr-only">Particle effects timeline duration {duration} seconds</span>}
    </div>
  );
};
