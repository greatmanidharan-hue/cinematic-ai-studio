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

  it("rejects duplicate filenames", async () => {
    await expect(
      createImageSequenceZip([
        { name: "frame.png", blob: new Blob(["one"]) },
        { name: "frame.png", blob: new Blob(["two"]) },
      ]),
    ).rejects.toThrow(/Duplicate image sequence filename/);
  });
});
