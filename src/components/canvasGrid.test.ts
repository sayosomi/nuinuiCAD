import { describe, expect, it } from "vitest";
import {
  DEFAULT_CANVAS_GRID_SETTINGS,
  normalizeCanvasGridSettings,
  snapWorldCoordinateToGrid,
  snapWorldPointToGrid
} from "./canvasGrid";

describe("canvas grid settings", () => {
  it("provides the existing default grid behavior", () => {
    expect(DEFAULT_CANVAS_GRID_SETTINGS).toEqual({
      enabled: true,
      spacingMm: 10,
      majorEvery: 5,
      snapEnabled: false
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
    })).toEqual({ enabled: false, spacingMm: 10, majorEvery: 5, snapEnabled: false });
    expect(normalizeCanvasGridSettings({
      enabled: true,
      spacingMm: -1,
      majorEvery: -3
    })).toEqual(DEFAULT_CANVAS_GRID_SETTINGS);
    expect(normalizeCanvasGridSettings({
      enabled: false,
      spacingMm: Number.POSITIVE_INFINITY,
      majorEvery: Number.NaN
    })).toEqual({ enabled: false, spacingMm: 10, majorEvery: 5, snapEnabled: false });
  });

  it("preserves each valid setting while normalizing the rest", () => {
    expect(normalizeCanvasGridSettings({ enabled: false, spacingMm: 2.5, majorEvery: 1, snapEnabled: true })).toEqual({
      enabled: false,
      spacingMm: 2.5,
      majorEvery: 1,
      snapEnabled: true
    });
  });

  it("snaps positive and negative coordinates with symmetric half-step ties", () => {
    expect(snapWorldCoordinateToGrid(4.9, 10)).toBe(0);
    expect(snapWorldCoordinateToGrid(5, 10)).toBe(10);
    expect(snapWorldCoordinateToGrid(15, 10)).toBe(20);
    expect(snapWorldCoordinateToGrid(-4.9, 10)).toBe(0);
    expect(snapWorldCoordinateToGrid(-5, 10)).toBe(-10);
    expect(snapWorldCoordinateToGrid(-15, 10)).toBe(-20);
    expect(snapWorldPointToGrid({ x: 14, y: -16 }, 10)).toEqual({ x: 10, y: -20 });
  });
});
