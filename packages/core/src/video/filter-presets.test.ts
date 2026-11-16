import { describe, expect, it } from "vitest";
import {
  FILTER_CATEGORIES,
  FILTER_PRESETS,
  getAllCategories,
  getAllPresets,
  getPresetById,
  getPresetsByCategory,
} from "./filter-presets";

describe("cinematic filter presets", () => {
  it("keeps preset identifiers unique and non-empty", () => {
    const ids = FILTER_PRESETS.map((preset) => preset.id);
    expect(ids.every((id) => id.trim().length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("provides valid category metadata for every preset", () => {
    const categoryIds = new Set(FILTER_CATEGORIES.map((category) => category.id));
    for (const preset of FILTER_PRESETS) {
      expect(categoryIds.has(preset.category)).toBe(true);
      expect(preset.name.trim().length).toBeGreaterThan(0);
      expect(preset.description.trim().length).toBeGreaterThan(0);
      expect(preset.effects.length).toBeGreaterThan(0);
    }
  });

  it("contains only finite numeric effect parameters", () => {
    const visit = (value: unknown, path: string): void => {
      if (typeof value === "number") {
        expect(Number.isFinite(value), path).toBe(true);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, `${path}[${index}]`));
        return;
      }
      if (value && typeof value === "object") {
        Object.entries(value).forEach(([key, item]) =>
          visit(item, `${path}.${key}`),
        );
      }
    };

    for (const preset of FILTER_PRESETS) {
      preset.effects.forEach((effect, index) =>
        visit(effect.params, `${preset.id}.effects[${index}]`),
      );
    }
  });

  it("returns matching presets from category and id lookups", () => {
    for (const category of FILTER_CATEGORIES) {
      expect(
        getPresetsByCategory(category.id).every(
          (preset) => preset.category === category.id,
        ),
      ).toBe(true);
    }

    for (const preset of FILTER_PRESETS) {
      expect(getPresetById(preset.id)).toBe(preset);
    }
    expect(getPresetById("missing-preset")).toBeUndefined();
  });

  it("exposes the same registered preset and category collections", () => {
    expect(getAllPresets()).toBe(FILTER_PRESETS);
    expect(getAllCategories()).toBe(FILTER_CATEGORIES);
  });
});
