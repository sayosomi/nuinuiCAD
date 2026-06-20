import type {
  ComputedBezierCurve,
  ComputedGeometry,
  ComputedOffsetLine,
  ComputedOffsetLineSegment,
  ComputedPoint,
  ElementId
} from "../types/geometry";

type Point = { x: number; y: number };

type SourceSegment =
  | { kind: "line"; start: Point; end: Point }
  | {
      kind: "bezier";
      start: Point;
      control1: Point;
      control2: Point;
      end: Point;
    }
  | {
      kind: "arc";
      center: Point;
      radius: number;
      startAngleDeg: number;
      sweepAngleDeg: number;
    };

type RawOffsetSegment = {
  segment: ComputedOffsetLineSegment;
  joinWithPrevious: "miter" | "smooth" | "none";
  source: SourceSegment;
};

const BEZIER_OFFSET_FLATNESS_TOLERANCE_MM = 0.1;
const BEZIER_OFFSET_MAX_DEPTH = 12;
const BEZIER_LENGTH_STEPS = 16;
const OVER_OFFSET_SAMPLE_STEPS = 64;
const OVER_OFFSET_MIN_SCALE = 0.02;
const POINTED_JOIN_DOT_THRESHOLD = -0.95;
const POINTED_JOIN_MITER_FACTOR = 4;
const POINTED_JOIN_MAX_LENGTH = 200;
const EPSILON = 1e-9;

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;
const radiansToDegrees = (radians: number) => (radians * 180) / Math.PI;
const normalizeDegrees = (degrees: number) => ((degrees % 360) + 360) % 360;
const positiveSweepDegrees = (startAngleDeg: number, endAngleDeg: number) =>
  normalizeDegrees(endAngleDeg - startAngleDeg);

const computedPoint = (
  elementId: ElementId,
  name: string,
  point: Point
): ComputedPoint => ({
  kind: "point",
  elementId,
  name,
  x: point.x,
  y: point.y
});

const arcPoint = (center: Point, radius: number, angleDeg: number): Point => {
  const angleRad = degreesToRadians(angleDeg);
  return {
    x: center.x + Math.cos(angleRad) * radius,
    y: center.y - Math.sin(angleRad) * radius
  };
};

const angleOfPoint = (center: Point, point: Point) =>
  normalizeDegrees(radiansToDegrees(Math.atan2(center.y - point.y, point.x - center.x)));

const lineLength = (start: Point, end: Point) => Math.hypot(end.x - start.x, end.y - start.y);

const bezierSourceSegments = (curve: ComputedBezierCurve): SourceSegment[] =>
  curve.segments.map((segment) => ({
    kind: "bezier" as const,
    start: segment.start,
    control1: segment.control1,
    control2: segment.control2,
    end: segment.end
  }));

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

const cubicSourcePointAt = (
  segment: Extract<SourceSegment, { kind: "bezier" }>,
  t: number
): Point => {
  const inverse = 1 - t;
  const a = inverse * inverse * inverse;
  const b = 3 * inverse * inverse * t;
  const c = 3 * inverse * t * t;
  const d = t * t * t;

  return {
    x:
      a * segment.start.x +
      b * segment.control1.x +
      c * segment.control2.x +
      d * segment.end.x,
    y:
      a * segment.start.y +
      b * segment.control1.y +
      c * segment.control2.y +
      d * segment.end.y
  };
};

const cubicDerivativeAt = (
  segment: Extract<SourceSegment, { kind: "bezier" }>,
  t: number
): Point => {
  const inverse = 1 - t;
  return {
    x:
      3 * inverse * inverse * (segment.control1.x - segment.start.x) +
      6 * inverse * t * (segment.control2.x - segment.control1.x) +
      3 * t * t * (segment.end.x - segment.control2.x),
    y:
      3 * inverse * inverse * (segment.control1.y - segment.start.y) +
      6 * inverse * t * (segment.control2.y - segment.control1.y) +
      3 * t * t * (segment.end.y - segment.control2.y)
  };
};

