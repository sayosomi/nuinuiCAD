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

const reverseSourceSegment = (segment: SourceSegment): SourceSegment =>
  segment.kind === "line"
    ? { kind: "line", start: segment.end, end: segment.start }
    : segment.kind === "bezier"
      ? {
          kind: "bezier",
          start: segment.end,
          control1: segment.control2,
          control2: segment.control1,
          end: segment.start
        }
      : {
          ...segment,
          startAngleDeg: segment.startAngleDeg + segment.sweepAngleDeg,
          sweepAngleDeg: -segment.sweepAngleDeg
        };

const reverseSourceSegments = (segments: SourceSegment[]) =>
  [...segments].reverse().map(reverseSourceSegment);

type OrientedSourceGroup = {
  segments: SourceSegment[];
  cost: number;
  previousOrientation: 0 | 1 | null;
};

const groupConnectionCost = (previous: SourceSegment[], next: SourceSegment[]) =>
  lineLength(sourceEnd(previous.at(-1)!), sourceStart(next[0]));

const orientSourceGroupsForInitialOrientation = (
  groups: SourceSegment[][],
  initialOrientation: 0 | 1,
  closed: boolean
) => {
  const candidates = groups.map((group) => [group, reverseSourceSegments(group)] as const);
  const states: OrientedSourceGroup[][] = [
    [
      {
        segments: candidates[0][0],
        cost: initialOrientation === 0 ? 0 : Number.POSITIVE_INFINITY,
        previousOrientation: null
      },
      {
        segments: candidates[0][1],
        cost: initialOrientation === 1 ? 0 : Number.POSITIVE_INFINITY,
        previousOrientation: null
      }
    ]
  ];

  for (let index = 1; index < candidates.length; index += 1) {
    states[index] = candidates[index].map((segments) => {
      const previousOptions = states[index - 1].map((previous, previousOrientation) => ({
        previous,
        previousOrientation: previousOrientation as 0 | 1,
        cost: previous.cost + groupConnectionCost(previous.segments, segments)
      }));
      const best = previousOptions[0].cost <= previousOptions[1].cost
        ? previousOptions[0]
        : previousOptions[1];
      return {
        segments,
        cost: best.cost,
        previousOrientation: best.previousOrientation
      };
    });
  }

  const lastStates = states.at(-1)!;
  const terminalOptions = lastStates.map((state, orientation) => ({
    state,
    orientation: orientation as 0 | 1,
    cost: closed
      ? state.cost + groupConnectionCost(state.segments, candidates[0][initialOrientation])
      : state.cost
  }));
  const terminal = terminalOptions[0].cost <= terminalOptions[1].cost
    ? terminalOptions[0]
    : terminalOptions[1];

  const orientedGroups: SourceSegment[][] = [];
  let orientation = terminal.orientation;
  for (let index = states.length - 1; index >= 0; index -= 1) {
    orientedGroups[index] = states[index][orientation].segments;
    const previous = states[index][orientation].previousOrientation;
    if (previous !== null) {
      orientation = previous;
    }
  }

  return {
    groups: orientedGroups,
    cost: terminal.cost
  };
};

const orientSourceGroups = (groups: SourceSegment[][], closed: boolean) => {
  if (groups.length <= 1) return groups;

  const forwardInitial = orientSourceGroupsForInitialOrientation(groups, 0, closed);
  const reversedInitial = orientSourceGroupsForInitialOrientation(groups, 1, closed);
  return forwardInitial.cost <= reversedInitial.cost ? forwardInitial.groups : reversedInitial.groups;
};

export const connectSourceSegmentGroups = (groups: SourceSegment[][], closed: boolean) => {
  const orientedGroups = orientSourceGroups(groups, closed);
  const connected: SourceSegment[] = [];

  for (const group of orientedGroups) {
    if (group.length === 0) continue;
    if (connected.length > 0) {
      const connector = connectorSegment(sourceEnd(connected.at(-1)!), sourceStart(group[0]));
      if (connector) connected.push(connector);
    }
    connected.push(...group);
  }

  return connected;
};
