import type { ArcDirection } from "../types/geometry";
import type {
  ComputedGeometryValueBezierCurve,
  ComputedGeometryValueOffsetLine,
  ComputedGeometryValueOffsetLineSegment,
  ComputedGeometryValuePolyline,
  ComputedOffsetLine
} from "./evaluationTypes";
import {
  approximateCubicLength,
  cross,
  cubicDerivativeAt,
  cubicPointAt,
  dot,
  EPSILON,
  selectBestBezierFeatureCandidate,
  solveRealQuadratic,
  type BezierLikeSegment
} from "./bezierMath";
import { CIRCLE_EPSILON, degreesToRadians, directedSweepDegrees } from "./evaluateGeometryPrimitives";
import { arcTangentAngles, lineTangentAngles } from "./lineMeasurements";

export type StructuralPoint = { x: number; y: number };

/** Identity-free structural form of the drawable Bezier extreme-point calculation. */
export const bezierExtremePointGeometryKernel = (
  segment: BezierLikeSegment,
  direction: StructuralPoint
): StructuralPoint => {
  const derivativeProjection = (t: number) => dot(cubicDerivativeAt(segment, t), direction);
  const f0 = derivativeProjection(0);
  const fHalf = derivativeProjection(0.5);
  const f1 = derivativeProjection(1);
  const c = f0;
  const a = 2 * (f1 + f0 - 2 * fHalf);
  const b = f1 - f0 - a;
  const candidates = [0, 1].map((t) => ({
    t,
    score: dot(cubicPointAt(segment, t), direction)
  }));

  for (const root of solveRealQuadratic(a, b, c)) {
    if (root > 0 && root < 1) {
      candidates.push({
        t: root,
        score: dot(cubicPointAt(segment, root), direction)
      });
    }
  }

  if (Math.abs(f0) <= EPSILON && Math.abs(fHalf) <= EPSILON && Math.abs(f1) <= EPSILON) {
    candidates.push({
      t: 0.5,
      score: dot(cubicPointAt(segment, 0.5), direction)
    });
  }

  const selected = selectBestBezierFeatureCandidate(candidates);
  return cubicPointAt(segment, selected?.t ?? 0.5);
};

/** Identity-free structural form of the drawable Bezier bulge-point calculation. */
export const bezierBulgePointGeometryKernel = (
  segment: BezierLikeSegment
): StructuralPoint | null => {
  const chord = {
    x: segment.end.x - segment.start.x,
    y: segment.end.y - segment.start.y
  };
  const chordLength = Math.hypot(chord.x, chord.y);
  if (chordLength <= EPSILON) return null;

  const derivativeCross = (t: number) => cross(chord, cubicDerivativeAt(segment, t));
  const q0 = derivativeCross(0);
  const qHalf = derivativeCross(0.5);
  const q1 = derivativeCross(1);
  const c = q0;
  const a = 2 * (q1 + q0 - 2 * qHalf);
  const b = q1 - q0 - a;
  const scoreAt = (t: number) =>
    Math.abs(cross(chord, {
      x: cubicPointAt(segment, t).x - segment.start.x,
      y: cubicPointAt(segment, t).y - segment.start.y
    })) / chordLength;
  const candidates: { t: number; score: number }[] = [];

  for (const root of solveRealQuadratic(a, b, c)) {
    if (root > 0 && root < 1) candidates.push({ t: root, score: scoreAt(root) });
  }
  if (Math.abs(q0) <= EPSILON && Math.abs(qHalf) <= EPSILON && Math.abs(q1) <= EPSILON) {
    candidates.push({ t: 0.5, score: scoreAt(0.5) });
  }

  const selected = selectBestBezierFeatureCandidate(candidates);
  return cubicPointAt(segment, selected?.t ?? 0.5);
};

export type StructuralLine = {
  kind: "line";
  start: StructuralPoint;
  end: StructuralPoint;
  length: number;
  startAngleDeg: number | null;
  endAngleDeg: number | null;
  startTangentAngleDeg: number | null;
  endTangentAngleDeg: number | null;
};

export type StructuralArcLine = {
  kind: "arcLine";
  center: StructuralPoint;
  start: StructuralPoint;
  end: StructuralPoint;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
  startTangentAngleDeg: number;
  endTangentAngleDeg: number;
  sweepAngleDeg: number;
  length: number;
};

export const coordinateGeometryKernel = (x: number, y: number): StructuralPoint => ({ x, y });

