import { Zip, ZipDeflate } from "fflate";
import type { ExportedImageFrame } from "./types";

export interface ImageSequenceZipOptions {
  signal?: AbortSignal;
  onProgress?: (completedFrames: number, totalFrames: number) => void;
}

function validateEntryName(name: string): string {
  const trimmedName = name.trim();
  const normalizedName = trimmedName.replace(/\\/g, "/");
  const segments = normalizedName.split("/");
  if (
    !trimmedName ||
    normalizedName.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalizedName) ||
    segments.some((segment) => segment === "." || segment === "..") ||
    trimmedName.includes("\0")
  ) {
    throw new Error(`Unsafe image sequence filename: ${name}`);
  }
  return normalizedName;
}

/**
 * Stream frame data through fflate's incremental ZIP writer.
 * Input and compression are processed in chunks so callers can cancel between
 * chunks instead of waiting for one synchronous zipSync operation to finish.
 */
export async function createImageSequenceZip(
  frames: readonly ExportedImageFrame[],
  options: ImageSequenceZipOptions = {},
): Promise<Blob> {
  if (frames.length === 0) {
    throw new Error("Cannot create an image sequence archive without frames.");
  }

  const names = new Set<string>();
  const normalizedFrames = frames.map((frame) => {
    const name = validateEntryName(frame.name);
    if (names.has(name)) {
      throw new Error(`Duplicate image sequence filename: ${name}`);
    }
    names.add(name);
    return { name, blob: frame.blob };
  });

  const output: Uint8Array[] = [];
  let outputError: Error | null = null;
  let resolveZip: (() => void) | undefined;
  let rejectZip: ((error: Error) => void) | undefined;
  const zipFinished = new Promise<void>((resolve, reject) => {
    resolveZip = resolve;
    rejectZip = reject;
  });

  const zip = new Zip((error, data, final) => {
    if (error) {
      outputError = error;
      rejectZip?.(error);
      return;
    }
    if (data.length > 0) output.push(data);
    if (final) resolveZip?.();
  });

  try {
    for (let index = 0; index < normalizedFrames.length; index += 1) {
      if (options.signal?.aborted) {
        throw new Error("Image sequence ZIP packaging cancelled.");
      }

      const frame = normalizedFrames[index];
      const entry = new ZipDeflate(frame.name, { level: 6 });
      zip.add(entry);

      const reader = frame.blob.stream().getReader();
      try {
        while (true) {
          if (options.signal?.aborted) {
            await reader.cancel();
            throw new Error("Image sequence ZIP packaging cancelled.");
          }
          const { value, done } = await reader.read();
          if (done) break;
          if (value?.byteLength) entry.push(value, false);
          // Yield to the browser between chunks so cancellation and UI updates
          // can be processed even while a large frame is being compressed.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        entry.push(new Uint8Array(0), true);
      } finally {
        reader.releaseLock();
      }

      options.onProgress?.(index + 1, normalizedFrames.length);
    }

    if (options.signal?.aborted) {
      throw new Error("Image sequence ZIP packaging cancelled.");
    }
    zip.end();
    await zipFinished;
    if (outputError) throw outputError;
    return new Blob(output, { type: "application/zip" });
  } catch (error) {
    try {
      zip.terminate();
    } catch {
      // The ZIP writer may already have completed or terminated.
    }
    throw error;
  }
}
