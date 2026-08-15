// Shared pure math for cubic Bezier segments, reused by the split, endpoint-move,
// && intersection evaluators. Mirrors `src-tauri/src/evaluation/bezier_math.rs`.

export type Point = { x: number; y: number };

export type BezierLikeSegment = {
  start: Point;
  control1: Point;
  control2: Point;
  end: Point;
};

export const EPSILON = 1e-9;

export const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

export const interpolate = (start: Point, end: Point, t: number): Point => ({
  x: start.x + (end.x - start.x) * t,
  y: start.y + (end.y - start.y) * t
});

export const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;

export const solveRealQuadratic = (a: number, b: number, c: number): number[] => {
  if (Math.abs(a) <= EPSILON) {
    if (Math.abs(b) <= EPSILON) return [];
    return [-c / b];
  }

  const discriminant = b * b - 4 * a * c;
  if (discriminant < -EPSILON) return [];
  if (Math.abs(discriminant) <= EPSILON) return [-b / (2 * a)];

  const rootDistance = Math.sqrt(discriminant);
  const roots = [
    (-b - rootDistance) / (2 * a),
    (-b + rootDistance) / (2 * a)
  ].sort((left, right) => left - right);
  return Math.abs(roots[1] - roots[0]) <= EPSILON ? [roots[0]] : roots;
};

export type BezierFeatureCandidate = {
  t: number;
  score: number;
};

export const selectBestBezierFeatureCandidate = (
  candidates: readonly BezierFeatureCandidate[]
): BezierFeatureCandidate | null => {
  let best: BezierFeatureCandidate | null = null;
  for (const candidate of candidates) {
    if (!best || candidate.score > best.score + EPSILON) {
      best = candidate;
      continue;
    }
    if (Math.abs(candidate.score - best.score) > EPSILON) continue;

    const candidateCenterDistance = Math.abs(candidate.t - 0.5);
    const bestCenterDistance = Math.abs(best.t - 0.5);
    if (
      candidateCenterDistance < bestCenterDistance - EPSILON ||
      (Math.abs(candidateCenterDistance - bestCenterDistance) <= EPSILON && candidate.t < best.t)
    ) {
      best = candidate;
    }
  }
  return best;
};

export const cubicPointAt = (segment: BezierLikeSegment, t: number): Point => {
  const inverse = 1 - t;
  const a = inverse * inverse * inverse;
  const b = 3 * inverse * inverse * t;
  const c = 3 * inverse * t * t;
  const d = t * t * t;
  return {
    x: a * segment.start.x + b * segment.control1.x + c * segment.control2.x + d * segment.end.x,
    y: a * segment.start.y + b * segment.control1.y + c * segment.control2.y + d * segment.end.y
  };
};

export const cubicDerivativeAt = (segment: BezierLikeSegment, t: number): Point => {
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

export const cubicSecondDerivativeAt = (segment: BezierLikeSegment, t: number): Point => ({
  x:
    6 * (1 - t) * (segment.control2.x - 2 * segment.control1.x + segment.start.x) +
    6 * t * (segment.end.x - 2 * segment.control2.x + segment.control1.x),
  y:
    6 * (1 - t) * (segment.control2.y - 2 * segment.control1.y + segment.start.y) +
    6 * t * (segment.end.y - 2 * segment.control2.y + segment.control1.y)
});

export type BezierProjection = {
  localT: number;
  distanceFromLine: number;
};

// Newton projection of a point onto a cubic segment, seeded from an initial t.
export const refineBezierProjection = (
  segment: BezierLikeSegment,
  point: Point,
  initialT: number
): BezierProjection => {
  let t = Math.min(Math.max(initialT, 0), 1);

  for (let index = 0; index < 20; index += 1) {
    const current = cubicPointAt(segment, t);
    const first = cubicDerivativeAt(segment, t);
    const second = cubicSecondDerivativeAt(segment, t);
    const residual = { x: current.x - point.x, y: current.y - point.y };
    const denominator = dot(first, first) + dot(residual, second);
    if (Math.abs(denominator) <= EPSILON) break;

    const nextT = Math.min(Math.max(t - dot(residual, first) / denominator, 0), 1);
    if (Math.abs(nextT - t) <= EPSILON) {
      t = nextT;
      break;
    }
    t = nextT;
  }

  const projected = cubicPointAt(segment, t);
  return {
    localT: t,
    distanceFromLine: distance(point, projected)
  };
};

export type CurveProjection = {
  segmentIndex: number;
  localT: number;
  point: Point;
  distance: number;
};

const SEED_STEPS = 64;

// Project a point onto the analytic curve made of cubic `segments`, returning the
// closest segment, its local parameter, the on-curve point, && distance. This is
// the single source of "where is this point on the curve" used by endpoint moves.
export const projectPointOntoCurve = (
  segments: BezierLikeSegment[],
  point: Point
): CurveProjection | null => {
  let best: CurveProjection | null = null;
  segments.forEach((segment, segmentIndex) => {
    let seedT = 0;
    let seedDistance = Infinity;
    for (let index = 0; index <= SEED_STEPS; index += 1) {
      const t = index / SEED_STEPS;
      const sampled = cubicPointAt(segment, t);
      const candidate = distance(sampled, point);
      if (candidate < seedDistance) {
        seedDistance = candidate;
        seedT = t;
      }
    }
    const refined = refineBezierProjection(segment, point, seedT);
    if (!best || refined.distanceFromLine < best.distance) {
      best = {
        segmentIndex,
        localT: refined.localT,
        point: cubicPointAt(segment, refined.localT),
        distance: refined.distanceFromLine
      };
    }
  });
  return best;
};

export type BezierSplit<T> = {
  point: Point;
  left: T;
  right: T;
};

// de Casteljau subdivision of a cubic at t.
export const splitBezierLike = <T extends BezierLikeSegment>(segment: T, t: number): BezierSplit<T> => {
  const p01 = interpolate(segment.start, segment.control1, t);
  const p12 = interpolate(segment.control1, segment.control2, t);
  const p23 = interpolate(segment.control2, segment.end, t);
  const p012 = interpolate(p01, p12, t);
  const p123 = interpolate(p12, p23, t);
  const p0123 = interpolate(p012, p123, t);
  return {
    point: p0123,
    left: { ...segment, control1: p01, control2: p012, end: p0123 },
    right: { ...segment, start: p0123, control1: p123, control2: p23 }
  };
};
