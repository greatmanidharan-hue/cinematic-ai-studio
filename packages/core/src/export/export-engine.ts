import type { Project } from "../types/project";
import type {
  VideoExportSettings,
  AudioExportSettings,
  ImageExportSettings,
  SequenceExportSettings,
  ExportProgress,
  ExportPreset,
  ExportResult,
  ExportStats,
  ExportError,
} from "./types";
import {
  DEFAULT_VIDEO_SETTINGS,
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_IMAGE_SETTINGS,
  VIDEO_QUALITY_PRESETS,
} from "./types";
import { VideoEngine, getVideoEngine } from "../video/video-engine";
import { AudioEngine, getAudioEngine } from "../audio/audio-engine";
import { titleEngine } from "../text/title-engine";
import { graphicsEngine } from "../graphics/graphics-engine";
import { UpscalingEngine, getUpscalingEngine } from "../video/upscaling";
import { getMediaEngine } from "../media/mediabunny-engine";
import { getWavEncoder } from "../wasm/wav";

export class ExportEngine {
  private static readonly AUDIO_EXPORT_CHUNK_DURATION_SECONDS = 15;
  private mediabunny: typeof import("mediabunny") | null = null;
  private initialized = false;
  private videoEngine: VideoEngine | null = null;
  private audioEngine: AudioEngine | null = null;
  private upscalingEngine: UpscalingEngine | null = null;
  private abortController: AbortController | null = null;
  private currentExport: {
    startTime: number;
    framesRendered: number;
  } | null = null;
  private exportWorker: Worker | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.mediabunny = await import("mediabunny");
    } catch (error) {
      console.warn("[ExportEngine] MediaBunny not available:", error);
      this.mediabunny = null;
    }

    try {
      this.videoEngine = getVideoEngine();
      this.audioEngine = getAudioEngine();

      if (!this.videoEngine.isInitialized()) {
        await this.videoEngine.initialize();
      }
      if (!this.audioEngine.isInitialized()) {
        await this.audioEngine.initialize();
      }

      this.initialized = true;
    } catch (error) {
      throw new Error(
        `ExportEngine initialization failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  async initializeGPUForExport(
    width: number,
    height: number,
  ): Promise<boolean> {
    if (!this.initialized || !this.videoEngine) {
      await this.initialize();
    }

    try {
      await this.videoEngine!.initializeGPUCompositor(width, height);
      const gpuCompositor = this.videoEngine!.getGPUCompositor();
      if (gpuCompositor) {
        const device = gpuCompositor.getDevice();
        if (device) {
          this.upscalingEngine = getUpscalingEngine();
          await this.upscalingEngine.initialize({ device });
        }
        return true;
      }
      return false;
    } catch (error) {
      throw new Error(
        `ExportEngine initialization failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  isMediaBunnyAvailable(): boolean {
    return this.mediabunny !== null;
  }

  isWebCodecsSupported(): boolean {
    return (
      typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined"
    );
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.mediabunny) {
      throw new Error("ExportEngine not initialized. Call initialize() first.");
    }
  }

  private ensureRenderingInitialized(): void {
    if (!this.initialized || !this.videoEngine) {
      throw new Error("ExportEngine not initialized. Call initialize() first.");
    }
  }

  /**
   * The export engine owns shared encoder, cache, progress, and cancellation
   * state. Until those resources are isolated per export, only one export may
   * run at a time.
   */
  private hasActiveExport(): boolean {
    return this.abortController !== null;
  }

  private createExportInProgressResult(): ExportResult {
    return {
      success: false,
      error: this.createError(
        "MUXER_ERROR",
        "Another export is already in progress. Wait for it to finish or cancel it before starting a new export.",
        "preparing",
      ),
    };
  }

  private createImageSequenceFileName(
    pattern: string,
    frameNumber: number,
    format: ImageExportSettings["format"],
  ): string {
    const framePattern = pattern.match(/\{(0+)\}/);
    const expandedName = framePattern
      ? pattern.replace(
          framePattern[0],
          String(frameNumber).padStart(framePattern[1].length, "0"),
        )
      : `${pattern}_${frameNumber}`;
    const safeBaseName = expandedName
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
      .replace(/\.(jpg|jpeg|png|webp)$/i, "")
      .replace(/^[. ]+|[. ]+$/g, "")
      .trim();
    const extension = format === "jpg" ? "jpg" : format;
    return `${safeBaseName || "frame_${frameNumber}"}.${extension}`;
  }

  private validateImageSettings(settings: ImageExportSettings): string | null {
    if (!["jpg", "png", "webp"].includes(settings.format)) {
      return "Unsupported image format.";
    }
    if (!Number.isInteger(settings.width) || settings.width <= 0) {
      return "Image width must be a positive integer.";
    }
    if (!Number.isInteger(settings.height) || settings.height <= 0) {
      return "Image height must be a positive integer.";
    }
    if (!Number.isFinite(settings.quality) || settings.quality < 0 || settings.quality > 100) {
      return "Image quality must be between 0 and 100.";
    }
    return null;
  }

  private validateVideoSettings(settings: VideoExportSettings): string | null {
    if (!["mp4", "webm", "mov"].includes(settings.format)) {
      return "Unsupported video container format.";
    }
    if (!["h264", "h265", "vp8", "vp9", "av1", "prores"].includes(settings.codec)) {
      return "Unsupported video codec.";
    }
    if (!Number.isInteger(settings.width) || settings.width <= 0) {
      return "Video width must be a positive integer.";
    }
    if (!Number.isInteger(settings.height) || settings.height <= 0) {
      return "Video height must be a positive integer.";
    }
    if (!Number.isFinite(settings.frameRate) || settings.frameRate < 1 || settings.frameRate > 120) {
      return "Frame rate must be between 1 and 120 fps.";
    }
    if (!Number.isFinite(settings.bitrate) || settings.bitrate <= 0) {
      return "Video bitrate must be a finite positive number.";
    }
    if (!Number.isFinite(settings.quality) || settings.quality < 0 || settings.quality > 100) {
      return "Video quality must be between 0 and 100.";
    }
    if (!Number.isFinite(settings.keyframeInterval) || settings.keyframeInterval <= 0) {
      return "Keyframe interval must be a finite positive number.";
    }
    if (!["cbr", "vbr"].includes(settings.bitrateMode)) {
      return "Unsupported video bitrate mode.";
    }
    return null;
  }

  private validateAudioSettings(settings: AudioExportSettings): string | null {
    if (!["mp3", "wav", "aac", "flac", "ogg"].includes(settings.format)) {
      return "Unsupported audio export format.";
    }
    if (![44100, 48000, 96000].includes(settings.sampleRate)) {
      return "Audio sample rate must be 44100, 48000, or 96000 Hz.";
    }
    if (![16, 24, 32].includes(settings.bitDepth)) {
      return "Audio bit depth must be 16, 24, or 32.";
    }
    if (![1, 2].includes(settings.channels)) {
      return "Audio channel count must be 1 or 2.";
    }
    if (!Number.isFinite(settings.bitrate) || settings.bitrate <= 0) {
      return "Audio bitrate must be a finite positive number.";
    }
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async findSupportedAudioCodec(
    outputFormat: { getSupportedAudioCodecs: () => any[] },
    audioSettings: AudioExportSettings,
    getFirstEncodableAudioCodec: (codecs: any[]) => Promise<string | null>,
  ): Promise<{ codec: string; bitrate: number }> {
    const supportedCodecs = outputFormat.getSupportedAudioCodecs();
    const requestedBitrate = audioSettings.bitrate * 1000;

    const bitrateFallbacks = [requestedBitrate, 192000, 128000, 96000].filter(
      (b, i, arr) => arr.indexOf(b) === i,
    );

    for (const bitrate of bitrateFallbacks) {
      const codec = await getFirstEncodableAudioCodec(supportedCodecs);
      if (codec) {
        const isSupported = await this.isAudioConfigSupported(
          codec,
          bitrate,
          audioSettings.channels,
          audioSettings.sampleRate,
        );
        if (isSupported) {
          return { codec, bitrate };
        }
      }
    }

    for (const fallbackCodec of ["aac", "mp3", "opus"]) {
      if (
        supportedCodecs.some((c: string) =>
          String(c).toLowerCase().includes(fallbackCodec) ||
          (fallbackCodec === "aac" && String(c).toLowerCase().includes("mp4a")),
        )
      ) {
        for (const bitrate of bitrateFallbacks) {
          const isSupported = await this.isAudioConfigSupported(
            fallbackCodec,
            bitrate,
            audioSettings.channels,
            audioSettings.sampleRate,
          );
          if (isSupported) {
            return { codec: fallbackCodec, bitrate };
          }
        }
      }
    }

    const defaultCodec = await getFirstEncodableAudioCodec(supportedCodecs);
    return {
      codec: defaultCodec || "aac",
      bitrate: 128000,
    };
  }

  private async isAudioConfigSupported(
    codec: string,
    bitrate: number,
    channels: number,
    sampleRate: number,
  ): Promise<boolean> {
    if (typeof AudioEncoder === "undefined") {
      return true;
    }

    try {
      let codecString: string;
      if (codec === "aac" || codec.includes("mp4a")) {
        codecString = "mp4a.40.2";
      } else if (codec === "opus") {
        codecString = "opus";
      } else if (codec === "mp3") {
        codecString = "mp3";
      } else {
        codecString = codec;
      }

      const config: AudioEncoderConfig = {
        codec: codecString,
        sampleRate,
        numberOfChannels: channels,
        bitrate,
      };

      const support = await AudioEncoder.isConfigSupported(config);
      return support.supported === true;
    } catch {
      return false;
    }
  }

  async *exportVideo(
    project: Project,
    settings: Partial<VideoExportSettings> = {},
    writableStream?: FileSystemWritableFileStream,
  ): AsyncGenerator<ExportProgress, ExportResult> {
    this.ensureInitialized();

    if (!this.mediabunny) {
      const errorMessage = this.isWebCodecsSupported()
        ? "MediaBunny library failed to load. Please refresh the page and try again."
        : "Video export requires WebCodecs API which is not supported in your browser. Please use Chrome, Edge, or another WebCodecs-compatible browser.";
      return {
        success: false,
        error: this.createError("UNSUPPORTED_CODEC", errorMessage, "preparing"),
      };
    }

    const fullSettings: VideoExportSettings = {
      ...DEFAULT_VIDEO_SETTINGS,
      ...settings,
      audioSettings: {
        ...DEFAULT_VIDEO_SETTINGS.audioSettings,
        ...settings.audioSettings,
      },
    };

    const videoSettingsError = this.validateVideoSettings(fullSettings);
    if (videoSettingsError) {
      return {
        success: false,
        error: this.createError("INVALID_SETTINGS", videoSettingsError, "preparing"),
      };
    }

    if (fullSettings.codec === "prores") {
      fullSettings.codec = "h264";
      fullSettings.format = "mp4";
      fullSettings.bitrate = 25000;
      fullSettings.quality = 95;
    }

    const audioSettingsError = this.validateAudioSettings(fullSettings.audioSettings);
    if (audioSettingsError) {
      return {
        success: false,
        error: this.createError("INVALID_SETTINGS", audioSettingsError, "preparing"),
      };
    }

    const { timeline } = project;
    const timelineDuration = this.calculateTimelineDuration(timeline);

    const isMemoryIntensiveCodec =
      fullSettings.codec === "vp9" ||
      fullSettings.codec === "av1" ||
      fullSettings.codec === "h265";
    const isLongVideo = timelineDuration > 120;

    let maxW = isMemoryIntensiveCodec ? 1920 : 3840;
    let maxH = isMemoryIntensiveCodec ? 1080 : 2160;
    if (isLongVideo) {
      maxW = Math.min(maxW, 1920);
      maxH = Math.min(maxH, 1080);
    }
    if (fullSettings.width > maxW || fullSettings.height > maxH) {
      const scale = Math.min(maxW / fullSettings.width, maxH / fullSettings.height, 1);
      fullSettings.width = Math.round(fullSettings.width * scale / 2) * 2;
      fullSettings.height = Math.round(fullSettings.height * scale / 2) * 2;
    }
    if (isLongVideo && fullSettings.frameRate > 30) {
      fullSettings.frameRate = 30;
    }

    // Validate prerequisites before changing shared engine state.
    if (timelineDuration <= 0) {
      return {
        success: false,
        error: this.createError(
          "MUXER_ERROR",
          "Timeline is empty. Add clips before exporting.",
          "preparing",
        ),
      };
    }

    if (!writableStream) {
      return {
        success: false,
        error: this.createError(
          "MUXER_ERROR",
          "No writable stream provided. Export requires a file destination.",
          "preparing",
        ),
      };
    }

    if (this.hasActiveExport()) {
      return this.createExportInProgressResult();
    }

    const controller = new AbortController();
    this.abortController = controller;
    this.currentExport = { startTime: Date.now(), framesRendered: 0 };

    const totalFrames = Math.ceil(timelineDuration * fullSettings.frameRate);
    let bytesWritten = 0;
    let videoSource: InstanceType<typeof import("mediabunny").VideoSampleSource> | null = null;
    let audioSource: InstanceType<typeof import("mediabunny").AudioBufferSource> | null = null;

    try {
      // Keep GPU setup inside the protected lifecycle so failures and
      // cancellation always pass through the same identity-safe cleanup.
      await this.initializeGPUForExport(
        fullSettings.width,
        fullSettings.height,
      );

      this.videoEngine?.resetExportState(project.timeline.particleEffects ?? []);
      if (this.videoEngine) {
        this.videoEngine.exportMode = true;
      }

      yield this.createProgress("preparing", 0, totalFrames, 0, 0);

      const {
        Output,
        StreamTarget,
        Mp4OutputFormat,
        WebMOutputFormat,
        MovOutputFormat,
        VideoSampleSource,
        AudioBufferSource,
        VideoSample,
        getFirstEncodableVideoCodec,
        getFirstEncodableAudioCodec,
        QUALITY_MEDIUM,
      } = this.mediabunny!;

      const diskWriter = writableStream;
      const chunkWriter = new WritableStream<{ data: Uint8Array; position: number }>({
        async write(chunk) {
          const buf = chunk.data.buffer.slice(
            chunk.data.byteOffset,
            chunk.data.byteOffset + chunk.data.byteLength,
          ) as ArrayBuffer;
          await diskWriter.seek(chunk.position);
          await diskWriter.write(buf);
          bytesWritten += chunk.data.byteLength;
        },
      });

      let outputFormat;
      switch (fullSettings.format) {
        case "webm":
          outputFormat = new WebMOutputFormat();
          break;
        case "mov":
          outputFormat = new MovOutputFormat();
          break;
        case "mp4":
        default:
          outputFormat = new Mp4OutputFormat({ fastStart: false });
          break;
      }

      const target = new StreamTarget(chunkWriter, {
        chunked: true,
        chunkSize: 4 * 1024 * 1024,
      });
      const output = new Output({ format: outputFormat, target });

      const videoCodec = await getFirstEncodableVideoCodec(
        outputFormat.getSupportedVideoCodecs(),
        { width: fullSettings.width, height: fullSettings.height },
      );

      if (!videoCodec) {
        throw this.createError(
          "UNSUPPORTED_CODEC",
          "No supported video codec found",
          "preparing",
        );
      }

      const audioCodecResult = await this.findSupportedAudioCodec(
        outputFormat,
        fullSettings.audioSettings,
        getFirstEncodableAudioCodec,
      );

      videoSource = new VideoSampleSource({
        codec: videoCodec,
        bitrate: fullSettings.bitrate ? fullSettings.bitrate * 1000 : QUALITY_MEDIUM,
        keyFrameInterval:
          fullSettings.keyframeInterval / fullSettings.frameRate,
        hardwareAcceleration: "prefer-software",
      });
      audioSource = new AudioBufferSource({
        codec: audioCodecResult.codec as "aac" | "opus" | "mp3",
        bitrate: audioCodecResult.bitrate,
      });
      output.addVideoTrack(videoSource);
      output.addAudioTrack(audioSource);
      output.setMetadataTags({
        title: project.name,
        date: new Date(),
      });

      await output.start();

      try {
        await this.encodeTimelineAudioToSource(project, audioSource);
      } finally {
        this.audioEngine?.clearCache();
      }
      audioSource.close();
      audioSource = null;

      const mediaEngine = getMediaEngine();
      const videoMediaIds: string[] = [];
      for (const track of project.timeline.tracks) {
        if (track.type !== "video") continue;
        for (const clip of track.clips) {
          const mediaItem = project.mediaLibrary.items.find(
            (m) => m.id === clip.mediaId,
          );
          if (mediaItem?.blob && !videoMediaIds.includes(mediaItem.id)) {
            videoMediaIds.push(mediaItem.id);
            try {
              await mediaEngine.createExportDecoder(
                mediaItem.id,
                mediaItem.blob,
                fullSettings.width,
              );
            } catch {}
          }
        }
      }

      for (let frame = 0; frame < totalFrames; frame++) {
        if (controller.signal.aborted) {
          throw this.createError(
            "CANCELLED",
            "Export cancelled by user",
            "rendering",
          );
        }

        const time = frame / fullSettings.frameRate;
        const rendered = await this.videoEngine!.renderFrame(
          project,
          time,
          fullSettings.width,
          fullSettings.height,
        );
        const shouldUpscale = this.shouldApplyUpscaling(project, fullSettings);
        let frameImage = rendered.image;

        try {
          if (shouldUpscale && this.upscalingEngine?.isInitialized()) {
            const sourceImage = frameImage;
            try {
              frameImage = await this.upscalingEngine.upscaleImageBitmap(
                sourceImage,
                fullSettings.width,
                fullSettings.height,
                fullSettings.upscaling!,
              );
            } finally {
              sourceImage.close();
            }
          }

          const videoSample = new VideoSample(frameImage, {
            timestamp: time,
            duration: 1 / fullSettings.frameRate,
          });

          try {
            await videoSource.add(videoSample);
          } finally {
            videoSample.close();
          }
        } finally {
          frameImage.close();
        }

        this.currentExport!.framesRendered = frame + 1;

        if ((frame + 1) % 5 === 0) {
          this.videoEngine?.clearVideoElementCache();
          this.videoEngine?.clearCache();
          try {
            mediaEngine.clearFrameCache();
          } catch {}
          await new Promise((resolve) => setTimeout(resolve, 2));
        }

        yield this.createProgress(
          "rendering",
          (frame + 1) / totalFrames,
          totalFrames,
          frame + 1,
          bytesWritten,
        );
      }

      if (controller.signal.aborted) {
        throw this.createError(
          "CANCELLED",
          "Export cancelled by user",
          "rendering",
        );
      }

      videoSource.close();
      videoSource = null;
      mediaEngine.disposeAllExportDecoders();
      mediaEngine.clearFrameCache();
      this.videoEngine?.clearVideoElementCache();
      this.videoEngine?.clearCache();
      if (this.videoEngine) {
        this.videoEngine.exportMode = false;
      }

      yield this.createProgress(
        "muxing",
        0.98,
        totalFrames,
        totalFrames,
        bytesWritten,
      );

      // The async generator may be paused at the progress yield while the user
      // cancels; check again before committing the muxed file.
      if (controller.signal.aborted) {
        throw this.createError(
          "CANCELLED",
          "Export cancelled by user",
          "muxing",
        );
      }

      await output.finalize();
      await writableStream.close();

      yield this.createProgress(
        "complete",
        1,
        totalFrames,
        totalFrames,
        bytesWritten,
      );

      return {
        success: true,
        stats: this.calculateStats(totalFrames, bytesWritten),
      };
    } catch (error) {
      try { await writableStream.abort(); } catch {}
      if (error && typeof error === "object" && "code" in error) {
        return { success: false, error: error as ExportError };
      }
      return {
        success: false,
        error: this.createError(
          "FRAME_ENCODE_FAILED",
          error instanceof Error ? error.message : "Unknown error",
          "rendering",
        ),
      };
    } finally {
      try { audioSource?.close(); } catch {}
      try { videoSource?.close(); } catch {}
      if (this.abortController === controller) {
        this.abortController = null;
        this.currentExport = null;
      }
      this.audioEngine?.clearCache();
      this.videoEngine?.clearVideoElementCache();
      this.videoEngine?.clearCache();
      if (this.videoEngine) {
        this.videoEngine.exportMode = false;
      }
      try {
        getMediaEngine().disposeAllExportDecoders();
        getMediaEngine().clearFrameCache();
      } catch {}
    }
  }

  private terminateWorker(): void {
    if (this.exportWorker) {
      this.exportWorker.terminate();
      this.exportWorker = null;
    }
  }

  async *exportAudio(
    project: Project,
    settings: Partial<AudioExportSettings> = {},
  ): AsyncGenerator<ExportProgress, ExportResult> {
    this.ensureInitialized();

    const fullSettings: AudioExportSettings = {
      ...DEFAULT_AUDIO_SETTINGS,
      ...settings,
    };

    const audioSettingsError = this.validateAudioSettings(fullSettings);
    if (audioSettingsError) {
      return {
        success: false,
        error: this.createError("INVALID_SETTINGS", audioSettingsError, "preparing"),
      };
    }

    if (!this.mediabunny && fullSettings.format !== "wav") {
      return {
        success: false,
        error: this.createError(
          "UNSUPPORTED_CODEC",
          `Audio export to ${fullSettings.format} format requires MediaBunny. WAV format is available as a fallback.`,
          "preparing",
        ),
      };
    }

    const { timeline } = project;
    const timelineDuration = this.calculateTimelineDuration(timeline);

    // Reject an empty timeline before creating shared cancellation/export state.
    if (timelineDuration <= 0) {
      return {
        success: false,
        error: this.createError(
          "AUDIO_ENCODE_FAILED",
          "Timeline is empty. Add clips before exporting.",
          "preparing",
        ),
      };
    }

    if (this.hasActiveExport()) {
      return this.createExportInProgressResult();
    }

    const controller = new AbortController();
    this.abortController = controller;
    this.currentExport = { startTime: Date.now(), framesRendered: 0 };

    try {
      yield this.createProgress("preparing", 0, 1, 0, 0);
      const audioBuffer = await this.renderTimelineAudio(project);

      if (this.abortController?.signal.aborted) {
        throw this.createError("CANCELLED", "Export cancelled by user", "rendering");
      }

      if (!audioBuffer) {
        throw this.createError(
          "AUDIO_ENCODE_FAILED",
          "No audio to export",
          "rendering",
        );
      }

      yield this.createProgress("encoding", 0.5, 1, 0, 0);

      // Encode based on format
      let blob: Blob;

      if (this.abortController?.signal.aborted) {
        throw this.createError("CANCELLED", "Export cancelled by user", "encoding");
      }

      if (fullSettings.format === "wav") {
        blob = this.encodeWav(audioBuffer, fullSettings);
      } else {
        // Use MediaBunny for other formats
        blob = await this.encodeAudioWithMediaBunny(audioBuffer, fullSettings);
      }

      yield this.createProgress("complete", 1, 1, 1, blob.size);

      return {
        success: true,
        blob,
        stats: {
          duration: Date.now() - this.currentExport!.startTime,
          framesRendered: 1,
          averageSpeed: 1,
          fileSize: blob.size,
          averageBitrate: (blob.size * 8) / timelineDuration,
        },
      };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        return { success: false, error: error as ExportError };
      }
      return {
        success: false,
        error: this.createError(
          "AUDIO_ENCODE_FAILED",
          error instanceof Error ? error.message : "Unknown error",
          "encoding",
        ),
      };
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
        this.currentExport = null;
      }
    }
  }

  async exportFrame(
    project: Project,
    time: number,
    settings: Partial<ImageExportSettings> = {},
  ): Promise<ExportResult> {
    this.ensureRenderingInitialized();

    const fullSettings: ImageExportSettings = {
      ...DEFAULT_IMAGE_SETTINGS,
      width: project.settings.width,
      height: project.settings.height,
      ...settings,
    };

    const settingsError = this.validateImageSettings(fullSettings);
    if (settingsError) {
      return {
        success: false,
        error: this.createError("INVALID_SETTINGS", settingsError, "preparing"),
      };
    }

    const timelineDuration = this.calculateTimelineDuration(project.timeline);
    if (!Number.isFinite(time) || time < 0 || time > timelineDuration) {
      return {
        success: false,
        error: this.createError(
          "INVALID_SETTINGS",
          "Frame time must be finite and within the timeline duration.",
          "preparing",
        ),
      };
    }

    let renderedImage: ImageBitmap | null = null;
    let canvas: OffscreenCanvas | null = null;
    try {
      const renderedFrame = await this.videoEngine!.renderFrame(
        project,
        time,
        fullSettings.width,
        fullSettings.height,
      );
      renderedImage = renderedFrame.image;

      canvas = new OffscreenCanvas(fullSettings.width, fullSettings.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Unable to create an image export canvas.");
      }

      ctx.drawImage(
        renderedImage,
        0,
        0,
        fullSettings.width,
        fullSettings.height,
      );

      const mimeType = this.getImageMimeType(fullSettings.format);
      const blob = await canvas.convertToBlob({
        type: mimeType,
        quality: fullSettings.quality / 100,
      });

      return {
        success: true,
        blob,
        stats: {
          duration: 0,
          framesRendered: 1,
          averageSpeed: 0,
          fileSize: blob.size,
          averageBitrate: 0,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: this.createError(
          "FRAME_ENCODE_FAILED",
          error instanceof Error ? error.message : "Unknown error",
          "rendering",
        ),
      };
    } finally {
      renderedImage?.close();
      // Release the per-frame backing store immediately instead of waiting
      // for garbage collection during long image-sequence exports.
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
  }

  async exportImage(
    project: Project,
    settings: Partial<ImageExportSettings> = {},
  ): Promise<ExportResult> {
    return this.exportFrame(project, 0, settings);
  }

  async *exportImageSequence(
    project: Project,
    settings: Partial<SequenceExportSettings> = {},
    onFrame?: (frame: { name: string; blob: Blob }) => void | Promise<void>,
  ): AsyncGenerator<ExportProgress, ExportResult> {
    this.ensureRenderingInitialized();

    const { timeline } = project;
    const frameRate = project.settings.frameRate;
    const totalFrames = Math.ceil(timeline.duration * frameRate);

    const fullSettings: SequenceExportSettings = {
      ...DEFAULT_IMAGE_SETTINGS,
      width: project.settings.width,
      height: project.settings.height,
      startFrame: 0,
      endFrame: totalFrames - 1,
      namingPattern: "frame_{0000}",
      ...settings,
    };

    const imageSettingsError = this.validateImageSettings(fullSettings);
    const sequenceSettingsError =
      !Number.isFinite(frameRate) || frameRate <= 0 || frameRate > 120
        ? "Sequence frame rate must be finite and between 1 and 120 fps."
        : !Number.isFinite(timeline.duration) || timeline.duration <= 0
          ? "Sequence duration must be finite and positive."
          : !Number.isInteger(fullSettings.startFrame) || fullSettings.startFrame < 0
            ? "Sequence start frame must be a non-negative integer."
            : !Number.isInteger(fullSettings.endFrame) ||
                fullSettings.endFrame < fullSettings.startFrame ||
                fullSettings.endFrame >= totalFrames
              ? "Sequence end frame must be an integer within the timeline and not before the start frame."
              : typeof fullSettings.namingPattern !== "string" ||
                  fullSettings.namingPattern.trim().length === 0
                ? "Sequence naming pattern must not be empty."
                : null;

    if (imageSettingsError || sequenceSettingsError) {
      return {
        success: false,
        error: this.createError(
          "INVALID_SETTINGS",
          imageSettingsError ?? sequenceSettingsError!,
          "preparing",
        ),
      };
    }

    if (this.hasActiveExport()) {
      return this.createExportInProgressResult();
    }

    const framesToExport = fullSettings.endFrame - fullSettings.startFrame + 1;
    const controller = new AbortController();
    this.abortController = controller;
    this.currentExport = { startTime: Date.now(), framesRendered: 0 };
    const files: Array<{ name: string; blob: Blob }> = [];
    let totalBytes = 0;

    try {
      yield this.createProgress("preparing", 0, framesToExport, 0, 0);

      for (let i = 0; i < framesToExport; i++) {
        if (controller.signal.aborted) {
          throw this.createError(
            "CANCELLED",
            "Export cancelled by user",
            "rendering",
          );
        }

        const frameNumber = fullSettings.startFrame + i;
        const time = frameNumber / frameRate;
        const result = await this.exportFrame(project, time, fullSettings);

        // Rendering is asynchronous and may finish after the user presses
        // Cancel. Do not retain or report a frame produced by a cancelled run.
        if (controller.signal.aborted) {
          throw this.createError(
            "CANCELLED",
            "Export cancelled by user",
            "rendering",
          );
        }

        if (!result.success || !result.blob) {
          return {
            success: false,
            error: result.error ?? this.createError(
              "FRAME_ENCODE_FAILED",
              "Unable to export image sequence frame.",
              "rendering",
            ),
          };
        }

        const frameName = this.createImageSequenceFileName(
          fullSettings.namingPattern,
          frameNumber,
          fullSettings.format,
        );
        const exportedFrame = { name: frameName, blob: result.blob };
        // Stream each rendered frame to the caller before rendering the next.
        // Awaiting the callback applies destination backpressure and avoids
        // retaining all encoded frame Blobs in memory.
        if (onFrame) {
          await onFrame(exportedFrame);
          // The destination callback may be awaiting a slow write while the
          // user cancels. Do not count or report that frame after cancellation.
          if (controller.signal.aborted) {
            throw this.createError(
              "CANCELLED",
              "Export cancelled by user",
              "rendering",
            );
          }
        } else {
          files.push(exportedFrame);
        }
        totalBytes += result.blob.size;
        this.currentExport!.framesRendered = i + 1;

        yield this.createProgress(
          "rendering",
          (i + 1) / framesToExport,
          framesToExport,
          i + 1,
          totalBytes,
        );
      }

      if (controller.signal.aborted) {
        throw this.createError(
          "CANCELLED",
          "Export cancelled by user",
          "rendering",
        );
      }

      yield this.createProgress(
        "complete",
        1,
        framesToExport,
        framesToExport,
        totalBytes,
      );

      const totalSize = totalBytes;
      return {
        success: true,
        blob: onFrame ? undefined : files[0]?.blob,
        files: onFrame ? [] : files,
        stats: this.calculateStats(framesToExport, totalSize),
      };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        return { success: false, error: error as ExportError };
      }
      return {
        success: false,
        error: this.createError(
          "FRAME_ENCODE_FAILED",
          error instanceof Error ? error.message : "Unknown error",
          "rendering",
        ),
      };
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
        this.currentExport = null;
      }
    }
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  getPresets(): ExportPreset[] {
    return [
      {
        id: "4k-master",
        name: "4K Master Quality",
        description: "Maximum quality 4K for professional delivery",
        category: "broadcast",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          ...VIDEO_QUALITY_PRESETS["4k-high"],
          codec: "h265",
          quality: 95,
        },
      },
      {
        id: "4k-prores-hq",
        name: "4K ProRes HQ",
        description: "Professional 4K ProRes for editing/mastering",
        category: "broadcast",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          width: 3840,
          height: 2160,
          frameRate: 30,
          format: "mov",
          codec: "prores",
          proresProfile: "hq",
          bitrate: 880000,
          quality: 100,
        },
      },
      {
        id: "4k-prores-4444",
        name: "4K ProRes 4444",
        description: "Highest quality ProRes with alpha channel support",
        category: "broadcast",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          width: 3840,
          height: 2160,
          frameRate: 30,
          format: "mov",
          codec: "prores",
          proresProfile: "4444",
          bitrate: 1320000,
          quality: 100,
        },
      },
      {
        id: "youtube-4k",
        name: "YouTube 4K",
        description: "4K UHD optimized for YouTube",
        category: "social",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          ...VIDEO_QUALITY_PRESETS["4k"],
          codec: "h264",
        },
      },
      {
        id: "youtube-4k-60",
        name: "YouTube 4K 60fps",
        description: "4K 60fps for YouTube gaming/motion",
        category: "social",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          ...VIDEO_QUALITY_PRESETS["4k-60"],
          codec: "h264",
        },
      },
      {
        id: "youtube-1080p-high",
        name: "YouTube 1080p High",
        description: "High bitrate 1080p for YouTube",
        category: "social",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          ...VIDEO_QUALITY_PRESETS["1080p-high"],
          codec: "h264",
        },
      },
      {
        id: "youtube-1080p",
        name: "YouTube 1080p",
        description: "Standard 1080p for YouTube",
        category: "social",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          ...VIDEO_QUALITY_PRESETS["1080p"],
          codec: "h264",
        },
      },
      {
        id: "tiktok-1080p",
        name: "TikTok/Reels",
        description: "Vertical 1080x1920 for TikTok/Reels",
        category: "social",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          width: 1080,
          height: 1920,
          bitrate: 15000,
          frameRate: 30,
          codec: "h264",
        },
      },
      {
        id: "twitter",
        name: "Twitter/X",
        description: "Optimized for Twitter",
        category: "social",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          ...VIDEO_QUALITY_PRESETS["720p"],
          codec: "h264",
        },
      },
      {
        id: "web-vp9",
        name: "Web (VP9)",
        description: "WebM VP9 for web embedding (720p for stability)",
        category: "web",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          format: "webm",
          codec: "vp9",
          ...VIDEO_QUALITY_PRESETS["720p"],
        },
      },
      {
        id: "archive-4k",
        name: "Archive 4K",
        description: "High quality 4K for archival",
        category: "archive",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          ...VIDEO_QUALITY_PRESETS["4k-high"],
          codec: "h265",
        },
      },
      {
        id: "archive-prores",
        name: "Archive ProRes",
        description: "Lossless quality ProRes for archival",
        category: "archive",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          width: 1920,
          height: 1080,
          format: "mov",
          codec: "prores",
          proresProfile: "hq",
          bitrate: 220000,
          quality: 100,
        },
      },
      {
        id: "audio-mp3",
        name: "MP3 Audio",
        description: "MP3 320kbps",
        category: "custom",
        settings: DEFAULT_AUDIO_SETTINGS,
      },
      {
        id: "audio-wav",
        name: "WAV Audio",
        description: "Uncompressed WAV 24-bit",
        category: "archive",
        settings: {
          ...DEFAULT_AUDIO_SETTINGS,
          format: "wav",
          bitDepth: 24,
          sampleRate: 48000,
        },
      },
    ];
  }

  createPreset(
    name: string,
    settings: VideoExportSettings | AudioExportSettings | ImageExportSettings,
  ): ExportPreset {
    return {
      id: `custom-${Date.now()}`,
      name,
      description: "Custom preset",
      settings,
      category: "custom",
    };
  }

  estimateFileSize(
    project: Project,
    settings: VideoExportSettings | AudioExportSettings,
  ): number {
    const duration = project.timeline.duration;

    if ("codec" in settings) {
      const videoBitrate = settings.bitrate * 1000;
      const audioBitrate = settings.audioSettings.bitrate * 1000;
      return Math.ceil(((videoBitrate + audioBitrate) * duration) / 8);
    } else {
      if (settings.format === "wav") {
        return Math.ceil(
          duration *
            settings.sampleRate *
            settings.channels *
            (settings.bitDepth / 8),
        );
      }
      return Math.ceil((settings.bitrate * 1000 * duration) / 8);
    }
  }

  estimateExportTime(
    project: Project,
    settings: VideoExportSettings | AudioExportSettings,
  ): number {
    const duration = project.timeline.duration;

    if ("codec" in settings) {
      const pixelCount = settings.width * settings.height;
      const complexity = pixelCount / (1920 * 1080);
      const codecFactor =
        settings.codec === "h265" || settings.codec === "av1" ? 2 : 1;
      return duration * complexity * codecFactor * 0.5;
    } else {
      return duration * 0.1;
    }
  }

  private async renderTimelineAudio(
    project: Project,
    startTime: number = 0,
    duration?: number,
  ): Promise<AudioBuffer | null> {
    const { timeline } = project;

    const hasAudio = timeline.tracks.some(
      (track) =>
        (track.type === "audio" || track.type === "video") &&
        !track.muted &&
        track.clips.length > 0,
    );

    if (!hasAudio) {
      return null;
    }

    const timelineDuration = this.calculateTimelineDuration(timeline);
    if (timelineDuration <= 0) {
      return null;
    }

    const renderDuration = Math.max(
      0,
      Math.min(duration ?? timelineDuration, timelineDuration - startTime),
    );
    if (renderDuration <= 0) {
      return null;
    }

    const rendered = await this.audioEngine!.renderAudio(
      project,
      startTime,
      renderDuration,
    );

    return rendered.buffer;
  }

  private async encodeTimelineAudioToSource(
    project: Project,
    audioSource: InstanceType<typeof import("mediabunny").AudioBufferSource>,
  ): Promise<void> {
    const timelineDuration = this.calculateTimelineDuration(project.timeline);
    if (timelineDuration <= 0) {
      return;
    }

    const chunkDuration = ExportEngine.AUDIO_EXPORT_CHUNK_DURATION_SECONDS;

    for (
      let startTime = 0;
      startTime < timelineDuration;
      startTime += chunkDuration
    ) {
      if (this.abortController?.signal.aborted) {
        throw this.createError(
          "CANCELLED",
          "Export cancelled by user",
          "encoding",
        );
      }

      const currentChunkDuration = Math.min(
        chunkDuration,
        timelineDuration - startTime,
      );
      const audioBuffer = await this.renderTimelineAudio(
        project,
        startTime,
        currentChunkDuration,
      );

      if (!audioBuffer) {
        continue;
      }

      await audioSource.add(audioBuffer);

      // Yield between chunks so the browser can reclaim the previous buffer
      // before the next long-running render starts.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  private async encodeAudioWithMediaBunny(
    buffer: AudioBuffer,
    settings: AudioExportSettings,
  ): Promise<Blob> {
    const {
      Output,
      BufferTarget,
      Mp3OutputFormat,
      AudioSampleSource,
      AudioSample,
      getFirstEncodableAudioCodec,
    } = this.mediabunny!;
    let outputFormat;
    switch (settings.format) {
      case "mp3":
        outputFormat = new Mp3OutputFormat();
        break;
      case "aac":
      case "flac":
      case "ogg":
      default:
        return this.encodeWav(buffer, settings);
    }

    const target = new BufferTarget();
    const output = new Output({ format: outputFormat, target });

    if (this.abortController?.signal.aborted) {
      throw this.createError("CANCELLED", "Export cancelled by user", "encoding");
    }

    const audioCodec = await getFirstEncodableAudioCodec(
      outputFormat.getSupportedAudioCodecs(),
    );

    if (this.abortController?.signal.aborted) {
      throw this.createError("CANCELLED", "Export cancelled by user", "encoding");
    }

    const audioSource = new AudioSampleSource({
      codec: audioCodec || "mp3",
      bitrate: settings.bitrate * 1000,
    });

    output.addAudioTrack(audioSource);
    await output.start();
    try {
      const audioSamples = AudioSample.fromAudioBuffer(buffer, 0);
      for (const sample of audioSamples) {
        try {
          if (this.abortController?.signal.aborted) {
            throw this.createError(
              "CANCELLED",
              "Export cancelled by user",
              "encoding",
            );
          }
          await audioSource.add(sample);
        } finally {
          sample.close();
        }
      }
    } finally {
      audioSource.close();
    }

    if (this.abortController?.signal.aborted) {
      throw this.createError("CANCELLED", "Export cancelled by user", "encoding");
    }

    await output.finalize();

    const resultBuffer = target.buffer;
    if (!resultBuffer) {
      throw new Error("Audio encoding failed");
    }

    return new Blob([resultBuffer], {
      type: this.getAudioMimeType(settings.format),
    });
  }

  private encodeWav(buffer: AudioBuffer, settings: AudioExportSettings): Blob {
    const numberOfChannels = Math.min(
      buffer.numberOfChannels,
      settings.channels,
    );
    const sampleRate = settings.sampleRate;
    const bitDepth = settings.bitDepth;

    if (bitDepth === 32) {
      return this.encodeWav32Float(buffer, numberOfChannels, sampleRate);
    }

    const encoder = getWavEncoder();
    const samples: Float32Array[] = [];
    for (let ch = 0; ch < numberOfChannels; ch++) {
      samples.push(buffer.getChannelData(ch));
    }

    const wavData = encoder.encodeFullWav(
      samples,
      sampleRate,
      bitDepth as 16 | 24,
    );

    return new Blob([wavData.buffer as ArrayBuffer], { type: "audio/wav" });
  }

  private encodeWav32Float(
    buffer: AudioBuffer,
    numberOfChannels: number,
    sampleRate: number,
  ): Blob {
    const bitDepth = 32;
    const bytesPerSample = 4;
    const blockAlign = numberOfChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataLength = buffer.length * blockAlign;
    const headerLength = 44;
    const totalLength = headerLength + dataLength;

    const arrayBuffer = new ArrayBuffer(totalLength);
    const view = new DataView(arrayBuffer);

    this.writeString(view, 0, "RIFF");
    view.setUint32(4, totalLength - 8, true);
    this.writeString(view, 8, "WAVE");
    this.writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 3, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    this.writeString(view, 36, "data");
    view.setUint32(40, dataLength, true);

    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        view.setFloat32(offset, buffer.getChannelData(channel)[i], true);
        offset += bytesPerSample;
      }
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
  }

  private writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  private getAudioMimeType(format: AudioExportSettings["format"]): string {
    switch (format) {
      case "mp3":
        return "audio/mpeg";
      case "wav":
        return "audio/wav";
      case "aac":
        return "audio/aac";
      case "flac":
        return "audio/flac";
      case "ogg":
        return "audio/ogg";
      default:
        return "audio/mpeg";
    }
  }

  private getImageMimeType(format: ImageExportSettings["format"]): string {
    switch (format) {
      case "png":
        return "image/png";
      case "webp":
        return "image/webp";
      case "jpg":
      default:
        return "image/jpeg";
    }
  }

  private createProgress(
    phase: ExportProgress["phase"],
    progress: number,
    totalFrames: number,
    currentFrame: number,
    bytesWritten: number,
  ): ExportProgress {
    const elapsed = this.currentExport
      ? (Date.now() - this.currentExport.startTime) / 1000
      : 0;
    const framesPerSecond = elapsed > 0 ? currentFrame / elapsed : 0;
    const remainingFrames = totalFrames - currentFrame;
    const estimatedTimeRemaining =
      framesPerSecond > 0 ? remainingFrames / framesPerSecond : 0;

    return {
      phase,
      progress,
      estimatedTimeRemaining,
      currentFrame,
      totalFrames,
      bytesWritten,
      currentBitrate: elapsed > 0 ? (bytesWritten * 8) / elapsed : 0,
    };
  }

  private createError(
    code: ExportError["code"],
    message: string,
    phase: ExportProgress["phase"],
  ): ExportError {
    return {
      code,
      message,
      phase,
      recoverable: code === "CANCELLED",
    };
  }

  private calculateStats(totalFrames: number, fileSize: number): ExportStats {
    const duration = this.currentExport
      ? Date.now() - this.currentExport.startTime
      : 0;
    const framesRendered = this.currentExport?.framesRendered || totalFrames;

    return {
      duration,
      framesRendered,
      averageSpeed: duration > 0 ? (framesRendered / duration) * 1000 : 0,
      fileSize,
      averageBitrate: duration > 0 ? (fileSize * 8000) / duration : 0,
    };
  }

  private calculateTimelineDuration(timeline: Project["timeline"]): number {
    let maxEndTime = 0;
    for (const track of timeline.tracks) {
      for (const clip of track.clips) {
        const endTime = clip.startTime + clip.duration;
        if (endTime > maxEndTime) {
          maxEndTime = endTime;
        }
      }
    }
    const textClips = titleEngine.getAllTextClips();
    for (const textClip of textClips) {
      const endTime = textClip.startTime + textClip.duration;
      if (endTime > maxEndTime) {
        maxEndTime = endTime;
      }
    }
    const shapeClips = graphicsEngine.getAllShapeClips();
    for (const shapeClip of shapeClips) {
      const endTime = shapeClip.startTime + shapeClip.duration;
      if (endTime > maxEndTime) {
        maxEndTime = endTime;
      }
    }
    const svgClips = graphicsEngine.getAllSVGClips();
    for (const svgClip of svgClips) {
      const endTime = svgClip.startTime + svgClip.duration;
      if (endTime > maxEndTime) {
        maxEndTime = endTime;
      }
    }
    const stickerClips = graphicsEngine.getAllStickerClips();
    for (const stickerClip of stickerClips) {
      const endTime = stickerClip.startTime + stickerClip.duration;
      if (endTime > maxEndTime) {
        maxEndTime = endTime;
      }
    }
    if (timeline.subtitles) {
      for (const subtitle of timeline.subtitles) {
        if (subtitle.endTime > maxEndTime) {
          maxEndTime = subtitle.endTime;
        }
      }
    }

    return maxEndTime;
  }

  private shouldApplyUpscaling(
    project: Project,
    settings: VideoExportSettings,
  ): boolean {
    if (!settings.upscaling?.enabled) {
      return false;
    }

    const sourceWidth = project.settings.width;
    const sourceHeight = project.settings.height;
    const targetWidth = settings.width;
    const targetHeight = settings.height;

    return targetWidth > sourceWidth || targetHeight > sourceHeight;
  }

  dispose(): void {
    this.cancel();
    this.terminateWorker();
    this.mediabunny = null;
    this.videoEngine = null;
    this.audioEngine = null;
    if (this.upscalingEngine) {
      this.upscalingEngine.clearTexturePool();
      this.upscalingEngine = null;
    }
    this.initialized = false;
  }
}
let exportEngineInstance: ExportEngine | null = null;

export function getExportEngine(): ExportEngine {
  if (!exportEngineInstance) {
    exportEngineInstance = new ExportEngine();
  }
  return exportEngineInstance;
}

export async function initializeExportEngine(): Promise<ExportEngine> {
  const engine = getExportEngine();
  await engine.initialize();
  return engine;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
