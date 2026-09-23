export type Viewport = {
  panX: number;
  panY: number;
  zoom: number;
};

export type ViewportSize = {
  width: number;
  height: number;
};

export type ViewportPoint = {
  x: number;
  y: number;
};

export type ViewportZoomAnchor = ViewportSize & ViewportPoint;

export type ViewportZoomNormalizer = (candidateZoom: number) => number | null;

export const VIEWPORT_ZOOM_STEP = 1.1;

export const worldToScreen = (
  point: ViewportPoint,
  size: ViewportSize,
  viewport: Viewport
): ViewportPoint => ({
  x: size.width / 2 + viewport.panX + point.x * viewport.zoom,
  y: size.height / 2 + viewport.panY - point.y * viewport.zoom
});

export const screenToWorld = (
  point: ViewportPoint,
  size: ViewportSize,
  viewport: Viewport
): ViewportPoint => ({
  x: (point.x - size.width / 2 - viewport.panX) / viewport.zoom,
  y: (size.height / 2 + viewport.panY - point.y) / viewport.zoom
});

export const panViewportByScreenDelta = (
  viewport: Viewport,
  screenDx: number,
  screenDy: number
): Viewport => ({
  ...viewport,
  panX: viewport.panX + screenDx,
  panY: viewport.panY + screenDy
});

export const zoomViewportAt = (
  viewport: Viewport,
  zoomFactor: number,
  anchor: ViewportZoomAnchor | undefined,
  normalizeZoom: ViewportZoomNormalizer
): Viewport => {
  if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) return viewport;

  const nextZoom = normalizeZoom(viewport.zoom * zoomFactor);
  if (nextZoom === null || nextZoom === viewport.zoom) return viewport;

  if (!anchor) {
    return {
      ...viewport,
      zoom: nextZoom
    };
  }

  const world = screenToWorld(anchor, anchor, viewport);
  const nextViewport = {
    zoom: nextZoom,
    panX: anchor.x - anchor.width / 2 - world.x * nextZoom,
    panY: anchor.y - anchor.height / 2 + world.y * nextZoom
  };
  return Number.isFinite(nextViewport.panX) && Number.isFinite(nextViewport.panY)
    ? nextViewport
    : viewport;
};
