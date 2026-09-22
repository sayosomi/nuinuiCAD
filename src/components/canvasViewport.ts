import {
  screenToWorld,
  worldToScreen,
  type Viewport,
  type ViewportSize
} from "../geometry/viewport";

export type { ViewportSize } from "../geometry/viewport";

export type PointDragAxis = "horizontal" | "vertical";

export { screenToWorld, worldToScreen };

export const visibleWorldBounds = (size: ViewportSize, viewport: Viewport) => ({
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
