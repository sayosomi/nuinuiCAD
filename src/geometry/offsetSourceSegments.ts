import type { ComputedBezierCurve, ComputedGeometry } from "../types/geometry";
import type { Point, SourceSegment } from "./offsetPathTypes";
import { unitTangentAt } from "./offsetBezier";
import { EPSILON, arcPoint, degreesToRadians, lineLength } from "./offsetPathMath";

const bezierSourceSegments = (curve: ComputedBezierCurve): SourceSegment[] =>
  curve.segments.map((segment) => ({
    kind: "bezier" as const,
    start: segment.start,
    control1: segment.control1,
    control2: segment.control2,
    end: segment.end
  }));

export const sourceSegmentsForGeometry = (geometry: ComputedGeometry): SourceSegment[] => {
  if (geometry.kind === "line") {
    return [{ kind: "line", start: geometry.start, end: geometry.end }];
  }
  if (geometry.kind === "arcLine") {
    return [
      {
        kind: "arc",
        center: geometry.center,
        radius: Math.max(geometry.radius, 0),
        startAngleDeg: geometry.startAngleDeg,
        sweepAngleDeg: geometry.sweepAngleDeg
      }
    ];
  }
  if (geometry.kind === "bezierCurve") return bezierSourceSegments(geometry);
  if (geometry.kind === "offsetLine") {
    return geometry.segments.map((segment) =>
      segment.kind === "line"
        ? { kind: "line", start: segment.start, end: segment.end }
        : segment.kind === "bezier"
          ? {
              kind: "bezier",
              start: segment.start,
              control1: segment.control1,
              control2: segment.control2,
              end: segment.end
            }
          : {
              kind: "arc",
              center: segment.center,
              radius: segment.radius,
              startAngleDeg: segment.startAngleDeg,
              sweepAngleDeg: segment.sweepAngleDeg
            }
    );
  }
  return [];
};

export const sourceEnd = (segment: SourceSegment) =>
  segment.kind === "line"
    ? segment.end
    : segment.kind === "bezier"
      ? segment.end
      : arcPoint(segment.center, segment.radius, segment.startAngleDeg + segment.sweepAngleDeg);

export const sourceStart = (segment: SourceSegment) =>
  segment.kind === "line"
    ? segment.start
    : segment.kind === "bezier"
      ? segment.start
      : arcPoint(segment.center, segment.radius, segment.startAngleDeg);

export const connectorSegment = (start: Point, end: Point): SourceSegment | null =>
  lineLength(start, end) <= EPSILON ? null : { kind: "line", start, end };

export const sourceStartTangent = (segment: SourceSegment): Point | null => {
  if (segment.kind === "line") {
    const length = lineLength(segment.start, segment.end);
    return length <= EPSILON
      ? null
      : { x: (segment.end.x - segment.start.x) / length, y: (segment.end.y - segment.start.y) / length };
  }
  if (segment.kind === "bezier") return unitTangentAt(segment, 0);

  const tangentAngle = degreesToRadians(segment.startAngleDeg + (segment.sweepAngleDeg >= 0 ? 90 : -90));
  return {
    x: Math.cos(tangentAngle),
    y: Math.sin(tangentAngle)
  };
};

export const sourceEndTangent = (segment: SourceSegment): Point | null => {
  if (segment.kind === "line") {
    const length = lineLength(segment.start, segment.end);
    return length <= EPSILON
      ? null
      : { x: (segment.end.x - segment.start.x) / length, y: (segment.end.y - segment.start.y) / length };
  }
  if (segment.kind === "bezier") return unitTangentAt(segment, 1);

  const endAngleDeg = segment.startAngleDeg + segment.sweepAngleDeg;
  const tangentAngle = degreesToRadians(endAngleDeg + (segment.sweepAngleDeg >= 0 ? 90 : -90));
  return {
    x: Math.cos(tangentAngle),
    y: Math.sin(tangentAngle)
  };
};

export const connectSourceSegmentGroups = (groups: SourceSegment[][], closed: boolean): SourceSegment[] | null => {
  // Direction is source-owned. Do not silently reverse a path just because it
  // makes a nearer join; users express that intention with `reverse Name`.
  const orientedGroups = groups;
  const connected: SourceSegment[] = [];

  for (const group of orientedGroups) {
    if (group.length === 0) continue;
    if (connected.length > 0) {
      if (connectorSegment(sourceEnd(connected.at(-1)!), sourceStart(group[0]))) return null;
    }
    connected.push(...group);
  }

  if (closed && connected.length > 1 && connectorSegment(sourceEnd(connected.at(-1)!), sourceStart(connected[0]))) return null;
  return connected;
};
