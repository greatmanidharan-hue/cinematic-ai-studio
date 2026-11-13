import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockRenderFrame,
  mockVideoEngine,
  mockRenderAudio,
  mockAudioEngine,
  mockMediaEngine,
  mockVideoSourceAdd,
  mockAudioSourceAdd,
  mockOutputStart,
  mockOutputFinalize,
} = vi.hoisted(() => {
  const mockRenderFrame = vi.fn().mockResolvedValue({
    image: { close: vi.fn() },
    width: 1920,
    height: 1080,
  });

  const mockVideoEngine = {
    isInitialized: vi.fn().mockReturnValue(false),
    initialize: vi.fn().mockResolvedValue(undefined),
    initializeGPUCompositor: vi.fn().mockResolvedValue(undefined),
    getGPUCompositor: vi.fn().mockReturnValue(null),
    renderFrame: mockRenderFrame,
    resetExportState: vi.fn(),
    clearVideoElementCache: vi.fn(),
    clearCache: vi.fn(),
  };

  const mockRenderAudio = vi.fn().mockResolvedValue({ buffer: null });
  const mockAudioEngine = {
    isInitialized: vi.fn().mockReturnValue(false),
    initialize: vi.fn().mockResolvedValue(undefined),
    renderAudio: mockRenderAudio,
    clearCache: vi.fn(),
  };

  const mockMediaEngine = {
    isAvailable: vi.fn().mockReturnValue(true),
    initialize: vi.fn().mockResolvedValue(undefined),
    getExportDecoder: vi.fn().mockReturnValue(null),
    createExportDecoder: vi.fn().mockResolvedValue(null),
    disposeAllExportDecoders: vi.fn(),
    clearFrameCache: vi.fn(),
  };

  return {
    mockRenderFrame,
    mockVideoEngine,
    mockRenderAudio,
    mockAudioEngine,
    mockMediaEngine,
    mockVideoSourceAdd: vi.fn().mockResolvedValue(undefined),
    mockAudioSourceAdd: vi.fn().mockResolvedValue(undefined),
    mockOutputStart: vi.fn().mockResolvedValue(undefined),
    mockOutputFinalize: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../video/video-engine", () => ({
  VideoEngine: vi.fn(),
  getVideoEngine: vi.fn().mockReturnValue(mockVideoEngine),
}));

vi.mock("../audio/audio-engine", () => ({
  AudioEngine: vi.fn(),
  getAudioEngine: vi.fn().mockReturnValue(mockAudioEngine),
}));

vi.mock("../text/title-engine", () => ({
  titleEngine: {
    getAllTextClips: vi.fn().mockReturnValue([]),
  },
}));

vi.mock("../graphics/graphics-engine", () => ({
  graphicsEngine: {
    getAllShapeClips: vi.fn().mockReturnValue([]),
    getAllSVGClips: vi.fn().mockReturnValue([]),
    getAllStickerClips: vi.fn().mockReturnValue([]),
  },
}));

vi.mock("../media/mediabunny-engine", () => ({
  getMediaEngine: vi.fn().mockReturnValue(mockMediaEngine),
}));

vi.mock("mediabunny", () => {
  class MockMp4OutputFormat {
    getSupportedVideoCodecs() {
      return ["avc"];
    }

    getSupportedAudioCodecs() {
      return ["aac"];
    }
  }

  class MockWebMOutputFormat extends MockMp4OutputFormat {}
  class MockMovOutputFormat extends MockMp4OutputFormat {}

  class MockOutput {
    addVideoTrack = vi.fn();
    addAudioTrack = vi.fn();
    setMetadataTags = vi.fn();
    start = mockOutputStart;
    finalize = mockOutputFinalize;
  }

  class MockStreamTarget {
    constructor(
      _writable: WritableStream<{ data: Uint8Array; position: number }>,
      _options?: Record<string, unknown>,
    ) {}
  }

  class MockVideoSampleSource {
    add = mockVideoSourceAdd;
    close = vi.fn();

    constructor(_config: Record<string, unknown>) {}
  }

  class MockAudioBufferSource {
    add = mockAudioSourceAdd;
    close = vi.fn();

    constructor(_config: Record<string, unknown>) {}
  }

  class MockVideoSample {
    close = vi.fn();

    constructor(
      _data: unknown,
      _init: { timestamp: number; duration: number },
    ) {}
  }

  return {
    Output: MockOutput,
    StreamTarget: MockStreamTarget,
    Mp4OutputFormat: MockMp4OutputFormat,
    WebMOutputFormat: MockWebMOutputFormat,
    MovOutputFormat: MockMovOutputFormat,
    VideoSampleSource: MockVideoSampleSource,
    AudioBufferSource: MockAudioBufferSource,
    VideoSample: MockVideoSample,
    getFirstEncodableVideoCodec: vi.fn().mockResolvedValue("avc"),
    getFirstEncodableAudioCodec: vi.fn().mockResolvedValue("aac"),
    QUALITY_MEDIUM: 1_000_000,
  };
});

