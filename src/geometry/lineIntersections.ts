import type {
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedLine,
  ComputedOffsetLine,
  ComputedOffsetLineSegment
} from "../types/geometry";
import type { LineLikeGeometry } from "./linePaths";

type Point = { x: number; y: number };

type IntersectionSegment = {
  start: Point;
  end: Point;
  startDistance: number;
  endDistance: number;
  extension: boolean;
};

export type LineIntersection = {
  x: number;
  y: number;
  line1Distance: number;
  line2Distance: number;
};

export type LineIntersectionResult =
  | { intersections: LineIntersection[]; error?: undefined }
  | { intersections: LineIntersection[]; error: string };

const CURVE_STEPS = 64;
const ARC_STEPS = 64;
const EXTENSION_LENGTH = 1_000_000;
const EPSILON = 1e-9;
const DEDUPE_EPSILON = 1e-5;

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

const cubicPointAt = (
  segment: { start: Point; control1: Point; control2: Point; end: Point },
  t: number
): Point => {
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

const arcPoint = (center: Point, radius: number, angleDeg: number): Point => {
  const angleRad = degreesToRadians(angleDeg);
  return {
    x: center.x + Math.cos(angleRad) * radius,
    y: center.y - Math.sin(angleRad) * radius
  };
};

const pointPathSegments = (points: Point[]) => {
  const segments: IntersectionSegment[] = [];
  let accumulated = 0;

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const length = distance(start, end);
    if (length <= EPSILON) continue;

    segments.push({
      start,
      end,
      startDistance: accumulated,
      endDistance: accumulated + length,
      extension: false
    });
    accumulated += length;
  }

  return segments;
};

