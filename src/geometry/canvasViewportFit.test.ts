import { describe, expect, it } from "vitest";
import { MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM } from "../state/cadUiStore";
import { CANVAS_FIT_PADDING_PX, fitCanvasViewportToBounds } from "./canvasViewportFit";

const bounds = (minX: number, minY: number, maxX: number, maxY: number) => ({
  minX,
  minY,
  maxX,
  maxY
});

const size = { width: 400, height: 300 };

describe("fitCanvasViewportToBounds", () => {
  it("fits a normal 2D target with 32px edge padding and exact centering", () => {
    expect(fitCanvasViewportToBounds({
      bounds: bounds(0, 0, 100, 50),
      size,
      currentZoom: 1,
      paddingPx: CANVAS_FIT_PADDING_PX
    })).toEqual({ zoom: 3.36, panX: -168, panY: 84 });
  });

  it("recomputes fit and center even when the target was already visible", () => {
    const fitted = fitCanvasViewportToBounds({
      bounds: bounds(-10, -10, 10, 10),
      size,
      currentZoom: 1
    });

    expect(fitted?.zoom).toBeCloseTo(11.8);
    expect(fitted?.panX).toBeCloseTo(0);
    expect(fitted?.panY).toBeCloseTo(0);
  });

  it("fits a zero-width target from the non-zero height", () => {
    const fitted = fitCanvasViewportToBounds({
      bounds: bounds(10, 0, 10, 40),
      size,
      currentZoom: 1
    });

    expect(fitted?.zoom).toBeCloseTo(5.9);
    expect(fitted?.panX).toBeCloseTo(-59);
    expect(fitted?.panY).toBeCloseTo(118);
  });

  it("fits a zero-height target from the non-zero width", () => {
    const fitted = fitCanvasViewportToBounds({
      bounds: bounds(0, -10, 100, -10),
      size,
      currentZoom: 1
    });

    expect(fitted?.zoom).toBeCloseTo(3.36);
    expect(fitted?.panX).toBeCloseTo(-168);
    expect(fitted?.panY).toBeCloseTo(-33.6);
  });

  it("preserves zoom for a point-like target and centers it", () => {
    expect(fitCanvasViewportToBounds({
      bounds: bounds(12, -8, 12, -8),
      size,
      currentZoom: 7
    })).toEqual({ zoom: 7, panX: -84, panY: -56 });
  });

  it("preserves point-like current zoom even when a fit maximum is supplied", () => {
    expect(fitCanvasViewportToBounds({
      bounds: bounds(2, 3, 2, 3),
      size,
      currentZoom: 37,
      maxZoom: MAX_CANVAS_ZOOM
    })).toEqual({ zoom: 37, panX: -74, panY: 111 });
  });

  it("caps tiny targets at the supplied maximum zoom", () => {
    expect(fitCanvasViewportToBounds({
      bounds: bounds(0, 0, 1, 1),
      size,
      currentZoom: 1,
      maxZoom: MAX_CANVAS_ZOOM
    })).toEqual({ zoom: MAX_CANVAS_ZOOM, panX: -10, panY: 10 });
  });

  it("allows huge targets to fit below the normal interactive minimum zoom", () => {
    const fitted = fitCanvasViewportToBounds({
      bounds: bounds(-10_000, -10_000, 10_000, 10_000),
      size,
      currentZoom: 1,
      maxZoom: MAX_CANVAS_ZOOM
    });

    expect(fitted?.zoom).toBeCloseTo(0.0118);
    expect(fitted?.panX).toBeCloseTo(0);
    expect(fitted?.panY).toBeCloseTo(0);
    expect(fitted!.zoom).toBeLessThan(MIN_CANVAS_ZOOM);
  });

  it("keeps Fit Drawing-style uncapped fits above MAX_CANVAS_ZOOM", () => {
    const fitted = fitCanvasViewportToBounds({
      bounds: bounds(0, 0, 1, 1),
      size,
      currentZoom: 1
    });

    expect(fitted).toEqual({ zoom: 236, panX: -118, panY: 118 });
    expect(fitted!.zoom).toBeGreaterThan(MAX_CANVAS_ZOOM);
  });

  it.each([
    bounds(Number.NaN, 0, 1, 1),
    bounds(2, 0, 1, 1),
    bounds(-Number.MAX_VALUE, 0, Number.MAX_VALUE, 1)
  ])("fails closed for invalid or unsafe bounds", (target) => {
    expect(fitCanvasViewportToBounds({ bounds: target, size, currentZoom: 1 })).toBeNull();
  });

  it.each([
    { width: Number.NaN, height: 300 },
    { width: 64, height: 300 },
    { width: 400, height: 64 },
    { width: -1, height: 300 }
  ])("fails closed for invalid or unusable viewport dimensions", (viewportSize) => {
    expect(fitCanvasViewportToBounds({
      bounds: bounds(0, 0, 100, 50),
      size: viewportSize,
      currentZoom: 1
    })).toBeNull();
  });

  it("fails closed when point-like fitting would require a non-finite current zoom", () => {
    expect(fitCanvasViewportToBounds({
      bounds: bounds(1, 1, 1, 1),
      size,
      currentZoom: Number.POSITIVE_INFINITY
    })).toBeNull();
  });

  it("fails closed for an invalid supplied maximum zoom", () => {
    expect(fitCanvasViewportToBounds({
      bounds: bounds(0, 0, 1, 1),
      size,
      currentZoom: 1,
      maxZoom: Number.NaN
    })).toBeNull();
  });
});
