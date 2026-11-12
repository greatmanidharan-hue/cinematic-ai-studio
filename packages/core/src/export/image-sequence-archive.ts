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
    const normalizedName = name.replace(/\\/g, "/");
    const segments = normalizedName.split("/");
    if (
      !name ||
      normalizedName.startsWith("/") ||
      /^[A-Za-z]:\//.test(normalizedName) ||
      segments.some((segment) => segment === "." || segment === "..") ||
      name.includes("\0")
    ) {
      throw new Error(`Unsafe image sequence filename: ${frame.name}`);
    }
    if (Object.prototype.hasOwnProperty.call(entries, normalizedName)) {
      throw new Error(`Duplicate image sequence filename: ${normalizedName}`);
    }
    entries[normalizedName] = new Uint8Array(await frame.blob.arrayBuffer());
  }

  const zipBytes = zipSync(entries, { level: 6 });
  // Pass the ZIP byte view directly to Blob. Avoid creating a second full-size
  // ArrayBuffer copy before Blob takes ownership of the archive data.
  return new Blob([zipBytes], { type: "application/zip" });
}
