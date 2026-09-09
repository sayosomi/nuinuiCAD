import type { ComputedGeometryValueOffsetLine, ComputedGeometryValueOffsetLineSegment } from "./evaluationTypes";
import { approximateBezierSegmentLength } from "./evaluateGeometryPrimitives";
import { angleOfPoint, lineLength } from "./offsetPathMath";
import { sourceEnd, sourceStart } from "./offsetSourceSegments";
import type { Point, SourceSegment } from "./offsetPathTypes";
import { offsetLineEndpointMeasurements } from "./lineMeasurements";

const EPSILON = 1e-9;

export type CopyPathTransform =
  | {
      kind: "transform";
      startPoint: Point;
      endPoint: Point;
      scale: number;
      angleDeg: number;
      mirrorX: boolean;
    }
  | {
      kind: "mirror";
      axis1: Point;
      axis2: Point;
    };

const transformPoint = (point: Point, transform: CopyPathTransform): Point | null => {
  if (transform.kind === "transform") {
    const moved = {
      x: point.x + transform.endPoint.x - transform.startPoint.x,
      y: point.y + transform.endPoint.y - transform.startPoint.y
    };
    const mirrored = transform.mirrorX
      ? { x: 2 * transform.endPoint.x - moved.x, y: moved.y }
      : moved;
    const dx = mirrored.x - transform.endPoint.x;
    const dy = mirrored.y - transform.endPoint.y;
    const angleRad = transform.angleDeg * Math.PI / 180;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    return {
      x: transform.endPoint.x + transform.scale * (dx * cos - dy * sin),
      y: transform.endPoint.y + transform.scale * (dx * sin + dy * cos)
    };
  }
  const axis = {
    x: transform.axis2.x - transform.axis1.x,
    y: transform.axis2.y - transform.axis1.y
  };
  const axisLengthSquared = axis.x * axis.x + axis.y * axis.y;
  if (axisLengthSquared <= EPSILON * EPSILON) return null;
  const relative = {
    x: point.x - transform.axis1.x,
    y: point.y - transform.axis1.y
  };
  const projectionScale = (relative.x * axis.x + relative.y * axis.y) / axisLengthSquared;
  return {
    x: transform.axis1.x + 2 * projectionScale * axis.x - relative.x,
    y: transform.axis1.y + 2 * projectionScale * axis.y - relative.y
  };
};

const reverseOrientation = (transform: CopyPathTransform) =>
  transform.kind === "mirror" || transform.mirrorX;

export const transformedCopyPathSegments = (
  sourceSegments: readonly SourceSegment[],
  transform: CopyPathTransform
): ComputedGeometryValueOffsetLineSegment[] => {
  const output: ComputedGeometryValueOffsetLineSegment[] = [];
  for (const segment of sourceSegments) {
    if (segment.kind === "line") {
      const start = transformPoint(segment.start, transform);
      const end = transformPoint(segment.end, transform);
      if (!start || !end) continue;
      const length = lineLength(start, end);
      if (length > EPSILON) output.push({ kind: "line", start, end, length });
      continue;
    }
    if (segment.kind === "bezier") {
      const start = transformPoint(segment.start, transform);
      const control1 = transformPoint(segment.control1, transform);
      const control2 = transformPoint(segment.control2, transform);
      const end = transformPoint(segment.end, transform);
      if (!start || !control1 || !control2 || !end) continue;
      const length = approximateBezierSegmentLength({ start, control1, control2, end } as never);
      if (length > EPSILON) output.push({ kind: "bezier", start, control1, control2, end, length });
      continue;
    }
    const center = transformPoint(segment.center, transform);
    const start = transformPoint(sourceStart(segment), transform);
    const end = transformPoint(sourceEnd(segment), transform);
    if (!center || !start || !end) continue;
    const radius = lineLength(center, start);
    const sweepAngleDeg = reverseOrientation(transform) ? -segment.sweepAngleDeg : segment.sweepAngleDeg;
    output.push({
      kind: "arc",
      center,
      start,
      end,
      radius,
      startAngleDeg: angleOfPoint(center, start),
      sweepAngleDeg,
      length: radius * Math.abs(sweepAngleDeg * Math.PI / 180)
    });
  }
  return output;
};

export const copyPathGeometry = (
  sourceSegments: readonly SourceSegment[],
  transform: CopyPathTransform
): ComputedGeometryValueOffsetLine | null => {
  const segments = transformedCopyPathSegments(sourceSegments, transform);
  if (segments.length === 0) return null;
  const measurements = offsetLineEndpointMeasurements(segments as never);
  return {
    kind: "offsetLine",
    start: segments[0]?.start ?? null,
    end: segments.at(-1)?.end ?? null,
    segments,
    closed: false,
    length: segments.reduce((total, segment) => total + segment.length, 0),
    startTangentAngleDeg: measurements.startTangentAngleDeg,
    endTangentAngleDeg: measurements.endTangentAngleDeg
  };
};
