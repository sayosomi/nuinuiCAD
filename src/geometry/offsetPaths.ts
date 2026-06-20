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

const BEZIER_OFFSET_FLATNESS_TOLERANCE_MM = 0.1;
const BEZIER_OFFSET_MAX_DEPTH = 8;
const BEZIER_LENGTH_STEPS = 16;
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

const distanceToLine = (point: Point, start: Point, end: Point) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= EPSILON) return lineLength(point, start);
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / length;
};

const midpoint = (first: Point, second: Point): Point => ({
  x: (first.x + second.x) / 2,
  y: (first.y + second.y) / 2
});

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

const bezierFlatness = (segment: Extract<SourceSegment, { kind: "bezier" }>) =>
  Math.max(
    distanceToLine(segment.control1, segment.start, segment.end),
    distanceToLine(segment.control2, segment.start, segment.end)
  );

const splitBezierSegment = (
  segment: Extract<SourceSegment, { kind: "bezier" }>
): [Extract<SourceSegment, { kind: "bezier" }>, Extract<SourceSegment, { kind: "bezier" }>] => {
  const startControl = midpoint(segment.start, segment.control1);
  const controlMid = midpoint(segment.control1, segment.control2);
  const endControl = midpoint(segment.control2, segment.end);
  const leftControl2 = midpoint(startControl, controlMid);
  const rightControl1 = midpoint(controlMid, endControl);
  const center = midpoint(leftControl2, rightControl1);

  return [
    {
      kind: "bezier",
      start: segment.start,
      control1: startControl,
      control2: leftControl2,
      end: center
    },
    {
      kind: "bezier",
      start: center,
      control1: rightControl1,
      control2: endControl,
      end: segment.end
    }
  ];
};

const offsetBezierLeafSegment = (
  segment: Extract<SourceSegment, { kind: "bezier" }>,
  offset: number
): ComputedOffsetLineSegment | null => {
  if (lineLength(segment.start, segment.end) <= EPSILON) return null;

  const startTangent = cubicDerivativeAt(segment, 0);
  const endTangent = cubicDerivativeAt(segment, 1);
  const start = offsetPointByTangent(
    segment.start,
    Math.hypot(startTangent.x, startTangent.y) > EPSILON
      ? startTangent
      : fallbackTangent(segment, false),
    offset
  );
  const end = offsetPointByTangent(
    segment.end,
    Math.hypot(endTangent.x, endTangent.y) > EPSILON
      ? endTangent
      : fallbackTangent(segment, true),
    offset
  );
  const control1 = offsetPointByTangent(segment.control1, fallbackTangent(segment, false), offset);
  const control2 = offsetPointByTangent(segment.control2, fallbackTangent(segment, true), offset);
  const output = {
    kind: "bezier" as const,
    start: computedPoint("", "", start),
    control1,
    control2,
    end: computedPoint("", "", end),
    length: 0
  };

  return { ...output, length: approximateBezierLength(output) };
};

const offsetBezierSegments = (
  segment: Extract<SourceSegment, { kind: "bezier" }>,
  offset: number,
  depth = 0
): ComputedOffsetLineSegment[] => {
  if (
    depth >= BEZIER_OFFSET_MAX_DEPTH ||
    bezierFlatness(segment) <= BEZIER_OFFSET_FLATNESS_TOLERANCE_MM
  ) {
    const output = offsetBezierLeafSegment(segment, offset);
    return output ? [output] : [];
  }

  const [first, second] = splitBezierSegment(segment);
  return [
    ...offsetBezierSegments(first, offset, depth + 1),
    ...offsetBezierSegments(second, offset, depth + 1)
  ];
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
}): { geometry?: ComputedOffsetLine; error?: string } => {
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

  const rawSegments: ComputedOffsetLineSegment[] = [];
  for (const segment of connectedSourceSegments) {
    if (segment.kind === "line") {
      const next = offsetLineSegment(segment, offset);
      if (next) rawSegments.push(next);
      continue;
    }
    if (segment.kind === "bezier") {
      rawSegments.push(...offsetBezierSegments(segment, offset));
      continue;
    }

    const next = offsetArcSegment(segment, offset, name);
    if (next.error) return { error: next.error };
    if (next.segment) rawSegments.push(next.segment);
  }

  if (rawSegments.length === 0) {
    return { error: `${name} は基準線から作図できる長さの線分がありません。` };
  }

  const adjusted = [...rawSegments];
  const connectors: Array<{ index: number; segment: ComputedOffsetLineSegment }> = [];
  const joinCount = closed ? adjusted.length : adjusted.length - 1;
  for (let index = 0; index < joinCount; index += 1) {
    const nextIndex = (index + 1) % adjusted.length;
    const intersection = joinIntersection(adjusted[index], adjusted[nextIndex]);
    if (intersection) {
      adjusted[index] = withEnd(adjusted[index], intersection, elementId, name);
      adjusted[nextIndex] = withStart(adjusted[nextIndex], intersection, elementId, name);
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
    }
  };
};
