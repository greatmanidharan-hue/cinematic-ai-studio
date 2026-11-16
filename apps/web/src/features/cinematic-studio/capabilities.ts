/**
 * Capability map for the Cinematic AI Studio workstream.
 * "foundation" means reusable code exists, not that the complete user-facing
 * workflow is already finished.
 */
export type StudioCapabilityStatus = "foundation" | "planned" | "experimental";
export type StudioCapabilityId = "vfx" | "three-d" | "face-ai" | "color" | "motion" | "export" | "ai-video";

export interface StudioCapability {
  id: StudioCapabilityId;
  name: string;
  summary: string;
  status: StudioCapabilityStatus;
  foundations: readonly string[];
  nextSteps: readonly string[];
}

export const CINEMATIC_STUDIO_CAPABILITIES: readonly StudioCapability[] = [
  {
    id: "vfx",
    name: "VFX Studio",
    summary: "Layered particles, compositing and cinematic overlays.",
    status: "foundation",
    foundations: [
      "packages/core/src/effects/particle-engine.ts",
      "packages/core/src/effects/particle-presets.ts",
      "packages/core/src/video/composite-engine.ts",
      "packages/core/src/video/video-effects-engine.ts",
    ],
    nextSteps: [
      "Audit particle emitters and render integration.",
      "Add authored fire, smoke, sparks and lightning presets.",
      "Expose clip-scoped, undoable effect controls.",
    ],
  },
  {
    id: "three-d",
    name: "3D Studio",
    summary: "Browser-rendered 3D elements and animated scenes.",
    status: "foundation",
    foundations: [
      "apps/web/package.json (three dependency)",
      "packages/core/src/animation/gsap-engine.ts",
    ],
    nextSteps: [
      "Confirm a lifecycle-safe Three.js canvas integration point.",
      "Build reusable 3D overlays synchronized to project time.",
      "Profile GPU and memory use.",
    ],
  },
  {
    id: "face-ai",
    name: "AI Face Studio",
    summary: "Local face landmarks, tracking and face-attached effects.",
    status: "experimental",
    foundations: [
      "packages/core/package.json (@mediapipe/tasks-vision)",
      "packages/core/src/video/motion-tracking-engine.ts",
    ],
    nextSteps: [
      "Inspect MediaPipe task APIs and existing tracking support.",
      "Prototype face landmarks behind an explicit user action.",
      "Make model downloads optional and disclose device requirements.",
    ],
  },
  {
    id: "color",
    name: "Color Studio",
    summary: "Clip-level cinematic looks and precise color controls.",
    status: "foundation",
    foundations: [
      "packages/core/src/video/color-grading-engine.ts",
      "packages/core/src/video/filter-presets.ts",
      "packages/core/src/video/shaders/",
    ],
    nextSteps: [
      "Audit grading controls and LUT import/export.",
      "Define non-destructive cinematic looks.",
      "Verify preview and export parity.",
    ],
  },
  {
    id: "motion",
    name: "Motion Studio",
    summary: "Speed curves, interpolation and animated transforms.",
    status: "foundation",
    foundations: [
      "packages/core/src/video/speed-engine.ts",
      "packages/core/src/video/speed-presets.ts",
      "packages/core/src/video/frame-interpolation.ts",
    ],
    nextSteps: [
      "Map constant-speed support and interpolation limits.",
      "Design keyframed speed-ramp curves.",
      "Validate audio synchronization and export behavior.",
    ],
  },
  {
    id: "ai-video",
    name: "AI Video Generator",
    summary: "Generate 10, 20 or 30 second videos from text prompts and import results into the editing timeline.",
    status: "planned",
    foundations: [
      "packages/core/src/ai-video/types.ts",
    ],
    nextSteps: [
      "Build a prompt composer with 10, 20 and 30 second duration choices.",
      "Add provider adapters with secure server-side credential handling.",
      "Show generation progress, failures and provider cost before submission.",
      "Import completed generated videos into the local project media library and timeline.",
    ],
  },
  {
    id: "export",
    name: "Export Studio",
    summary: "Browser-side encoding with capability-aware fallbacks.",
    status: "foundation",
    foundations: [
      "packages/core/src/export/export-engine.ts",
      "packages/core/src/export/types.ts",
      "apps/web/src/components/editor/Toolbar.tsx",
    ],
    nextSteps: [
      "Verify codecs against browser runtime capabilities.",
      "Validate unsupported codec and resolution combinations.",
      "Test cancellation and memory use on long renders.",
    ],
  },
] as const;

export const getStudioCapability = (
  id: StudioCapabilityId,
): StudioCapability | undefined =>
  CINEMATIC_STUDIO_CAPABILITIES.find((capability) => capability.id === id);
