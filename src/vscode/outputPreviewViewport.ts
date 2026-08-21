import { MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM } from "../state/cadUiStore";
import type { OutputBounds, OutputPlan } from "../output/outputCore";

export type OutputPreviewViewport = {
  panX: number;
  panY: number;
  zoom: number;
};

export type OutputPreviewViewportSize = { width: number; height: number };

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

export const outputPreviewWorldToScreen = (
  point: { x: number; y: number },
  size: OutputPreviewViewportSize,
  viewport: OutputPreviewViewport
) => ({
  x: size.width / 2 + viewport.panX + point.x * viewport.zoom,
  y: size.height / 2 + viewport.panY - point.y * viewport.zoom
});

export const zoomOutputPreviewViewportAt = (
  viewport: OutputPreviewViewport,
  zoomFactor: number,
  anchor: { x: number; y: number; width: number; height: number }
): OutputPreviewViewport => {
  if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) return viewport;
  const world = {
    x: (anchor.x - anchor.width / 2 - viewport.panX) / viewport.zoom,
    y: (anchor.height / 2 + viewport.panY - anchor.y) / viewport.zoom
  };
  const zoom = clampOutputPreviewZoom(viewport.zoom * zoomFactor);
  return {
    zoom,
    panX: anchor.x - anchor.width / 2 - world.x * zoom,
    panY: anchor.y - anchor.height / 2 + world.y * zoom
  };
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
