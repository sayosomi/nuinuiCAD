import type { ComputedGeometry, ComputedGeometryValue, ComputedGeometryValueJoinedPath, ComputedGeometryValueOffsetLineSegment } from "./evaluationTypes";
import { approximateBezierSegmentLength } from "./evaluateGeometryPrimitives";
import { offsetLineEndpointMeasurements } from "./lineMeasurements";
import { lineLength } from "./offsetPathMath";
import { sourceEnd, sourceSegmentsForGeometry, sourceStart } from "./offsetSourceSegments";
import type { Point, SourceSegment } from "./offsetPathTypes";

const EPSILON = 1e-9;

const plainPoint = (point: Point): Point => ({ x: point.x, y: point.y });

const reverseSegment = (segment: SourceSegment): SourceSegment => {
  if (segment.kind === "line") return { kind: "line", start: segment.end, end: segment.start };
  if (segment.kind === "bezier") {
    return {
      kind: "bezier",
      start: segment.end,
      control1: segment.control2,
      control2: segment.control1,
      end: segment.start
    };
  }
  return {
    kind: "arc",
    center: segment.center,
    radius: segment.radius,
    startAngleDeg: segment.startAngleDeg + segment.sweepAngleDeg,
    sweepAngleDeg: -segment.sweepAngleDeg
  };
};

const reverseSegments = (segments: readonly SourceSegment[]): SourceSegment[] =>
  segments.slice().reverse().map(reverseSegment);

const exactSegment = (segment: SourceSegment): ComputedGeometryValueOffsetLineSegment => {
  if (segment.kind === "line") {
    return { kind: "line", start: plainPoint(segment.start), end: plainPoint(segment.end), length: lineLength(segment.start, segment.end) };
  }
  if (segment.kind === "bezier") {
    const length = approximateBezierSegmentLength(segment as never);
    return {
      kind: "bezier",
      start: plainPoint(segment.start),
      control1: plainPoint(segment.control1),
      control2: plainPoint(segment.control2),
      end: plainPoint(segment.end),
      length
    };
  }
  const start = sourceStart(segment);
  const end = sourceEnd(segment);
  return {
    kind: "arc",
    center: plainPoint(segment.center),
    start: plainPoint(start),
    end: plainPoint(end),
    radius: segment.radius,
    startAngleDeg: segment.startAngleDeg,
    sweepAngleDeg: segment.sweepAngleDeg,
    length: segment.radius * Math.abs(segment.sweepAngleDeg * Math.PI / 180)
  };
};

const endpoints = (segments: readonly SourceSegment[]): { start: Point; end: Point } | null => {
  const first = segments[0];
  const last = segments.at(-1);
  return first && last ? { start: sourceStart(first), end: sourceEnd(last) } : null;
};

export const joinedPathGeometryValueKernel = (
  sources: readonly (ComputedGeometry | ComputedGeometryValue)[],
  closed: boolean
): ComputedGeometryValueJoinedPath | { error: string } => {
  if (sources.length === 0) return { error: "join geometry value construction requires at least one path." };

  const oriented: SourceSegment[] = [];
  for (const source of sources) {
    const segments = sourceSegmentsForGeometry(source);
    if (segments.length === 0) return { error: "join geometry value construction contains an empty or unsupported path." };
    const previousEnd = oriented.length > 0 ? sourceEnd(oriented.at(-1)!) : null;
    const authored = endpoints(segments);
    if (!authored) return { error: "join geometry value construction contains a path without endpoints." };
    if (!previousEnd || lineLength(previousEnd, authored.start) <= EPSILON) {
      oriented.push(...segments);
    } else if (lineLength(previousEnd, authored.end) <= EPSILON) {
      oriented.push(...reverseSegments(segments));
    } else {
      return { error: "join geometry value construction paths are not continuous in the specified order." };
    }
  }

  const first = endpoints(oriented);
  if (!first) return { error: "join geometry value construction produced no segments." };
  if (closed && lineLength(first.end, sourceStart(oriented[0]!)) > EPSILON) {
    return { error: "join geometry value construction is closed but the final path does not connect to the first path." };
  }

  const segments = oriented.map(exactSegment);
  const measurements = offsetLineEndpointMeasurements(segments as never);
  return {
    kind: "joinedPath",
    start: segments[0]?.start ?? null,
    end: segments.at(-1)?.end ?? null,
    segments,
    closed,
    length: segments.reduce((total, segment) => total + segment.length, 0),
    startTangentAngleDeg: measurements.startTangentAngleDeg,
    endTangentAngleDeg: measurements.endTangentAngleDeg
  };
};