const cubicSecondDerivativeAt = (
  segment: Extract<SourceSegment, { kind: "bezier" }>,
  t: number
): Point => ({
  x:
    6 * (1 - t) * (segment.control2.x - 2 * segment.control1.x + segment.start.x) +
    6 * t * (segment.end.x - 2 * segment.control2.x + segment.control1.x),
  y:
    6 * (1 - t) * (segment.control2.y - 2 * segment.control1.y + segment.start.y) +
    6 * t * (segment.end.y - 2 * segment.control2.y + segment.control1.y)
});

const fallbackTangent = (
  segment: Extract<SourceSegment, { kind: "bezier" }>,
  atEnd: boolean
): Point => {
  const candidates = atEnd
    ? [
        { x: segment.end.x - segment.control2.x, y: segment.end.y - segment.control2.y },
        { x: segment.end.x - segment.control1.x, y: segment.end.y - segment.control1.y },
        { x: segment.end.x - segment.start.x, y: segment.end.y - segment.start.y }
      ]
    : [
        { x: segment.control1.x - segment.start.x, y: segment.control1.y - segment.start.y },
        { x: segment.control2.x - segment.start.x, y: segment.control2.y - segment.start.y },
        { x: segment.end.x - segment.start.x, y: segment.end.y - segment.start.y }
      ];

  return candidates.find((candidate) => Math.hypot(candidate.x, candidate.y) > EPSILON) ?? { x: 1, y: 0 };
};

const offsetPointByTangent = (point: Point, tangent: Point, offset: number): Point => {
  const length = Math.hypot(tangent.x, tangent.y);
  if (length <= EPSILON) return point;
  return {
    x: point.x + (-tangent.y / length) * offset,
    y: point.y + (tangent.x / length) * offset
  };
};

const squaredDistance = (first: Point, second: Point) => {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  return dx * dx + dy * dy;
};

const cubicPoint = (
  start: Point,
  control1: Point,
  control2: Point,
  end: Point,
  t: number
): Point => {
  const inverse = 1 - t;
  const a = inverse * inverse * inverse;
  const b = 3 * inverse * inverse * t;
  const c = 3 * inverse * t * t;
  const d = t * t * t;

  return {
    x: a * start.x + b * control1.x + c * control2.x + d * end.x,
    y: a * start.y + b * control1.y + c * control2.y + d * end.y
  };
};

const unitTangentAt = (
  segment: Extract<SourceSegment, { kind: "bezier" }>,
  t: number
): Point => {
  const tangent = cubicDerivativeAt(segment, t);
  const length = Math.hypot(tangent.x, tangent.y);
  if (length > EPSILON) return { x: tangent.x / length, y: tangent.y / length };

  const fallback = fallbackTangent(segment, t >= 0.5);
  const fallbackLength = Math.hypot(fallback.x, fallback.y);
  return fallbackLength > EPSILON
    ? { x: fallback.x / fallbackLength, y: fallback.y / fallbackLength }
    : { x: 1, y: 0 };
};

const offsetPointAt = (
  segment: Extract<SourceSegment, { kind: "bezier" }>,
  t: number,
  offset: number
): Point => offsetPointByTangent(cubicSourcePointAt(segment, t), unitTangentAt(segment, t), offset);

const signedCurvatureAt = (
  segment: Extract<SourceSegment, { kind: "bezier" }>,
  t: number
) => {
  const first = cubicDerivativeAt(segment, t);
  const second = cubicSecondDerivativeAt(segment, t);
  const speed = Math.hypot(first.x, first.y);
  if (speed <= EPSILON) return 0;
  return (first.x * second.y - first.y * second.x) / speed ** 3;
};

const offsetScaleAt = (
  segment: Extract<SourceSegment, { kind: "bezier" }>,
  t: number,
  offset: number
) => 1 - offset * signedCurvatureAt(segment, t);

const isSafeOffsetT = (
  segment: Extract<SourceSegment, { kind: "bezier" }>,
  t: number,
  offset: number
) => offsetScaleAt(segment, t, offset) > OVER_OFFSET_MIN_SCALE;

