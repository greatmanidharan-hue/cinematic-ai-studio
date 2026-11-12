import { Zip, ZipDeflate } from "fflate";
import type { ExportedImageFrame } from "./types";

export interface ImageSequenceZipOptions {
  signal?: AbortSignal;
  onProgress?: (completedFrames: number, totalFrames: number) => void;
  onChunk?: (chunk: Uint8Array) => void | Promise<void>;
}

function validateEntryName(name: string): string {
  const trimmedName = name.trim();
  const normalizedName = trimmedName.replace(/\\/g, "/").normalize("NFC");
  const segments = normalizedName.split("/");
  const hasUnsafeSegment = segments.some((segment) => {
    const deviceName = segment.split(".")[0].trimEnd().toUpperCase();
    return (
      segment.length === 0 ||
      segment === "." ||
      segment === ".." ||
      /[. ]$/.test(segment) ||
      /[:<>"|?*\u0000-\u001f]/.test(segment) ||
      /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$/.test(deviceName)
    );
  });
  if (
    !trimmedName ||
    normalizedName.startsWith("/") ||
    /^[A-Za-z]:/.test(normalizedName) ||
    hasUnsafeSegment
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
export async function createImageSequenceZipFromFrames(
  frames: AsyncIterable<ExportedImageFrame>,
  totalFrames: number,
  options: ImageSequenceZipOptions = {},
): Promise<Blob> {
  if (!Number.isInteger(totalFrames) || totalFrames <= 0) {
    throw new Error("Cannot create an image sequence archive without frames.");
  }

  const output: Uint8Array[] = [];
  const names = new Set<string>();
  const directoryPaths = new Set<string>();
  let completedFrames = 0;
  let outputWriteQueue = Promise.resolve();
  let outputError: Error | null = null;
  let resolveZip: (() => void) | undefined;
  const zipFinished = new Promise<void>((resolve) => { resolveZip = resolve; });
  const waitForOutputWrites = async () => {
    if (!options.signal) {
      await outputWriteQueue;
      return;
    }
    if (options.signal.aborted) {
      throw new Error("Image sequence ZIP packaging cancelled.");
    }
    let removeAbortListener = () => {};
    const aborted = new Promise<never>((_, reject) => {
      const onAbort = () => reject(new Error("Image sequence ZIP packaging cancelled."));
      options.signal!.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () => options.signal!.removeEventListener("abort", onAbort);
    });
    try {
      await Promise.race([outputWriteQueue, aborted]);
    } finally {
      removeAbortListener();
    }
  };
  const zip = new Zip((error, data, final) => {
    if (error) {
      outputError = error;
      resolveZip?.();
      return;
    }
    if (data.length > 0) {
      if (options.onChunk) {
        const chunk = data.slice();
        outputWriteQueue = outputWriteQueue.then(() => options.onChunk?.(chunk)).then(
          () => undefined,
          (writeError: unknown) => {
            outputError = writeError instanceof Error ? writeError : new Error("Failed to write ZIP output chunk.");
          },
        );
      } else {
        output.push(data);
      }
    }
    if (final) resolveZip?.();
  });

  try {
    for await (const frame of frames) {
      if (options.signal?.aborted) throw new Error("Image sequence ZIP packaging cancelled.");
      if (outputError) throw outputError;
      if (completedFrames >= totalFrames) {
        throw new Error(`Image sequence frame count mismatch: expected ${totalFrames}, received more than declared.`);
      }
      const name = validateEntryName(frame.name);
      const collisionKey = name.toLowerCase();
      const pathSegments = collisionKey.split("/");
      const hasFileAncestor = pathSegments.some((_, index) => {
        if (index === pathSegments.length - 1) return false;
        return names.has(pathSegments.slice(0, index + 1).join("/"));
      });
      const hasDirectoryDescendant = directoryPaths.has(collisionKey);
      if (names.has(collisionKey)) {
        throw new Error(`Duplicate image sequence filename: ${name}`);
      }
      if (hasFileAncestor || hasDirectoryDescendant) {
        throw new Error(`Conflicting image sequence filename: ${name}`);
      }
      names.add(collisionKey);
      for (let index = 1; index < pathSegments.length; index += 1) {
        directoryPaths.add(pathSegments.slice(0, index).join("/"));
      }

      const entry = new ZipDeflate(name, { level: 6 });
      zip.add(entry);
      const reader = frame.blob.stream().getReader();
      const cancelReaderOnAbort = () => {
        void reader.cancel().catch(() => {
          // The reader may already be closed or errored.
        });
      };
      options.signal?.addEventListener("abort", cancelReaderOnAbort, { once: true });
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
          await waitForOutputWrites();
          if (outputError) throw outputError;
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        entry.push(new Uint8Array(0), true);
        await waitForOutputWrites();
        if (outputError) throw outputError;
      } finally {
        options.signal?.removeEventListener("abort", cancelReaderOnAbort);
        reader.releaseLock();
      }

      completedFrames += 1;
      options.onProgress?.(completedFrames, totalFrames);
    }

    if (completedFrames !== totalFrames) {
      throw new Error(`Image sequence frame count mismatch: expected ${totalFrames}, received ${completedFrames}.`);
    }
    if (options.signal?.aborted) throw new Error("Image sequence ZIP packaging cancelled.");
    zip.end();
    await zipFinished;
    await waitForOutputWrites();
    if (outputError) throw outputError;
    return new Blob(output, { type: "application/zip" });
  } catch (error) {
    try { zip.terminate(); } catch {
      // The ZIP writer may already have completed or terminated.
    }
    throw error;
  }
}

export async function createImageSequenceZip(
  frames: readonly ExportedImageFrame[],
  options: ImageSequenceZipOptions = {},
): Promise<Blob> {
  if (frames.length === 0) throw new Error("Cannot create an image sequence archive without frames.");
  async function* frameSource() {
    for (const frame of frames) yield frame;
  }
  return createImageSequenceZipFromFrames(frameSource(), frames.length, options);
}
