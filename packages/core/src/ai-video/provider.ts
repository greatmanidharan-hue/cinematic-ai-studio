import {
  validateAIVideoRequest,
  type AIVideoGenerationJob,
  type AIVideoGenerationRequest,
} from "./types";

/**
 * Provider adapters must call a trusted backend. Never place provider API keys
 * in browser bundles or persist them in editor project data.
 */
export interface AIVideoProviderAdapter {
  readonly providerId: string;
  submit(
    request: AIVideoGenerationRequest,
    signal?: AbortSignal,
  ): Promise<AIVideoGenerationJob>;
  getJob(
    jobId: string,
    signal?: AbortSignal,
  ): Promise<AIVideoGenerationJob>;
  cancel?(jobId: string): Promise<void>;
}

export class AIVideoGenerationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_REQUEST"
      | "PROVIDER_ERROR"
      | "JOB_NOT_FOUND"
      | "CANCEL_UNSUPPORTED",
  ) {
    super(message);
    this.name = "AIVideoGenerationError";
  }
}

/**
 * Thin orchestration layer shared by future provider integrations and UI.
 * Polling cadence and UI state are intentionally left to the caller.
 */
export class AIVideoGenerationService {
  constructor(private readonly provider: AIVideoProviderAdapter) {}

  async create(
    request: AIVideoGenerationRequest,
    signal?: AbortSignal,
  ): Promise<AIVideoGenerationJob> {
    const errors = validateAIVideoRequest(request);
    if (errors.length > 0) {
      throw new AIVideoGenerationError(errors.join(" "), "INVALID_REQUEST");
    }
    try {
      return await this.provider.submit(request, signal);
    } catch (error) {
      if (error instanceof AIVideoGenerationError) throw error;
      throw new AIVideoGenerationError(
        error instanceof Error ? error.message : "Video generation request failed.",
        "PROVIDER_ERROR",
      );
    }
  }

  async refresh(
    jobId: string,
    signal?: AbortSignal,
  ): Promise<AIVideoGenerationJob> {
    if (!jobId.trim()) {
      throw new AIVideoGenerationError("A generation job ID is required.", "JOB_NOT_FOUND");
    }
    try {
      return await this.provider.getJob(jobId, signal);
    } catch (error) {
      if (error instanceof AIVideoGenerationError) throw error;
      throw new AIVideoGenerationError(
        error instanceof Error ? error.message : "Could not refresh generation status.",
        "PROVIDER_ERROR",
      );
    }
  }

  async cancel(jobId: string): Promise<void> {
    if (!this.provider.cancel) {
      throw new AIVideoGenerationError(
        "This provider does not support cancellation.",
        "CANCEL_UNSUPPORTED",
      );
    }
    await this.provider.cancel(jobId);
  }
}
