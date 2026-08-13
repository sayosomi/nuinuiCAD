import type {
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedLine,
  ComputedOffsetLine,
  ComputedOffsetLineSegment
} from "../types/geometry";
import type { LineLikeGeometry } from "./linePaths";
import { cubicDerivativeAt, cubicPointAt } from "./bezierMath";

type Point = { x: number; y: number };

type IntersectionSegment = {
  start: Point;
  end: Point;
  startDistance: number;
  endDistance: number;
  extension: boolean;
  primitive:
    // Only genuinely straight sources (line geometry, offsetLine "line"
    // sub-segments, && extension rays) produce this primitive -- arcLine &&
    // bezierCurve chords carry their own analytic primitive instead, so this
    // is always exact && needs no separate flag.
    | { kind: "line" }
    | {
        kind: "bezier";
        segment: { start: Point; control1: Point; control2: Point; end: Point };
        tStart: number;
        tEnd: number;
      }
    | {
        kind: "arc";
        center: Point;
        radius: number;
        startAngleDeg: number;
        sweepAngleDeg: number;
        // Sweep fraction range this chord covers, in [0, 1] over the arc's
        // own startAngleDeg..startAngleDeg+sweepAngleDeg span.
        uStart: number;
        uEnd: number;
      };
};

export type LineIntersection = {
  x: number;
  y: number;
  line1Distance: number;
  line2Distance: number;
};

export type LineIntersectionResult =
  | { intersections: LineIntersection[]; error?: undefined }
  | { intersections: LineIntersection[]; error: string };

const CURVE_STEPS = 64;
const ARC_STEPS = 64;
const EXTENSION_LENGTH = 1_000_000;
const EPSILON = 1e-9;
const DEDUPE_EPSILON = 1e-5;
const INTERSECTION_TOLERANCE = 1e-6;

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

const normalizeVector = (vector: Point) => {
  const length = Math.hypot(vector.x, vector.y);
  return length > EPSILON ? { x: vector.x / length, y: vector.y / length } : null;
};

const vectorBetween = (start: Point, end: Point) => ({ x: end.x - start.x, y: end.y - start.y });

const arcPoint = (center: Point, radius: number, angleDeg: number): Point => {
  const angleRad = degreesToRadians(angleDeg);
  return {
    x: center.x + Math.cos(angleRad) * radius,
    y: center.y + Math.sin(angleRad) * radius
  };
};

const pointPathSegments = (points: Point[]) => {
  const segments: IntersectionSegment[] = [];
  let accumulated = 0;

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const length = distance(start, end);
    if (length <= EPSILON) continue;

    segments.push({
      start,
      end,
      startDistance: accumulated,
      endDistance: accumulated + length,
      extension: false,
      primitive: { kind: "line" }
    });
    accumulated += length;
  }

  return segments;
};

// Append chord-sampled seeds for one arc span (used both for a bare arcLine
// geometry && for a single "arc" offsetLine sub-segment), continuing the
// running accumulated distance so multi-segment offset lines stay contiguous.
const pushArcChords = (
  segments: IntersectionSegment[],
  accumulated: { value: number },
  center: Point,
  radius: number,
  startAngleDeg: number,
  sweepAngleDeg: number
) => {
  const safeRadius = Math.max(radius, 0);
  const stepCount = Math.max(1, Math.ceil((Math.abs(sweepAngleDeg) / 360) * ARC_STEPS));

  for (let index = 0; index < stepCount; index += 1) {
    const uStart = index / stepCount;
    const uEnd = (index + 1) / stepCount;
    const start = arcPoint(center, safeRadius, startAngleDeg + sweepAngleDeg * uStart);
    const end = arcPoint(center, safeRadius, startAngleDeg + sweepAngleDeg * uEnd);
    const length = distance(start, end);
    if (length <= EPSILON) continue;

    segments.push({
      start,
      end,
      startDistance: accumulated.value,
      endDistance: accumulated.value + length,
      extension: false,
      primitive: { kind: "arc", center, radius: safeRadius, startAngleDeg, sweepAngleDeg, uStart, uEnd }
    });
    accumulated.value += length;
  }
};

const arcPathSegments = ({
  center,
  radius,
  startAngleDeg,
  sweepAngleDeg
}: {
  center: Point;
  radius: number;
  startAngleDeg: number;
  sweepAngleDeg: number;
}) => {
  const segments: IntersectionSegment[] = [];
  pushArcChords(segments, { value: 0 }, center, radius, startAngleDeg, sweepAngleDeg);
  return segments;
};