export const offsetPointGeometryKernel = (
  from: StructuralPoint,
  dx: number,
  dy: number
): StructuralPoint => ({ x: from.x + dx, y: from.y + dy });

export const polarPointGeometryKernel = (
  from: StructuralPoint,
  angleDeg: number,
  distance: number
): StructuralPoint => {
  const angleRad = degreesToRadians(angleDeg);
  return {
    x: from.x + Math.cos(angleRad) * distance,
    y: from.y + Math.sin(angleRad) * distance
  };
};

export const divisionPointGeometryKernel = (
  start: StructuralPoint,
  end: StructuralPoint,
  placement: { kind: "distance" | "ratio"; value: number }
): StructuralPoint | null => {
  const vector = { x: end.x - start.x, y: end.y - start.y };
  if (placement.kind === "ratio") {
    return {
      x: start.x + vector.x * placement.value,
      y: start.y + vector.y * placement.value
    };
  }
  const length = Math.hypot(vector.x, vector.y);
  if (length <= CIRCLE_EPSILON) return null;
  return {
    x: start.x + (vector.x / length) * placement.value,
    y: start.y + (vector.y / length) * placement.value
  };
};

const identityFreePoint = ({ x, y }: { x: number; y: number }) => ({ x, y });

const identityFreeOffsetSegment = (
  segment: ComputedOffsetLine["segments"][number]
): ComputedGeometryValueOffsetLineSegment => {
  if (segment.kind === "line") {
    return { kind: "line", start: identityFreePoint(segment.start), end: identityFreePoint(segment.end), length: segment.length };
  }
  if (segment.kind === "bezier") {
    return {
      kind: "bezier",
      start: identityFreePoint(segment.start),
      control1: segment.control1,
      control2: segment.control2,
      end: identityFreePoint(segment.end),
      length: segment.length
    };
  }
  return {
    kind: "arc",
    center: identityFreePoint(segment.center),
    start: identityFreePoint(segment.start),
    end: identityFreePoint(segment.end),
    radius: segment.radius,
    startAngleDeg: segment.startAngleDeg,
    sweepAngleDeg: segment.sweepAngleDeg,
    length: segment.length
  };
};

export const offsetLineGeometryValueKernel = (
  line: ComputedOffsetLine
): ComputedGeometryValueOffsetLine => ({
  kind: "offsetLine",
  start: line.start ? identityFreePoint(line.start) : null,
  end: line.end ? identityFreePoint(line.end) : null,
  segments: line.segments.map(identityFreeOffsetSegment),
  closed: line.closed,
  length: line.length,
  startTangentAngleDeg: line.startTangentAngleDeg,
  endTangentAngleDeg: line.endTangentAngleDeg
});

export const segmentGeometryKernel = (start: StructuralPoint, end: StructuralPoint): StructuralLine => ({
  kind: "line",
  start,
  end,
  length: Math.hypot(end.x - start.x, end.y - start.y),
  ...lineTangentAngles(start, end)
});

export const polarLineGeometryKernel = (
  start: StructuralPoint,
  angleDeg: number,
  length: number
): StructuralLine => segmentGeometryKernel(start, polarPointGeometryKernel(start, angleDeg, length));

