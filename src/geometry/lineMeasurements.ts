import type {
  ComputedBezierCurve,
  ComputedBezierSegment,
  ComputedOffsetLine,
  ComputedOffsetLineSegment,
  ComputedPoint
} from "../types/geometry";
import { normalizeDegrees, radiansToDegrees } from "./evaluateGeometryPrimitives";

type Point = { x: number; y: number };

const EPSILON = 1e-9;

const angleFromTo = (start: Point, end: Point) => {
  const dx = end.x - start.x;
  const dy = start.y - end.y;
  const length = Math.hypot(dx, dy);
  return length <= EPSILON ? null : normalizeDegrees(radiansToDegrees(Math.atan2(dy, dx)));
};

const reverseAngle = (angle: number | null) => (angle === null ? null : normalizeDegrees(angle + 180));

const arcSweepDirection = (sweepAngleDeg: number) => (sweepAngleDeg >= 0 ? 90 : -90);

export const lineTangentAngles = (start: Point, end: Point) => {
  const startTangentAngleDeg = angleFromTo(start, end);
  return {
    startAngleDeg: startTangentAngleDeg,
    endAngleDeg: angleFromTo(end, start),
    startTangentAngleDeg,
    endTangentAngleDeg: angleFromTo(end, start)
  };
};

export const arcTangentAngles = ({
  startAngleDeg,
  endAngleDeg,
  sweepAngleDeg
}: {
  startAngleDeg: number;
  endAngleDeg: number;
  sweepAngleDeg: number;
}) => {
  const tangentOffset = arcSweepDirection(sweepAngleDeg);
  return {
    startTangentAngleDeg: normalizeDegrees(startAngleDeg + tangentOffset),
    endTangentAngleDeg: normalizeDegrees(endAngleDeg + tangentOffset + 180)
  };
};

const bezierSegmentStartForwardAngle = (segment: ComputedBezierSegment | Extract<ComputedOffsetLineSegment, { kind: "bezier" }>) =>
  angleFromTo(segment.start, segment.control1) ??
  angleFromTo(segment.start, segment.control2) ??
  angleFromTo(segment.start, segment.end);

const bezierSegmentEndForwardAngle = (segment: ComputedBezierSegment | Extract<ComputedOffsetLineSegment, { kind: "bezier" }>) =>
  angleFromTo(segment.control2, segment.end) ??
  angleFromTo(segment.control1, segment.end) ??
  angleFromTo(segment.start, segment.end);

export const bezierCurveEndpointPoints = (curve: ComputedBezierCurve) => {
  const first = curve.segments[0];
  const last = curve.segments.at(-1);
  return {
    start: first?.start ?? null,
    end: last?.end ?? null
  };
};

export const offsetSegmentStartForwardAngle = (segment: ComputedOffsetLineSegment) => {
  if (segment.kind === "line") return angleFromTo(segment.start, segment.end);
  if (segment.kind === "bezier") return bezierSegmentStartForwardAngle(segment);
  return normalizeDegrees(segment.startAngleDeg + arcSweepDirection(segment.sweepAngleDeg));
};

export const offsetSegmentEndForwardAngle = (segment: ComputedOffsetLineSegment) => {
  if (segment.kind === "line") return angleFromTo(segment.start, segment.end);
  if (segment.kind === "bezier") return bezierSegmentEndForwardAngle(segment);
  return normalizeDegrees(
    segment.startAngleDeg + segment.sweepAngleDeg + arcSweepDirection(segment.sweepAngleDeg)
  );
};

export const offsetLineEndpointMeasurements = (
  segments: ComputedOffsetLineSegment[]
): Pick<
  ComputedOffsetLine,
  "start" | "end" | "startTangentAngleDeg" | "endTangentAngleDeg"
> => {
  const first = segments[0];
  const last = segments.at(-1);
  return {
    start: first?.start ?? null,
    end: last?.end ?? null,
    startTangentAngleDeg: first ? offsetSegmentStartForwardAngle(first) : null,
    endTangentAngleDeg: last ? reverseAngle(offsetSegmentEndForwardAngle(last)) : null
  };
};

export const computedLineMeasurements = (start: ComputedPoint, end: ComputedPoint) =>
  lineTangentAngles(start, end);