// Append chord-sampled seeds for one bezier sub-segment, continuing the
// running accumulated distance.
const pushBezierChords = (
  segments: IntersectionSegment[],
  accumulated: { value: number },
  segment: { start: Point; control1: Point; control2: Point; end: Point }
) => {
  const points = Array.from({ length: CURVE_STEPS + 1 }, (_, index) => cubicPointAt(segment, index / CURVE_STEPS));

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const length = distance(start, end);
    if (length <= EPSILON) continue;

    segments.push({
      start,
      end,
      startDistance: accumulated.value,
      endDistance: accumulated.value + length,
      extension: false,
      primitive: {
        kind: "bezier",
        segment,
        tStart: index / CURVE_STEPS,
        tEnd: (index + 1) / CURVE_STEPS
      }
    });
    accumulated.value += length;
  }
};

const bezierPathSegments = (curve: ComputedBezierCurve) => {
  const segments: IntersectionSegment[] = [];
  const accumulated = { value: 0 };
  for (const segment of curve.segments) {
    pushBezierChords(segments, accumulated, segment);
  }
  return segments;
};

// Dispatch each offsetLine sub-segment to its own analytic primitive (line,
// bezier, || arc) instead of flattening the whole offset line into a single
// approximate polyline. This preserves curve identity for refinement and,
// unlike the previous implementation, does not special-case closed offset
// lines -- a closed offset line can still be intersected, it just never gets
// endpoint extension segments (see `endpointTangents`).
const offsetPathSegments = (line: ComputedOffsetLine) => {
  const segments: IntersectionSegment[] = [];
  const accumulated = { value: 0 };

  for (const segment of line.segments) {
    if (segment.kind === "line") {
      const length = distance(segment.start, segment.end);
      if (length > EPSILON) {
        segments.push({
          start: segment.start,
          end: segment.end,
          startDistance: accumulated.value,
          endDistance: accumulated.value + length,
          extension: false,
          primitive: { kind: "line" }
        });
        accumulated.value += length;
      }
      continue;
    }
    if (segment.kind === "bezier") {
      pushBezierChords(segments, accumulated, segment);
      continue;
    }
    pushArcChords(
      segments,
      accumulated,
      segment.center,
      segment.radius,
      segment.startAngleDeg,
      segment.sweepAngleDeg
    );
  }

  return segments;
};

const pathSegmentsForLine = (geometry: LineLikeGeometry) => {
  if (geometry.kind === "line") return pointPathSegments([geometry.start, geometry.end]);
  if (geometry.kind === "arcLine") {
    return arcPathSegments({
      center: geometry.center,
      radius: geometry.radius,
      startAngleDeg: geometry.startAngleDeg,
      sweepAngleDeg: geometry.sweepAngleDeg
    });
  }
  if (geometry.kind === "bezierCurve") return bezierPathSegments(geometry);
  return offsetPathSegments(geometry);
};

const bezierStartForward = (segment: { start: Point; control1: Point; control2: Point; end: Point }) =>
  normalizeVector(vectorBetween(segment.start, segment.control1)) ??
  normalizeVector(vectorBetween(segment.start, segment.control2)) ??
  normalizeVector(vectorBetween(segment.start, segment.end));

const bezierEndForward = (segment: { start: Point; control1: Point; control2: Point; end: Point }) =>
  normalizeVector(vectorBetween(segment.control2, segment.end)) ??
  normalizeVector(vectorBetween(segment.control1, segment.end)) ??
  normalizeVector(vectorBetween(segment.start, segment.end));

const arcForwardTangent = (angleDeg: number, sweepAngleDeg: number) => {
  const angleRad = degreesToRadians(angleDeg);
  const direction = sweepAngleDeg >= 0 ? 1 : -1;
  return {
    x: -Math.sin(angleRad) * direction,
    y: Math.cos(angleRad) * direction
  };
};

const offsetSegmentStartForward = (segment: ComputedOffsetLineSegment) => {
  if (segment.kind === "line") return normalizeVector(vectorBetween(segment.start, segment.end));
  if (segment.kind === "bezier") return bezierStartForward(segment);
  return arcForwardTangent(segment.startAngleDeg, segment.sweepAngleDeg);
};

const offsetSegmentEndForward = (segment: ComputedOffsetLineSegment) => {
  if (segment.kind === "line") return normalizeVector(vectorBetween(segment.start, segment.end));
  if (segment.kind === "bezier") return bezierEndForward(segment);
  return arcForwardTangent(segment.startAngleDeg + segment.sweepAngleDeg, segment.sweepAngleDeg);
};

