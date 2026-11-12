# Cinematic AI Studio — Architecture Plan

## Goal
Extend the existing FairArena Video editor into a browser-first cinematic editing
studio while preserving current workflows. All development is isolated on
`feat/cinematic-ai-studio-foundation`; do not commit feature work to `main`.

## Existing foundations found during source inspection
- Video effects and compositing: `packages/core/src/video/video-effects-engine.ts`,
  `composite-engine.ts`, and the video barrel exports.
- Particle effects: `packages/core/src/effects/particle-engine.ts` and
  `particle-presets.ts`.
- 3D: Three.js is already a web-app dependency.
- Face AI: MediaPipe Tasks Vision is already a core dependency; current
  end-to-end face workflows still need verification.
- Color: `color-grading-engine.ts`, filter presets and shader modules.
- Motion: speed engine, speed presets, frame interpolation and keyframe engine.
- Export: browser export engine and export UI already exist.

A dependency or engine is a reusable foundation, not proof that a complete
end-user feature is finished.

## Product principles
1. Browser-first and local processing by default; never upload user footage
   without an explicit opt-in.
2. Make AI model downloads optional and disclose model size and device needs.
3. Use progressive enhancement: WebGPU where supported and existing fallbacks
   where possible.
4. Preserve non-destructive editing, undo/redo, autosave and project recovery.
5. Preview and export must use consistent effect parameters.
6. Treat generative video and advanced character generation as optional
   capabilities, not guaranteed browser-only features.
7. Build original stylized 3D looks; do not market them as official Pixar assets.

## Delivery phases
### Phase 0 — Baseline audit
Map effect, particle, tracking, color, speed and export APIs. Identify editor
panel/store patterns and preview/export render bridges. Record build, typecheck
and test baselines before feature changes.

### Phase 1 — Shared studio foundation
Create typed capability metadata, a studio navigation entry point, and shared
preset/effect parameter contracts. Mark each capability as foundation,
experimental or planned.

### Phase 2 — VFX and cinematic looks
Author fire, smoke, sparks, lightning and atmosphere presets. Integrate them
with clip-scoped project state and undo history. Add non-destructive color looks
using the existing grading pipeline.

### Phase 3 — Motion and 3D
Add keyframed speed curves and verify interpolation/audio behavior. Integrate
Three.js overlays with deterministic cleanup and project-time synchronization.

### Phase 4 — Face tracking
Prototype local face landmarks with MediaPipe. Add face-attached overlays only
after tracking stability, privacy UX and performance checks pass.

### Phase 5 — Export hardening
Test preview/export parity, codec support, cancellation and memory usage.
Provide clear capability warnings and fallback paths.

## Current implementation progress

- Added typed capability metadata for VFX, 3D, face AI, color, motion and export.
- Added three clip-attachable particle presets using the existing particle engine:
  Fire Plume, Smoke Column and Lightning Impact Sparks.
- Added Vitest coverage for preset registration, basic configuration bounds and
  clip-scoped effect creation.
- Lightning Impact Sparks is a short electric impact burst, not a continuous
  lightning-bolt generator. A bolt renderer/shader remains planned.
- Added a reusable Canvas 2D particle renderer with radial glow, rotation, opacity and optional additive blending; it supports HTML canvas and OffscreenCanvas contexts.
- Added unit tests for visible-particle drawing, inactive/transparent particle filtering and zero-opacity layers.
- Renderer is exported from the core effects barrel. It is not yet wired into the editor preview/export bridge; that integration remains the next task.
- No existing editor panel or render pipeline was replaced in this foundation step.

## Quality gates
- Run relevant unit tests, type checks and build checks for each change.
- Keep all feature work on the development branch.
- Test with small sample media before large or 4K footage.
- Document unsupported browsers, codecs and device limits honestly.
- Do not merge changes that break project load/save or undo/redo.
