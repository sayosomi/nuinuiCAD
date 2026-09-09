import type { ArcDirection } from "../types/geometry";
import type {
  ComputedGeometryValueBezierCurve,
  ComputedGeometryValueOffsetLine,
  ComputedGeometryValueOffsetLineSegment,
  ComputedGeometryValuePolyline,
  ComputedOffsetLine
} from "./evaluationTypes";
import { approximateCubicLength, type BezierLikeSegment } from "./bezierMath";
import { CIRCLE_EPSILON, degreesToRadians, directedSweepDegrees } from "./evaluateGeometryPrimitives";
import { arcTangentAngles, lineTangentAngles } from "./lineMeasurements";

export type StructuralPoint = { x: number; y: number };

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