const endpointTangents = (geometry: LineLikeGeometry) => {
  if (geometry.kind === "line") {
    const forward = normalizeVector(vectorBetween(geometry.start, geometry.end));
    return forward ? { start: geometry.start, end: geometry.end, startForward: forward, endForward: forward } : null;
  }
  if (geometry.kind === "arcLine") {
    return {
      start: geometry.start,
      end: geometry.end,
      startForward: arcForwardTangent(geometry.startAngleDeg, geometry.sweepAngleDeg),
      endForward: arcForwardTangent(geometry.startAngleDeg + geometry.sweepAngleDeg, geometry.sweepAngleDeg)
    };
  }
  if (geometry.kind === "bezierCurve") {
    const first = geometry.segments[0];
    const last = geometry.segments.at(-1);
    if (!first || !last) return null;
    const startForward = bezierStartForward(first);
    const endForward = bezierEndForward(last);
    return startForward && endForward
      ? { start: first.start, end: last.end, startForward, endForward }
      : null;
  }
  if (geometry.closed) return null;
  const first = geometry.segments[0];
  const last = geometry.segments.at(-1);
  if (!first || !last) return null;
  const startForward = offsetSegmentStartForward(first);
  const endForward = offsetSegmentEndForward(last);
  return startForward && endForward
    ? { start: first.start, end: last.end, startForward, endForward }
    : null;
};

const extensionSegments = (
  segments: IntersectionSegment[],
  geometry: LineLikeGeometry
): IntersectionSegment[] => {
  const tangents = endpointTangents(geometry);
  if (!tangents) return [];

  const totalDistance = segments.at(-1)?.endDistance ?? geometry.length;

  return [
    {
      start: {
        x: tangents.start.x - tangents.startForward.x * EXTENSION_LENGTH,
        y: tangents.start.y - tangents.startForward.y * EXTENSION_LENGTH
      },
      end: tangents.start,
      startDistance: -EXTENSION_LENGTH,
      endDistance: 0,
      extension: true,
      primitive: { kind: "line" }
    },
    {
      start: tangents.end,
      end: {
        x: tangents.end.x + tangents.endForward.x * EXTENSION_LENGTH,
        y: tangents.end.y + tangents.endForward.y * EXTENSION_LENGTH
      },
      startDistance: totalDistance,
      endDistance: totalDistance + EXTENSION_LENGTH,
      extension: true,
      primitive: { kind: "line" }
    }
  ];
};

const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;

const segmentIntersection = (
  a: IntersectionSegment,
  b: IntersectionSegment
): { point: Point; line1Distance: number; line2Distance: number; overlap: boolean } | null => {
  const r = { x: a.end.x - a.start.x, y: a.end.y - a.start.y };
  const s = { x: b.end.x - b.start.x, y: b.end.y - b.start.y };
  const denominator = cross(r, s);
  const qp = { x: b.start.x - a.start.x, y: b.start.y - a.start.y };

  if (Math.abs(denominator) <= EPSILON) {
    if (Math.abs(cross(qp, r)) <= EPSILON) return { point: a.start, line1Distance: 0, line2Distance: 0, overlap: true };
    return null;
  }

  const t = cross(qp, s) / denominator;
  const u = cross(qp, r) / denominator;
  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) return null;

  const clampedT = Math.min(Math.max(t, 0), 1);
  const clampedU = Math.min(Math.max(u, 0), 1);
  return {
    point: {
      x: a.start.x + r.x * clampedT,
      y: a.start.y + r.y * clampedT
    },
    line1Distance: a.startDistance + (a.endDistance - a.startDistance) * clampedT,
    line2Distance: b.startDistance + (b.endDistance - b.startDistance) * clampedU,
    overlap: false
  };
};

const projectionT = (point: Point, start: Point, end: Point) => {
  const vector = { x: end.x - start.x, y: end.y - start.y };
  const lengthSquared = vector.x * vector.x + vector.y * vector.y;
  if (lengthSquared <= EPSILON) return null;
  return ((point.x - start.x) * vector.x + (point.y - start.y) * vector.y) / lengthSquared;
};

const signedDistanceToLine = (point: Point, line: IntersectionSegment) =>
  cross(
    { x: point.x - line.start.x, y: point.y - line.start.y },
    { x: line.end.x - line.start.x, y: line.end.y - line.start.y }
  );

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const chordSeed = (segment: IntersectionSegment, start: number, end: number, roughPoint: Point) => {
  const chordT = projectionT(roughPoint, segment.start, segment.end);
  return chordT === null ? (start + end) / 2 : clamp(start + (end - start) * chordT, start, end);
};

