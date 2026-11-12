import type { ScreenPoint } from "./DrawingCanvasHitTest";

export type CanvasDirectionArrowGeometry = {
  center: ScreenPoint;
  direction: ScreenPoint;
};

export const CANVAS_DIRECTION_ARROW_MIN_PATH_LENGTH_PX = 16;

/** Finds the path-length midpoint and the direction of its ordered local segment. */
export const canvasDirectionArrowGeometryForPath = (
  points: readonly ScreenPoint[]
): CanvasDirectionArrowGeometry | null => {
  if (points.length < 2 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return null;
  }

  const segments: Array<{ start: ScreenPoint; end: ScreenPoint; length: number }> = [];
  let totalLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!;
    const end = points[index]!;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (!Number.isFinite(length)) return null;
    if (length === 0) continue;
    totalLength += length;
    if (!Number.isFinite(totalLength)) return null;
    segments.push({ start, end, length });
  }

  if (totalLength < CANVAS_DIRECTION_ARROW_MIN_PATH_LENGTH_PX) return null;

  const midpointDistance = totalLength / 2;
  let traversed = 0;
  for (const segment of segments) {
    if (traversed + segment.length >= midpointDistance) {
      const ratio = (midpointDistance - traversed) / segment.length;
      return {
        center: {
          x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
          y: segment.start.y + (segment.end.y - segment.start.y) * ratio
        },
        direction: {
          x: (segment.end.x - segment.start.x) / segment.length,
          y: (segment.end.y - segment.start.y) / segment.length
        }
      };
    }
    traversed += segment.length;
  }

  return null;
};
