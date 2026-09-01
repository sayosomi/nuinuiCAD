import type {
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedBezierSegment,
  ComputedGeometry,
  ComputedLine,
  ComputedOffsetLine,
  ComputedOffsetLineSegment
} from "../types/geometry";
import { arcTangentAngles, lineTangentAngles, offsetLineEndpointMeasurements } from "./lineMeasurements";
import { angleOfPoint } from "./offsetPathMath";
import { approximateBezierSegmentLength } from "./evaluateGeometryPrimitives";
import { isLineLikeGeometry, type LineLikeGeometry } from "./linePaths";

const reverseBezierSegment = (segment: ComputedBezierSegment): ComputedBezierSegment => ({
  startPointId: segment.endPointId,
  endPointId: segment.startPointId,
  start: segment.end,
  control1: segment.control2,
  control2: segment.control1,
  end: segment.start
});

const reverseOffsetSegment = (segment: ComputedOffsetLineSegment): ComputedOffsetLineSegment => {
  if (segment.kind === "line") return { ...segment, start: segment.end, end: segment.start };
  if (segment.kind === "bezier") {
    const next = { ...segment, start: segment.end, control1: segment.control2, control2: segment.control1, end: segment.start };
    return { ...next, length: approximateBezierSegmentLength({ startPointId: null, endPointId: null, ...next }) };
  }
  return {
    ...segment,
    start: segment.end,
    end: segment.start,
    startAngleDeg: segment.startAngleDeg + segment.sweepAngleDeg,
    sweepAngleDeg: -segment.sweepAngleDeg
  };
};

const reverseLine = (line: ComputedLine): ComputedLine => ({
  ...line,
  startPointId: line.endPointId,
  endPointId: line.startPointId,
  start: line.end,
  end: line.start,
  ...lineTangentAngles(line.end, line.start)
});

const reverseArc = (arc: ComputedArcLine): ComputedArcLine => {
  const startAngleDeg = arc.startAngleDeg + arc.sweepAngleDeg;
  const endAngleDeg = arc.startAngleDeg;
  const sweepAngleDeg = -arc.sweepAngleDeg;
  return {
    ...arc,
    start: arc.end,
    end: arc.start,
    startAngleDeg,
    endAngleDeg,
    sweepAngleDeg,
    ...arcTangentAngles({ startAngleDeg, endAngleDeg, sweepAngleDeg })
  };
};

const reverseBezier = (curve: ComputedBezierCurve): ComputedBezierCurve => {
  const segments = [...curve.segments].reverse().map(reverseBezierSegment);
  const start = segments[0]?.start;
  const end = segments.at(-1)?.end;
  return {
    ...curve,
    startPointId: curve.endPointId,
    endPointId: curve.startPointId,
    intermediateSlotIds: [...curve.intermediateSlotIds].reverse(),
    segments,
    startHandleAngleDeg: curve.endHandleAngleDeg,
    startHandleLength: curve.endHandleLength,
    endHandleAngleDeg: curve.startHandleAngleDeg,
    endHandleLength: curve.startHandleLength,
    startTangentAngleDeg: start && segments[0] ? angleOfPoint(start, segments[0].control1) : null,
    endTangentAngleDeg: end && segments.at(-1) ? angleOfPoint(end, segments.at(-1)!.control2) : null
  };
};

const reverseOffset = (line: ComputedOffsetLine): ComputedOffsetLine => {
  const segments = [...line.segments].reverse().map(reverseOffsetSegment);
  return {
    ...line,
    segments,
    ...offsetLineEndpointMeasurements(segments)
  };
};

const reversePolyline = (line: Extract<LineLikeGeometry, { kind: "polyline" }>): LineLikeGeometry => {
  const segments = [...line.segments].reverse().map((segment) => ({
    ...segment,
    start: segment.end,
    end: segment.start
  }));
  const nonZero = segments.filter((segment) => segment.length > 1e-9);
  const first = segments[0];
  const last = segments.at(-1);
  const firstNonZero = nonZero[0];
  const lastNonZero = nonZero.at(-1);
  return {
    ...line,
    segments,
    start: first?.start ?? line.start,
    end: line.closed ? (first?.start ?? line.start) : (last?.end ?? line.end),
    startTangentAngleDeg: firstNonZero ? lineTangentAngles(firstNonZero.start, firstNonZero.end).startTangentAngleDeg : null,
    endTangentAngleDeg: lastNonZero ? lineTangentAngles(lastNonZero.start, lastNonZero.end).endTangentAngleDeg : null
  };
};

/** Reverses the semantic traversal of an already evaluated path without moving it. */
export const reverseLineLikeGeometry = (geometry: LineLikeGeometry): LineLikeGeometry => {
  if (geometry.kind === "line") return reverseLine(geometry);
  if (geometry.kind === "arcLine") return reverseArc(geometry);
  if (geometry.kind === "bezierCurve") return reverseBezier(geometry);
  if (geometry.kind === "polyline") return reversePolyline(geometry);
  return reverseOffset(geometry);
};

export const reverseComputedPathGeometry = (geometry: ComputedGeometry): ComputedGeometry | null =>
  isLineLikeGeometry(geometry) ? reverseLineLikeGeometry(geometry) : null;
