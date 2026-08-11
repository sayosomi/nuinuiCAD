import type {
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedGeometry,
  ComputedLine,
  ComputedOffsetLine,
  ComputedOffsetLineSegment
} from "../types/geometry";
import { cubicDerivativeAt, projectPointOntoCurve } from "./bezierMath";
import { projectPointOntoOffsetLine } from "./offsetSegmentProjection";

type Point = { x: number; y: number };

export type LineLikeGeometry = ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine;

type BezierLikeSegment = {
  start: Point;
  control1: Point;
  control2: Point;
  end: Point;
};

type PathSegment = {
  start: Point;
  end: Point;
  length: number;
};

const CURVE_PATH_STEPS = 32;
const EPSILON = 1e-9;

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

const radiansToDegrees = (radians: number) => (radians * 180) / Math.PI;

const normalizeDegrees = (degrees: number) => ((degrees % 360) + 360) % 360;

const interpolate = (start: Point, end: Point, t: number): Point => ({
  x: start.x + (end.x - start.x) * t,
  y: start.y + (end.y - start.y) * t
});

const unitVector = (start: Point, end: Point): Point | null => {
  const length = distance(start, end);
  if (length <= EPSILON) return null;
  return {
    x: (end.x - start.x) / length,
    y: (end.y - start.y) / length
  };
};

const angleFromDirection = (direction: Point) =>
  normalizeDegrees(radiansToDegrees(Math.atan2(direction.y, direction.x)));

const extendFrom = (point: Point, direction: Point, distanceFromPoint: number): Point => ({
  x: point.x + direction.x * distanceFromPoint,
  y: point.y + direction.y * distanceFromPoint
});

const projectedPointOnSegment = (point: Point, segment: PathSegment) => {
  const vector = {
    x: segment.end.x - segment.start.x,
    y: segment.end.y - segment.start.y
  };
  const lengthSquared = vector.x * vector.x + vector.y * vector.y;
  if (lengthSquared <= EPSILON) return null;

  const rawT =
    ((point.x - segment.start.x) * vector.x + (point.y - segment.start.y) * vector.y) /
    lengthSquared;
  const t = Math.min(1, Math.max(0, rawT));
  const projected = interpolate(segment.start, segment.end, t);
  return {
    point: projected,
    distance: distance(point, projected)
  };
};

