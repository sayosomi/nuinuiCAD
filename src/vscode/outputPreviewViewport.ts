import { fitCanvasViewportToBounds, CANVAS_FIT_PADDING_PX } from "../geometry/canvasViewportFit";
import {
  screenToWorld,
  worldToScreen,
  zoomViewportAt,
  type Viewport,
  type ViewportSize
} from "../geometry/viewport";
import { outputDrawableBounds, type OutputBounds, type OutputDrawable, type OutputPlan } from "../output/outputCore";
import { MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM } from "../state/cadUiStore";

export type OutputPreviewViewport = Viewport;

export type OutputPreviewViewportSize = ViewportSize;

export type OutputPreviewFitBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export const DEFAULT_OUTPUT_PREVIEW_VIEWPORT: OutputPreviewViewport = {
  panX: 0,
  panY: 0,
  zoom: 1
};

export const clampOutputPreviewZoom = (zoom: number): number =>
  Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, zoom));

export const outputPreviewWorldToScreen = worldToScreen;

export const outputPreviewScreenToWorld = screenToWorld;

export const resetOutputPreviewViewport = (): OutputPreviewViewport => ({
  ...DEFAULT_OUTPUT_PREVIEW_VIEWPORT
});

export const zoomOutputPreviewViewportAt = (
  viewport: OutputPreviewViewport,
  zoomFactor: number,
  anchor: { x: number; y: number; width: number; height: number }
): OutputPreviewViewport => {
  return zoomViewportAt(viewport, zoomFactor, anchor, clampOutputPreviewZoom);
};

export const outputPreviewFitBoundsFor = (plan: OutputPlan): OutputPreviewFitBounds | null => {
  if (plan.kind === "svg") {
    return {
      minX: plan.bounds.minX,
      minY: plan.bounds.minY,
      maxX: plan.bounds.maxX,
      maxY: plan.bounds.maxY
    };
  }
  const paper = plan.print;
  if (!paper || paper.pages.length === 0) return null;
  return paper.pages.reduce<OutputPreviewFitBounds | null>((bounds, page) => {
    const next = {
      minX: page.origin.x,
      minY: page.origin.y,
      maxX: page.origin.x + paper.paperWidthMm,
      maxY: page.origin.y + paper.paperHeightMm
    };
    if (!bounds) return next;
    return {
      minX: Math.min(bounds.minX, next.minX),
      minY: Math.min(bounds.minY, next.minY),
      maxX: Math.max(bounds.maxX, next.maxX),
      maxY: Math.max(bounds.maxY, next.maxY)
    };
  }, null);
};

export const fitOutputPreviewViewport = (
  bounds: OutputPreviewFitBounds | OutputBounds,
  size: OutputPreviewViewportSize,
  paddingPx = 32
): OutputPreviewViewport => {
  const availableWidth = size.width - paddingPx * 2;
  const availableHeight = size.height - paddingPx * 2;
  const worldWidth = bounds.maxX - bounds.minX;
  const worldHeight = bounds.maxY - bounds.minY;
  const ratios = [
    worldWidth > 0 ? availableWidth / worldWidth : null,
    worldHeight > 0 ? availableHeight / worldHeight : null
  ].filter((ratio): ratio is number => ratio !== null && Number.isFinite(ratio) && ratio > 0);
  const zoom = clampOutputPreviewZoom(ratios.length > 0 ? Math.min(...ratios) : 1);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return {
    zoom,
    panX: -centerX * zoom,
    panY: centerY * zoom
  };
};

const outputPreviewRevealBoundsFor = (
  drawables: readonly OutputDrawable[]
): OutputPreviewFitBounds | null => {
  if (drawables.length === 0) return null;

  let bounds: OutputPreviewFitBounds | null = null;
  for (const drawable of drawables) {
    const drawableBounds = outputDrawableBounds(drawable);
    if (
      ![
        drawableBounds.minX,
        drawableBounds.minY,
        drawableBounds.maxX,
        drawableBounds.maxY,
        drawableBounds.width,
        drawableBounds.height
      ].every(Number.isFinite) ||
      drawableBounds.minX > drawableBounds.maxX ||
      drawableBounds.minY > drawableBounds.maxY ||
      drawableBounds.width < 0 ||
      drawableBounds.height < 0
    ) return null;

    if (!bounds) {
      bounds = {
        minX: drawableBounds.minX,
        minY: drawableBounds.minY,
        maxX: drawableBounds.maxX,
        maxY: drawableBounds.maxY
      };
      continue;
    }
    bounds = {
      minX: Math.min(bounds.minX, drawableBounds.minX),
      minY: Math.min(bounds.minY, drawableBounds.minY),
      maxX: Math.max(bounds.maxX, drawableBounds.maxX),
      maxY: Math.max(bounds.maxY, drawableBounds.maxY)
    };
  }
  return bounds;
};

/** Fits every drawable occurrence selected by an explicit Output Preview Reveal. */
export const fitOutputPreviewRevealViewport = (
  drawables: readonly OutputDrawable[],
  size: OutputPreviewViewportSize,
  currentViewport: OutputPreviewViewport
): OutputPreviewViewport | null => {
  if (
    ![
      currentViewport.panX,
      currentViewport.panY,
      currentViewport.zoom
    ].every(Number.isFinite) ||
    currentViewport.zoom <= 0
  ) return null;

  const bounds = outputPreviewRevealBoundsFor(drawables);
  if (!bounds) return null;

  const fitted = fitCanvasViewportToBounds({
    bounds,
    size,
    currentZoom: currentViewport.zoom,
    paddingPx: CANVAS_FIT_PADDING_PX,
    maxZoom: MAX_CANVAS_ZOOM
  });
  const isPointLike = bounds.minX === bounds.maxX && bounds.minY === bounds.maxY;
  return isPointLike && fitted !== null && fitted.zoom !== currentViewport.zoom
    ? null
    : fitted;
};
