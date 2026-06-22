import type { ComputedBezierSegment, ComputedPoint } from "../types/geometry";

const CURVE_LENGTH_STEPS = 32;

export const CIRCLE_EPSILON = 1e-9;

export const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;

export const radiansToDegrees = (radians: number) => (radians * 180) / Math.PI;

export const normalizeDegrees = (degrees: number) => ((degrees % 360) + 360) % 360;

export const positiveSweepDegrees = (startAngleDeg: number, endAngleDeg: number) =>
  normalizeDegrees(endAngleDeg - startAngleDeg);

export const circleThroughThreePoints = (
  point1: ComputedPoint,
  point2: ComputedPoint,
  point3: ComputedPoint
) => {
  const denominator =
    2 *
    (point1.x * (point2.y - point3.y) +
      point2.x * (point3.y - point1.y) +
      point3.x * (point1.y - point2.y));

  if (Math.abs(denominator) < CIRCLE_EPSILON) return null;

  const point1Squared = point1.x * point1.x + point1.y * point1.y;
  const point2Squared = point2.x * point2.x + point2.y * point2.y;
  const point3Squared = point3.x * point3.x + point3.y * point3.y;
  const x =
    (point1Squared * (point2.y - point3.y) +
      point2Squared * (point3.y - point1.y) +
      point3Squared * (point1.y - point2.y)) /
    denominator;
  const y =
    (point1Squared * (point3.x - point2.x) +
      point2Squared * (point1.x - point3.x) +
      point3Squared * (point2.x - point1.x)) /
    denominator;
  const radius = Math.hypot(point1.x - x, point1.y - y);

  if (!Number.isFinite(radius) || radius <= CIRCLE_EPSILON) return null;
  return { x, y, radius };
};

export const handlePoint = (point: ComputedPoint, angleDeg: number, length: number) => {
  const angleRad = degreesToRadians(angleDeg);
  return {
    x: point.x + Math.cos(angleRad) * length,
    y: point.y - Math.sin(angleRad) * length
  };
};

const cubicPointAt = (
  segment: ComputedBezierSegment,
  t: number
): { x: number; y: number } => {
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

export const approximateBezierSegmentLength = (segment: ComputedBezierSegment) => {
  let length = 0;
  let previous: { x: number; y: number } = segment.start;

  for (let step = 1; step <= CURVE_LENGTH_STEPS; step += 1) {
    const next = cubicPointAt(segment, step / CURVE_LENGTH_STEPS);
    length += Math.hypot(next.x - previous.x, next.y - previous.y);
    previous = next;
  }

  return length;
};