const arcPoints = ({
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
  const stepCount = Math.max(1, Math.ceil((Math.abs(sweepAngleDeg) / 360) * ARC_STEPS));
  return Array.from({ length: stepCount + 1 }, (_, index) =>
    arcPoint(center, safeRadius, startAngleDeg + (sweepAngleDeg * index) / stepCount)
  );
};

const bezierPoints = (curve: ComputedBezierCurve) =>
  curve.segments.flatMap((segment, segmentIndex) => {
    const points = Array.from({ length: CURVE_STEPS + 1 }, (_, index) =>
      cubicPointAt(segment, index / CURVE_STEPS)
    );
    return segmentIndex === 0 ? points : points.slice(1);
  });

const offsetSegmentPoints = (segment: ComputedOffsetLineSegment) => {
  if (segment.kind === "line") return [segment.start, segment.end];
  if (segment.kind === "bezier") {
    return Array.from({ length: CURVE_STEPS + 1 }, (_, index) =>
      cubicPointAt(segment, index / CURVE_STEPS)
    );
  }
  return arcPoints({
    center: segment.center,
    radius: segment.radius,
    startAngleDeg: segment.startAngleDeg,
    sweepAngleDeg: segment.sweepAngleDeg
  });
};

const offsetPoints = (line: ComputedOffsetLine) =>
  line.segments.flatMap((segment, segmentIndex) => {
    const points = offsetSegmentPoints(segment);
    return segmentIndex === 0 ? points : points.slice(1);
  });

const pathSegmentsForLine = (geometry: LineLikeGeometry) => {
  if (geometry.kind === "line") return pointPathSegments([geometry.start, geometry.end]);
  if (geometry.kind === "arcLine") {
    return pointPathSegments(
      arcPoints({
        center: geometry.center,
        radius: geometry.radius,
        startAngleDeg: geometry.startAngleDeg,
        sweepAngleDeg: geometry.sweepAngleDeg
      })
    );
  }
  if (geometry.kind === "bezierCurve") return pointPathSegments(bezierPoints(geometry));
  return pointPathSegments(offsetPoints(geometry));
};

const extensionSegments = (
  segments: IntersectionSegment[],
  geometry: LineLikeGeometry
): IntersectionSegment[] => {
  if (segments.length === 0 || (geometry.kind === "offsetLine" && geometry.closed)) return [];

  const first = segments[0];
  const last = segments.at(-1)!;
  const firstLength = distance(first.start, first.end);
  const lastLength = distance(last.start, last.end);
  if (firstLength <= EPSILON || lastLength <= EPSILON) return [];

  const startDirection = {
    x: (first.start.x - first.end.x) / firstLength,
    y: (first.start.y - first.end.y) / firstLength
  };
  const endDirection = {
    x: (last.end.x - last.start.x) / lastLength,
    y: (last.end.y - last.start.y) / lastLength
  };

  return [
    {
      start: {
        x: first.start.x + startDirection.x * EXTENSION_LENGTH,
        y: first.start.y + startDirection.y * EXTENSION_LENGTH
      },
      end: first.start,
      startDistance: -EXTENSION_LENGTH,
      endDistance: 0,
      extension: true
    },
    {
      start: last.end,
      end: {
        x: last.end.x + endDirection.x * EXTENSION_LENGTH,
        y: last.end.y + endDirection.y * EXTENSION_LENGTH
      },
      startDistance: last.endDistance,
      endDistance: last.endDistance + EXTENSION_LENGTH,
      extension: true
    }
  ];
};

const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;

const segmentIntersection = (
  a: IntersectionSegment,
  b: IntersectionSegment
): { point: Point; line1Distance: number; line2Distance: number; overlap: boolean } | null => {
  const r = { x: a.end.x - a.start.x, y: a.end.y - a.start.y };
  const s = { x: b.end.x - b.start.x, y: b.end.y - b.start.y };
  const denominator = cross(r, s);
  const qp = { x: b.start.x - a.start.x, y: b.start.y - a.start.y };

  if (Math.abs(denominator) <= EPSILON) {
    if (Math.abs(cross(qp, r)) <= EPSILON) return { point: a.start, line1Distance: 0, line2Distance: 0, overlap: true };
    return null;
  }

  const t = cross(qp, s) / denominator;
  const u = cross(qp, r) / denominator;
  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) return null;

  const clampedT = Math.min(Math.max(t, 0), 1);
  const clampedU = Math.min(Math.max(u, 0), 1);
  return {
    point: {
      x: a.start.x + r.x * clampedT,
      y: a.start.y + r.y * clampedT
    },
    line1Distance: a.startDistance + (a.endDistance - a.startDistance) * clampedT,
    line2Distance: b.startDistance + (b.endDistance - b.startDistance) * clampedU,
    overlap: false
  };
};

const samePoint = (a: LineIntersection, b: LineIntersection) =>
  Math.hypot(a.x - b.x, a.y - b.y) <= DEDUPE_EPSILON;

export const findLineIntersections = (
  line1: ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine,
  line2: ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine,
  options: { useExtensions: boolean }
): LineIntersectionResult => {
  const baseSegments1 = pathSegmentsForLine(line1);
  const baseSegments2 = pathSegmentsForLine(line2);
  const segments1 = options.useExtensions
    ? [...baseSegments1, ...extensionSegments(baseSegments1, line1)]
    : baseSegments1;
  const segments2 = options.useExtensions
    ? [...baseSegments2, ...extensionSegments(baseSegments2, line2)]
    : baseSegments2;
  const intersections: LineIntersection[] = [];

  for (const segment1 of segments1) {
    for (const segment2 of segments2) {
      const intersection = segmentIntersection(segment1, segment2);
      if (!intersection) continue;
      if (intersection.overlap) {
        return {
          intersections,
          error: "参照線同士が重なっているため、交点を一意に決められません。重ならない線を指定してください。"
        };
      }
      const item = {
        x: intersection.point.x,
        y: intersection.point.y,
        line1Distance: intersection.line1Distance,
        line2Distance: intersection.line2Distance
      };
      if (!intersections.some((existing) => samePoint(existing, item))) {
        intersections.push(item);
      }
    }
  }

  intersections.sort(
    (a, b) =>
      a.line1Distance - b.line1Distance ||
      a.line2Distance - b.line2Distance ||
      a.x - b.x ||
      a.y - b.y
  );

  return { intersections };
};