const findSafeBoundary = (
  segment: Extract<SourceSegment, { kind: "bezier" }>,
  safeT: number,
  unsafeT: number,
  offset: number
) => {
  let safe = safeT;
  let unsafe = unsafeT;
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const mid = (safe + unsafe) / 2;
    if (isSafeOffsetT(segment, mid, offset)) {
      safe = mid;
    } else {
      unsafe = mid;
    }
  }
  return safe;
};

const safeOffsetIntervals = (
  segment: Extract<SourceSegment, { kind: "bezier" }>,
  offset: number
) => {
  const intervals: Array<{ t0: number; t1: number }> = [];
  let intervalStart: number | null = isSafeOffsetT(segment, 0, offset) ? 0 : null;
  let previousT = 0;
  let previousSafe = intervalStart !== null;

  for (let index = 1; index <= OVER_OFFSET_SAMPLE_STEPS; index += 1) {
    const currentT = index / OVER_OFFSET_SAMPLE_STEPS;
    const currentSafe = isSafeOffsetT(segment, currentT, offset);

    if (previousSafe && !currentSafe && intervalStart !== null) {
      const boundary = findSafeBoundary(segment, previousT, currentT, offset);
      if (boundary - intervalStart > EPSILON) intervals.push({ t0: intervalStart, t1: boundary });
      intervalStart = null;
    } else if (!previousSafe && currentSafe) {
      intervalStart = findSafeBoundary(segment, currentT, previousT, offset);
    }

    previousT = currentT;
    previousSafe = currentSafe;
  }

  if (intervalStart !== null && 1 - intervalStart > EPSILON) {
    intervals.push({ t0: intervalStart, t1: 1 });
  }

  return {
    intervals,
    trimmed: intervals.length !== 1 || intervals[0]?.t0 > EPSILON || intervals[0]?.t1 < 1 - EPSILON
  };
};

type PlainBezierSegment = {
  start: Point;
  control1: Point;
  control2: Point;
  end: Point;
};

const fitOffsetBezierSegment = (
  segment: Extract<SourceSegment, { kind: "bezier" }>,
  t0: number,
  t1: number,
  offset: number
): PlainBezierSegment => {
  const start = offsetPointAt(segment, t0, offset);
  const end = offsetPointAt(segment, t1, offset);
  const midT = (t0 + t1) / 2;
  const mid = offsetPointAt(segment, midT, offset);
  const startTangent = unitTangentAt(segment, t0);
  const endTangent = unitTangentAt(segment, t1);
  const chordLength = Math.max(lineLength(start, end), EPSILON);

  const target = {
    x: (mid.x - (start.x + end.x) / 2) / 0.375,
    y: (mid.y - (start.y + end.y) / 2) / 0.375
  };
  const a11 = startTangent.x * startTangent.x + startTangent.y * startTangent.y;
  const a12 = -(startTangent.x * endTangent.x + startTangent.y * endTangent.y);
  const a22 = endTangent.x * endTangent.x + endTangent.y * endTangent.y;
  const b1 = startTangent.x * target.x + startTangent.y * target.y;
  const b2 = -(endTangent.x * target.x + endTangent.y * target.y);
  const determinant = a11 * a22 - a12 * a12;
  const fallbackHandleLength = chordLength / 3;
  const rawStartHandle =
    Math.abs(determinant) > EPSILON ? (b1 * a22 - b2 * a12) / determinant : fallbackHandleLength;
  const rawEndHandle =
    Math.abs(determinant) > EPSILON ? (a11 * b2 - a12 * b1) / determinant : fallbackHandleLength;
  const maxHandleLength = chordLength * 2;
  const startHandleLength =
    Number.isFinite(rawStartHandle) && rawStartHandle > 0
      ? Math.min(rawStartHandle, maxHandleLength)
      : fallbackHandleLength;
  const endHandleLength =
    Number.isFinite(rawEndHandle) && rawEndHandle > 0
      ? Math.min(rawEndHandle, maxHandleLength)
      : fallbackHandleLength;

  return {
    start,
    control1: {
      x: start.x + startTangent.x * startHandleLength,
      y: start.y + startTangent.y * startHandleLength
    },
    control2: {
      x: end.x - endTangent.x * endHandleLength,
      y: end.y - endTangent.y * endHandleLength
    },
    end
  };
};

