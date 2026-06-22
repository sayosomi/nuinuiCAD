import type { ComputedOffsetLineSegment } from "../types/geometry";
import type { Point, SourceSegment } from "./offsetPathTypes";
import {
  BEZIER_LENGTH_STEPS,
  BEZIER_OFFSET_FLATNESS_TOLERANCE_MM,
  BEZIER_OFFSET_MAX_DEPTH,
  EPSILON,
  OVER_OFFSET_MIN_SCALE,
  OVER_OFFSET_SAMPLE_STEPS,
  computedPoint,
  lineLength
} from "./offsetPathMath";

export const cubicSourcePointAt = (
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

export const unitTangentAt = (
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

export const approximateBezierLength = (
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

export const offsetBezierSegmentGroups = (
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