// Refine a Bezier<->Bezier crossing with a damped 2D Newton solve confined to
// the two seed chords' own parameter ranges. A rough crossing only proves that
// these chords are candidates; it must never be returned as geometry when the
// analytic solve cannot establish an exact root.
const refineBezierBezierIntersection = (
  a: IntersectionSegment,
  b: IntersectionSegment,
  roughPoint: Point
): { point: Point; aT: number; bT: number } | null => {
  if (a.primitive.kind !== "bezier" || b.primitive.kind !== "bezier") return null;

  const segmentA = a.primitive.segment;
  const segmentB = b.primitive.segment;
  const { tStart: aStart, tEnd: aEnd } = a.primitive;
  const { tStart: bStart, tEnd: bEnd } = b.primitive;
  const solve = (initialA: number, initialB: number) => {
    let tA = initialA;
    let tB = initialB;
    for (let index = 0; index < 40; index += 1) {
      const pa = cubicPointAt(segmentA, tA);
      const pb = cubicPointAt(segmentB, tB);
      const fx = pa.x - pb.x;
      const fy = pa.y - pb.y;
      const residual = Math.hypot(fx, fy);
      if (!Number.isFinite(residual)) return null;
      if (residual <= EPSILON) break;

      const da = cubicDerivativeAt(segmentA, tA);
      const db = cubicDerivativeAt(segmentB, tB);
      const det = db.x * da.y - da.x * db.y;
      if (!Number.isFinite(det) || Math.abs(det) <= EPSILON) return null;
      const dtA = (db.y * fx - db.x * fy) / det;
      const dtB = (da.y * fx - da.x * fy) / det;
      if (!Number.isFinite(dtA) || !Number.isFinite(dtB)) return null;

      let accepted = false;
      for (let damping = 1; damping >= 1 / 1024; damping /= 2) {
        const nextA = tA + damping * dtA;
        const nextB = tB + damping * dtB;
        if (
          nextA < aStart - EPSILON || nextA > aEnd + EPSILON ||
          nextB < bStart - EPSILON || nextB > bEnd + EPSILON
        ) continue;
        const nextPA = cubicPointAt(segmentA, nextA);
        const nextPB = cubicPointAt(segmentB, nextB);
        if (Math.hypot(nextPA.x - nextPB.x, nextPA.y - nextPB.y) < residual) {
          tA = nextA;
          tB = nextB;
          accepted = true;
          break;
        }
      }
      if (!accepted) return null;
    }

    const pa = cubicPointAt(segmentA, tA);
    const pb = cubicPointAt(segmentB, tB);
    const residual = Math.hypot(pa.x - pb.x, pa.y - pb.y);
    return Number.isFinite(residual) && residual <= INTERSECTION_TOLERANCE
      ? { point: pa, aT: tA, bT: tB }
      : null;
  };

  const roughA = chordSeed(a, aStart, aEnd, roughPoint);
  const roughB = chordSeed(b, bStart, bEnd, roughPoint);
  const middleA = (aStart + aEnd) / 2;
  const middleB = (bStart + bEnd) / 2;
  return solve(roughA, roughB) ?? solve(middleA, middleB) ?? solve(roughA, middleB) ?? solve(middleA, roughB);
};

const refineBezierLineIntersection = (
  bezier: IntersectionSegment,
  line: IntersectionSegment
): { point: Point; bezierT: number; lineT: number } | null => {
  if (bezier.primitive.kind !== "bezier") return null;
  if (line.primitive.kind !== "line") return null;

  const { segment, tStart, tEnd } = bezier.primitive;
  let low = tStart;
  let high = tEnd;
  let lowValue = signedDistanceToLine(cubicPointAt(segment, low), line);
  const highValue = signedDistanceToLine(cubicPointAt(segment, high), line);

  const pointAtAcceptedT = (bezierT: number) => {
    const point = cubicPointAt(segment, bezierT);
    const lineT = projectionT(point, line.start, line.end);
    if (lineT === null || lineT < -EPSILON || lineT > 1 + EPSILON) return null;
    return { point, bezierT, lineT: Math.min(Math.max(lineT, 0), 1) };
  };

  if (Math.abs(lowValue) <= EPSILON) return pointAtAcceptedT(low);
  if (Math.abs(highValue) <= EPSILON) return pointAtAcceptedT(high);
  if (Math.sign(lowValue) === Math.sign(highValue)) return null;

  for (let index = 0; index < 80; index += 1) {
    const mid = (low + high) / 2;
    const midValue = signedDistanceToLine(cubicPointAt(segment, mid), line);
    if (Math.abs(midValue) <= EPSILON) {
      low = mid;
      high = mid;
      break;
    }
    if (Math.sign(lowValue) === Math.sign(midValue)) {
      low = mid;
      lowValue = midValue;
    } else {
      high = mid;
    }
  }

  return pointAtAcceptedT((low + high) / 2);
};

const distanceAtBezierSegmentT = (segment: IntersectionSegment, t: number) => {
  if (segment.primitive.kind !== "bezier") return segment.startDistance;
  const span = segment.primitive.tEnd - segment.primitive.tStart;
  const localT =
    Math.abs(span) <= EPSILON
      ? 0
      : Math.min(Math.max((t - segment.primitive.tStart) / span, 0), 1);
  return segment.startDistance + (segment.endDistance - segment.startDistance) * localT;
};

const distanceAtArcSegmentU = (segment: IntersectionSegment, u: number) => {
  if (segment.primitive.kind !== "arc") return segment.startDistance;
  const span = segment.primitive.uEnd - segment.primitive.uStart;
  const localU =
    Math.abs(span) <= EPSILON
      ? 0
      : Math.min(Math.max((u - segment.primitive.uStart) / span, 0), 1);
  return segment.startDistance + (segment.endDistance - segment.startDistance) * localU;
};

