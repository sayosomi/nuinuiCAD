import type { ElementId } from "../types/geometry";
import { textHitBounds, type ScreenPoint } from "./DrawingCanvasHitTest";

export type ScreenSelectionRectangle = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type CanvasRectangleMembershipMode = "window" | "crossing";

type GeometryIdentity = { elementId: ElementId };

export type CanvasRectangleMembershipInput = {
  rectangle: ScreenSelectionRectangle;
  mode: CanvasRectangleMembershipMode;
  lines?: ReadonlyArray<{ line: GeometryIdentity; start: ScreenPoint; end: ScreenPoint }>;
  arcs?: ReadonlyArray<{ arc: GeometryIdentity; points: readonly ScreenPoint[] }>;
  curves?: ReadonlyArray<{ curve: GeometryIdentity; points: readonly ScreenPoint[] }>;
  offsetLines?: ReadonlyArray<{ line: GeometryIdentity; points: readonly ScreenPoint[] }>;
  polylines?: ReadonlyArray<{ polyline: GeometryIdentity; points: readonly ScreenPoint[] }>;
  images?: ReadonlyArray<{ image: GeometryIdentity; corners: readonly ScreenPoint[] }>;
  texts?: ReadonlyArray<{
    text: GeometryIdentity & { text: string };
    screen: ScreenPoint;
    fontSizePx: number;
  }>;
  points?: ReadonlyArray<{ point: GeometryIdentity; screen: ScreenPoint }>;
};

const EPSILON = 1e-9;

const normalizedRectangle = (rectangle: ScreenSelectionRectangle): ScreenSelectionRectangle => ({
  left: Math.min(rectangle.left, rectangle.right),
  top: Math.min(rectangle.top, rectangle.bottom),
  right: Math.max(rectangle.left, rectangle.right),
  bottom: Math.max(rectangle.top, rectangle.bottom)
});

export const screenSelectionRectangleBetween = (
  start: ScreenPoint,
  end: ScreenPoint
): ScreenSelectionRectangle => normalizedRectangle({
  left: start.x,
  top: start.y,
  right: end.x,
  bottom: end.y
});

const pointInsideRectangle = (point: ScreenPoint, rectangle: ScreenSelectionRectangle): boolean =>
  point.x >= rectangle.left - EPSILON &&
  point.x <= rectangle.right + EPSILON &&
  point.y >= rectangle.top - EPSILON &&
  point.y <= rectangle.bottom + EPSILON;

const cross = (a: ScreenPoint, b: ScreenPoint, c: ScreenPoint): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const pointOnSegment = (point: ScreenPoint, start: ScreenPoint, end: ScreenPoint): boolean =>
  Math.abs(cross(start, end, point)) <= EPSILON &&
  point.x >= Math.min(start.x, end.x) - EPSILON &&
  point.x <= Math.max(start.x, end.x) + EPSILON &&
  point.y >= Math.min(start.y, end.y) - EPSILON &&
  point.y <= Math.max(start.y, end.y) + EPSILON;

const segmentsIntersectInclusive = (
  aStart: ScreenPoint,
  aEnd: ScreenPoint,
  bStart: ScreenPoint,
  bEnd: ScreenPoint
): boolean => {
  const abStart = cross(aStart, aEnd, bStart);
  const abEnd = cross(aStart, aEnd, bEnd);
  const baStart = cross(bStart, bEnd, aStart);
  const baEnd = cross(bStart, bEnd, aEnd);

  if (Math.abs(abStart) <= EPSILON && pointOnSegment(bStart, aStart, aEnd)) return true;
  if (Math.abs(abEnd) <= EPSILON && pointOnSegment(bEnd, aStart, aEnd)) return true;
  if (Math.abs(baStart) <= EPSILON && pointOnSegment(aStart, bStart, bEnd)) return true;
  if (Math.abs(baEnd) <= EPSILON && pointOnSegment(aEnd, bStart, bEnd)) return true;

  return (
    ((abStart > EPSILON && abEnd < -EPSILON) || (abStart < -EPSILON && abEnd > EPSILON)) &&
    ((baStart > EPSILON && baEnd < -EPSILON) || (baStart < -EPSILON && baEnd > EPSILON))
  );
};

const rectangleCorners = (rectangle: ScreenSelectionRectangle): readonly ScreenPoint[] => [
  { x: rectangle.left, y: rectangle.top },
  { x: rectangle.right, y: rectangle.top },
  { x: rectangle.right, y: rectangle.bottom },
  { x: rectangle.left, y: rectangle.bottom }
];

const rectangleEdges = (rectangle: ScreenSelectionRectangle) => {
  const corners = rectangleCorners(rectangle);
  return corners.map((start, index) => ({
    start,
    end: corners[(index + 1) % corners.length]!
  }));
};

const segmentIntersectsRectangle = (
  start: ScreenPoint,
  end: ScreenPoint,
  rectangle: ScreenSelectionRectangle
): boolean =>
  pointInsideRectangle(start, rectangle) ||
  pointInsideRectangle(end, rectangle) ||
  rectangleEdges(rectangle).some((edge) =>
    segmentsIntersectInclusive(start, end, edge.start, edge.end)
  );