const offsetBezierApproximationError = (
  source: Extract<SourceSegment, { kind: "bezier" }>,
  candidate: PlainBezierSegment,
  t0: number,
  t1: number,
  offset: number
) => {
  const samplePositions = [0.25, 0.5, 0.75];
  return Math.sqrt(
    Math.max(
      ...samplePositions.map((localT) => {
        const sourceT = t0 + (t1 - t0) * localT;
        return squaredDistance(
          cubicPoint(candidate.start, candidate.control1, candidate.control2, candidate.end, localT),
          offsetPointAt(source, sourceT, offset)
        );
      })
    )
  );
};

const approximateBezierLength = (
  segment: Extract<ComputedOffsetLineSegment, { kind: "bezier" }>
) => {
  let length = 0;
  let previous: Point = segment.start;
  const source = {
    kind: "bezier" as const,
    start: segment.start,
    control1: segment.control1,
    control2: segment.control2,
    end: segment.end
  };
  for (let index = 1; index <= BEZIER_LENGTH_STEPS; index += 1) {
    const point = cubicSourcePointAt(source, index / BEZIER_LENGTH_STEPS);
    length += lineLength(previous, point);
    previous = point;
  }
  return length;
};

const offsetBezierLeafSegment = (
  candidate: PlainBezierSegment
): ComputedOffsetLineSegment | null => {
  if (lineLength(candidate.start, candidate.end) <= EPSILON) return null;
  const output = {
    kind: "bezier" as const,
    start: computedPoint("", "", candidate.start),
    control1: candidate.control1,
    control2: candidate.control2,
    end: computedPoint("", "", candidate.end),
    length: 0
  };

  return { ...output, length: approximateBezierLength(output) };
};

const offsetBezierSegments = (
  segment: Extract<SourceSegment, { kind: "bezier" }>,
  offset: number,
  t0 = 0,
  t1 = 1,
  depth = 0
): ComputedOffsetLineSegment[] => {
  const candidate = fitOffsetBezierSegment(segment, t0, t1, offset);
  const error = offsetBezierApproximationError(segment, candidate, t0, t1, offset);
  if (depth >= BEZIER_OFFSET_MAX_DEPTH || error <= BEZIER_OFFSET_FLATNESS_TOLERANCE_MM) {
    const output = offsetBezierLeafSegment(candidate);
    return output ? [output] : [];
  }

  const midT = (t0 + t1) / 2;
  return [
    ...offsetBezierSegments(segment, offset, t0, midT, depth + 1),
    ...offsetBezierSegments(segment, offset, midT, t1, depth + 1)
  ];
};

