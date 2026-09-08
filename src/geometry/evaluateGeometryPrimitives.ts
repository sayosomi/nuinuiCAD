import type { ArcDirection, ComputedBezierSegment, ComputedPoint } from "../types/geometry";

const CURVE_LENGTH_STEPS = 32;

export const CIRCLE_EPSILON = 1e-9;

export const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;

export const radiansToDegrees = (radians: number) => (radians * 180) / Math.PI;

export const normalizeDegrees = (degrees: number) => ((degrees % 360) + 360) % 360;

export const positiveSweepDegrees = (startAngleDeg: number, endAngleDeg: number) => {
  const rawSweep = endAngleDeg - startAngleDeg;
  const normalized = normalizeDegrees(rawSweep);
  const isFullCircle = normalized <= CIRCLE_EPSILON || 360 - normalized <= CIRCLE_EPSILON;
  return isFullCircle && Math.abs(rawSweep) > CIRCLE_EPSILON ? 360 : normalized;
};

export const directedSweepDegrees = (
  startAngleDeg: number,
  endAngleDeg: number,
  direction: ArcDirection
) => {
  const sweep = direction === "clockwise"
    ? -positiveSweepDegrees(endAngleDeg, startAngleDeg)
    : positiveSweepDegrees(startAngleDeg, endAngleDeg);
  return sweep === 0 ? 0 : sweep;
};

export const handlePoint = (point: ComputedPoint, angleDeg: number, length: number) => {
  const angleRad = degreesToRadians(angleDeg);
  return {
    x: point.x + Math.cos(angleRad) * length,
    y: point.y + Math.sin(angleRad) * length
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
