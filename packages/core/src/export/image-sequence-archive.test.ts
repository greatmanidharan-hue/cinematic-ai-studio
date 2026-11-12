import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { createImageSequenceZip } from "./image-sequence-archive";

describe("createImageSequenceZip", () => {
  it("packages each frame using its original filename and bytes", async () => {
    const archive = await createImageSequenceZip([
      { name: "frame_0001.png", blob: new Blob(["first-frame"]) },
      { name: "frame_0002.png", blob: new Blob(["second-frame"]) },
    ]);

    expect(archive.type).toBe("application/zip");
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    expect(Object.keys(files)).toEqual(["frame_0001.png", "frame_0002.png"]);
    expect(new TextDecoder().decode(files["frame_0001.png"])).toBe("first-frame");
    expect(new TextDecoder().decode(files["frame_0002.png"])).toBe("second-frame");
  });

  it("streams ZIP output chunks to the supplied writer without retaining an archive Blob", async () => {
    const chunks: Uint8Array[] = [];
    const archive = await createImageSequenceZip(
      [{ name: "frame.png", blob: new Blob(["streamed-frame"]) }],
      { onChunk: (chunk) => chunks.push(chunk.slice()) },
    );

    expect(archive.size).toBe(0);
    expect(chunks.length).toBeGreaterThan(0);
    const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const bytes = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const files = unzipSync(bytes);
    expect(new TextDecoder().decode(files["frame.png"])).toBe("streamed-frame");
  });

  it("propagates errors from the streamed ZIP destination", async () => {
    await expect(
      createImageSequenceZip(
        [{ name: "frame.png", blob: new Blob(["frame-data"]) }],
        {
          onChunk: async () => {
            throw new Error("destination write failed");
          },
        },
      ),
    ).rejects.toThrow("destination write failed");
  });

  it("rejects an empty frame list", async () => {
    await expect(createImageSequenceZip([])).rejects.toThrow(/without frames/);
  });

  it("rejects path traversal filenames", async () => {
    await expect(
      createImageSequenceZip([
        { name: "../outside.png", blob: new Blob(["unsafe"]) },
      ]),
    ).rejects.toThrow(/Unsafe image sequence filename/);
  });

  it("rejects absolute paths using either path separator", async () => {
    await expect(
      createImageSequenceZip([{ name: "\\\\outside.png", blob: new Blob(["unsafe"]) }]),
    ).rejects.toThrow(/Unsafe image sequence filename/);
    await expect(
      createImageSequenceZip([{ name: "C:\\\\outside.png", blob: new Blob(["unsafe"]) }]),
    ).rejects.toThrow(/Unsafe image sequence filename/);
  });

  it("rejects traversal paths using Windows separators", async () => {
    const separator = String.fromCharCode(92);
    await expect(
      createImageSequenceZip([{ name: ".." + separator + "outside.png", blob: new Blob(["unsafe"]) }]),
    ).rejects.toThrow(/Unsafe image sequence filename/);
  });

  it("rejects duplicate paths after separator normalization", async () => {
    const separator = String.fromCharCode(92);
    await expect(
      createImageSequenceZip([
        { name: "frames" + separator + "frame.png", blob: new Blob(["one"]) },
        { name: "frames/frame.png", blob: new Blob(["two"]) },
      ]),
    ).rejects.toThrow(/Duplicate image sequence filename/);
  });
  it("rejects absolute paths beginning with a Windows separator", async () => {
    const separator = String.fromCharCode(92);
    await expect(
      createImageSequenceZip([{ name: separator + "outside.png", blob: new Blob(["unsafe"]) }]),
    ).rejects.toThrow(/Unsafe image sequence filename/);
  });

  it("rejects dot-segment filenames", async () => {
    await expect(
      createImageSequenceZip([{ name: "frames/./frame.png", blob: new Blob(["unsafe"]) }]),
    ).rejects.toThrow(/Unsafe image sequence filename/);
  });

  it("rejects filenames containing null bytes", async () => {
    await expect(
      createImageSequenceZip([{ name: "frame" + String.fromCharCode(0) + ".png", blob: new Blob(["unsafe"]) }]),
    ).rejects.toThrow(/Unsafe image sequence filename/);
  });
  it("supports cancellation before ZIP packaging starts", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      createImageSequenceZip(
        [{ name: "frame.png", blob: new Blob(["frame"]) }],
        { signal: controller.signal },
      ),
    ).rejects.toThrow(/cancelled/i);
  });

  it("stops between frames when cancellation is requested", async () => {
    const controller = new AbortController();
    await expect(
      createImageSequenceZip(
        [
          { name: "frame-1.png", blob: new Blob(["one"]) },
          { name: "frame-2.png", blob: new Blob(["two"]) },
        ],
        { signal: controller.signal, onProgress: () => controller.abort() },
      ),
    ).rejects.toThrow(/cancelled/i);
  });
  it("rejects duplicate filenames", async () => {
    await expect(
      createImageSequenceZip([
        { name: "frame.png", blob: new Blob(["one"]) },
        { name: "frame.png", blob: new Blob(["two"]) },
      ]),
    ).rejects.toThrow(/Duplicate image sequence filename/);
  });
});