const polylineMatches = (
  points: readonly ScreenPoint[],
  rectangle: ScreenSelectionRectangle,
  mode: CanvasRectangleMembershipMode
): boolean => {
  if (points.length === 0) return false;
  if (mode === "window") return points.every((point) => pointInsideRectangle(point, rectangle));
  if (points.some((point) => pointInsideRectangle(point, rectangle))) return true;
  for (let index = 1; index < points.length; index += 1) {
    if (segmentIntersectsRectangle(points[index - 1]!, points[index]!, rectangle)) return true;
  }
  return false;
};

const pointInsidePolygonInclusive = (point: ScreenPoint, polygon: readonly ScreenPoint[]): boolean => {
  if (polygon.length < 3) return false;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]!;
    const end = polygon[(index + 1) % polygon.length]!;
    if (pointOnSegment(point, start, end)) return true;
  }

  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentPoint = polygon[index]!;
    const previousPoint = polygon[previous]!;
    const crossesScanline = currentPoint.y > point.y !== previousPoint.y > point.y;
    if (!crossesScanline) continue;
    const xAtScanline =
      ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
        (previousPoint.y - currentPoint.y) +
      currentPoint.x;
    if (point.x < xAtScanline) inside = !inside;
  }
  return inside;
};

const polygonMatches = (
  polygon: readonly ScreenPoint[],
  rectangle: ScreenSelectionRectangle,
  mode: CanvasRectangleMembershipMode
): boolean => {
  if (polygon.length === 0) return false;
  if (mode === "window") return polygon.every((point) => pointInsideRectangle(point, rectangle));
  if (polygon.some((point) => pointInsideRectangle(point, rectangle))) return true;
  if (rectangleCorners(rectangle).some((point) => pointInsidePolygonInclusive(point, polygon))) return true;

  const edges = rectangleEdges(rectangle);
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]!;
    const end = polygon[(index + 1) % polygon.length]!;
    if (edges.some((edge) => segmentsIntersectInclusive(start, end, edge.start, edge.end))) return true;
  }
  return false;
};

const rectangleContainsRectangle = (
  outer: ScreenSelectionRectangle,
  inner: ScreenSelectionRectangle
): boolean =>
  inner.left >= outer.left - EPSILON &&
  inner.right <= outer.right + EPSILON &&
  inner.top >= outer.top - EPSILON &&
  inner.bottom <= outer.bottom + EPSILON;

const rectanglesIntersectInclusive = (
  a: ScreenSelectionRectangle,
  b: ScreenSelectionRectangle
): boolean =>
  a.left <= b.right + EPSILON &&
  a.right >= b.left - EPSILON &&
  a.top <= b.bottom + EPSILON &&
  a.bottom >= b.top - EPSILON;

export const canvasRectangleMemberIds = ({
  rectangle: inputRectangle,
  mode,
  lines = [],
  arcs = [],
  curves = [],
  offsetLines = [],
  polylines = [],
  images = [],
  texts = [],
  points = []
}: CanvasRectangleMembershipInput): ElementId[] => {
  const rectangle = normalizedRectangle(inputRectangle);
  const matches = new Set<ElementId>();
  const addIf = (elementId: ElementId, matched: boolean) => {
    if (matched) matches.add(elementId);
  };

  for (const { image, corners } of images) {
    addIf(image.elementId, polygonMatches(corners, rectangle, mode));
  }
  for (const { line, start, end } of lines) {
    addIf(line.elementId, polylineMatches([start, end], rectangle, mode));
  }
  for (const { arc, points: sampledPoints } of arcs) {
    addIf(arc.elementId, polylineMatches(sampledPoints, rectangle, mode));
  }
  for (const { curve, points: sampledPoints } of curves) {
    addIf(curve.elementId, polylineMatches(sampledPoints, rectangle, mode));
  }
  for (const { line, points: sampledPoints } of offsetLines) {
    addIf(line.elementId, polylineMatches(sampledPoints, rectangle, mode));
  }
  for (const { polyline, points: sampledPoints } of polylines) {
    addIf(polyline.elementId, polylineMatches(sampledPoints, rectangle, mode));
  }
  for (const { text, screen, fontSizePx } of texts) {
    const bounds = textHitBounds({ text: text.text, screen, fontSizePx });
    const textRectangle = normalizedRectangle({
      left: bounds.left,
      top: bounds.top,
      right: bounds.left + bounds.width,
      bottom: bounds.top + bounds.height
    });
    addIf(
      text.elementId,
      mode === "window"
        ? rectangleContainsRectangle(rectangle, textRectangle)
        : rectanglesIntersectInclusive(rectangle, textRectangle)
    );
  }
  for (const { point, screen } of points) {
    addIf(point.elementId, pointInsideRectangle(screen, rectangle));
  }

  return [...matches];
};
