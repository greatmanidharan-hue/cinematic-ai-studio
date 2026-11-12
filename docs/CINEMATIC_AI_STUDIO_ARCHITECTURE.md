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
- Lightning Impact Sparks is a short electric impact burst, separate from the continuous timeline lightning-bolt overlay.
- Added a reusable Canvas 2D particle renderer with radial glow, rotation, opacity and optional additive blending; it supports HTML canvas and OffscreenCanvas contexts.
- Added unit tests for visible-particle drawing, inactive/transparent particle filtering and zero-opacity layers.
- Renderer is exported from the core effects barrel and is used by `VideoEngine` for particle export rendering. The editor preview continues to use its existing Three.js renderer.
- Preview audit found an existing Three.js `ParticleRenderer` mounted as a transparent overlay in `Preview.tsx`; it advances the shared particle engine during playback and refreshes at the playhead while paused. The existing renderer remains the sole particle preview loop.
- The existing Three.js preview renderer is separate from the Canvas renderer. Preview continues to use the established Three.js overlay; no duplicate preview loop was added.
- `VideoEngine.renderFrame` already advanced the particle engine during export, but drew plain circles. It now delegates particle drawing to the shared Canvas renderer, adding radial glow and rotation while preserving the existing bottom-left particle coordinate convention.
- Particle simulation now uses a seeded Mulberry32 random source for emission, velocity, turbulence, size, rotation, lifetime and particle IDs. `VideoEngine.resetExportState()` derives a stable FNV-1a seed from the sorted particle-effect configuration before resetting the simulation, so repeated exports with the same effect setup and frame sequence reproduce the same particle pattern.
- Deterministic simulation tests cover same-seed equality, different-seed variation and reset/replay reproducibility. Lightning renderer tests cover bolt/branch drawing, deterministic geometry and zero-length endpoints. Tests have been authored but have not yet been executed in this GitHub-only workflow.
- Particle effects are now serialized on `project.timeline.particleEffects`; the inspector updates project data and rehydrates the runtime engine from that source. The preview reads the same project-owned list.
- Export now creates a private `ParticleEngine` snapshot directly from the exported project's particle effects, rather than relying on whichever effects happen to be loaded in the editor singleton. It resets and seeds its own simulation without resetting live preview state. The private engine is disposed when the `VideoEngine` is disposed; concurrent exports on the same `VideoEngine` instance and arbitrary-time seek parity still need dedicated handling.
- Added a Lightning VFX inspector section with add/remove, enable/disable, timing, normalized start/end coordinates, intensity, branch count, segment count, amplitude and color controls. Changes are persisted in `project.timeline.lightningEffects` and dispatch preview invalidation.\n- Added a dedicated Particle VFX timeline lane with drag/trim editing and snapping to grid, clips, playhead and markers.
- Timeline VFX selection now opens a dedicated Inspector view for Lightning and Particle effects. Particle controls include preset application, particle count, speed, gravity, emission rate, turbulence, emission radius, size range, emission shape, blend mode and editable color palettes.
- VFX inspector edits persist to the project timeline and dispatch preview invalidation; particle size and color-palette constraints are guarded in the UI.
- Timeline and Inspector VFX edits now use the project action history (`project/updateTimelineVfx`) with inverse snapshots, so Lightning and Particle changes participate in Undo/Redo. Drag and trim gestures are grouped into a single history entry; preview invalidation is dispatched after undo and redo.
- The Particle VFX Inspector includes a searchable, categorized preset browser (Cinematic, Atmosphere, Impact and Transform). Preset application clones nested configuration values so editing a preset instance does not mutate the shared preset catalog.
- Lightning timeline move and trim now use the same snapping rules as Particle VFX: grid, clip boundaries, playhead and markers. Both VFX lanes close their history group and restore pointer state if a drag is interrupted by component unmount.
- Added a dedicated Lightning VFX timeline lane aligned with the track headers. Lightning blocks can be selected, dragged horizontally to change start time, and trimmed from the right edge to change duration; inspector controls remain available for detailed parameters.
- Added a Canvas-based `LightningRenderer` to the live editor preview. It reads `project.timeline.lightningEffects`, draws only effects active at the current playhead, and derives deterministic bolt geometry from effect ID and timeline frame. `VideoEngine.renderFrame` uses the same core bolt renderer during export.
- Timeline duration and playhead snap points now include the end/start boundaries of both lightning and particle effects.\n- No existing editor panel or render pipeline was replaced in this foundation step.

## Quality gates
- Run relevant unit tests, type checks and build checks for each change.
- Keep all feature work on the development branch.
- Test with small sample media before large or 4K footage.
- Document unsupported browsers, codecs and device limits honestly.
- Do not merge changes that break project load/save or undo/redo.