const cubicPointAt = (segment: BezierLikeSegment, t: number): Point => {
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

const arcPoint = (
  center: Point,
  radius: number,
  angleDeg: number
): Point => {
  const angleRad = degreesToRadians(angleDeg);
  return {
    x: center.x + Math.cos(angleRad) * radius,
    y: center.y + Math.sin(angleRad) * radius
  };
};

const pathSegment = (start: Point, end: Point): PathSegment | null => {
  const length = distance(start, end);
  return length <= EPSILON ? null : { start, end, length };
};

const bezierEndpointTangent = (
  segment: BezierLikeSegment,
  atEnd: boolean
): Point | null => {
  const direction = atEnd
    ? {
        x: segment.end.x - segment.control2.x,
        y: segment.end.y - segment.control2.y
      }
    : {
        x: segment.control1.x - segment.start.x,
        y: segment.control1.y - segment.start.y
      };
  return Math.hypot(direction.x, direction.y) <= EPSILON ? null : direction;
};

const bezierEndpointTangentAtPoint = (
  segment: BezierLikeSegment,
  point: Point,
  tolerance: number
): { angleDeg: number; distanceFromLine: number } | null => {
  const startDistance = distance(point, segment.start);
  const endDistance = distance(point, segment.end);

  if (startDistance <= tolerance) {
    const direction = bezierEndpointTangent(segment, false);
    if (direction) {
      return {
        angleDeg: angleFromDirection(direction),
        distanceFromLine: startDistance
      };
    }
  }
  if (endDistance <= tolerance) {
    const direction = bezierEndpointTangent(segment, true);
    if (direction) {
      return {
        angleDeg: angleFromDirection(direction),
        distanceFromLine: endDistance
      };
    }
  }
  return null;
};

const bestBezierEndpointTangent = (
  segments: BezierLikeSegment[],
  point: Point,
  tolerance: number
) =>
  segments
    .map((segment) => bezierEndpointTangentAtPoint(segment, point, tolerance))
    .filter((tangent): tangent is { angleDeg: number; distanceFromLine: number } => Boolean(tangent))
    .sort((a, b) => a.distanceFromLine - b.distanceFromLine)[0] ?? null;

const arcSegments = ({
  center,
  radius,
  startAngleDeg,
  sweepAngleDeg
}: {
  center: Point;
  radius: number;
  startAngleDeg: number;
  sweepAngleDeg: number;
}) => {
  const safeRadius = Math.max(radius, 0);
  const stepCount = Math.max(1, Math.ceil((Math.abs(sweepAngleDeg) / 360) * CURVE_PATH_STEPS));
  const points = Array.from({ length: stepCount + 1 }, (_, index) =>
    arcPoint(center, safeRadius, startAngleDeg + (sweepAngleDeg * index) / stepCount)
  );
  return points.slice(0, -1).flatMap((start, index) => {
    const segment = pathSegment(start, points[index + 1]);
    return segment ? [segment] : [];
  });
};

const bezierSegments = (curve: ComputedBezierCurve) =>
  curve.segments.flatMap((segment) => {
    const points = Array.from({ length: CURVE_PATH_STEPS + 1 }, (_, index) =>
      cubicPointAt(segment, index / CURVE_PATH_STEPS)
    );
    return points.slice(0, -1).flatMap((start, index) => {
      const path = pathSegment(start, points[index + 1]);
      return path ? [path] : [];
    });
  });

const offsetSegments = (line: ComputedOffsetLine) =>
  line.segments.flatMap((segment: ComputedOffsetLineSegment) => {
    if (segment.kind === "line") {
      const path = pathSegment(segment.start, segment.end);
      return path ? [path] : [];
    }
    if (segment.kind === "bezier") {
      const points = Array.from({ length: CURVE_PATH_STEPS + 1 }, (_, index) =>
        cubicPointAt(segment, index / CURVE_PATH_STEPS)
      );
      return points.slice(0, -1).flatMap((start, index) => {
        const path = pathSegment(start, points[index + 1]);
        return path ? [path] : [];
      });
    }
    return arcSegments({
      center: segment.center,
      radius: segment.radius,
      startAngleDeg: segment.startAngleDeg,
      sweepAngleDeg: segment.sweepAngleDeg
    });
  });

export const isLineLikeGeometry = (geometry: ComputedGeometry | undefined): geometry is LineLikeGeometry =>
  geometry?.kind === "line" ||
  geometry?.kind === "arcLine" ||
  geometry?.kind === "bezierCurve" ||
  geometry?.kind === "offsetLine";

const segmentsForLineLikeGeometry = (geometry: LineLikeGeometry): PathSegment[] => {
  if (geometry.kind === "line") {
    const segment = pathSegment(geometry.start, geometry.end);
    return segment ? [segment] : [];
  }
  if (geometry.kind === "arcLine") {
    return arcSegments({
      center: geometry.center,
      radius: geometry.radius,
      startAngleDeg: geometry.startAngleDeg,
      sweepAngleDeg: geometry.sweepAngleDeg
    });
  }
  if (geometry.kind === "bezierCurve") return bezierSegments(geometry);
  return offsetSegments(geometry);
};

// Snap a chord-sampled path point onto the true analytic geometry: the exact
// cubic for Beziers, the exact circle for arcs, and the constituent analytic
// primitives for offset lines.
const snapOntoGeometry = (geometry: LineLikeGeometry, point: Point): Point | null => {
  if (geometry.kind === "bezierCurve") {
    const projection = projectPointOntoCurve(geometry.segments, point);
    return projection ? projection.point : null;
  }
  if (geometry.kind === "arcLine") {
    const direction = unitVector(geometry.center, point);
    if (!direction) return null;
    const radius = Math.max(geometry.radius, 0);
    return { x: geometry.center.x + direction.x * radius, y: geometry.center.y + direction.y * radius };
  }
  if (geometry.kind === "offsetLine") {
    return projectPointOntoOffsetLine(point, geometry.segments)?.point ?? null;
  }
  return null;
};

const analyticBezierTangentAtPoint = (
  segments: BezierLikeSegment[],
  point: Point,
  tolerance: number
): { angleDeg: number; distanceFromLine: number } | null => {
  const projection = projectPointOntoCurve(segments, point);
  if (!projection || projection.distance > tolerance) return null;
  const derivative = cubicDerivativeAt(segments[projection.segmentIndex], projection.localT);
  if (Math.hypot(derivative.x, derivative.y) <= EPSILON) return null;
  return {
    angleDeg: angleFromDirection(derivative),
    distanceFromLine: projection.distance
  };
};

export const pointAtDistanceFromEndpoint = (
  geometry: LineLikeGeometry,
  endpointKey: "start" | "end",
  distanceFromEndpoint: number
): Point | null => {
  const forwardSegments = segmentsForLineLikeGeometry(geometry);
  const segments =
    endpointKey === "start"
      ? forwardSegments
      : [...forwardSegments].reverse().map((segment) => ({
          start: segment.end,
          end: segment.start,
          length: segment.length
        }));
  if (segments.length === 0) return null;

  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  const startPoint = segments[0].start;
  const endPoint = segments.at(-1)!.end;
  const startDirection = unitVector(segments[0].start, segments[0].end);
  const endDirection = unitVector(segments.at(-1)!.start, segments.at(-1)!.end);
  if (!startDirection || !endDirection) return null;

  // Beyond either endpoint the point extends straight along the endpoint
  // tangent -- intentionally off-curve, so no snapping.
  if (distanceFromEndpoint < 0) {
    return extendFrom(startPoint, startDirection, distanceFromEndpoint);
  }

  if (distanceFromEndpoint > totalLength) {
    return extendFrom(endPoint, endDirection, distanceFromEndpoint - totalLength);
  }

  let remaining = distanceFromEndpoint;
  let chordPoint = endPoint;
  for (const segment of segments) {
    if (remaining <= segment.length) {
      chordPoint = interpolate(segment.start, segment.end, segment.length <= EPSILON ? 0 : remaining / segment.length);
      break;
    }
    remaining -= segment.length;
  }

  // Place the in-range point on the true geometry, not the sampled chord.
  return snapOntoGeometry(geometry, chordPoint) ?? chordPoint;
};

export const tangentAtPointOnLineLikeGeometry = (
  geometry: LineLikeGeometry,
  point: Point,
  tolerance = 0.001
): { angleDeg: number; distanceFromLine: number } | null => {
  if (geometry.kind === "bezierCurve") {
    const tangent = bestBezierEndpointTangent(geometry.segments, point, tolerance);
    if (tangent) return tangent;
    const analyticTangent = analyticBezierTangentAtPoint(geometry.segments, point, tolerance);
    if (analyticTangent) return analyticTangent;
  }
  if (geometry.kind === "offsetLine") {
    const tangent = bestBezierEndpointTangent(
      geometry.segments.filter((segment): segment is Extract<ComputedOffsetLineSegment, { kind: "bezier" }> =>
        segment.kind === "bezier"
      ),
      point,
      tolerance
    );
    if (tangent) return tangent;
    const analyticTangent = analyticBezierTangentAtPoint(
      geometry.segments.filter((segment): segment is Extract<ComputedOffsetLineSegment, { kind: "bezier" }> =>
        segment.kind === "bezier"
      ),
      point,
      tolerance
    );
    if (analyticTangent) return analyticTangent;
  }

  const segments = segmentsForLineLikeGeometry(geometry);
  let best:
    | {
        segment: PathSegment;
        distanceFromLine: number;
      }
    | null = null;

  for (const segment of segments) {
    const projection = projectedPointOnSegment(point, segment);
    if (!projection) continue;
    if (!best || projection.distance < best.distanceFromLine) {
      best = {
        segment,
        distanceFromLine: projection.distance
      };
    }
  }

  if (!best || best.distanceFromLine > tolerance) return null;

  const direction = unitVector(best.segment.start, best.segment.end);
  if (!direction) return null;

  return {
    angleDeg: angleFromDirection(direction),
    distanceFromLine: best.distanceFromLine
  };
};
