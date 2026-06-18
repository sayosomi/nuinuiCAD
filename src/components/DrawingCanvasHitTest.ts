import type { ComputedLine, ComputedPoint, ElementId } from "../types/geometry";

export type ScreenPoint = {
  x: number;
  y: number;
};

const POINT_HIT_RADIUS_PX = 8;
const LINE_HIT_DISTANCE_PX = 6;

const squaredDistance = (a: ScreenPoint, b: ScreenPoint) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

const distanceToLineSegment = (point: ScreenPoint, start: ScreenPoint, end: ScreenPoint) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.sqrt(squaredDistance(point, start));

  const t = Math.min(
    Math.max(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0),
    1
  );
  const projection = {
    x: start.x + t * dx,
    y: start.y + t * dy
  };
  return Math.sqrt(squaredDistance(point, projection));
};

export const hitTestCanvasGeometry = ({
  screen,
  lines,
  points
}: {
  screen: ScreenPoint;
  lines: Array<{ line: ComputedLine; start: ScreenPoint; end: ScreenPoint }>;
  points: Array<{ point: ComputedPoint; screen: ScreenPoint }>;
}): ElementId | null => {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const item = points[index];
    if (squaredDistance(screen, item.screen) <= POINT_HIT_RADIUS_PX * POINT_HIT_RADIUS_PX) {
      return item.point.elementId;
    }
  }

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const item = lines[index];
    if (distanceToLineSegment(screen, item.start, item.end) <= LINE_HIT_DISTANCE_PX) {
      return item.line.elementId;
    }
  }

  return null;
};