const offsetBezierSegmentGroups = (
  segment: Extract<SourceSegment, { kind: "bezier" }>,
  offset: number
) => {
  const { intervals, trimmed } = safeOffsetIntervals(segment, offset);
  return {
    groups: intervals
      .map(({ t0, t1 }) => offsetBezierSegments(segment, offset, t0, t1))
      .filter((segments) => segments.length > 0),
    trimmed
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

const sourceSegmentsForGeometry = (geometry: ComputedGeometry): SourceSegment[] => {
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

const sourceEnd = (segment: SourceSegment) =>
  segment.kind === "line"
    ? segment.end
    : segment.kind === "bezier"
      ? segment.end
    : arcPoint(segment.center, segment.radius, segment.startAngleDeg + segment.sweepAngleDeg);

const sourceStart = (segment: SourceSegment) =>
  segment.kind === "line"
    ? segment.start
    : segment.kind === "bezier"
      ? segment.start
    : arcPoint(segment.center, segment.radius, segment.startAngleDeg);

const connectorSegment = (start: Point, end: Point): SourceSegment | null =>
  lineLength(start, end) <= EPSILON ? null : { kind: "line", start, end };

const sourceStartTangent = (segment: SourceSegment): Point | null => {
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
    y: -Math.sin(tangentAngle)
  };
};

const sourceEndTangent = (segment: SourceSegment): Point | null => {
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
    y: -Math.sin(tangentAngle)
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

const connectSourceSegmentGroups = (groups: SourceSegment[][], closed: boolean) => {
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

const lineIntersection = (
  first: Extract<ComputedOffsetLineSegment, { kind: "line" }>,
  second: Extract<ComputedOffsetLineSegment, { kind: "line" }>
) => {
  const x1 = first.start.x;
  const y1 = first.start.y;
  const x2 = first.end.x;
  const y2 = first.end.y;
  const x3 = second.start.x;
  const y3 = second.start.y;
  const x4 = second.end.x;
  const y4 = second.end.y;
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denominator) <= EPSILON) return null;

  return {
    x: ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denominator,
    y: ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denominator
  };
};

const lineCircleIntersections = (
  line: Extract<ComputedOffsetLineSegment, { kind: "line" }>,
  arc: Extract<ComputedOffsetLineSegment, { kind: "arc" }>
) => {
  const dx = line.end.x - line.start.x;
  const dy = line.end.y - line.start.y;
  const fx = line.start.x - arc.center.x;
  const fy = line.start.y - arc.center.y;
  const a = dx * dx + dy * dy;
  if (a <= EPSILON) return [];
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - arc.radius * arc.radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -EPSILON) return [];
  if (Math.abs(discriminant) <= EPSILON) {
    const t = -b / (2 * a);
    return [{ x: line.start.x + dx * t, y: line.start.y + dy * t }];
  }
  const sqrt = Math.sqrt(discriminant);
  return [(-b + sqrt) / (2 * a), (-b - sqrt) / (2 * a)].map((t) => ({
    x: line.start.x + dx * t,
    y: line.start.y + dy * t
  }));
};

const circleCircleIntersections = (
  first: Extract<ComputedOffsetLineSegment, { kind: "arc" }>,
  second: Extract<ComputedOffsetLineSegment, { kind: "arc" }>
) => {
  const dx = second.center.x - first.center.x;
  const dy = second.center.y - first.center.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= EPSILON) return [];
  if (distance > first.radius + second.radius + EPSILON) return [];
  if (distance < Math.abs(first.radius - second.radius) - EPSILON) return [];

  const a = (first.radius * first.radius - second.radius * second.radius + distance * distance) / (2 * distance);
  const heightSquared = first.radius * first.radius - a * a;
  if (heightSquared < -EPSILON) return [];

  const px = first.center.x + (a * dx) / distance;
  const py = first.center.y + (a * dy) / distance;
  if (Math.abs(heightSquared) <= EPSILON) return [{ x: px, y: py }];

  const height = Math.sqrt(heightSquared);
  return [
    {
      x: px + (-dy * height) / distance,
      y: py + (dx * height) / distance
    },
    {
      x: px - (-dy * height) / distance,
      y: py - (dx * height) / distance
    }
  ];
};

const segmentStart = (segment: ComputedOffsetLineSegment) => segment.start;
const segmentEnd = (segment: ComputedOffsetLineSegment) => segment.end;

const nearestPoint = (points: Point[], targetA: Point, targetB: Point) => {
  if (points.length === 0) return null;
  return points.reduce((best, point) => {
    const bestDistance = lineLength(best, targetA) + lineLength(best, targetB);
    const pointDistance = lineLength(point, targetA) + lineLength(point, targetB);
    return pointDistance < bestDistance ? point : best;
  });
};

