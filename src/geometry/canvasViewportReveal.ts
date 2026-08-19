import type { CanvasDrawingBounds } from "./canvasDrawingBounds";
import type { CanvasViewport } from "../state/cadUiStore";

export type CanvasViewportSize = { width: number; height: number };
export type CanvasPanDelta = { dx: number; dy: number };

/** Minimum screen-space pan needed to bring a world-space target into view. */
export const minimumCanvasPanForBounds = (
  bounds: CanvasDrawingBounds,
  viewport: CanvasViewport,
  size: CanvasViewportSize
): CanvasPanDelta | null => {
  if (
    ![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, viewport.zoom, viewport.panX, viewport.panY, size.width, size.height]
      .every(Number.isFinite) ||
    viewport.zoom <= 0 ||
    size.width < 0 ||
    size.height < 0 ||
    bounds.minX > bounds.maxX ||
    bounds.minY > bounds.maxY
  ) return null;

  const screenLeft = size.width / 2 + bounds.minX * viewport.zoom + viewport.panX;
  const screenRight = size.width / 2 + bounds.maxX * viewport.zoom + viewport.panX;
  const screenTop = size.height / 2 - bounds.maxY * viewport.zoom + viewport.panY;
  const screenBottom = size.height / 2 - bounds.minY * viewport.zoom + viewport.panY;
  if (![screenLeft, screenRight, screenTop, screenBottom].every(Number.isFinite)) return null;

  const dx = screenLeft < 0 ? -screenLeft : screenRight > size.width ? size.width - screenRight : 0;
  const dy = screenTop < 0 ? -screenTop : screenBottom > size.height ? size.height - screenBottom : 0;
  return Number.isFinite(dx) && Number.isFinite(dy) ? { dx, dy } : null;
};