import { ExportEngine, getExportEngine } from "./export-engine";
import {
  DEFAULT_VIDEO_SETTINGS,
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_IMAGE_SETTINGS,
  VIDEO_QUALITY_PRESETS,
} from "./types";
import type { Project, Timeline, Track, Clip } from "../types";

const createMockProject = (overrides?: Partial<Project>): Project => ({
  id: "test-project-id",
  name: "Test Project",
  createdAt: Date.now(),
  modifiedAt: Date.now(),
  settings: {
    width: 1920,
    height: 1080,
    frameRate: 30,
    sampleRate: 48000,
    channels: 2,
  },
  mediaLibrary: {
    items: [],
  },
  timeline: {
    tracks: [],
    subtitles: [],
    duration: 0,
    markers: [],
  },
  ...overrides,
});

const createMockClip = (overrides?: Partial<Clip>): Clip => ({
  id: "clip-1",
  mediaId: "media-1",
  trackId: "track-1",
  startTime: 0,
  duration: 5,
  inPoint: 0,
  outPoint: 5,
  effects: [],
  audioEffects: [],
  transform: {
    position: { x: 0.5, y: 0.5 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    anchor: { x: 0.5, y: 0.5 },
    opacity: 1,
  },
  volume: 1,
  keyframes: [],
  ...overrides,
});

const createMockTrack = (overrides?: Partial<Track>): Track => ({
  id: "track-1",
  type: "video",
  name: "Video 1",
  clips: [createMockClip()],
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
  ...overrides,
});

const createMockTimeline = (overrides?: Partial<Timeline>): Timeline => ({
  tracks: [createMockTrack()],
  subtitles: [],
  duration: 5,
  markers: [],
  ...overrides,
});

describe("ExportEngine", () => {
  let exportEngine: ExportEngine;

  beforeEach(() => {
    exportEngine = new ExportEngine();
    vi.clearAllMocks();
    mockVideoEngine.isInitialized.mockReturnValue(false);
    mockAudioEngine.isInitialized.mockReturnValue(false);
    mockMediaEngine.isAvailable.mockReturnValue(true);
    mockMediaEngine.getExportDecoder.mockReturnValue(null);
    mockRenderFrame.mockResolvedValue({
      image: { close: vi.fn() },
      width: 1920,
      height: 1080,
    });
    mockRenderAudio.mockResolvedValue({ buffer: null });
  });

  afterEach(() => {
    exportEngine.dispose();
  });

  describe("initialization", () => {
    it("should start uninitialized", () => {
      expect(exportEngine.isInitialized()).toBe(false);
    });

    it("should report MediaBunny unavailable before init", () => {
      expect(exportEngine.isMediaBunnyAvailable()).toBe(false);
    });
  });

  describe("singleton pattern", () => {
    it("should return same instance from getExportEngine", () => {
      const engine1 = getExportEngine();
      const engine2 = getExportEngine();
      expect(engine1).toBe(engine2);
    });
  });

  describe("presets", () => {
    it("should return export presets", () => {
      const presets = exportEngine.getPresets();
      expect(presets.length).toBeGreaterThan(0);
    });

    it("should have presets for all categories", () => {
      const presets = exportEngine.getPresets();
      const categories = new Set(presets.map((p) => p.category));
      expect(categories.has("social")).toBe(true);
      expect(categories.has("broadcast")).toBe(true);
      expect(categories.has("web")).toBe(true);
      expect(categories.has("archive")).toBe(true);
    });

    it("should have YouTube preset", () => {
      const presets = exportEngine.getPresets();
      const youtubePreset = presets.find((p) => p.id === "youtube-1080p");
      expect(youtubePreset).toBeDefined();
      expect(youtubePreset?.settings).toHaveProperty("codec", "h264");
    });

    it("should have TikTok preset with vertical dimensions", () => {
      const presets = exportEngine.getPresets();
      const tiktokPreset = presets.find((p) => p.id === "tiktok-1080p");
      expect(tiktokPreset).toBeDefined();
      if ("width" in tiktokPreset!.settings) {
        expect(tiktokPreset!.settings.width).toBe(1080);
        expect(tiktokPreset!.settings.height).toBe(1920);
      }
    });

    it("should create custom preset", () => {
      const customPreset = exportEngine.createPreset("My Preset", {
        ...DEFAULT_VIDEO_SETTINGS,
        bitrate: 15000,
      });
      expect(customPreset.name).toBe("My Preset");
      expect(customPreset.category).toBe("custom");
      expect(customPreset.id).toMatch(/^custom-/);
    });
  });

  describe("file size estimation", () => {
    it("should estimate video file size", () => {
      const project = createMockProject({
        timeline: createMockTimeline({ duration: 60 }),
      });

      const settings = { ...DEFAULT_VIDEO_SETTINGS, bitrate: 8000 };
      const estimatedSize = exportEngine.estimateFileSize(project, settings);

      const expectedSize = ((8000 * 1000 + 192 * 1000) * 60) / 8;
      expect(estimatedSize).toBe(Math.ceil(expectedSize));
    });

    it("should estimate audio file size for WAV", () => {
      const project = createMockProject({
        timeline: createMockTimeline({ duration: 60 }),
      });

      const settings = { ...DEFAULT_AUDIO_SETTINGS, format: "wav" as const };
      const estimatedSize = exportEngine.estimateFileSize(project, settings);

      const expectedSize = 60 * 48000 * 2 * (16 / 8);
      expect(estimatedSize).toBe(Math.ceil(expectedSize));
    });

    it("should estimate audio file size for MP3", () => {
      const project = createMockProject({
        timeline: createMockTimeline({ duration: 60 }),
      });

      const settings = { ...DEFAULT_AUDIO_SETTINGS, bitrate: 320 };
      const estimatedSize = exportEngine.estimateFileSize(project, settings);

      const expectedSize = (320 * 1000 * 60) / 8;
      expect(estimatedSize).toBe(Math.ceil(expectedSize));
    });
  });

  describe("export time estimation", () => {
    it("should estimate video export time", () => {
      const project = createMockProject({
        timeline: createMockTimeline({ duration: 60 }),
      });

      const settings = DEFAULT_VIDEO_SETTINGS;
      const estimatedTime = exportEngine.estimateExportTime(project, settings);

      expect(estimatedTime).toBeGreaterThan(0);
    });

    it("should estimate longer time for H.265", () => {
      const project = createMockProject({
        timeline: createMockTimeline({ duration: 60 }),
      });

      const h264Settings = {
        ...DEFAULT_VIDEO_SETTINGS,
        codec: "h264" as const,
      };
      const h265Settings = {
        ...DEFAULT_VIDEO_SETTINGS,
        codec: "h265" as const,
      };

      const h264Time = exportEngine.estimateExportTime(project, h264Settings);
      const h265Time = exportEngine.estimateExportTime(project, h265Settings);

      expect(h265Time).toBeGreaterThan(h264Time);
    });

    it("should estimate longer time for 4K", () => {
      const project = createMockProject({
        timeline: createMockTimeline({ duration: 60 }),
      });

      const hd = { ...DEFAULT_VIDEO_SETTINGS, width: 1920, height: 1080 };
      const fourK = { ...DEFAULT_VIDEO_SETTINGS, width: 3840, height: 2160 };

      const hdTime = exportEngine.estimateExportTime(project, hd);
      const fourKTime = exportEngine.estimateExportTime(project, fourK);

      expect(fourKTime).toBeGreaterThan(hdTime);
    });
  });

  describe("cancel", () => {
    it("should not throw when canceling without active export", () => {
      expect(() => exportEngine.cancel()).not.toThrow();
    });
  });

  describe("audio export settings validation", () => {
    it("should reject a non-finite audio bitrate before starting export", async () => {
      await exportEngine.initialize();

      const generator = exportEngine.exportAudio(
        createMockProject(),
        { bitrate: Number.NaN },
      );
      const result = await generator.next();

      expect(result.done).toBe(true);
      if (!result.done) throw new Error("Expected validation to stop export");
      expect(result.value.success).toBe(false);
      expect(result.value.error?.code).toBe("INVALID_SETTINGS");
      expect(mockRenderAudio).not.toHaveBeenCalled();
    });

    it("should reject invalid nested audio settings before video export setup", async () => {
      await exportEngine.initialize();

      const project = createMockProject({
        timeline: createMockTimeline(),
      });
      const writableStream = {
        seek: vi.fn().mockResolvedValue(undefined),
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
      } as unknown as FileSystemWritableFileStream;

      const generator = exportEngine.exportVideo(
        project,
        {
          ...DEFAULT_VIDEO_SETTINGS,
          audioSettings: {
            ...DEFAULT_AUDIO_SETTINGS,
            sampleRate: 12345 as unknown as 44100,
          },
        },
        writableStream,
      );
      const result = await generator.next();

      expect(result.done).toBe(true);
      if (!result.done) throw new Error("Expected validation to stop export");
      expect(result.value.success).toBe(false);
      expect(result.value.error?.code).toBe("INVALID_SETTINGS");
      expect(mockVideoEngine.initializeGPUCompositor).not.toHaveBeenCalled();
    });
  });

  describe("audio export cancellation", () => {
    it("reports cancellation when audio rendering rejects after cancellation", async () => {
      await exportEngine.initialize();
      const project = createMockProject();
      let rejectRender!: (error: Error) => void;
      const pendingRender = new Promise<null>((_resolve, reject) => {
        rejectRender = reject;
      });
      const renderSpy = vi.spyOn(exportEngine, "renderTimelineAudio")
        .mockReturnValue(pendingRender);
      const generator = exportEngine.exportAudio(project);
      try {
        const preparing = await generator.next();
        expect(preparing.done).toBe(false);

        const pendingResult = generator.next();
        exportEngine.cancel();
        rejectRender(new Error("audio renderer stopped"));
        const result = await pendingResult;

        expect(result.done).toBe(true);
        if (!result.done) throw new Error("Expected cancelled audio export to finish");
        expect(result.value.success).toBe(false);
        expect(result.value.error?.code).toBe("CANCELLED");
      } finally {
        renderSpy.mockRestore();
      }
    });
  });

  describe("image export validation", () => {
    it("should reject invalid image dimensions before rendering", async () => {
      await exportEngine.initialize();

      const result = await exportEngine.exportFrame(
        createMockProject(),
        0,
        { ...DEFAULT_IMAGE_SETTINGS, width: 0 },
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_SETTINGS");
      expect(mockRenderFrame).not.toHaveBeenCalled();
    });

    it("should reject frame times outside the timeline", async () => {
      await exportEngine.initialize();

      const project = createMockProject({
        timeline: createMockTimeline({ duration: 5 }),
      });
      const result = await exportEngine.exportFrame(project, 6);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_SETTINGS");
      expect(mockRenderFrame).not.toHaveBeenCalled();
    });
  });

  describe("video export settings validation", () => {
    it("should reject invalid dimensions before initializing the GPU compositor", async () => {
      await exportEngine.initialize();

      const project = createMockProject({
        timeline: createMockTimeline(),
      });
      const writableStream = {
        seek: vi.fn().mockResolvedValue(undefined),
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
      } as unknown as FileSystemWritableFileStream;

      const generator = exportEngine.exportVideo(
        project,
        { ...DEFAULT_VIDEO_SETTINGS, width: 0 },
        writableStream,
      );
      const result = await generator.next();

      expect(result.done).toBe(true);
      if (!result.done) throw new Error("Expected validation to stop export");
      expect(result.value.success).toBe(false);
      expect(result.value.error?.code).toBe("INVALID_SETTINGS");
      expect(mockVideoEngine.initializeGPUCompositor).not.toHaveBeenCalled();
    });

    it("should reject frame rates outside the supported range", async () => {
      await exportEngine.initialize();

      const project = createMockProject({
        timeline: createMockTimeline(),
      });
      const writableStream = {
        seek: vi.fn().mockResolvedValue(undefined),
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
      } as unknown as FileSystemWritableFileStream;

      const generator = exportEngine.exportVideo(
        project,
        { ...DEFAULT_VIDEO_SETTINGS, frameRate: 0 },
        writableStream,
      );
      const result = await generator.next();

      expect(result.done).toBe(true);
      if (!result.done) throw new Error("Expected validation to stop export");
      expect(result.value.success).toBe(false);
      expect(result.value.error?.code).toBe("INVALID_SETTINGS");
      expect(mockVideoEngine.initializeGPUCompositor).not.toHaveBeenCalled();
    });
  });

  describe("image sequence validation", () => {
    it("should reject an end frame outside the timeline before rendering", async () => {
      await exportEngine.initialize();
      const project = createMockProject({
        settings: { width: 1920, height: 1080, frameRate: 1, sampleRate: 48000, channels: 2 },
        timeline: createMockTimeline({ duration: 5 }),
      });

      const generator = exportEngine.exportImageSequence(project, {
        startFrame: 0,
        endFrame: 5,
      });
      const result = await generator.next();

      expect(result.done).toBe(true);
      if (!result.done) throw new Error("Expected sequence validation to stop export");
      expect(result.value.success).toBe(false);
      expect(result.value.error?.code).toBe("INVALID_SETTINGS");
      expect(mockRenderFrame).not.toHaveBeenCalled();
    });

    it("should return every frame with sanitized filenames and format extensions", async () => {
      await exportEngine.initialize();
      const project = createMockProject({
        settings: { width: 1920, height: 1080, frameRate: 1, sampleRate: 48000, channels: 2 },
        timeline: createMockTimeline({ duration: 2 }),
      });
      const firstBlob = new Blob(["frame-0"]);
      const secondBlob = new Blob(["frame-1"]);
      const exportFrameSpy = vi.spyOn(exportEngine, "exportFrame")
        .mockResolvedValueOnce({ success: true, blob: firstBlob })
        .mockResolvedValueOnce({ success: true, blob: secondBlob });

      const generator = exportEngine.exportImageSequence(project, {
        namingPattern: "../shot:{000}",
        format: "png",
      });
      let result;
      try {
        result = await generator.next();
        while (!result.done) {
          result = await generator.next();
        }
      } finally {
        exportFrameSpy.mockRestore();
      }

      expect(result.value.success).toBe(true);
      expect(result.value.files?.map((file) => file.name)).toEqual([
        "_shot_000.png",
        "_shot_001.png",
      ]);
      expect(result.value.files?.map((file) => file.blob)).toEqual([
        firstBlob,
        secondBlob,
      ]);
    });

    it("streams each rendered frame to an awaited callback without retaining frame Blobs", async () => {
      await exportEngine.initialize();
      const project = createMockProject({
        settings: { width: 1920, height: 1080, frameRate: 1, sampleRate: 48000, channels: 2 },
        timeline: createMockTimeline({ duration: 2 }),
      });
      const firstBlob = new Blob(["frame-0"]);
      const secondBlob = new Blob(["frame-1"]);
      const exportFrameSpy = vi.spyOn(exportEngine, "exportFrame")
        .mockResolvedValueOnce({ success: true, blob: firstBlob })
        .mockResolvedValueOnce({ success: true, blob: secondBlob });
      const received: Array<{ name: string; blob: Blob }> = [];
      const callback = vi.fn(async (frame: { name: string; blob: Blob }) => {
        await Promise.resolve();
        received.push(frame);
      });
      const generator = exportEngine.exportImageSequence(project, {
        namingPattern: "frame_{000}",
        format: "png",
      }, callback);
      let result;
      try {
        result = await generator.next();
        while (!result.done) result = await generator.next();
      } finally {
        exportFrameSpy.mockRestore();
      }

      expect(result.value.success).toBe(true);
      expect(callback).toHaveBeenCalledTimes(2);
      expect(received.map((frame) => frame.name)).toEqual(["frame_000.png", "frame_001.png"]);
      expect(received.map((frame) => frame.blob)).toEqual([firstBlob, secondBlob]);
      expect(result.value.files).toEqual([]);
      expect(result.value.blob).toBeUndefined();
      expect(result.value.stats?.fileSize).toBe(firstBlob.size + secondBlob.size);
    });

    it("honors cancellation while the streamed frame consumer is awaiting a write", async () => {
      await exportEngine.initialize();
      const project = createMockProject({
        settings: { width: 1920, height: 1080, frameRate: 1, sampleRate: 48000, channels: 2 },
        timeline: createMockTimeline({ duration: 2 }),
      });
      const exportFrameSpy = vi.spyOn(exportEngine, "exportFrame")
        .mockResolvedValue({ success: true, blob: new Blob(["frame"]) });
      const onFrame = vi.fn(async () => {
        exportEngine.cancel();
        await Promise.resolve();
      });
      const generator = exportEngine.exportImageSequence(project, {}, onFrame);
      let result;
      try {
        result = await generator.next();
        while (!result.done) result = await generator.next();
      } finally {
        exportFrameSpy.mockRestore();
      }

      expect(result.value.success).toBe(false);
      expect(result.value.error?.code).toBe("CANCELLED");
      expect(onFrame).toHaveBeenCalledTimes(1);
      expect(exportFrameSpy).toHaveBeenCalledTimes(1);
      expect(result.value.stats?.framesRendered ?? 0).toBe(0);
    });

    it("reports cancellation when the streamed frame consumer rejects after cancellation", async () => {
      await exportEngine.initialize();
      const project = createMockProject({
        settings: { width: 1920, height: 1080, frameRate: 1, sampleRate: 48000, channels: 2 },
        timeline: createMockTimeline({ duration: 1 }),
      });
      const exportFrameSpy = vi.spyOn(exportEngine, "exportFrame")
        .mockResolvedValue({ success: true, blob: new Blob(["frame"]) });
      const onFrame = vi.fn(async () => {
        exportEngine.cancel();
        throw new Error("consumer stopped during cancellation");
      });
      const generator = exportEngine.exportImageSequence(project, {}, onFrame);
      let result;
      try {
        result = await generator.next();
        while (!result.done) result = await generator.next();
      } finally {
        exportFrameSpy.mockRestore();
      }

      expect(result.value.success).toBe(false);
      expect(result.value.error?.code).toBe("CANCELLED");
      expect(result.value.error?.message).toContain("cancelled");
      expect(onFrame).toHaveBeenCalledTimes(1);
      expect(exportFrameSpy).toHaveBeenCalledTimes(1);
    });

    it("allows a fresh sequence export after a cancelled streamed export", async () => {
      await exportEngine.initialize();
      const project = createMockProject({
        settings: { width: 1920, height: 1080, frameRate: 1, sampleRate: 48000, channels: 2 },
        timeline: createMockTimeline({ duration: 1 }),
      });
      const exportFrameSpy = vi.spyOn(exportEngine, "exportFrame")
        .mockResolvedValue({ success: true, blob: new Blob(["frame"]) });
      const cancelledConsumer = vi.fn(() => {
        exportEngine.cancel();
      });

      try {
        const cancelledGenerator = exportEngine.exportImageSequence(
          project,
          {},
          cancelledConsumer,
        );
        let cancelledResult = await cancelledGenerator.next();
        while (!cancelledResult.done) {
          cancelledResult = await cancelledGenerator.next();
        }

        const nextGenerator = exportEngine.exportImageSequence(project);
        let nextResult = await nextGenerator.next();
        while (!nextResult.done) {
          nextResult = await nextGenerator.next();
        }

        expect(cancelledResult.value.success).toBe(false);
        expect(cancelledResult.value.error?.code).toBe("CANCELLED");
        expect(nextResult.value.success).toBe(true);
        expect(nextResult.value.files).toHaveLength(1);
        expect(exportFrameSpy).toHaveBeenCalledTimes(2);
      } finally {
        exportFrameSpy.mockRestore();
      }
    });

    it("rejects a second export while a streamed sequence is active", async () => {
      await exportEngine.initialize();
      const project = createMockProject({
        settings: { width: 1920, height: 1080, frameRate: 1, sampleRate: 48000, channels: 2 },
        timeline: createMockTimeline({ duration: 1 }),
      });
      const exportFrameSpy = vi.spyOn(exportEngine, "exportFrame")
        .mockResolvedValue({ success: true, blob: new Blob(["frame"]) });

      let releaseFrame!: () => void;
      const frameWrite = new Promise<void>((resolve) => {
        releaseFrame = resolve;
      });
      const firstGenerator = exportEngine.exportImageSequence(
        project,
        {},
        async () => frameWrite,
      );

      try {
        await firstGenerator.next();
        const activeStep = firstGenerator.next();
        // Let the frame callback begin and hold the first export open.
        await Promise.resolve();
        const secondGenerator = exportEngine.exportImageSequence(project);
        const secondResult = await secondGenerator.next();

        expect(secondResult.done).toBe(true);
        if (!secondResult.done) throw new Error("Expected concurrent export to be rejected");
        expect(secondResult.value.success).toBe(false);
        expect(secondResult.value.error?.message).toContain("already in progress");

        releaseFrame();
        let firstResult = await activeStep;
        while (!firstResult.done) firstResult = await firstGenerator.next();
        expect(firstResult.value.success).toBe(true);
      } finally {
        releaseFrame();
        exportFrameSpy.mockRestore();
      }
    });

    it("stops rendering when the streamed frame consumer fails", async () => {
      await exportEngine.initialize();
      const project = createMockProject({
        settings: { width: 1920, height: 1080, frameRate: 1, sampleRate: 48000, channels: 2 },
        timeline: createMockTimeline({ duration: 2 }),
      });
      const exportFrameSpy = vi.spyOn(exportEngine, "exportFrame")
        .mockResolvedValue({ success: true, blob: new Blob(["frame"]) });
      const onFrame = vi.fn(async () => {
        throw new Error("ZIP destination unavailable");
      });
      const generator = exportEngine.exportImageSequence(project, {}, onFrame);
      let result;
      try {
        result = await generator.next();
        while (!result.done) result = await generator.next();
      } finally {
        exportFrameSpy.mockRestore();
      }

      expect(result.value.success).toBe(false);
      expect(result.value.error?.message).toContain("ZIP destination unavailable");
      expect(onFrame).toHaveBeenCalledTimes(1);
      expect(exportFrameSpy).toHaveBeenCalledTimes(1);
    });

    it("should reject an empty sequence naming pattern before rendering", async () => {
      await exportEngine.initialize();
      const project = createMockProject({
        settings: { width: 1920, height: 1080, frameRate: 1, sampleRate: 48000, channels: 2 },
        timeline: createMockTimeline({ duration: 5 }),
      });

      const generator = exportEngine.exportImageSequence(project, {
        namingPattern: "   ",
      });
      const result = await generator.next();

      expect(result.done).toBe(true);
      if (!result.done) throw new Error("Expected sequence validation to stop export");
      expect(result.value.success).toBe(false);
      expect(result.value.error?.code).toBe("INVALID_SETTINGS");
      expect(mockRenderFrame).not.toHaveBeenCalled();
    });
  });

  describe("video export", () => {
    it("honors cancellation while output finalization is pending", async () => {
      await exportEngine.initialize();
      const project = createMockProject({
        timeline: createMockTimeline({ duration: 1 }),
      });
      const writableStream = {
        seek: vi.fn().mockResolvedValue(undefined),
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
      } as unknown as FileSystemWritableFileStream;

      let finishFinalize!: () => void;
      mockOutputFinalize.mockImplementationOnce(
        () => new Promise<void>((resolve) => {
          finishFinalize = resolve;
        }),
      );

      const generator = exportEngine.exportVideo(
        project,
        { ...DEFAULT_VIDEO_SETTINGS, frameRate: 1, width: 640, height: 360 },
        writableStream,
      );

      let step = await generator.next();
      while (!step.done && mockOutputFinalize.mock.calls.length === 0) {
        const pendingStep = generator.next();
        // Allow the export pipeline to reach the deliberately pending finalize.
        await Promise.resolve();
        await Promise.resolve();
        if (mockOutputFinalize.mock.calls.length > 0) {
          exportEngine.cancel();
          finishFinalize();
          step = await pendingStep;
          break;
        }
        step = await pendingStep;
      }

      expect(mockOutputFinalize).toHaveBeenCalledTimes(1);
      expect(step.done).toBe(true);
      if (!step.done) throw new Error("Expected cancelled export to finish");
      expect(step.value.success).toBe(false);
      expect(step.value.error?.code).toBe("CANCELLED");
      expect(writableStream.close).not.toHaveBeenCalled();
      expect(writableStream.abort).toHaveBeenCalled();
    });

    it("honors cancellation while GPU initialization is pending", async () => {
      await exportEngine.initialize();
      const project = createMockProject({
        timeline: createMockTimeline({ duration: 1 }),
      });
      const writableStream = {
        seek: vi.fn().mockResolvedValue(undefined),
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
      } as unknown as FileSystemWritableFileStream;

      let finishGpuInitialization!: () => void;
      mockVideoEngine.initializeGPUCompositor.mockImplementationOnce(
        () => new Promise<void>((resolve) => {
          finishGpuInitialization = resolve;
        }),
      );

      const generator = exportEngine.exportVideo(
        project,
        { ...DEFAULT_VIDEO_SETTINGS, frameRate: 1, width: 640, height: 360 },
        writableStream,
      );
      const pendingResult = generator.next();
      exportEngine.cancel();
      finishGpuInitialization();

      const result = await pendingResult;
      expect(result.done).toBe(true);
      if (!result.done) throw new Error("Expected cancelled export to finish");
      expect(result.value.success).toBe(false);
      expect(result.value.error?.code).toBe("CANCELLED");
      expect(mockOutputStart).not.toHaveBeenCalled();
    });

    it("should render long export audio in chunks and clear cached audio", async () => {
      const project = createMockProject({
        timeline: createMockTimeline({
          tracks: [
            createMockTrack({
              clips: [createMockClip({ duration: 40, outPoint: 40 })],
            }),
          ],
          duration: 40,
        }),
      });

      mockRenderAudio.mockResolvedValue({ buffer: { duration: 15 } });

      await exportEngine.initialize();

      const writableStream = {
        seek: vi.fn().mockResolvedValue(undefined),
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
      } as unknown as FileSystemWritableFileStream;

      const generator = exportEngine.exportVideo(
        project,
        { ...DEFAULT_VIDEO_SETTINGS, frameRate: 1, width: 640, height: 360 },
        writableStream,
      );

      while (true) {
        const { done } = await generator.next();
        if (done) break;
      }

      expect(mockRenderAudio).toHaveBeenCalledTimes(3);
      expect(mockRenderAudio).toHaveBeenNthCalledWith(1, project, 0, 15);
      expect(mockRenderAudio).toHaveBeenNthCalledWith(2, project, 15, 15);
      expect(mockRenderAudio).toHaveBeenNthCalledWith(3, project, 30, 10);
      expect(mockAudioSourceAdd).toHaveBeenCalledTimes(3);
      expect(mockAudioEngine.clearCache).toHaveBeenCalled();
    });
  });

  describe("dispose", () => {
    it("should reset state on dispose", () => {
      exportEngine.dispose();
      expect(exportEngine.isInitialized()).toBe(false);
      expect(exportEngine.isMediaBunnyAvailable()).toBe(false);
    });
  });
});

describe("Export Types and Defaults", () => {
  describe("DEFAULT_VIDEO_SETTINGS", () => {
    it("should have correct default format", () => {
      expect(DEFAULT_VIDEO_SETTINGS.format).toBe("mp4");
    });

    it("should have correct default codec", () => {
      expect(DEFAULT_VIDEO_SETTINGS.codec).toBe("h264");
    });

    it("should have correct default resolution", () => {
      expect(DEFAULT_VIDEO_SETTINGS.width).toBe(1920);
      expect(DEFAULT_VIDEO_SETTINGS.height).toBe(1080);
    });

    it("should have correct default frame rate", () => {
      expect(DEFAULT_VIDEO_SETTINGS.frameRate).toBe(30);
    });

    it("should have audio settings", () => {
      expect(DEFAULT_VIDEO_SETTINGS.audioSettings).toBeDefined();
      expect(DEFAULT_VIDEO_SETTINGS.audioSettings.sampleRate).toBe(48000);
    });
  });

  describe("DEFAULT_AUDIO_SETTINGS", () => {
    it("should have correct defaults", () => {
      expect(DEFAULT_AUDIO_SETTINGS.format).toBe("mp3");
      expect(DEFAULT_AUDIO_SETTINGS.sampleRate).toBe(48000);
      expect(DEFAULT_AUDIO_SETTINGS.bitrate).toBe(320);
      expect(DEFAULT_AUDIO_SETTINGS.channels).toBe(2);
    });
  });

  describe("DEFAULT_IMAGE_SETTINGS", () => {
    it("should have correct defaults", () => {
      expect(DEFAULT_IMAGE_SETTINGS.format).toBe("jpg");
      expect(DEFAULT_IMAGE_SETTINGS.quality).toBe(90);
      expect(DEFAULT_IMAGE_SETTINGS.width).toBe(1920);
      expect(DEFAULT_IMAGE_SETTINGS.height).toBe(1080);
    });
  });

  describe("VIDEO_QUALITY_PRESETS", () => {
    it("should have 4K preset", () => {
      expect(VIDEO_QUALITY_PRESETS["4k"]).toBeDefined();
      expect(VIDEO_QUALITY_PRESETS["4k"].width).toBe(3840);
      expect(VIDEO_QUALITY_PRESETS["4k"].height).toBe(2160);
    });

    it("should have 1080p preset", () => {
      expect(VIDEO_QUALITY_PRESETS["1080p"]).toBeDefined();
      expect(VIDEO_QUALITY_PRESETS["1080p"].width).toBe(1920);
      expect(VIDEO_QUALITY_PRESETS["1080p"].height).toBe(1080);
    });

    it("should have 720p preset", () => {
      expect(VIDEO_QUALITY_PRESETS["720p"]).toBeDefined();
      expect(VIDEO_QUALITY_PRESETS["720p"].width).toBe(1280);
      expect(VIDEO_QUALITY_PRESETS["720p"].height).toBe(720);
    });

    it("should have higher bitrate for 4K than 1080p", () => {
      expect(VIDEO_QUALITY_PRESETS["4k"].bitrate).toBeGreaterThan(
        VIDEO_QUALITY_PRESETS["1080p"].bitrate,
      );
    });
  });
});