// Real roots of a*x^2 + b*x + c = 0. A discriminant that is negative only by
// numerical noise (within EPSILON) is treated as a tangent double root instead
// of "no roots", so near-tangent line/circle configurations stay stable.
const quadraticRoots = (a: number, b: number, c: number): number[] => {
  if (Math.abs(a) <= EPSILON) {
    return Math.abs(b) <= EPSILON ? [] : [-c / b];
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -EPSILON) return [];
  const sqrtDiscriminant = Math.sqrt(Math.max(discriminant, 0));
  if (sqrtDiscriminant <= EPSILON) return [-b / (2 * a)];
  return [(-b - sqrtDiscriminant) / (2 * a), (-b + sqrtDiscriminant) / (2 * a)];
};

// Return the representative of an angle that belongs to this particular seed
// chord. Full circles have both u=0 && u=1 at their seam, so a global modulo
// fraction is insufficient; unwrap around the chord's local range instead.
const sweepFractionForAngleInRange = (
  startAngleDeg: number,
  sweepAngleDeg: number,
  angleDeg: number,
  uStart: number,
  uEnd: number
): number | null => {
  if (Math.abs(sweepAngleDeg) <= EPSILON) return null;
  const midpoint = (uStart + uEnd) / 2;
  const centerTurn = Math.floor((startAngleDeg + sweepAngleDeg * midpoint - angleDeg) / 360);
  let best: number | null = null;
  for (let turn = centerTurn - 2; turn <= centerTurn + 2; turn += 1) {
    const u = (angleDeg + 360 * turn - startAngleDeg) / sweepAngleDeg;
    if (u < uStart - EPSILON || u > uEnd + EPSILON) continue;
    if (best === null || Math.abs(u - midpoint) < Math.abs(best - midpoint)) best = u;
  }
  return best === null ? null : clamp(best, uStart, uEnd);
};

