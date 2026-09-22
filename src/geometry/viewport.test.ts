import { describe, expect, it } from "vitest";
import {
  panViewportByScreenDelta,
  screenToWorld,
  worldToScreen,
  zoomViewportAt
} from "./viewport";

describe("viewport geometry", () => {
  const viewport = { panX: 35, panY: -18, zoom: 2.5 };
  const size = { width: 800, height: 600 };

  it("round-trips representative world coordinates", () => {
    const worldPoint = { x: 12.4, y: -27.8 };
    const screenPoint = worldToScreen(worldPoint, size, viewport);

    expect(screenToWorld(screenPoint, size, viewport)).toEqual({
      x: expect.closeTo(worldPoint.x),
      y: expect.closeTo(worldPoint.y)
    });
  });

  it("maps positive world Y upward on screen", () => {
    expect(worldToScreen({ x: 0, y: 10 }, size, { panX: 0, panY: 0, zoom: 1 }).y).toBe(290);
  });

  it("keeps the world point under an anchor fixed while zooming", () => {
    const anchor = { x: 100, y: 80, width: 500, height: 300 };
    const initial = { panX: 0, panY: 0, zoom: 1 };
    const worldAtAnchor = screenToWorld(anchor, anchor, initial);
    const zoomed = zoomViewportAt(initial, 2, anchor, (candidateZoom) => candidateZoom);

    expect(zoomed).toEqual({ panX: 150, panY: 70, zoom: 2 });
    expect(worldToScreen(worldAtAnchor, anchor, zoomed)).toEqual({ x: anchor.x, y: anchor.y });
  });

  it("applies screen pan deltas without changing zoom", () => {
    expect(panViewportByScreenDelta(viewport, 14, -9)).toEqual({
      panX: 49,
      panY: -27,
      zoom: 2.5
    });
  });

  it("leaves zoom policy decisions to the supplied normalizer", () => {
    const initial = { panX: 0, panY: 0, zoom: 1 };
    const normalizeCanvasZoom = (candidateZoom: number) =>
      Number.isFinite(candidateZoom) && candidateZoom > 0 ? candidateZoom : null;
    const normalizeOutputPreviewZoom = (candidateZoom: number) =>
      Math.min(20, Math.max(0.1, candidateZoom));

    expect(zoomViewportAt(initial, 100, undefined, normalizeCanvasZoom).zoom).toBe(100);
    expect(zoomViewportAt(initial, 100, undefined, normalizeOutputPreviewZoom).zoom).toBe(20);
  });
});