const joinIntersection = (
  first: ComputedOffsetLineSegment,
  second: ComputedOffsetLineSegment
) => {
  const bezierStartTangentLine = (
    segment: Extract<ComputedOffsetLineSegment, { kind: "bezier" }>
  ): Extract<ComputedOffsetLineSegment, { kind: "line" }> | null => {
    const tangent = {
      x: segment.control1.x - segment.start.x,
      y: segment.control1.y - segment.start.y
    };
    const length = Math.hypot(tangent.x, tangent.y);
    if (length <= EPSILON) return null;
    return {
      kind: "line",
      start: segment.start,
      end: computedPoint("", "", {
        x: segment.start.x + tangent.x,
        y: segment.start.y + tangent.y
      }),
      length
    };
  };
  const bezierEndTangentLine = (
    segment: Extract<ComputedOffsetLineSegment, { kind: "bezier" }>
  ): Extract<ComputedOffsetLineSegment, { kind: "line" }> | null => {
    const tangent = {
      x: segment.end.x - segment.control2.x,
      y: segment.end.y - segment.control2.y
    };
    const length = Math.hypot(tangent.x, tangent.y);
    if (length <= EPSILON) return null;
    return {
      kind: "line",
      start: computedPoint("", "", {
        x: segment.end.x - tangent.x,
        y: segment.end.y - tangent.y
      }),
      end: segment.end,
      length
    };
  };

  if (first.kind === "line" && second.kind === "line") {
    return nearestPoint(
      [lineIntersection(first, second)].filter((point): point is Point => Boolean(point)),
      segmentEnd(first),
      segmentStart(second)
    );
  }
  if (first.kind === "line" && second.kind === "bezier") {
    const tangent = bezierStartTangentLine(second);
    return nearestPoint(
      tangent ? [lineIntersection(first, tangent)].filter((point): point is Point => Boolean(point)) : [],
      segmentEnd(first),
      segmentStart(second)
    );
  }
  if (first.kind === "bezier" && second.kind === "line") {
    const tangent = bezierEndTangentLine(first);
    return nearestPoint(
      tangent ? [lineIntersection(tangent, second)].filter((point): point is Point => Boolean(point)) : [],
      segmentEnd(first),
      segmentStart(second)
    );
  }
  if (first.kind === "bezier" && second.kind === "bezier") {
    const firstTangent = bezierEndTangentLine(first);
    const secondTangent = bezierStartTangentLine(second);
    return nearestPoint(
      firstTangent && secondTangent
        ? [lineIntersection(firstTangent, secondTangent)].filter((point): point is Point => Boolean(point))
        : [],
      segmentEnd(first),
      segmentStart(second)
    );
  }
  if (first.kind === "line" && second.kind === "arc") {
    return nearestPoint(lineCircleIntersections(first, second), segmentEnd(first), segmentStart(second));
  }
  if (first.kind === "arc" && second.kind === "line") {
    return nearestPoint(lineCircleIntersections(second, first), segmentEnd(first), segmentStart(second));
  }
  if (first.kind === "arc" && second.kind === "arc") {
    return nearestPoint(circleCircleIntersections(first, second), segmentEnd(first), segmentStart(second));
  }
  return null;
};

const withStart = (
  segment: ComputedOffsetLineSegment,
  point: Point,
  elementId: ElementId,
  name: string
): ComputedOffsetLineSegment => {
  if (segment.kind === "line") {
    const start = computedPoint(`${elementId}:segment-start`, `${name}.始点`, point);
    return { ...segment, start, length: lineLength(start, segment.end) };
  }
  if (segment.kind === "bezier") {
    const start = computedPoint(`${elementId}:segment-start`, `${name}.始点`, point);
    const dx = start.x - segment.start.x;
    const dy = start.y - segment.start.y;
    const next = {
      ...segment,
      start,
      control1: { x: segment.control1.x + dx, y: segment.control1.y + dy }
    };
    return { ...next, length: approximateBezierLength(next) };
  }

  const startAngleDeg = angleOfPoint(segment.center, point);
  const endAngleDeg = angleOfPoint(segment.center, segment.end);
  const sweepAngleDeg =
    segment.sweepAngleDeg >= 0
      ? positiveSweepDegrees(startAngleDeg, endAngleDeg)
      : -positiveSweepDegrees(endAngleDeg, startAngleDeg);
  const start = computedPoint(`${elementId}:segment-start`, `${name}.始点`, point);
  return {
    ...segment,
    start,
    startAngleDeg,
    sweepAngleDeg,
    length: segment.radius * Math.abs(degreesToRadians(sweepAngleDeg))
  };
};

