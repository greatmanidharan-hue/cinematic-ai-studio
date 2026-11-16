import React, { useCallback, useEffect, useRef, useState } from "react";
import type { LightningEffectClip } from "@fairarena/core";
import type { SnapSettings } from "../../../stores/ui-store";

interface LightningEffectLaneProps {
  effects: readonly LightningEffectClip[];
  pixelsPerSecond: number;
  duration: number;
  snapSettings: SnapSettings;
  snapPoints: readonly number[];
  playheadPosition: number;
  markerTimes: readonly number[];
  onUpdate: (effectId: string, updates: Partial<LightningEffectClip>) => void;
  onSelect?: (effectId: string) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
}

type DragMode = "move" | "trim";

export const LightningEffectLane: React.FC<LightningEffectLaneProps> = ({
  effects,
  pixelsPerSecond,
  duration,
  snapSettings,
  snapPoints,
  playheadPosition,
  markerTimes,
  onUpdate,
  onSelect,
  onInteractionStart,
  onInteractionEnd,
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dragRef = useRef<{ id: string; mode: DragMode; startX: number; originalStart: number; originalDuration: number } | null>(null);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = (event.clientX - drag.startX) / Math.max(1, pixelsPerSecond);
    const rawDuration = Math.max(0.05, drag.originalDuration + delta);
    const rawEdge = drag.mode === "move"
      ? Math.max(0, drag.originalStart + delta)
      : drag.originalStart + rawDuration;
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
    if (dragRef.current) onInteractionEnd?.();
    dragRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, [onInteractionEnd]);

  useEffect(() => {
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      if (dragRef.current) onInteractionEnd?.();
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [handlePointerMove, handlePointerUp, onInteractionEnd]);

  const beginDrag = (event: React.PointerEvent, effect: LightningEffectClip, mode: DragMode) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(effect.id);
    onSelect?.(effect.id);
    onInteractionStart?.();
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
        const width = Math.max(18, effect.duration * pixelsPerSecond);
        const active = selectedId === effect.id;
        return (
          <div key={effect.id} role="button" tabIndex={0}
            aria-label={`Lightning effect at ${effect.startTime.toFixed(2)} seconds`}
            onPointerDown={(event) => beginDrag(event, effect, "move")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setSelectedId(effect.id);
                onSelect?.(effect.id);
              }
            }}
            className={`absolute top-1 h-8 rounded border flex items-center gap-1 px-2 text-[10px] font-semibold overflow-hidden select-none ${effect.enabled ? "bg-sky-500/20 border-sky-400/70 text-sky-200" : "bg-slate-500/15 border-slate-500/50 text-slate-400"} ${active ? "ring-1 ring-white/70" : ""}`}
            style={{ left, width, minWidth: 18, touchAction: "none" }}
            title={`Lightning · ${effect.startTime.toFixed(2)}s – ${(effect.startTime + effect.duration).toFixed(2)}s`}
          >
            <span className="truncate">⚡ {effect.name || "Lightning"}</span>
            <span aria-hidden="true"
              onPointerDown={(event) => beginDrag(event, effect, "trim")}
              className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-sky-300/40 hover:bg-sky-200/80" />
          </div>
        );
      })}
      {duration > 0 && <span className="sr-only">Timeline duration {duration} seconds</span>}
    </div>
  );
};
