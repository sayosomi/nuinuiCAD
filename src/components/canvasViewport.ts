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

export const worldToScreen = (
  point: { x: number; y: number },
  size: ViewportSize,
  viewport: CanvasViewport
): ScreenPoint => ({
  x: size.width / 2 + viewport.panX + point.x * viewport.zoom,
  y: size.height / 2 + viewport.panY + point.y * viewport.zoom
});

export const visibleWorldBounds = (size: ViewportSize, viewport: CanvasViewport) => ({
  minX: (0 - size.width / 2 - viewport.panX) / viewport.zoom,
  maxX: (size.width - size.width / 2 - viewport.panX) / viewport.zoom,
  minY: (0 - size.height / 2 - viewport.panY) / viewport.zoom,
  maxY: (size.height - size.height / 2 - viewport.panY) / viewport.zoom
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

export const constrainedWorldDelta = ({
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
  dy: axisLockKeys.x ? 0 : screenDy / zoom
});