const withEnd = (
  segment: ComputedOffsetLineSegment,
  point: Point,
  elementId: ElementId,
  name: string
): ComputedOffsetLineSegment => {
  if (segment.kind === "line") {
    const end = computedPoint(`${elementId}:segment-end`, `${name}.終点`, point);
    return { ...segment, end, length: lineLength(segment.start, end) };
  }
  if (segment.kind === "bezier") {
    const end = computedPoint(`${elementId}:segment-end`, `${name}.終点`, point);
    const dx = end.x - segment.end.x;
    const dy = end.y - segment.end.y;
    const next = {
      ...segment,
      control2: { x: segment.control2.x + dx, y: segment.control2.y + dy },
      end
    };
    return { ...next, length: approximateBezierLength(next) };
  }

  const endAngleDeg = angleOfPoint(segment.center, point);
  const sweepAngleDeg =
    segment.sweepAngleDeg >= 0
      ? positiveSweepDegrees(segment.startAngleDeg, endAngleDeg)
      : -positiveSweepDegrees(endAngleDeg, segment.startAngleDeg);
  const end = computedPoint(`${elementId}:segment-end`, `${name}.終点`, point);
  return {
    ...segment,
    end,
    sweepAngleDeg,
    length: segment.radius * Math.abs(degreesToRadians(sweepAngleDeg))
  };
};

const namedSegment = (
  segment: ComputedOffsetLineSegment,
  elementId: ElementId,
  name: string,
  index: number
): ComputedOffsetLineSegment => {
  const prefix = `${elementId}:segment-${index + 1}`;
  if (segment.kind === "line") {
    return {
      ...segment,
      start: computedPoint(`${prefix}:start`, `${name}.区間${index + 1}始点`, segment.start),
      end: computedPoint(`${prefix}:end`, `${name}.区間${index + 1}終点`, segment.end)
    };
  }
  if (segment.kind === "bezier") {
    return {
      ...segment,
      start: computedPoint(`${prefix}:start`, `${name}.区間${index + 1}始点`, segment.start),
      end: computedPoint(`${prefix}:end`, `${name}.区間${index + 1}終点`, segment.end)
    };
  }
  return {
    ...segment,
    center: computedPoint(`${prefix}:center`, `${name}.区間${index + 1}中心`, segment.center),
    start: computedPoint(`${prefix}:start`, `${name}.区間${index + 1}始点`, segment.start),
    end: computedPoint(`${prefix}:end`, `${name}.区間${index + 1}終点`, segment.end)
  };
};

const lineConnector = (
  start: Point,
  end: Point,
  elementId: ElementId,
  name: string,
  index: number
): ComputedOffsetLineSegment | null => {
  if (lineLength(start, end) <= EPSILON) return null;
  const prefix = `${elementId}:connector-${index + 1}`;
  return {
    kind: "line",
    start: computedPoint(`${prefix}:start`, `${name}.接続${index + 1}始点`, start),
    end: computedPoint(`${prefix}:end`, `${name}.接続${index + 1}終点`, end),
    length: lineLength(start, end)
  };
};

const pointedJoinConnectors = ({
  previous,
  next,
  offset,
  elementId,
  name,
  index
}: {
  previous: RawOffsetSegment;
  next: RawOffsetSegment;
  offset: number;
  elementId: ElementId;
  name: string;
  index: number;
}) => {
  const joinPoint = sourceEnd(previous.source);
  if (lineLength(joinPoint, sourceStart(next.source)) > Math.max(Math.abs(offset) * 0.01, 0.1)) {
    return [];
  }

  const incoming = sourceEndTangent(previous.source);
  const outgoing = sourceStartTangent(next.source);
  if (!incoming || !outgoing) return [];

  const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;
  if (dot > POINTED_JOIN_DOT_THRESHOLD) return [];

  const apexDistance = Math.min(Math.abs(offset) * POINTED_JOIN_MITER_FACTOR, POINTED_JOIN_MAX_LENGTH);
  if (apexDistance <= EPSILON) return [];

  const apex = {
    x: joinPoint.x + incoming.x * apexDistance,
    y: joinPoint.y + incoming.y * apexDistance
  };
  const first = lineConnector(segmentEnd(previous.segment), apex, elementId, name, index * 2);
  const second = lineConnector(apex, segmentStart(next.segment), elementId, name, index * 2 + 1);
  return [first, second].filter((segment): segment is ComputedOffsetLineSegment => Boolean(segment));
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
  "bezierCurve",
  "offsetLine"
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
