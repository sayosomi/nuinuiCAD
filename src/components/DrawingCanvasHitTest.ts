import type {
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedLine,
  ComputedOffsetLine,
  ComputedPoint,
  ElementId
} from "../types/geometry";
import type { NumericMeasurementKey } from "../geometry/numericExpressions";

export type ScreenPoint = {
  x: number;
  y: number;
};

const POINT_HIT_RADIUS_PX = 8;
const LINE_HIT_DISTANCE_PX = 6;
const LINE_ENDPOINT_MEASUREMENT_RADIUS_PX = 12;
const CURVE_HIT_STEPS = 32;
const ARC_HIT_STEPS = 32;

type BezierLikeSegment = {
  start: ScreenPoint;
  control1: ScreenPoint;
  control2: ScreenPoint;
  end: ScreenPoint;
};

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

const cubicPointAt = (segment: BezierLikeSegment, t: number): ScreenPoint => {
  const inverse = 1 - t;
  const a = inverse * inverse * inverse;
  const b = 3 * inverse * inverse * t;
  const c = 3 * inverse * t * t;
  const d = t * t * t;

  return {
    x:
      a * segment.start.x +
      b * segment.control1.x +
      c * segment.control2.x +
      d * segment.end.x,
    y:
      a * segment.start.y +
      b * segment.control1.y +
      c * segment.control2.y +
      d * segment.end.y
  };
};

export const sampleBezierCurveScreenPoints = (
  curve: ComputedBezierCurve,
  worldToScreen: (point: ScreenPoint) => ScreenPoint
) =>
  curve.segments.flatMap((segment) =>
    Array.from({ length: CURVE_HIT_STEPS + 1 }, (_, index) =>
      worldToScreen(cubicPointAt(segment, index / CURVE_HIT_STEPS))
    )
  );

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;

export const sampleArcLineScreenPoints = (
  arc: ComputedArcLine,
  worldToScreen: (point: ScreenPoint) => ScreenPoint
) => {
  const radius = arc.radius > 0 ? arc.radius : 0;
  const stepCount = Math.max(1, Math.ceil((Math.abs(arc.sweepAngleDeg) / 360) * ARC_HIT_STEPS));
  return Array.from({ length: stepCount + 1 }, (_, index) => {
    const angleDeg = arc.startAngleDeg + (arc.sweepAngleDeg * index) / stepCount;
    const angleRad = degreesToRadians(angleDeg);
    return worldToScreen({
      x: arc.center.x + Math.cos(angleRad) * radius,
      y: arc.center.y + Math.sin(angleRad) * radius
    });
  });
};

export const sampleOffsetLineScreenPoints = (
  line: ComputedOffsetLine,
  worldToScreen: (point: ScreenPoint) => ScreenPoint
) =>
  line.segments.flatMap((segment) => {
    if (segment.kind === "line") {
      return [worldToScreen(segment.start), worldToScreen(segment.end)];
    }
    if (segment.kind === "bezier") {
      return Array.from({ length: CURVE_HIT_STEPS + 1 }, (_, index) =>
        worldToScreen(cubicPointAt(segment, index / CURVE_HIT_STEPS))
      );
    }
    const stepCount = Math.max(1, Math.ceil((Math.abs(segment.sweepAngleDeg) / 360) * ARC_HIT_STEPS));
    return Array.from({ length: stepCount + 1 }, (_, index) => {
      const angleDeg = segment.startAngleDeg + (segment.sweepAngleDeg * index) / stepCount;
      const angleRad = degreesToRadians(angleDeg);
      return worldToScreen({
        x: segment.center.x + Math.cos(angleRad) * segment.radius,
        y: segment.center.y + Math.sin(angleRad) * segment.radius
      });
    });
  });

const distanceToPolyline = (point: ScreenPoint, points: ScreenPoint[]) => {
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length - 1; index += 1) {
    distance = Math.min(distance, distanceToLineSegment(point, points[index], points[index + 1]));
  }
  return distance;
};

