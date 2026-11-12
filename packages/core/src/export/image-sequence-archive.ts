import { Zip, ZipDeflate } from "fflate";
import type { ExportedImageFrame } from "./types";

export interface ImageSequenceZipOptions {
  signal?: AbortSignal;
  onProgress?: (completedFrames: number, totalFrames: number) => void;
  onChunk?: (chunk: Uint8Array) => void | Promise<void>;
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
  let outputWriteQueue = Promise.resolve();
  let outputError: Error | null = null;
  let resolveZip: (() => void) | undefined;
  const zipFinished = new Promise<void>((resolve) => {
    resolveZip = resolve;
  });

  const zip = new Zip((error, data, final) => {
    if (error) {
      outputError = error;
      // Resolve rather than reject here: ZIP callbacks may fire before the
      // async producer reaches its await, which could otherwise create an
      // unhandled promise rejection during cancellation or compression errors.
      resolveZip?.();
      return;
    }
    if (data.length > 0) {
      if (options.onChunk) {
        // fflate may reuse its output buffer after the callback returns. Copy the
        // chunk before handing it to an asynchronous destination writer.
        const chunk = data.slice();
        outputWriteQueue = outputWriteQueue.then(() => options.onChunk?.(chunk)).then(
          () => undefined,
          (error: unknown) => {
            outputError = error instanceof Error ? error : new Error("Failed to write ZIP output chunk.");
          },
        );
      } else {
        output.push(data);
      }
    }
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
          if (outputError) throw outputError;
          if (value?.byteLength) entry.push(value, false);
          // Wait for emitted archive bytes to reach the destination before
          // feeding more input. This applies backpressure and bounds queued
          // output memory when the file writer is slower than compression.
          await outputWriteQueue;
          if (outputError) throw outputError;
          // Yield to the browser between chunks so cancellation and UI updates
          // can be processed even while a large frame is being compressed.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        entry.push(new Uint8Array(0), true);
        await outputWriteQueue;
        if (outputError) throw outputError;
      } finally {
        reader.releaseLock();
      }

      if (outputError) throw outputError;
      options.onProgress?.(index + 1, normalizedFrames.length);
    }

    if (options.signal?.aborted) {
      throw new Error("Image sequence ZIP packaging cancelled.");
    }
    zip.end();
    await zipFinished;
    await outputWriteQueue;
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
