import { describe, expect, it } from "vitest";
import {
  DEFAULT_CANVAS_GRID_SETTINGS,
  normalizeCanvasGridSettings
} from "./canvasGrid";

describe("canvas grid settings", () => {
  it("provides the existing default grid behavior", () => {
    expect(DEFAULT_CANVAS_GRID_SETTINGS).toEqual({
      enabled: true,
      spacingMm: 10,
      majorEvery: 5
    });
    expect(normalizeCanvasGridSettings(undefined)).toEqual(DEFAULT_CANVAS_GRID_SETTINGS);
  });

  it("falls back independently for invalid runtime values", () => {
    expect(normalizeCanvasGridSettings({
      enabled: "yes",
      spacingMm: Number.NaN,
      majorEvery: 0
    })).toEqual(DEFAULT_CANVAS_GRID_SETTINGS);
    expect(normalizeCanvasGridSettings({
      enabled: false,
      spacingMm: 0,
      majorEvery: 2.5
    })).toEqual({ enabled: false, spacingMm: 10, majorEvery: 5 });
    expect(normalizeCanvasGridSettings({
      enabled: true,
      spacingMm: -1,
      majorEvery: -3
    })).toEqual(DEFAULT_CANVAS_GRID_SETTINGS);
    expect(normalizeCanvasGridSettings({
      enabled: false,
      spacingMm: Number.POSITIVE_INFINITY,
      majorEvery: Number.NaN
    })).toEqual({ enabled: false, spacingMm: 10, majorEvery: 5 });
  });

  it("preserves each valid setting while normalizing the rest", () => {
    expect(normalizeCanvasGridSettings({ enabled: false, spacingMm: 2.5, majorEvery: 1 })).toEqual({
      enabled: false,
      spacingMm: 2.5,
      majorEvery: 1
    });
  });
});
