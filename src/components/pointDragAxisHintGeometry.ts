import type { ScreenPoint } from "./DrawingCanvasHitTest";
import type { AxisLockKeys, ViewportSize } from "./canvasViewport";

export type PointDragAxisLockFeedbackState = {
  cursor: ScreenPoint;
  origin: ScreenPoint;
  axisLockKeys: AxisLockKeys;
};

export const POINT_DRAG_AXIS_HINT_SIZE = {
  width: 118,
  height: 28
} as const;

const POINT_DRAG_AXIS_HINT_OFFSET_PX = 10;

type PointDragAxisHintPositionInput = {
  cursor: ScreenPoint;
  viewportSize: ViewportSize;
  hintSize?: typeof POINT_DRAG_AXIS_HINT_SIZE;
  offsetPx?: number;
};

export const pointDragAxisHintPosition = ({
  cursor,
  viewportSize,
  hintSize = POINT_DRAG_AXIS_HINT_SIZE,
  offsetPx = POINT_DRAG_AXIS_HINT_OFFSET_PX
}: PointDragAxisHintPositionInput): ScreenPoint => {
  const right = cursor.x + offsetPx;
  const left = cursor.x - offsetPx - hintSize.width;
  const bottom = cursor.y + offsetPx;
  const top = cursor.y - offsetPx - hintSize.height;
  const maxX = Math.max(viewportSize.width - hintSize.width, 0);
  const maxY = Math.max(viewportSize.height - hintSize.height, 0);
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);

  return {
    x: clamp(right + hintSize.width <= viewportSize.width ? right : left, maxX),
    y: clamp(bottom + hintSize.height <= viewportSize.height ? bottom : top, maxY)
  };
};
