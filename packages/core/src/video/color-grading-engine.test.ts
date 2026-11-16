import { describe, expect, it } from "vitest";
import { validateLUTData, type LUTData } from "./color-grading-engine";

const makeLut = (size = 2, intensity = 1): LUTData => ({
  size,
  intensity,
  data: new Uint8Array(size * size * size * 3),
});

describe("3D LUT validation", () => {
  it("accepts a correctly sized RGB LUT", () => {
    expect(validateLUTData(makeLut())).toEqual([]);
  });

  it("rejects sizes that cannot describe a 3D cube", () => {
    expect(validateLUTData({ ...makeLut(), size: 1 })).toContain(
      "LUT size must be an integer of at least 2.",
    );
    expect(validateLUTData({ ...makeLut(), size: 2.5 })).toContain(
      "LUT size must be an integer of at least 2.",
    );
  });

  it("rejects incomplete RGB cube data", () => {
    expect(
      validateLUTData({ ...makeLut(), data: new Uint8Array(10) }),
    ).toContain("LUT data must contain at least 24 RGB values.");
  });

  it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid intensity %s",
    (intensity) => {
      expect(validateLUTData(makeLut(2, intensity))).toContain(
        "LUT intensity must be between 0 and 1.",
      );
    },
  );

  it("accepts intensity endpoints", () => {
    expect(validateLUTData(makeLut(2, 0))).toEqual([]);
    expect(validateLUTData(makeLut(2, 1))).toEqual([]);
  });

  it("does not reject extra packed bytes after the required cube", () => {
    const lut = makeLut();
    lut.data = new Uint8Array(32);
    expect(validateLUTData(lut)).toEqual([]);
  });
});
