import type { CanvasViewport } from "../state/cadUiStore";
import type { CanvasDrawingBounds } from "./canvasDrawingBounds";

export const CANVAS_FIT_PADDING_PX = 32;

export type CanvasViewportSize = {
  width: number;
  height: number;
};

export type CanvasViewportFitInput = {
  bounds: CanvasDrawingBounds;
  size: CanvasViewportSize;
  currentZoom: number;
  paddingPx?: number;
  maxZoom?: number;
};

const finitePositiveFitZoom = (
  candidateZoom: number,
  centerX: number,
  centerY: number
): number | null => {
  if (!(Number.isFinite(candidateZoom) && candidateZoom > 0)) return null;
  const maxZoomForFinitePan = Math.min(
    centerX === 0 ? Number.POSITIVE_INFINITY : Number.MAX_VALUE / Math.abs(centerX),
    centerY === 0 ? Number.POSITIVE_INFINITY : Number.MAX_VALUE / Math.abs(centerY)
  );
  const zoom = Math.min(candidateZoom, maxZoomForFinitePan);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : null;
};

/** Fits world-space bounds into a Canvas viewport and centers them. */
export const fitCanvasViewportToBounds = ({
  bounds,
  size,
  currentZoom,
  paddingPx = CANVAS_FIT_PADDING_PX,
  maxZoom
}: CanvasViewportFitInput): CanvasViewport | null => {
  if (
    ![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, size.width, size.height, paddingPx]
      .every(Number.isFinite) ||
    bounds.minX > bounds.maxX ||
    bounds.minY > bounds.maxY ||
    paddingPx < 0 ||
    (maxZoom !== undefined && !(Number.isFinite(maxZoom) && maxZoom > 0))
  ) return null;

  const availableWidth = size.width - paddingPx * 2;
  const availableHeight = size.height - paddingPx * 2;
  if (
    !Number.isFinite(availableWidth) ||
    !Number.isFinite(availableHeight) ||
    availableWidth <= 0 ||
    availableHeight <= 0
  ) return null;

  const targetWidth = bounds.maxX - bounds.minX;
  const targetHeight = bounds.maxY - bounds.minY;
  if (
    !Number.isFinite(targetWidth) ||
    !Number.isFinite(targetHeight) ||
    targetWidth < 0 ||
    targetHeight < 0
  ) return null;

  const candidateRatios = [
    targetWidth > 0 ? availableWidth / targetWidth : null,
    targetHeight > 0 ? availableHeight / targetHeight : null
  ].filter((ratio): ratio is number => ratio !== null);
  const hasFittableExtent = candidateRatios.length > 0;
  if (!hasFittableExtent && !(Number.isFinite(currentZoom) && currentZoom > 0)) return null;

  const rawCandidateZoom = hasFittableExtent
    ? Math.min(...candidateRatios)
    : currentZoom;
  const finiteCandidateZoom = hasFittableExtent && rawCandidateZoom === Number.POSITIVE_INFINITY
    ? Number.MAX_VALUE
    : rawCandidateZoom;
  const candidateZoom = maxZoom !== undefined && hasFittableExtent
    ? Math.min(finiteCandidateZoom, maxZoom)
    : finiteCandidateZoom;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return null;

  const zoom = finitePositiveFitZoom(candidateZoom, centerX, centerY);
  if (zoom === null) return null;

  const panX = -centerX * zoom;
  const panY = centerY * zoom;
  return Number.isFinite(panX) && Number.isFinite(panY)
    ? { panX, panY, zoom }
    : null;
};
