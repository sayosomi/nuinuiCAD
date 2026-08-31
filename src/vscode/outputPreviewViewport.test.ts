import { describe, expect, it } from "vitest";
import type { OutputDrawable, OutputPlan } from "../output/outputCore";
import {
  DEFAULT_OUTPUT_PREVIEW_VIEWPORT,
  clampOutputPreviewZoom,
  fitOutputPreviewViewport,
  fitOutputPreviewRevealViewport,
  outputPreviewFitBoundsFor,
  outputPreviewScreenToWorld,
  outputPreviewWorldToScreen,
  resetOutputPreviewViewport,
  zoomOutputPreviewViewportAt
} from "./outputPreviewViewport";

const printPlan = {
  kind: "print",
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10, width: 10, height: 10 },
  print: {
    paperWidthMm: 210,
    paperHeightMm: 297,
    pages: [
      { index: 0, column: 0, row: 0, origin: { x: 0, y: 0 }, guides: [] },
      { index: 1, column: 1, row: 0, origin: { x: 200, y: 0 }, guides: [] }
    ]
  }
} as unknown as OutputPlan;

const lineDrawable = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  elementId = "line"
): OutputDrawable => ({
  kind: "line",
  elementId,
  name: elementId,
  start,
  end,
  stroke: { widthMm: 0, style: "solid", colorHex: "#000000" }
});

