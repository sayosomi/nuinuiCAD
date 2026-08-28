import { describe, expect, it } from "vitest";
import type { OutputPlan } from "../output/outputCore";
import {
  DEFAULT_OUTPUT_PREVIEW_VIEWPORT,
  clampOutputPreviewZoom,
  fitOutputPreviewViewport,
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
});