// Analytic circle-vs-infinite-line intersection, seeded from the rough
// polyline crossing to pick between up to two roots. Only accepts a root
// whose line parameter lies in the line chord's own [0, 1] span && whose arc
// sweep fraction lies within *this seed chord's* local uStart..uEnd range
// (not the arc's global [0, 1]) -- so a chord only claims roots that
// actually belong to it, even when the circle intersects the line elsewhere
// along the arc's full sweep.
const refineArcLineIntersection = (
  arc: IntersectionSegment,
  line: IntersectionSegment,
  roughPoint: Point
): { point: Point; arcU: number; lineT: number } | null => {
  if (arc.primitive.kind !== "arc") return null;
  if (line.primitive.kind !== "line") return null;

  const { center, radius, startAngleDeg, sweepAngleDeg, uStart, uEnd } = arc.primitive;
  const d = { x: line.end.x - line.start.x, y: line.end.y - line.start.y };
  const f = { x: line.start.x - center.x, y: line.start.y - center.y };
  const aCoef = d.x * d.x + d.y * d.y;
  if (aCoef <= EPSILON) return null;
  const bCoef = 2 * (f.x * d.x + f.y * d.y);
  const cCoef = f.x * f.x + f.y * f.y - radius * radius;

  let best: { point: Point; lineT: number; u: number; distToRough: number } | null = null;
  for (const lineT of quadraticRoots(aCoef, bCoef, cCoef)) {
    if (lineT < -EPSILON || lineT > 1 + EPSILON) continue;
    const point = { x: line.start.x + d.x * lineT, y: line.start.y + d.y * lineT };
    const angleDeg = (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
    const u = sweepFractionForAngleInRange(startAngleDeg, sweepAngleDeg, angleDeg, uStart, uEnd);
    if (u === null) continue;
    const distToRough = Math.hypot(point.x - roughPoint.x, point.y - roughPoint.y);
    if (!best || distToRough < best.distToRough) {
      best = {
        point,
        lineT: Math.min(Math.max(lineT, 0), 1),
        u,
        distToRough
      };
    }
  }

  return best && { point: best.point, arcU: best.u, lineT: best.lineT };
};

// Analytic circle-circle intersection (0/1/2 points). A discriminant-like
// term that is negative only by numerical noise is clamped to 0 (tangent
// circles), matching quadraticRoots' tolerance style. Concentric (or
// coincident-center) circles have no well-defined finite intersection set
// && return no points.
const circleCircleIntersections = (
  centerA: Point,
  radiusA: number,
  centerB: Point,
  radiusB: number
): Point[] => {
  const dx = centerB.x - centerA.x;
  const dy = centerB.y - centerA.y;
  const d = Math.hypot(dx, dy);
  if (d <= EPSILON) return [];
  if (d > radiusA + radiusB + EPSILON || d < Math.abs(radiusA - radiusB) - EPSILON) return [];

  const a = (radiusA * radiusA - radiusB * radiusB + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(radiusA * radiusA - a * a, 0));
  const mid = { x: centerA.x + (a * dx) / d, y: centerA.y + (a * dy) / d };
  if (h <= EPSILON) return [mid];
  const perp = { x: -dy / d, y: dx / d };
  return [
    { x: mid.x + perp.x * h, y: mid.y + perp.y * h },
    { x: mid.x - perp.x * h, y: mid.y - perp.y * h }
  ];
};

// Refine an Arc<->Arc crossing analytically, seeded from the rough polyline
// crossing to pick between up to two circle-circle roots. Each candidate
// point's sweep fraction is checked against *both* seed chords' own local
// uStart..uEnd ranges (not either arc's global [0, 1]).
const refineArcArcIntersection = (
  a: IntersectionSegment,
  b: IntersectionSegment,
  roughPoint: Point
): { point: Point; arcUA: number; arcUB: number } | null => {
  if (a.primitive.kind !== "arc" || b.primitive.kind !== "arc") return null;
  const primitiveA = a.primitive;
  const primitiveB = b.primitive;

  let best: { point: Point; uA: number; uB: number; distToRough: number } | null = null;
  for (const point of circleCircleIntersections(primitiveA.center, primitiveA.radius, primitiveB.center, primitiveB.radius)) {
    const angleADeg = (Math.atan2(point.y - primitiveA.center.y, point.x - primitiveA.center.x) * 180) / Math.PI;
    const uA = sweepFractionForAngleInRange(
      primitiveA.startAngleDeg,
      primitiveA.sweepAngleDeg,
      angleADeg,
      primitiveA.uStart,
      primitiveA.uEnd
    );
    if (uA === null) continue;

    const angleBDeg = (Math.atan2(point.y - primitiveB.center.y, point.x - primitiveB.center.x) * 180) / Math.PI;
    const uB = sweepFractionForAngleInRange(
      primitiveB.startAngleDeg,
      primitiveB.sweepAngleDeg,
      angleBDeg,
      primitiveB.uStart,
      primitiveB.uEnd
    );
    if (uB === null) continue;

    const distToRough = Math.hypot(point.x - roughPoint.x, point.y - roughPoint.y);
    if (!best || distToRough < best.distToRough) {
      best = {
        point,
        uA,
        uB,
        distToRough
      };
    }
  }

  return best && { point: best.point, arcUA: best.uA, arcUB: best.uB };
};

const arcPointAtU = (center: Point, radius: number, startAngleDeg: number, sweepAngleDeg: number, u: number): Point =>
  arcPoint(center, radius, startAngleDeg + sweepAngleDeg * u);

// d/du of arcPointAtU: the arc is parameterized by sweep fraction u (not
// angle directly), so the chain rule picks up a factor of sweepAngleDeg (in
// radians) from d(theta)/du.
const arcDerivativeAtU = (radius: number, startAngleDeg: number, sweepAngleDeg: number, u: number): Point => {
  const thetaRad = degreesToRadians(startAngleDeg + sweepAngleDeg * u);
  const sweepRad = degreesToRadians(sweepAngleDeg);
  return {
    x: -radius * sweepRad * Math.sin(thetaRad),
    y: radius * sweepRad * Math.cos(thetaRad)
  };
};

const isFinitePoint = (point: Point) => Number.isFinite(point.x) && Number.isFinite(point.y);

// Refine a Bezier<->Arc crossing with 2D Newton solving B(t) = Arc(u), where
// Arc(u) = center + radius*(cos(start+sweep*u), sin(start+sweep*u)) so u is
// the arc's own sweep fraction (handles negative sweep && >180-degree
// sweeps naturally, unlike parameterizing directly by angle). Same
// defensive conditions as the Rust port (singular/non-finite Jacobian,
// non-finite step, 40-iteration cap, final residual tolerance), plus an
// extra requirement specific to arcs: the converged (t, u) must land within
// *this seed chord's own* local ranges (tStart..tEnd && uStart..uEnd), not
// just the global [0, 1] each side is clamped to during iteration --
// otherwise a chord could steal a root that actually belongs to a
// neighboring chord.
const refineBezierArcIntersection = (
  bezier: IntersectionSegment,
  arc: IntersectionSegment,
  roughPoint: Point
): { point: Point; bezierT: number; arcU: number } | null => {
  if (bezier.primitive.kind !== "bezier") return null;
  if (arc.primitive.kind !== "arc") return null;

  const { segment, tStart, tEnd } = bezier.primitive;
  const { center, radius, startAngleDeg, sweepAngleDeg, uStart, uEnd } = arc.primitive;

  const solve = (initialT: number, initialU: number) => {
    let t = initialT;
    let u = initialU;
    for (let index = 0; index < 40; index += 1) {
      const pt = cubicPointAt(segment, t);
      const pu = arcPointAtU(center, radius, startAngleDeg, sweepAngleDeg, u);
      const fx = pt.x - pu.x;
      const fy = pt.y - pu.y;
      const residual = Math.hypot(fx, fy);
      if (!Number.isFinite(residual)) return null;
      if (residual <= EPSILON) break;

      const dt = cubicDerivativeAt(segment, t);
      const arcDeriv = arcDerivativeAtU(radius, startAngleDeg, sweepAngleDeg, u);
      const negArcDeriv = { x: -arcDeriv.x, y: -arcDeriv.y };
      const det = negArcDeriv.x * dt.y - dt.x * negArcDeriv.y;
      if (!Number.isFinite(det) || Math.abs(det) <= EPSILON) return null;
      const stepT = (negArcDeriv.y * fx - negArcDeriv.x * fy) / det;
      const stepU = (dt.y * fx - dt.x * fy) / det;
      if (!Number.isFinite(stepT) || !Number.isFinite(stepU)) return null;

      let accepted = false;
      for (let damping = 1; damping >= 1 / 1024; damping /= 2) {
        const nextT = t + damping * stepT;
        const nextU = u + damping * stepU;
        if (nextT < tStart - EPSILON || nextT > tEnd + EPSILON || nextU < uStart - EPSILON || nextU > uEnd + EPSILON) continue;
        const nextPt = cubicPointAt(segment, nextT);
        const nextPu = arcPointAtU(center, radius, startAngleDeg, sweepAngleDeg, nextU);
        if (Math.hypot(nextPt.x - nextPu.x, nextPt.y - nextPu.y) < residual) {
          t = nextT;
          u = nextU;
          accepted = true;
          break;
        }
      }
      if (!accepted) return null;
    }

    const pt = cubicPointAt(segment, t);
    const pu = arcPointAtU(center, radius, startAngleDeg, sweepAngleDeg, u);
    const residual = Math.hypot(pt.x - pu.x, pt.y - pu.y);
    return isFinitePoint(pt) && isFinitePoint(pu) && residual <= INTERSECTION_TOLERANCE
      ? { point: pt, bezierT: t, arcU: u }
      : null;
  };

  const bisectCircleRoot = () => {
    const circleResidual = (t: number) => {
      const point = cubicPointAt(segment, t);
      return (point.x - center.x) ** 2 + (point.y - center.y) ** 2 - radius ** 2;
    };
    let low = tStart;
    let high = tEnd;
    let lowValue = circleResidual(low);
    const highValue = circleResidual(high);
    if (!Number.isFinite(lowValue) || !Number.isFinite(highValue)) return null;
    if (Math.abs(lowValue) > EPSILON && Math.abs(highValue) > EPSILON && Math.sign(lowValue) === Math.sign(highValue)) {
      return null;
    }
    for (let index = 0; index < 80; index += 1) {
      const mid = (low + high) / 2;
      const midValue = circleResidual(mid);
      if (Math.abs(midValue) <= EPSILON) {
        low = mid;
        high = mid;
        break;
      }
      if (Math.sign(lowValue) === Math.sign(midValue)) {
        low = mid;
        lowValue = midValue;
      } else {
        high = mid;
      }
    }
    const bezierT = (low + high) / 2;
    const point = cubicPointAt(segment, bezierT);
    const angleDeg = (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
    const arcU = sweepFractionForAngleInRange(startAngleDeg, sweepAngleDeg, angleDeg, uStart, uEnd);
    if (arcU === null) return null;
    const arcPoint = arcPointAtU(center, radius, startAngleDeg, sweepAngleDeg, arcU);
    return Math.hypot(point.x - arcPoint.x, point.y - arcPoint.y) <= INTERSECTION_TOLERANCE
      ? { point, bezierT, arcU }
      : null;
  };

  const roughT = chordSeed(bezier, tStart, tEnd, roughPoint);
  const roughU = chordSeed(arc, uStart, uEnd, roughPoint);
  const middleT = (tStart + tEnd) / 2;
  const middleU = (uStart + uEnd) / 2;
  return (
    solve(roughT, roughU) ??
    solve(middleT, middleU) ??
    solve(roughT, middleU) ??
    solve(middleT, roughU) ??
    bisectCircleRoot()
  );
};

const refineIntersection = (
  a: IntersectionSegment,
  b: IntersectionSegment,
  intersection: { point: Point; line1Distance: number; line2Distance: number; overlap: boolean }
): { point: Point; line1Distance: number; line2Distance: number; overlap: boolean } | null => {
  if (a.primitive.kind === "bezier" && b.primitive.kind === "bezier") {
    const refined = refineBezierBezierIntersection(a, b, intersection.point);
    if (refined) {
      return {
        point: refined.point,
        line1Distance: distanceAtBezierSegmentT(a, refined.aT),
        line2Distance: distanceAtBezierSegmentT(b, refined.bT),
        overlap: false
      };
    }
    return null;
  }
  if (a.primitive.kind === "arc" && b.primitive.kind === "arc") {
    const refined = refineArcArcIntersection(a, b, intersection.point);
    if (refined) {
      return {
        point: refined.point,
        line1Distance: distanceAtArcSegmentU(a, refined.arcUA),
        line2Distance: distanceAtArcSegmentU(b, refined.arcUB),
        overlap: false
      };
    }
    return null;
  }
  if (a.primitive.kind === "bezier" && b.primitive.kind === "arc") {
    const refined = refineBezierArcIntersection(a, b, intersection.point);
    if (refined) {
      return {
        point: refined.point,
        line1Distance: distanceAtBezierSegmentT(a, refined.bezierT),
        line2Distance: distanceAtArcSegmentU(b, refined.arcU),
        overlap: false
      };
    }
    return null;
  }
  if (a.primitive.kind === "arc" && b.primitive.kind === "bezier") {
    const refined = refineBezierArcIntersection(b, a, intersection.point);
    if (refined) {
      return {
        point: refined.point,
        line1Distance: distanceAtArcSegmentU(a, refined.arcU),
        line2Distance: distanceAtBezierSegmentT(b, refined.bezierT),
        overlap: false
      };
    }
    return null;
  }
  if (a.primitive.kind === "bezier") {
    const refined = refineBezierLineIntersection(a, b);
    if (refined) {
      return {
        point: refined.point,
        line1Distance: distanceAtBezierSegmentT(a, refined.bezierT),
        line2Distance: b.startDistance + (b.endDistance - b.startDistance) * refined.lineT,
        overlap: false
      };
    }
    return null;
  }
  if (b.primitive.kind === "bezier") {
    const refined = refineBezierLineIntersection(b, a);
    if (refined) {
      return {
        point: refined.point,
        line1Distance: a.startDistance + (a.endDistance - a.startDistance) * refined.lineT,
        line2Distance: distanceAtBezierSegmentT(b, refined.bezierT),
        overlap: false
      };
    }
    return null;
  }
  if (a.primitive.kind === "arc") {
    const refined = refineArcLineIntersection(a, b, intersection.point);
    if (refined) {
      return {
        point: refined.point,
        line1Distance: distanceAtArcSegmentU(a, refined.arcU),
        line2Distance: b.startDistance + (b.endDistance - b.startDistance) * refined.lineT,
        overlap: false
      };
    }
    return null;
  }
  if (b.primitive.kind === "arc") {
    const refined = refineArcLineIntersection(b, a, intersection.point);
    if (refined) {
      return {
        point: refined.point,
        line1Distance: a.startDistance + (a.endDistance - a.startDistance) * refined.lineT,
        line2Distance: distanceAtArcSegmentU(b, refined.arcU),
        overlap: false
      };
    }
    return null;
  }
  return intersection;
};

const samePoint = (a: LineIntersection, b: LineIntersection) =>
  Math.hypot(a.x - b.x, a.y - b.y) <= DEDUPE_EPSILON;

export const findLineIntersections = (
  line1: ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine,
  line2: ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine,
  options: { useExtensions: boolean }
): LineIntersectionResult => {
  const baseSegments1 = pathSegmentsForLine(line1);
  const baseSegments2 = pathSegmentsForLine(line2);
  const segments1 = options.useExtensions
    ? [...baseSegments1, ...extensionSegments(baseSegments1, line1)]
    : baseSegments1;
  const segments2 = options.useExtensions
    ? [...baseSegments2, ...extensionSegments(baseSegments2, line2)]
    : baseSegments2;
  const intersections: LineIntersection[] = [];

  for (const segment1 of segments1) {
    for (const segment2 of segments2) {
      const roughIntersection = segmentIntersection(segment1, segment2);
      if (!roughIntersection) continue;
      const intersection = refineIntersection(segment1, segment2, roughIntersection);
      if (!intersection) continue;
      if (intersection.overlap) {
        return {
          intersections,
          error: "参照線同士が重なっているため、交点を一意に決められません。重ならない線を指定してください。"
        };
      }
      const item = {
        x: intersection.point.x,
        y: intersection.point.y,
        line1Distance: intersection.line1Distance,
        line2Distance: intersection.line2Distance
      };
      if (!intersections.some((existing) => samePoint(existing, item))) {
        intersections.push(item);
      }
    }
  }

  intersections.sort(
    (a, b) =>
      a.line1Distance - b.line1Distance ||
      a.line2Distance - b.line2Distance ||
      a.x - b.x ||
      a.y - b.y
  );

  return { intersections };
};
