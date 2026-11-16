/**
 * Provider-neutral contract for prompt-to-video generation.
 *
 * Generation is cloud/provider-backed and must be opt-in. The editor owns
 * importing the completed asset into the local project timeline.
 */
export const AI_VIDEO_DURATIONS = [10, 20, 30] as const;

export type AIVideoDuration = (typeof AI_VIDEO_DURATIONS)[number];
export type AIVideoAspectRatio = "16:9" | "9:16" | "1:1";
export type AIVideoResolution = "720p" | "1080p" | "4k";
export type AIVideoFrameRate = 24 | 25 | 30 | 60;

export interface AIVideoGenerationRequest {
  prompt: string;
  durationSeconds: AIVideoDuration;
  aspectRatio: AIVideoAspectRatio;
  resolution: AIVideoResolution;
  frameRate: AIVideoFrameRate;
  negativePrompt?: string;
  stylePreset?: string;
  /** Provider-specific model identifier selected by the user. */
  model?: string;
}

export type AIVideoGenerationStatus =
  | "queued"
  | "generating"
  | "completed"
  | "failed"
  | "cancelled";

export interface AIVideoGenerationJob {
  id: string;
  status: AIVideoGenerationStatus;
  request: AIVideoGenerationRequest;
  progress: number;
  outputUrl?: string;
  error?: string;
}

export const isAIVideoDuration = (value: number): value is AIVideoDuration =>
  AI_VIDEO_DURATIONS.some((duration) => duration === value);

export const validateAIVideoRequest = (
  request: AIVideoGenerationRequest,
): string[] => {
  const errors: string[] = [];
  if (!request.prompt.trim()) {
    errors.push("A video prompt is required.");
  }
  if (request.prompt.length > 2000) {
    errors.push("The video prompt must be 2000 characters or fewer.");
  }
  if (!isAIVideoDuration(request.durationSeconds)) {
    errors.push("Video duration must be 10, 20 or 30 seconds.");
  }
  if (request.negativePrompt && request.negativePrompt.length > 1000) {
    errors.push("The negative prompt must be 1000 characters or fewer.");
  }
  return errors;
};