export const hitTestCanvasGeometry = ({
  screen,
  lines,
  arcs,
  curves,
  offsetLines,
  images,
  texts,
  points
}: {
  screen: ScreenPoint;
  lines: Array<{ line: ComputedLine; start: ScreenPoint; end: ScreenPoint }>;
  arcs?: Array<{ arc: ComputedArcLine; points: ScreenPoint[] }>;
  curves?: Array<{ curve: ComputedBezierCurve; points: ScreenPoint[] }>;
  offsetLines?: Array<{ line: ComputedOffsetLine; points: ScreenPoint[] }>;
  images?: Array<{ image: { elementId: ElementId }; corners: ScreenPoint[] }>;
  texts?: Array<{ text: { elementId: ElementId; text: string }; screen: ScreenPoint; fontSizePx: number }>;
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

  for (let index = (arcs?.length ?? 0) - 1; index >= 0; index -= 1) {
    const item = arcs![index];
    if (distanceToPolyline(screen, item.points) <= LINE_HIT_DISTANCE_PX) {
      return item.arc.elementId;
    }
  }

  for (let index = (curves?.length ?? 0) - 1; index >= 0; index -= 1) {
    const item = curves![index];
    if (distanceToPolyline(screen, item.points) <= LINE_HIT_DISTANCE_PX) {
      return item.curve.elementId;
    }
  }

  for (let index = (offsetLines?.length ?? 0) - 1; index >= 0; index -= 1) {
    const item = offsetLines![index];
    if (distanceToPolyline(screen, item.points) <= LINE_HIT_DISTANCE_PX) {
      return item.line.elementId;
    }
  }

  for (let index = (texts?.length ?? 0) - 1; index >= 0; index -= 1) {
    const item = texts![index];
    if (pointInTextBounds(screen, item)) {
      return item.text.elementId;
    }
  }

  for (let index = (images?.length ?? 0) - 1; index >= 0; index -= 1) {
    const item = images![index];
    if (pointInPolygon(screen, item.corners)) {
      return item.image.elementId;
    }
  }

  return null;
};

const pointInTextBounds = (
  point: ScreenPoint,
  item: { text: { text: string }; screen: ScreenPoint; fontSizePx: number }
) => {
  const lines = item.text.text.split(/\r?\n/);
  const maxLineLength = Math.max(1, ...lines.map((line) => Array.from(line).length));
  const width = maxLineLength * item.fontSizePx * 0.62;
  const height = Math.max(1, lines.length) * item.fontSizePx * 1.2;
  return (
    point.x >= item.screen.x &&
    point.x <= item.screen.x + width &&
    point.y >= item.screen.y &&
    point.y <= item.screen.y + height
  );
};

const pointInPolygon = (point: ScreenPoint, polygon: ScreenPoint[]) => {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const intersects =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x;
    if (intersects) inside = !inside;
  }
  return inside;
};

export type LineMeasurementCandidate = {
  line: ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine;
  property: NumericMeasurementKey;
};

export const hitTestLineCandidates = ({
  screen,
  lines
}: {
  screen: ScreenPoint;
  lines: Array<{ line: ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine; start?: ScreenPoint; end?: ScreenPoint; points?: ScreenPoint[] }>;
}) => {
  const candidates: Array<ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine> = [];

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const item = lines[index];
    if (item.line.kind === "line") {
      if (item.start && item.end && distanceToLineSegment(screen, item.start, item.end) <= LINE_HIT_DISTANCE_PX) {
        candidates.push(item.line);
      }
      continue;
    }
    if (item.points && distanceToPolyline(screen, item.points) <= LINE_HIT_DISTANCE_PX) {
      candidates.push(item.line);
    }
  }

  return candidates;
};

export const hitTestLineMeasurementCandidates = ({
  screen,
  lines
}: {
  screen: ScreenPoint;
  lines: Array<{ line: ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine; start?: ScreenPoint; end?: ScreenPoint; points?: ScreenPoint[] }>;
}): LineMeasurementCandidate[] => {
  const candidates: LineMeasurementCandidate[] = [];

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const item = lines[index];
    if (item.line.kind === "bezierCurve" || item.line.kind === "offsetLine") {
      if (item.points && distanceToPolyline(screen, item.points) <= LINE_HIT_DISTANCE_PX) {
        candidates.push({ line: item.line, property: "length" });
      }
      continue;
    }
    if (item.line.kind === "arcLine") {
      if (item.points && distanceToPolyline(screen, item.points) <= LINE_HIT_DISTANCE_PX) {
        candidates.push({ line: item.line, property: "length" });
      }
      if (item.start) {
        const startDistance = Math.sqrt(squaredDistance(screen, item.start));
        if (startDistance <= LINE_ENDPOINT_MEASUREMENT_RADIUS_PX) {
          candidates.push({ line: item.line, property: "startTangentAngleDeg" });
          continue;
        }
      }
      if (item.end) {
        const endDistance = Math.sqrt(squaredDistance(screen, item.end));
        if (endDistance <= LINE_ENDPOINT_MEASUREMENT_RADIUS_PX) {
          candidates.push({ line: item.line, property: "endTangentAngleDeg" });
        }
      }
      continue;
    }
    if (!item.start || !item.end) continue;
    const startDistance = Math.sqrt(squaredDistance(screen, item.start));
    const endDistance = Math.sqrt(squaredDistance(screen, item.end));

    if (startDistance <= LINE_ENDPOINT_MEASUREMENT_RADIUS_PX) {
      candidates.push({ line: item.line, property: "startTangentAngleDeg" });
      continue;
    }

    if (endDistance <= LINE_ENDPOINT_MEASUREMENT_RADIUS_PX) {
      candidates.push({ line: item.line, property: "endTangentAngleDeg" });
      continue;
    }

    if (distanceToLineSegment(screen, item.start, item.end) <= LINE_HIT_DISTANCE_PX) {
      candidates.push({ line: item.line, property: "length" });
    }
  }

  return candidates;
};
