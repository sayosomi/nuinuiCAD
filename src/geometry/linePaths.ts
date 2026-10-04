import type {
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedGeometry,
  ComputedGeometryValue,
  ComputedGeometryValueOffsetLine,
  ComputedLine,
  ComputedJoinedPath,
  ComputedOffsetLine,
  ComputedPolyline
} from "../types/geometry";
import { cubicDerivativeAt, projectPointOntoCurve, type BezierLikeSegment } from "./bezierMath";
import { projectPointOntoOffsetLine, type OffsetLineSegment } from "./offsetSegmentProjection";

type Point = { x: number; y: number };

type ArcTraversal = {
  center: Point;
  radius: number;
  startAngleDeg: number;
  sweepAngleDeg: number;
};

export type LineLikeGeometry = ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine | ComputedPolyline | ComputedJoinedPath;
export type LineLikeGeometryInput = LineLikeGeometry | Extract<ComputedGeometryValue, { kind: "line" | "arcLine" | "bezierCurve" | "offsetLine" | "joinedPath" | "polyline" }>;
export type FillEligiblePathGeometry = ComputedOffsetLine | ComputedJoinedPath | ComputedPolyline;

type PathSegment = {
  start: Point;
  end: Point;
  length: number;
  arc?: ArcTraversal;
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

const analyticArcSegment = (
  center: Point,
  radius: number,
  startAngleDeg: number,
  sweepAngleDeg: number,
  start = arcPoint(center, Math.max(radius, 0), startAngleDeg),
  end = arcPoint(center, Math.max(radius, 0), startAngleDeg + sweepAngleDeg),
  length = Math.max(radius, 0) * Math.abs(degreesToRadians(sweepAngleDeg))
): PathSegment | null => {
  const safeRadius = Math.max(radius, 0);
  return length <= EPSILON
    ? null
    : {
        start,
        end,
        length,
        arc: { center, radius: safeRadius, startAngleDeg, sweepAngleDeg }
      };
};

const endpointDirection = (segment: PathSegment, atEnd: boolean): Point | null => {
  if (!segment.arc) return unitVector(segment.start, segment.end);
  const stepCount = Math.max(1, Math.ceil((Math.abs(segment.arc.sweepAngleDeg) / 360) * CURVE_PATH_STEPS));
  const pieceSweep = segment.arc.sweepAngleDeg / stepCount;
  const startAngle = atEnd
    ? segment.arc.startAngleDeg + pieceSweep * (stepCount - 1)
    : segment.arc.startAngleDeg;
  return unitVector(
    arcPoint(segment.arc.center, segment.arc.radius, startAngle),
    arcPoint(segment.arc.center, segment.arc.radius, startAngle + pieceSweep)
  );
};

const reversePathSegment = (segment: PathSegment): PathSegment => ({
  start: segment.end,
  end: segment.start,
  length: segment.length,
  ...(segment.arc
    ? {
        arc: {
          ...segment.arc,
          startAngleDeg: segment.arc.startAngleDeg + segment.arc.sweepAngleDeg,
          sweepAngleDeg: -segment.arc.sweepAngleDeg
        }
      }
    : {})
});

const pointAtDistanceAlongSegment = (segment: PathSegment, distanceAlong: number): Point => {
  if (!segment.arc) {
    return interpolate(segment.start, segment.end, segment.length <= EPSILON ? 0 : distanceAlong / segment.length);
  }
  const fraction = segment.length <= EPSILON ? 0 : distanceAlong / segment.length;
  return arcPoint(
    segment.arc.center,
    segment.arc.radius,
    segment.arc.startAngleDeg + segment.arc.sweepAngleDeg * fraction
  );
};

const bezierSegments = (curve: { segments: readonly BezierLikeSegment[] }) =>
  curve.segments.flatMap((segment) => {
    const points = Array.from({ length: CURVE_PATH_STEPS + 1 }, (_, index) =>
      cubicPointAt(segment, index / CURVE_PATH_STEPS)
    );
    return points.slice(0, -1).flatMap((start, index) => {
      const path = pathSegment(start, points[index + 1]);
      return path ? [path] : [];
    });
  });

const offsetSegments = (line: Pick<ComputedOffsetLine | ComputedGeometryValueOffsetLine, "segments">) =>
  line.segments.flatMap((segment: OffsetLineSegment) => {
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
  geometry?.kind === "offsetLine" ||
  geometry?.kind === "polyline" ||
  geometry?.kind === "joinedPath";

export const isLineLikeGeometryInput = (
  geometry: ComputedGeometry | ComputedGeometryValue | undefined
): geometry is LineLikeGeometryInput =>
  geometry?.kind === "line" ||
  geometry?.kind === "arcLine" ||
  geometry?.kind === "bezierCurve" ||
  geometry?.kind === "offsetLine" ||
  geometry?.kind === "polyline" ||
  geometry?.kind === "joinedPath";

/** Fill is a semantic property of the currently supported closed path kinds.
 * Endpoint coincidence is deliberately not consulted here. */
export const isFillEligibleClosedPath = (
  geometry: ComputedGeometry | undefined
): geometry is FillEligiblePathGeometry =>
  (geometry?.kind === "polyline" || geometry?.kind === "offsetLine" || geometry?.kind === "joinedPath") && geometry.closed;

const segmentsForLineLikeGeometry = (geometry: LineLikeGeometryInput): PathSegment[] => {
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
  if (geometry.kind === "polyline") return geometry.segments.flatMap((segment) => {
    const path = pathSegment(segment.start, segment.end);
    return path ? [path] : [];
  });
  return offsetSegments(geometry);
};

const traversalSegmentsForLineLikeGeometry = (geometry: LineLikeGeometryInput): PathSegment[] => {
  if (geometry.kind === "arcLine") {
    const segment = analyticArcSegment(
      geometry.center,
      geometry.radius,
      geometry.startAngleDeg,
      geometry.sweepAngleDeg,
      geometry.start,
      geometry.end,
      geometry.length
    );
    return segment ? [segment] : [];
  }
  if (geometry.kind === "offsetLine" || geometry.kind === "joinedPath") {
    return geometry.segments.flatMap((segment) => {
      if (segment.kind === "line") {
        const path = pathSegment(segment.start, segment.end);
        return path ? [path] : [];
      }
      if (segment.kind === "bezier") return bezierSegments({ segments: [segment] });
      const arc = analyticArcSegment(
        segment.center,
        segment.radius,
        segment.startAngleDeg,
        segment.sweepAngleDeg,
        segment.start,
        segment.end,
        segment.length
      );
      return arc ? [arc] : [];
    });
  }
  return segmentsForLineLikeGeometry(geometry);
};

// Snap sampled non-arc traversal points onto the exact cubic or offset primitives.
const snapOntoGeometry = (geometry: LineLikeGeometryInput, point: Point): Point | null => {
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
  if (geometry.kind === "offsetLine" || geometry.kind === "joinedPath") {
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

const offsetSegmentTangent = (
  segment: OffsetLineSegment,
  projection: { localT: number; point: Point }
): Point | null => {
  if (segment.kind === "line") return unitVector(segment.start, segment.end);

  if (segment.kind === "bezier") {
    const derivative = cubicDerivativeAt(segment, projection.localT);
    return Math.hypot(derivative.x, derivative.y) <= EPSILON ? null : derivative;
  }

  const radial = {
    x: projection.point.x - segment.center.x,
    y: projection.point.y - segment.center.y
  };
  const radialLength = Math.hypot(radial.x, radial.y);
  if (radialLength <= EPSILON) return null;
  const sign = segment.sweepAngleDeg >= 0 ? 1 : -1;
  return { x: -radial.y * sign, y: radial.x * sign };
};

export const pointAtDistanceFromEndpoint = (
  geometry: LineLikeGeometryInput,
  endpointKey: "start" | "end",
  distanceFromEndpoint: number
): Point | null => {
  const forwardSegments = traversalSegmentsForLineLikeGeometry(geometry);
  const segments =
    endpointKey === "start"
      ? forwardSegments
      : [...forwardSegments].reverse().map(reversePathSegment);
  if (segments.length === 0) return null;

  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  const startPoint = segments[0].start;
  const endPoint = segments.at(-1)!.end;
  const startDirection = endpointDirection(segments[0], false);
  const endDirection = endpointDirection(segments.at(-1)!, true);
  if (!startDirection || !endDirection) return null;

  // Beyond either endpoint the point extends straight along the endpoint
  // tangent -- intentionally off-curve, so no snapping.
  if (distanceFromEndpoint < 0) {
    return extendFrom(startPoint, startDirection, distanceFromEndpoint);
  }

  if (distanceFromEndpoint > totalLength) {
    return extendFrom(endPoint, endDirection, distanceFromEndpoint - totalLength);
  }
  if (distanceFromEndpoint === 0) return { x: startPoint.x, y: startPoint.y };
  if (distanceFromEndpoint === totalLength) return { x: endPoint.x, y: endPoint.y };

  let remaining = distanceFromEndpoint;
  let chordPoint = endPoint;
  let selectedSegment: PathSegment | undefined;
  for (const segment of segments) {
    if (remaining <= segment.length) {
      selectedSegment = segment;
      chordPoint = pointAtDistanceAlongSegment(segment, remaining);
      break;
    }
    remaining -= segment.length;
  }

  if (selectedSegment?.arc) return chordPoint;

  // Place the in-range point on the true geometry, not the sampled chord.
  return snapOntoGeometry(geometry, chordPoint) ?? chordPoint;
};

export const tangentAtPointOnLineLikeGeometry = (
  geometry: LineLikeGeometryInput,
  point: Point,
  tolerance = 0.001
): { angleDeg: number; distanceFromLine: number } | null => {
  if (geometry.kind === "bezierCurve") {
    const tangent = bestBezierEndpointTangent(geometry.segments, point, tolerance);
    if (tangent) return tangent;
    const analyticTangent = analyticBezierTangentAtPoint(geometry.segments, point, tolerance);
    if (analyticTangent) return analyticTangent;
  }
  if (geometry.kind === "offsetLine" || geometry.kind === "joinedPath") {
    const tangent = bestBezierEndpointTangent(
      geometry.segments.filter((segment) => segment.kind === "bezier") as Extract<OffsetLineSegment, { kind: "bezier" }>[],
      point,
      tolerance
    );
    if (tangent) return tangent;

    const projection = projectPointOntoOffsetLine(point, geometry.segments);
    if (!projection || projection.distance > tolerance) return null;
    const segment = geometry.segments[projection.segmentIndex];
    const direction = segment ? offsetSegmentTangent(segment, projection) : null;
    if (!direction) return null;
    return {
      angleDeg: angleFromDirection(direction),
      distanceFromLine: projection.distance
    };
  }
  if (geometry.kind === "arcLine") {
    const radial = unitVector(geometry.center, point);
    if (!radial) return null;
    const radius = Math.max(geometry.radius, 0);
    const distanceFromLine = Math.abs(distance(geometry.center, point) - radius);
    if (distanceFromLine > tolerance) return null;
    const sign = geometry.sweepAngleDeg >= 0 ? 1 : -1;
    const tangent = { x: -radial.y * sign, y: radial.x * sign };
    return {
      angleDeg: angleFromDirection(tangent),
      distanceFromLine
    };
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
