import type { ComputedOffsetLineSegment } from "../types/geometry";
import { degreesToRadians, normalizeDegrees, radiansToDegrees } from "./evaluateGeometryPrimitives";
import { cubicPointAt, distance, interpolate, refineBezierProjection, type Point } from "./bezierMath";

const EPSILON = 1e-9;

export type OffsetSegmentProjection = {
  localT: number;
  point: Point;
  distance: number;
};

export type OffsetLineProjection = OffsetSegmentProjection & {
  segmentIndex: number;
};

const projectLine = (point: Point, start: Point, end: Point): OffsetSegmentProjection | null => {
  const vector = { x: end.x - start.x, y: end.y - start.y };
  const lengthSquared = vector.x * vector.x + vector.y * vector.y;
  if (lengthSquared <= EPSILON) return null;
  const rawT = ((point.x - start.x) * vector.x + (point.y - start.y) * vector.y) / lengthSquared;
  if (rawT < -EPSILON || rawT > 1 + EPSILON) return null;
  const localT = Math.min(Math.max(rawT, 0), 1);
  const projected = interpolate(start, end, localT);
  return { localT, point: projected, distance: distance(point, projected) };
};

const projectArc = (
  point: Point,
  segment: Extract<ComputedOffsetLineSegment, { kind: "arc" }>
): OffsetSegmentProjection | null => {
  if (segment.radius <= EPSILON || Math.abs(segment.sweepAngleDeg) <= EPSILON) return null;
  const pointAngleDeg = radiansToDegrees(Math.atan2(point.y - segment.center.y, point.x - segment.center.x));
  const progressDeg =
    segment.sweepAngleDeg >= 0
      ? normalizeDegrees(pointAngleDeg - segment.startAngleDeg)
      : -normalizeDegrees(segment.startAngleDeg - pointAngleDeg);
  const rawT = progressDeg / segment.sweepAngleDeg;
  if (rawT < -EPSILON || rawT > 1 + EPSILON) return null;
  const localT = Math.min(Math.max(rawT, 0), 1);
  const angleRad = degreesToRadians(segment.startAngleDeg + segment.sweepAngleDeg * localT);
  const projected = {
    x: segment.center.x + Math.cos(angleRad) * segment.radius,
    y: segment.center.y + Math.sin(angleRad) * segment.radius
  };
  return { localT, point: projected, distance: distance(point, projected) };
};

// Refine a chord-sampled seed to the exact primitive. Sampling remains useful
// for choosing the nearest offset sub-segment; it must not decide whether an
// exact intersection point is on that sub-segment || where it is split.
export const projectPointOntoOffsetSegment = (
  point: Point,
  segment: ComputedOffsetLineSegment,
  seedT: number
): OffsetSegmentProjection | null => {
  if (segment.kind === "line") return projectLine(point, segment.start, segment.end);
  if (segment.kind === "arc") return projectArc(point, segment);

  const refined = refineBezierProjection(segment, point, seedT);
  const projected = cubicPointAt(segment, refined.localT);
  return { localT: refined.localT, point: projected, distance: refined.distanceFromLine };
};

const samplePoint = (segment: ComputedOffsetLineSegment, t: number): Point => {
  if (segment.kind === "line") return interpolate(segment.start, segment.end, t);
  if (segment.kind === "bezier") return cubicPointAt(segment, t);
  const angleRad = degreesToRadians(segment.startAngleDeg + segment.sweepAngleDeg * t);
  return {
    x: segment.center.x + Math.cos(angleRad) * segment.radius,
    y: segment.center.y + Math.sin(angleRad) * segment.radius
  };
};

export const projectPointOntoOffsetLine = (
  point: Point,
  segments: ComputedOffsetLineSegment[]
): OffsetLineProjection | null => {
  let best: OffsetLineProjection | null = null;
  for (const [segmentIndex, segment] of segments.entries()) {
    let seedT = 0;
    let seedDistance = Infinity;
    for (let index = 0; index <= 32; index += 1) {
      const t = index / 32;
      const candidate = distance(point, samplePoint(segment, t));
      if (candidate < seedDistance) {
        seedDistance = candidate;
        seedT = t;
      }
    }
    const projected = projectPointOntoOffsetSegment(point, segment, seedT);
    if (projected && (!best || projected.distance < best.distance)) {
      best = { ...projected, segmentIndex };
    }
  }
  return best;
};
