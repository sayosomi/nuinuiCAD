import type { ComputedOffsetLineSegment, ElementId } from "../types/geometry";
import type { Point, RawOffsetSegment } from "./offsetPathTypes";
import { approximateBezierLength } from "./offsetBezier";
import {
  EPSILON,
  POINTED_JOIN_DOT_THRESHOLD,
  POINTED_JOIN_MAX_LENGTH,
  POINTED_JOIN_MITER_FACTOR,
  angleOfPoint,
  computedPoint,
  degreesToRadians,
  lineLength,
  positiveSweepDegrees
} from "./offsetPathMath";
import { sourceEnd, sourceEndTangent, sourceStart, sourceStartTangent } from "./offsetSourceSegments";

const BEZIER_JOIN_INTERSECTION_STEPS = 96;
const ARC_JOIN_INTERSECTION_STEPS = 96;
const BEZIER_TRIM_STEPS = 96;
const BEZIER_TRIM_TOLERANCE_MM = 0.5;

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

const interpolate = (start: Point, end: Point, t: number): Point => ({
  x: start.x + (end.x - start.x) * t,
  y: start.y + (end.y - start.y) * t
});

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

const splitCubic = (segment: Extract<ComputedOffsetLineSegment, { kind: "bezier" }>, t: number) => {
  const p01 = interpolate(segment.start, segment.control1, t);
  const p12 = interpolate(segment.control1, segment.control2, t);
  const p23 = interpolate(segment.control2, segment.end, t);
  const p012 = interpolate(p01, p12, t);
  const p123 = interpolate(p12, p23, t);
  const p0123 = interpolate(p012, p123, t);
  return {
    left: { start: segment.start, control1: p01, control2: p012, end: p0123 },
    right: { start: p0123, control1: p123, control2: p23, end: segment.end }
  };
};

const nearestBezierT = (segment: Extract<ComputedOffsetLineSegment, { kind: "bezier" }>, target: Point) => {
  let bestT = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= BEZIER_TRIM_STEPS; index += 1) {
    const t = index / BEZIER_TRIM_STEPS;
    const point = cubicPoint(segment.start, segment.control1, segment.control2, segment.end, t);
    const distance = lineLength(point, target);
    if (distance < bestDistance) {
      bestT = t;
      bestDistance = distance;
    }
  }
  return { t: bestT, distance: bestDistance };
};

const segmentPoints = (segment: ComputedOffsetLineSegment): Point[] => {
  if (segment.kind === "line") return [segment.start, segment.end];
  if (segment.kind === "bezier") {
    return Array.from({ length: BEZIER_JOIN_INTERSECTION_STEPS + 1 }, (_, index) =>
      cubicPoint(segment.start, segment.control1, segment.control2, segment.end, index / BEZIER_JOIN_INTERSECTION_STEPS)
    );
  }
  const stepCount = Math.max(
    1,
    Math.ceil((Math.abs(segment.sweepAngleDeg) / 360) * ARC_JOIN_INTERSECTION_STEPS)
  );
  return Array.from({ length: stepCount + 1 }, (_, index) => {
    const angleRad = ((segment.startAngleDeg + (segment.sweepAngleDeg * index) / stepCount) * Math.PI) / 180;
    return {
      x: segment.center.x + Math.cos(angleRad) * segment.radius,
      y: segment.center.y + Math.sin(angleRad) * segment.radius
    };
  });
};

const finiteSegmentIntersection = (aStart: Point, aEnd: Point, bStart: Point, bEnd: Point) => {
  const r = { x: aEnd.x - aStart.x, y: aEnd.y - aStart.y };
  const s = { x: bEnd.x - bStart.x, y: bEnd.y - bStart.y };
  const denominator = r.x * s.y - r.y * s.x;
  if (Math.abs(denominator) <= EPSILON) return null;
  const qp = { x: bStart.x - aStart.x, y: bStart.y - aStart.y };
  const t = (qp.x * s.y - qp.y * s.x) / denominator;
  const u = (qp.x * r.y - qp.y * r.x) / denominator;
  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) return null;
  const clampedT = Math.min(Math.max(t, 0), 1);
  return { x: aStart.x + r.x * clampedT, y: aStart.y + r.y * clampedT };
};

const sampledSegmentIntersections = (first: ComputedOffsetLineSegment, second: ComputedOffsetLineSegment) => {
  const firstPoints = segmentPoints(first);
  const secondPoints = segmentPoints(second);
  const intersections: Point[] = [];
  for (let firstIndex = 0; firstIndex < firstPoints.length - 1; firstIndex += 1) {
    for (let secondIndex = 0; secondIndex < secondPoints.length - 1; secondIndex += 1) {
      const intersection = finiteSegmentIntersection(
        firstPoints[firstIndex],
        firstPoints[firstIndex + 1],
        secondPoints[secondIndex],
        secondPoints[secondIndex + 1]
      );
      if (!intersection) continue;
      if (intersections.some((point) => lineLength(point, intersection) <= 1e-5)) continue;
      intersections.push(intersection);
    }
  }
  return intersections;
};

export const segmentStart = (segment: ComputedOffsetLineSegment) => segment.start;
export const segmentEnd = (segment: ComputedOffsetLineSegment) => segment.end;

const nearestPoint = (points: Point[], targetA: Point, targetB: Point) => {
  if (points.length === 0) return null;
  return points.reduce((best, point) => {
    const bestDistance = lineLength(best, targetA) + lineLength(best, targetB);
    const pointDistance = lineLength(point, targetA) + lineLength(point, targetB);
    return pointDistance < bestDistance ? point : best;
  });
};

export const joinIntersection = (
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

  if (first.kind === "bezier" || second.kind === "bezier") {
    const sampled = nearestPoint(sampledSegmentIntersections(first, second), segmentEnd(first), segmentStart(second));
    if (sampled) return sampled;
  }

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

export const withStart = (
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
    const nearest = nearestBezierT(segment, point);
    if (nearest.distance <= BEZIER_TRIM_TOLERANCE_MM && nearest.t > EPSILON && nearest.t < 1 - EPSILON) {
      const right = splitCubic(segment, nearest.t).right;
      const next = {
        ...segment,
        start,
        control1: right.control1,
        control2: right.control2,
        end: right.end
      };
      return { ...next, length: approximateBezierLength(next) };
    }
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

export const withEnd = (
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
    const nearest = nearestBezierT(segment, point);
    if (nearest.distance <= BEZIER_TRIM_TOLERANCE_MM && nearest.t > EPSILON && nearest.t < 1 - EPSILON) {
      const left = splitCubic(segment, nearest.t).left;
      const next = {
        ...segment,
        start: left.start,
        control1: left.control1,
        control2: left.control2,
        end
      };
      return { ...next, length: approximateBezierLength(next) };
    }
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

export const namedSegment = (
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

export const lineConnector = (
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

export const pointedJoinConnectors = ({
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
