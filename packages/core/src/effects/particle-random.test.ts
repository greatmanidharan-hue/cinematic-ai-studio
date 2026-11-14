import { describe, expect, it } from "vitest";
import { createSeededRandom } from "./particle-random";

describe("createSeededRandom", () => {
  it("returns the same sequence for the same seed", () => {
    const first = createSeededRandom("effect-fire-trail");
    const second = createSeededRandom("effect-fire-trail");

    expect(Array.from({ length: 8 }, first)).toEqual(
      Array.from({ length: 8 }, second)
    );
  });

  it("produces different sequences for different seeds", () => {
    const first = createSeededRandom("effect-a");
    const second = createSeededRandom("effect-b");

    expect(Array.from({ length: 5 }, first)).not.toEqual(
      Array.from({ length: 5 }, second)
    );
  });

  it("keeps generated values in the half-open interval [0, 1)", () => {
    const random = createSeededRandom("range-check");
    const values = Array.from({ length: 1000 }, random);

    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
  });
});
