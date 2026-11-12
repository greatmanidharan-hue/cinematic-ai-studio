import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { createImageSequenceZip, createImageSequenceZipFromFrames } from "./image-sequence-archive";

describe("createImageSequenceZipFromFrames", () => {
  it("packages frames from an async source incrementally", async () => {
    const yielded: string[] = [];
    async function* frames() {
      yielded.push("first");
      yield { name: "frame-1.png", blob: new Blob(["one"]) };
      yielded.push("second");
      yield { name: "frame-2.png", blob: new Blob(["two"]) };
    }

    const archive = await createImageSequenceZipFromFrames(frames(), 2);
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    expect(yielded).toEqual(["first", "second"]);
    expect(new TextDecoder().decode(files["frame-1.png"])).toBe("one");
    expect(new TextDecoder().decode(files["frame-2.png"])).toBe("two");
  });

  it("rejects duplicate filenames across separately yielded frames", async () => {
    async function* frames() {
      yield { name: "frame.png", blob: new Blob(["one"]) };
      yield { name: "frame.png", blob: new Blob(["two"]) };
    }
    await expect(createImageSequenceZipFromFrames(frames(), 2)).rejects.toThrow(/Duplicate image sequence filename/);
  });

  it("rejects an async source that produces fewer frames than declared", async () => {
    async function* frames() {
      yield { name: "frame.png", blob: new Blob(["one"]) };
    }
    await expect(createImageSequenceZipFromFrames(frames(), 2)).rejects.toThrow(/frame count mismatch/);
  });

  it("stops an async source as soon as it yields more frames than declared", async () => {
    let yielded = 0;
    async function* frames() {
      yielded += 1;
      yield { name: "frame-1.png", blob: new Blob(["one"]) };
      yielded += 1;
      yield { name: "frame-2.png", blob: new Blob(["two"]) };
      yielded += 1;
      yield { name: "frame-3.png", blob: new Blob(["three"]) };
    }

    await expect(createImageSequenceZipFromFrames(frames(), 2)).rejects.toThrow(/frame count mismatch/);
    expect(yielded).toBe(3);
  });
});

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

  it("rejects promptly when cancellation occurs during a pending destination write", async () => {
    const controller = new AbortController();
    let releaseWrite: (() => void) | undefined;
    let notifyWriteStarted: (() => void) | undefined;
    const writeStarted = new Promise<void>((resolve) => {
      notifyWriteStarted = resolve;
    });
    const pendingWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const packaging = createImageSequenceZip(
      [{ name: "frame.png", blob: new Blob(["frame-data"]) }],
      {
        signal: controller.signal,
        onChunk: async () => {
          notifyWriteStarted?.();
          await pendingWrite;
        },
      },
    );

    try {
      await writeStarted;
      controller.abort();
      await expect(packaging).rejects.toThrow(/cancelled/i);
    } finally {
      releaseWrite?.();
    }
  });

  it("honors cancellation while a streamed destination write is pending", async () => {
    const controller = new AbortController();
    let releaseWrite: (() => void) | undefined;
    let notifyWriteStarted: (() => void) | undefined;
    const writeStarted = new Promise<void>((resolve) => {
      notifyWriteStarted = resolve;
    });
    const pendingWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });

    const packaging = createImageSequenceZip(
      [{ name: "frame.png", blob: new Blob(["frame-data"]) }],
      {
        signal: controller.signal,
        onChunk: async () => {
          notifyWriteStarted?.();
          await pendingWrite;
        },
      },
    );

    await writeStarted;
    controller.abort();
    releaseWrite?.();
    await expect(packaging).rejects.toThrow(/cancelled/i);
  });

  it("interrupts a pending frame read when cancellation is requested", async () => {
    const controller = new AbortController();
    let notifyReadStarted: (() => void) | undefined;
    let wasCancelled = false;
    const readStarted = new Promise<void>((resolve) => {
      notifyReadStarted = resolve;
    });
    const pendingBlob = new Blob(["pending-frame"]);
    pendingBlob.stream = () =>
      new ReadableStream<Uint8Array>({
        start() {
          notifyReadStarted?.();
        },
        cancel() {
          wasCancelled = true;
        },
      });

    const packaging = createImageSequenceZip(
      [{ name: "frame.png", blob: pendingBlob }],
      { signal: controller.signal },
    );

    await readStarted;
    controller.abort();
    await expect(packaging).rejects.toThrow(/cancelled/i);
    expect(wasCancelled).toBe(true);
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

  it("rejects empty path segments and trailing separators", async () => {
    for (const name of ["frames//shot.png", "frames/shot.png/", "frames\\\\shot.png"]) {
      await expect(
        createImageSequenceZip([{ name, blob: new Blob(["unsafe"]) }]),
      ).rejects.toThrow(/Unsafe image sequence filename/);
    }
  });

  it("rejects dot-segment filenames", async () => {
    await expect(
      createImageSequenceZip([{ name: "frames/./frame.png", blob: new Blob(["unsafe"]) }]),
    ).rejects.toThrow(/Unsafe image sequence filename/);
  });

  it("rejects Windows reserved device names and trailing-dot segments", async () => {
    for (const name of ["CON.png", "folder/NUL.txt", "frames/frame.png."]) {
      await expect(
        createImageSequenceZip([{ name, blob: new Blob(["unsafe"]) }]),
      ).rejects.toThrow(/Unsafe image sequence filename/);
    }
  });

  it("rejects drive-relative paths and colon characters", async () => {
    for (const name of ["C:frame.png", "frames/alternate:stream.png"]) {
      await expect(
        createImageSequenceZip([{ name, blob: new Blob(["unsafe"]) }]),
      ).rejects.toThrow(/Unsafe image sequence filename/);
    }
  });

  it("rejects file and directory prefix conflicts in either insertion order", async () => {
    const frame = (name: string) => ({ name, blob: new Blob(["data"]) });
    await expect(
      createImageSequenceZip([frame("frames"), frame("frames/shot.png")]),
    ).rejects.toThrow(/Conflicting image sequence filename/);
    await expect(
      createImageSequenceZip([frame("frames/shot.png"), frame("frames")]),
    ).rejects.toThrow(/Conflicting image sequence filename/);
  });

  it("rejects Windows device names with spaces before the extension", async () => {
    await expect(
      createImageSequenceZip([{ name: "CON .png", blob: new Blob(["unsafe"]) }]),
    ).rejects.toThrow(/Unsafe image sequence filename/);
  });

  it("rejects case-insensitive duplicate paths for portable extraction", async () => {
    await expect(
      createImageSequenceZip([
        { name: "Frames/Shot.PNG", blob: new Blob(["one"]) },
        { name: "frames/shot.png", blob: new Blob(["two"]) },
      ]),
    ).rejects.toThrow(/Duplicate image sequence filename/);
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
