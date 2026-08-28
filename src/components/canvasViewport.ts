import type { CanvasViewport } from "../state/cadUiStore";
import type { ScreenPoint } from "./DrawingCanvasHitTest";

export type ViewportSize = {
  width: number;
  height: number;
};

export type AxisLockKeys = {
  x: boolean;
  y: boolean;
};

export type PointDragAxis = "horizontal" | "vertical";

export const worldToScreen = (
  point: { x: number; y: number },
  size: ViewportSize,
  viewport: CanvasViewport
): ScreenPoint => ({
  x: size.width / 2 + viewport.panX + point.x * viewport.zoom,
  y: size.height / 2 + viewport.panY - point.y * viewport.zoom
});

export const screenToWorld = (
  point: ScreenPoint,
  size: ViewportSize,
  viewport: CanvasViewport
): ScreenPoint => ({
  x: (point.x - size.width / 2 - viewport.panX) / viewport.zoom,
  y: (size.height / 2 + viewport.panY - point.y) / viewport.zoom
});

export const visibleWorldBounds = (size: ViewportSize, viewport: CanvasViewport) => ({
  minX: (0 - size.width / 2 - viewport.panX) / viewport.zoom,
  maxX: (size.width - size.width / 2 - viewport.panX) / viewport.zoom,
  minY: (size.height / 2 + viewport.panY - size.height) / viewport.zoom,
  maxY: (size.height / 2 + viewport.panY) / viewport.zoom
});

export const visibleGridStep = (
  zoom: number,
  {
    gridStep,
    majorGridMultiplier,
    minGridSpacingPx
  }: {
    gridStep: number;
    majorGridMultiplier: number;
    minGridSpacingPx: number;
  }
) => {
  let step = gridStep;
  while (step * zoom < minGridSpacingPx) {
    step *= majorGridMultiplier;
  }
  return step;
};

export const pointDragAxisForScreenDelta = ({
  screenDx,
  screenDy,
  shiftKey
}: {
  screenDx: number;
  screenDy: number;
  shiftKey: boolean;
}): PointDragAxis | null => {
  if (!shiftKey) return null;
  return Math.abs(screenDx) >= Math.abs(screenDy) ? "horizontal" : "vertical";
};

export const constrainedWorldDelta = ({
  screenDx,
  screenDy,
  zoom,
  shiftKey
}: {
  screenDx: number;
  screenDy: number;
  zoom: number;
  shiftKey: boolean;
}) => {
  const axis = pointDragAxisForScreenDelta({ screenDx, screenDy, shiftKey });
  return {
    dx: axis === "vertical" ? 0 : screenDx / zoom,
    dy: axis === "horizontal" ? 0 : -screenDy / zoom
  };
};

/** Preserves X/Y axis-lock semantics for Output Preview placement. */
export const axisLockedWorldDelta = ({
  screenDx,
  screenDy,
  zoom,
  axisLockKeys
}: {
  screenDx: number;
  screenDy: number;
  zoom: number;
  axisLockKeys: AxisLockKeys;
}) => ({
  dx: axisLockKeys.y && !axisLockKeys.x ? 0 : screenDx / zoom,
  dy: axisLockKeys.x ? 0 : -screenDy / zoom
});
