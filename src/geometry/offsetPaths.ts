import type {
  ComputedGeometry,
  ComputedOffsetLine,
  ComputedOffsetLineSegment,
  ElementId
} from "../types/geometry";
import { offsetBezierSegmentGroups } from "./offsetBezier";
import {
  joinIntersection,
  lineConnector,
  namedSegment,
  pointedJoinConnectors,
  segmentEnd,
  segmentStart,
  withEnd,
  withStart
} from "./offsetJoins";
import { EPSILON, arcPoint, computedPoint, degreesToRadians, lineLength, normalizeDegrees } from "./offsetPathMath";
import type { RawOffsetSegment, SourceSegment } from "./offsetPathTypes";
import {
  connectSourceSegmentGroups,
  connectorSegment,
  sourceEnd,
  sourceSegmentsForGeometry,
  sourceStart
} from "./offsetSourceSegments";

const offsetLineSegment = (
  segment: Extract<SourceSegment, { kind: "line" }>,
  offset: number
): ComputedOffsetLineSegment | null => {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const length = Math.hypot(dx, dy);
  if (length <= EPSILON) return null;

  const nx = (-dy / length) * offset;
  const ny = (dx / length) * offset;
  const start = { x: segment.start.x + nx, y: segment.start.y + ny };
  const end = { x: segment.end.x + nx, y: segment.end.y + ny };

  return {
    kind: "line",
    start: computedPoint("", "", start),
    end: computedPoint("", "", end),
    length: lineLength(start, end)
  };
};

const offsetArcSegment = (
  segment: Extract<SourceSegment, { kind: "arc" }>,
  offset: number,
  elementName: string
) => {
  const radius = segment.radius + (segment.sweepAngleDeg >= 0 ? offset : -offset);
  if (radius <= EPSILON) {
    return {
      segment: null,
      error: `${elementName} はオフセット後の円弧半径が0以下になるため作図できません。オフセット量または左右を変更してください。`
    };
  }

  const start = arcPoint(segment.center, radius, segment.startAngleDeg);
  const end = arcPoint(segment.center, radius, segment.startAngleDeg + segment.sweepAngleDeg);

  return {
    segment: {
      kind: "arc" as const,
      center: computedPoint("", "", segment.center),
      start: computedPoint("", "", start),
      end: computedPoint("", "", end),
      radius,
      startAngleDeg: normalizeDegrees(segment.startAngleDeg),
      sweepAngleDeg: segment.sweepAngleDeg,
      length: radius * Math.abs(degreesToRadians(segment.sweepAngleDeg))
    },
    error: null
  };
};

export const isLineLikeGeometry = (geometry: ComputedGeometry | undefined) =>
  geometry?.kind === "line" ||
  geometry?.kind === "arcLine" ||
  geometry?.kind === "bezierCurve" ||
  geometry?.kind === "offsetLine";

export const lineLikeElementTypes = [
  "line",
  "arcLine",
  "threePointArcLine",
  "cornerRadiusArcLine",
  "bezierCurve",
  "offsetLine",
  "copyLine"
] as const;

export const buildOffsetLineGeometry = ({
  elementId,
  name,
  baseLineIds,
  baseGeometries,
  offset,
  closed
}: {
  elementId: ElementId;
  name: string;
  baseLineIds: ElementId[];
  baseGeometries: ComputedGeometry[];
  offset: number;
  closed: boolean;
}): { geometry?: ComputedOffsetLine; error?: string; warnings?: string[] } => {
  const sourceSegmentGroups = baseGeometries
    .map(sourceSegmentsForGeometry)
    .filter((segments) => segments.length > 0);
  if (sourceSegmentGroups.length === 0) {
    return { error: `${name} は基準線から作図できる線分がありません。基準線を指定してください。` };
  }

  const connectedSourceSegments = connectSourceSegmentGroups(sourceSegmentGroups, closed);

  if (closed) {
    const connector = connectorSegment(
      sourceEnd(connectedSourceSegments.at(-1)!),
      sourceStart(connectedSourceSegments[0])
    );
    if (connector) connectedSourceSegments.push(connector);
  }

  const rawSegments: RawOffsetSegment[] = [];
  const warnings: string[] = [];
  for (const segment of connectedSourceSegments) {
    if (segment.kind === "line") {
      const next = offsetLineSegment(segment, offset);
      if (next) rawSegments.push({ segment: next, joinWithPrevious: "miter", source: segment });
      continue;
    }
    if (segment.kind === "bezier") {
      const result = offsetBezierSegmentGroups(segment, offset);
      if (result.trimmed && warnings.length === 0) {
        warnings.push(
          `${name} はオフセット量が曲線の曲率半径を超える箇所があるため、一部区間をトリムしました。オフセット量を下げると全体を作図できます。`
        );
      }
      result.groups.forEach((group, groupIndex) => {
        group.forEach((next, index) => {
          rawSegments.push({
            segment: next,
            joinWithPrevious: index > 0 ? "smooth" : groupIndex > 0 ? "none" : "miter",
            source: segment
          });
        });
      });
      continue;
    }

    const next = offsetArcSegment(segment, offset, name);
    if (next.error) return { error: next.error };
    if (next.segment) rawSegments.push({ segment: next.segment, joinWithPrevious: "miter", source: segment });
  }

  if (rawSegments.length === 0) {
    return { error: `${name} は基準線から作図できる長さの線分がありません。` };
  }

  const adjusted = rawSegments.map((item) => item.segment);
  const connectors: Array<{ index: number; segment: ComputedOffsetLineSegment }> = [];
  const joinCount = closed ? adjusted.length : adjusted.length - 1;
  for (let index = 0; index < joinCount; index += 1) {
    const nextIndex = (index + 1) % adjusted.length;
    const joinMode = rawSegments[nextIndex]?.joinWithPrevious;
    if (joinMode === "smooth" || joinMode === "none") continue;

    const intersection = joinIntersection(adjusted[index], adjusted[nextIndex]);
    if (intersection) {
      adjusted[index] = withEnd(adjusted[index], intersection, elementId, name);
      adjusted[nextIndex] = withStart(adjusted[nextIndex], intersection, elementId, name);
      continue;
    }

    const pointedConnectors = pointedJoinConnectors({
      previous: { ...rawSegments[index], segment: adjusted[index] },
      next: { ...rawSegments[nextIndex], segment: adjusted[nextIndex] },
      offset,
      elementId,
      name,
      index
    });
    if (pointedConnectors.length > 0) {
      pointedConnectors.forEach((segment) => connectors.push({ index, segment }));
      continue;
    }

    const connector = lineConnector(
      segmentEnd(adjusted[index]),
      segmentStart(adjusted[nextIndex]),
      elementId,
      name,
      index
    );
    if (connector) connectors.push({ index, segment: connector });
  }

  const outputSegments: ComputedOffsetLineSegment[] = [];
  adjusted.forEach((segment, index) => {
    outputSegments.push(namedSegment(segment, elementId, name, outputSegments.length));
    for (const connector of connectors.filter((item) => item.index === index)) {
      outputSegments.push(namedSegment(connector.segment, elementId, name, outputSegments.length));
    }
  });

  return {
    geometry: {
      kind: "offsetLine",
      elementId,
      name,
      baseLineIds,
      segments: outputSegments,
      closed,
      length: outputSegments.reduce((sum, segment) => sum + segment.length, 0)
    },
    warnings
  };
};
