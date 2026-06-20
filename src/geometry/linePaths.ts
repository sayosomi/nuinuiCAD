import type {
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedBezierSegment,
  ComputedGeometry,
  ComputedLine,
  ComputedOffsetLine,
  ComputedOffsetLineSegment
} from "../types/geometry";

type Point = { x: number; y: number };

export type LineLikeGeometry = ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine;

type PathSegment = {
  start: Point;
  end: Point;
  length: number;
};

const CURVE_PATH_STEPS = 32;
const EPSILON = 1e-9;

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

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

const extendFrom = (point: Point, direction: Point, distanceFromPoint: number): Point => ({
  x: point.x + direction.x * distanceFromPoint,
  y: point.y + direction.y * distanceFromPoint
});

const cubicPointAt = (segment: ComputedBezierSegment, t: number): Point => {
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
    y: center.y - Math.sin(angleRad) * radius
  };
};

const pathSegment = (start: Point, end: Point): PathSegment | null => {
  const length = distance(start, end);
  return length <= EPSILON ? null : { start, end, length };
};

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

  if (distanceFromEndpoint < 0) {
    return extendFrom(startPoint, startDirection, distanceFromEndpoint);
  }

  if (distanceFromEndpoint > totalLength) {
    return extendFrom(endPoint, endDirection, distanceFromEndpoint - totalLength);
  }

  let remaining = distanceFromEndpoint;
  for (const segment of segments) {
    if (remaining <= segment.length) {
      return interpolate(segment.start, segment.end, segment.length <= EPSILON ? 0 : remaining / segment.length);
    }
    remaining -= segment.length;
  }

  return endPoint;
};