describe("Output Preview viewport", () => {
  it("keeps the default viewport stable and inverts its Y-up transform", () => {
    expect(DEFAULT_OUTPUT_PREVIEW_VIEWPORT).toEqual({ panX: 0, panY: 0, zoom: 1 });
    expect(resetOutputPreviewViewport()).toEqual(DEFAULT_OUTPUT_PREVIEW_VIEWPORT);

    const size = { width: 800, height: 600 };
    const viewport = { panX: 35, panY: -18, zoom: 2.5 };
    const worldPoint = { x: 12.4, y: -27.8 };
    const screenPoint = outputPreviewWorldToScreen(worldPoint, size, viewport);

    expect(outputPreviewScreenToWorld(screenPoint, size, viewport)).toEqual({
      x: expect.closeTo(worldPoint.x),
      y: expect.closeTo(worldPoint.y)
    });
    expect(outputPreviewWorldToScreen({ x: 0, y: 10 }, size, { panX: 0, panY: 0, zoom: 1 }).y).toBe(290);
    expect(outputPreviewScreenToWorld({ x: 400, y: 290 }, size, { panX: 0, panY: 0, zoom: 1 })).toEqual({ x: 0, y: 10 });
  });

  it("fits the physical page union and centers it in the viewport", () => {
    const bounds = outputPreviewFitBoundsFor(printPlan)!;
    const viewport = fitOutputPreviewViewport(bounds, { width: 1000, height: 800 });

    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 410, maxY: 297 });
    expect(viewport.panX).toBeCloseTo(-205 * viewport.zoom);
    expect(viewport.panY).toBeCloseTo(148.5 * viewport.zoom);
  });

  it("keeps the wheel anchor fixed and clamps zoom to the shared safe limits", () => {
    const initial = { panX: 0, panY: 0, zoom: 1 };
    const zoomed = zoomOutputPreviewViewportAt(initial, 2, { x: 100, y: 80, width: 500, height: 300 });

    expect(zoomed.zoom).toBe(2);
    expect(zoomed.panX).toBe(150);
    expect(zoomed.panY).toBe(70);
    expect(clampOutputPreviewZoom(0)).toBe(0.1);
    expect(clampOutputPreviewZoom(100)).toBe(20);
  });

  it("fits ordinary Reveal geometry with 32px edge padding and centers it", () => {
    expect(fitOutputPreviewRevealViewport(
      [lineDrawable({ x: 0, y: 0 }, { x: 100, y: 50 })],
      { width: 400, height: 300 },
      { panX: 12, panY: -8, zoom: 1 }
    )).toEqual({ zoom: 3.36, panX: -168, panY: 84 });
  });

  it("includes every repeated highlighted occurrence in the Reveal target bounds", () => {
    const fitted = fitOutputPreviewRevealViewport(
      [
        lineDrawable({ x: 0, y: 0 }, { x: 100, y: 0 }, "repeated"),
        lineDrawable({ x: 200, y: 10 }, { x: 300, y: 60 }, "repeated")
      ],
      { width: 400, height: 300 },
      DEFAULT_OUTPUT_PREVIEW_VIEWPORT
    );
    expect(fitted?.zoom).toBeCloseTo(1.12);
    expect(fitted?.panX).toBeCloseTo(-168);
    expect(fitted?.panY).toBeCloseTo(33.6);
  });

  it("uses the non-zero target extent when the other axis is zero", () => {
    expect(fitOutputPreviewRevealViewport(
      [lineDrawable({ x: 10, y: 0 }, { x: 10, y: 40 })],
      { width: 400, height: 300 },
      DEFAULT_OUTPUT_PREVIEW_VIEWPORT
    )).toEqual({ zoom: 5.9, panX: -59, panY: 118 });
    expect(fitOutputPreviewRevealViewport(
      [lineDrawable({ x: 0, y: -10 }, { x: 100, y: -10 })],
      { width: 400, height: 300 },
      DEFAULT_OUTPUT_PREVIEW_VIEWPORT
    )).toEqual({ zoom: 3.36, panX: -168, panY: -33.6 });
  });

  it("preserves the current zoom and centers a point-like Reveal target", () => {
    expect(fitOutputPreviewRevealViewport(
      [lineDrawable({ x: 12, y: -8 }, { x: 12, y: -8 })],
      { width: 400, height: 300 },
      { panX: 17, panY: -9, zoom: 7 }
    )).toEqual({ zoom: 7, panX: -84, panY: -56 });
  });

  it("caps tiny targets at the shared maximum zoom", () => {
    expect(fitOutputPreviewRevealViewport(
      [lineDrawable({ x: 0, y: 0 }, { x: 1, y: 1 })],
      { width: 400, height: 300 },
      DEFAULT_OUTPUT_PREVIEW_VIEWPORT
    )).toEqual({ zoom: 20, panX: -10, panY: 10 });
  });

  it("allows very large Reveal targets to fit below the interactive minimum", () => {
    const fitted = fitOutputPreviewRevealViewport(
      [lineDrawable({ x: -10_000, y: -10_000 }, { x: 10_000, y: 10_000 })],
      { width: 400, height: 300 },
      DEFAULT_OUTPUT_PREVIEW_VIEWPORT
    );

    expect(fitted?.zoom).toBeCloseTo(0.0118);
    expect(fitted?.panX).toBeCloseTo(0);
    expect(fitted?.panY).toBeCloseTo(0);
  });

  it.each([
    {
      drawables: [lineDrawable({ x: Number.NaN, y: 0 }, { x: 1, y: 1 })],
      size: { width: 400, height: 300 },
      viewport: DEFAULT_OUTPUT_PREVIEW_VIEWPORT
    },
    {
      drawables: [lineDrawable({ x: 0, y: 0 }, { x: 1, y: 1 })],
      size: { width: 64, height: 300 },
      viewport: DEFAULT_OUTPUT_PREVIEW_VIEWPORT
    },
    {
      drawables: [lineDrawable({ x: 0, y: 0 }, { x: 1, y: 1 })],
      size: { width: 400, height: 300 },
      viewport: { panX: Number.POSITIVE_INFINITY, panY: 0, zoom: 1 }
    },
    {
      drawables: [lineDrawable({ x: Number.MAX_VALUE, y: 0 }, { x: Number.MAX_VALUE, y: 0 })],
      size: { width: 400, height: 300 },
      viewport: { panX: 0, panY: 0, zoom: 2 }
    }
  ])("leaves the viewport unchanged when Reveal fit inputs are unsafe", ({ drawables, size, viewport }) => {
    expect(fitOutputPreviewRevealViewport(drawables, size, viewport)).toBeNull();
  });
});
