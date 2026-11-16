import { describe, expect, it } from "vitest";
import {
  AI_VIDEO_DURATIONS,
  isAIVideoDuration,
  validateAIVideoRequest,
  type AIVideoGenerationRequest,
} from "./types";

const validRequest: AIVideoGenerationRequest = {
  prompt: "A cinematic aerial shot over a misty ancient city at sunrise",
  durationSeconds: 20,
  aspectRatio: "16:9",
  resolution: "1080p",
  frameRate: 30,
};

describe("prompt-to-video request contract", () => {
  it("offers only the requested 10, 20 and 30 second durations", () => {
    expect(AI_VIDEO_DURATIONS).toEqual([10, 20, 30]);
    expect(isAIVideoDuration(10)).toBe(true);
    expect(isAIVideoDuration(20)).toBe(true);
    expect(isAIVideoDuration(30)).toBe(true);
    expect(isAIVideoDuration(15)).toBe(false);
  });

  it("accepts a valid prompt generation request", () => {
    expect(validateAIVideoRequest(validRequest)).toEqual([]);
  });

  it("rejects an empty prompt", () => {
    expect(validateAIVideoRequest({ ...validRequest, prompt: "   " })).toContain(
      "A video prompt is required.",
    );
  });

  it("rejects unsupported duration values at runtime", () => {
    expect(
      validateAIVideoRequest({
        ...validRequest,
        durationSeconds: 15 as AIVideoGenerationRequest["durationSeconds"],
      }),
    ).toContain("Video duration must be 10, 20 or 30 seconds.");
  });

  it("enforces prompt length limits", () => {
    expect(
      validateAIVideoRequest({ ...validRequest, prompt: "x".repeat(2001) }),
    ).toContain("The video prompt must be 2000 characters or fewer.");
  });
});
