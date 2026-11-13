import { describe, expect, it, vi } from "vitest";
import {
  AIVideoGenerationError,
  AIVideoGenerationService,
  type AIVideoProviderAdapter,
} from "./provider";
import type { AIVideoGenerationJob, AIVideoGenerationRequest } from "./types";

const request: AIVideoGenerationRequest = {
  prompt: "A cinematic tracking shot through a rain-soaked neon street",
  durationSeconds: 10,
  aspectRatio: "16:9",
  resolution: "1080p",
  frameRate: 24,
};

const job: AIVideoGenerationJob = {
  id: "job-123",
  status: "queued",
  request,
  progress: 0,
};

describe("AIVideoGenerationService", () => {
  it("submits a valid request through the configured adapter", async () => {
    const adapter: AIVideoProviderAdapter = {
      providerId: "test-provider",
      submit: vi.fn().mockResolvedValue(job),
      getJob: vi.fn(),
    };
    const service = new AIVideoGenerationService(adapter);
    await expect(service.create(request)).resolves.toEqual(job);
    expect(adapter.submit).toHaveBeenCalledWith(request, undefined);
  });

  it("rejects invalid prompts before contacting a provider", async () => {
    const adapter: AIVideoProviderAdapter = {
      providerId: "test-provider",
      submit: vi.fn(),
      getJob: vi.fn(),
    };
    const service = new AIVideoGenerationService(adapter);
    await expect(service.create({ ...request, prompt: " " })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(adapter.submit).not.toHaveBeenCalled();
  });

  it("normalizes unexpected provider failures", async () => {
    const adapter: AIVideoProviderAdapter = {
      providerId: "test-provider",
      submit: vi.fn().mockRejectedValue(new Error("provider offline")),
      getJob: vi.fn(),
    };
    const service = new AIVideoGenerationService(adapter);
    await expect(service.create(request)).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      message: "provider offline",
    });
  });

  it("refreshes job status by ID", async () => {
    const adapter: AIVideoProviderAdapter = {
      providerId: "test-provider",
      submit: vi.fn(),
      getJob: vi.fn().mockResolvedValue({ ...job, status: "generating", progress: 42 }),
    };
    const service = new AIVideoGenerationService(adapter);
    await expect(service.refresh("job-123")).resolves.toMatchObject({
      status: "generating",
      progress: 42,
    });
  });

  it("reports when cancellation is unsupported", async () => {
    const adapter: AIVideoProviderAdapter = {
      providerId: "test-provider",
      submit: vi.fn(),
      getJob: vi.fn(),
    };
    const service = new AIVideoGenerationService(adapter);
    await expect(service.cancel("job-123")).rejects.toBeInstanceOf(AIVideoGenerationError);
  });
});