export const polylineGeometryKernel = (
  points: readonly StructuralPoint[],
  closed: boolean
): ComputedGeometryValuePolyline | null => {
  const minimumPointCount = closed ? 3 : 2;
  if (points.length < minimumPointCount || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  const segments = points.slice(0, -1).map((start, index) => {
    const end = points[index + 1]!;
    return { start, end, length: Math.hypot(end.x - start.x, end.y - start.y) };
  });
  const first = points[0]!;
  const last = points.at(-1)!;
  if (closed && Math.hypot(last.x - first.x, last.y - first.y) > CIRCLE_EPSILON) {
    segments.push({ start: last, end: first, length: Math.hypot(first.x - last.x, first.y - last.y) });
  }
  const nonZero = segments.filter((segment) => segment.length > CIRCLE_EPSILON);
  const startTangentAngleDeg = nonZero[0] ? lineTangentAngles(nonZero[0].start, nonZero[0].end).startTangentAngleDeg : null;
  const endTangentAngleDeg = nonZero.at(-1) ? lineTangentAngles(nonZero.at(-1)!.start, nonZero.at(-1)!.end).endTangentAngleDeg : null;
  return {
    kind: "polyline",
    segments,
    closed,
    start: first,
    end: closed ? first : last,
    length: segments.reduce((sum, segment) => sum + segment.length, 0),
    startTangentAngleDeg,
    endTangentAngleDeg
  };
};

export const arcGeometryKernel = (
  center: StructuralPoint,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
  direction: ArcDirection
): StructuralArcLine => {
  const sweepAngleDeg = directedSweepDegrees(startAngleDeg, endAngleDeg, direction);
  const startAngleRad = degreesToRadians(startAngleDeg);
  const endAngleRad = degreesToRadians(endAngleDeg);
  return {
    kind: "arcLine",
    center,
    start: {
      x: center.x + Math.cos(startAngleRad) * radius,
      y: center.y + Math.sin(startAngleRad) * radius
    },
    end: {
      x: center.x + Math.cos(endAngleRad) * radius,
      y: center.y + Math.sin(endAngleRad) * radius
    },
    radius,
    startAngleDeg,
    endAngleDeg,
    ...arcTangentAngles({ startAngleDeg, endAngleDeg, sweepAngleDeg }),
    sweepAngleDeg,
    length: radius * Math.abs(degreesToRadians(sweepAngleDeg))
  };
};

export const throughArcGeometryKernel = (
  point1: StructuralPoint,
  point2: StructuralPoint,
  point3: StructuralPoint,
  startAngleDeg: number,
  endAngleDeg: number
): StructuralArcLine | null => {
  const denominator =
    2 *
    (point1.x * (point2.y - point3.y) +
      point2.x * (point3.y - point1.y) +
      point3.x * (point1.y - point2.y));

  if (Math.abs(denominator) < CIRCLE_EPSILON) return null;

  const point1Squared = point1.x * point1.x + point1.y * point1.y;
  const point2Squared = point2.x * point2.x + point2.y * point2.y;
  const point3Squared = point3.x * point3.x + point3.y * point3.y;
  const centerX =
    (point1Squared * (point2.y - point3.y) +
      point2Squared * (point3.y - point1.y) +
      point3Squared * (point1.y - point2.y)) /
    denominator;
  const centerY =
    (point1Squared * (point3.x - point2.x) +
      point2Squared * (point1.x - point3.x) +
      point3Squared * (point2.x - point1.x)) /
    denominator;
  const radius = Math.hypot(point1.x - centerX, point1.y - centerY);

  if (!Number.isFinite(centerX) || !Number.isFinite(centerY) || !Number.isFinite(radius) || radius <= CIRCLE_EPSILON) {
    return null;
  }
  return arcGeometryKernel({ x: centerX, y: centerY }, radius, startAngleDeg, endAngleDeg, "counterclockwise");
};

export type BezierGeometryIntermediate = {
  point: StructuralPoint;
  angleDeg: number;
  incomingLength: number;
  outgoingLength: number;
};

const bezierHandlePoint = (point: StructuralPoint, angleDeg: number, length: number): StructuralPoint => {
  const angleRad = degreesToRadians(angleDeg);
  return {
    x: point.x + Math.cos(angleRad) * length,
    y: point.y + Math.sin(angleRad) * length
  };
};

export const bezierGeometryKernel = (
  start: StructuralPoint,
  end: StructuralPoint,
  startAngleDeg: number,
  startLength: number,
  endAngleDeg: number,
  endLength: number,
  intermediates: readonly BezierGeometryIntermediate[]
): ComputedGeometryValueBezierCurve | null => {
  const anchors = [start, ...intermediates.map((intermediate) => intermediate.point), end];
  const outgoingHandles = [
    bezierHandlePoint(start, startAngleDeg, startLength),
    ...intermediates.map((intermediate) => bezierHandlePoint(intermediate.point, intermediate.angleDeg, intermediate.outgoingLength))
  ];
  const incomingHandles = [
    ...intermediates.map((intermediate) => bezierHandlePoint(intermediate.point, intermediate.angleDeg + 180, intermediate.incomingLength)),
    bezierHandlePoint(end, endAngleDeg + 180, endLength)
  ];
  const segments: BezierLikeSegment[] = anchors.slice(0, -1).map((anchor, index) => ({
    start: anchor,
    control1: outgoingHandles[index]!,
    control2: incomingHandles[index]!,
    end: anchors[index + 1]!
  }));
  if (segments.some((segment) => Object.values(segment).some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)))) return null;
  return {
    kind: "bezierCurve",
    segments,
    length: segments.reduce((sum, segment) => sum + approximateCubicLength(segment), 0)
  };
};
