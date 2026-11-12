import { zipSync } from "fflate";
import type { ExportedImageFrame } from "./types";

/**
 * Package exported image frames into a browser-downloadable ZIP archive.
 * Frame names are kept intact, but unsafe paths and duplicate entries are rejected.
 */
export async function createImageSequenceZip(
  frames: readonly ExportedImageFrame[],
): Promise<Blob> {
  if (frames.length === 0) {
    throw new Error("Cannot create an image sequence archive without frames.");
  }

  const entries: Record<string, Uint8Array> = Object.create(null) as Record<
    string,
    Uint8Array
  >;

  for (const frame of frames) {
    const name = frame.name.trim();
    const segments = name.replace(/\\\\/g, "/").split("/");
    if (
      !name ||
      name.startsWith("/") ||
      segments.some((segment) => segment === "." || segment === "..") ||
      name.includes("\\0")
    ) {
      throw new Error(`Unsafe image sequence filename: ${frame.name}`);
    }
    if (Object.prototype.hasOwnProperty.call(entries, name)) {
      throw new Error(`Duplicate image sequence filename: ${name}`);
    }
    entries[name] = new Uint8Array(await frame.blob.arrayBuffer());
  }

  return new Blob([zipSync(entries, { level: 6 })], {
    type: "application/zip",
  });
}
