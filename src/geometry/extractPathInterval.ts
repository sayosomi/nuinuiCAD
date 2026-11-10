import type { ComputedGeometry, ComputedGeometryValue, ComputedJoinedPath, ComputedOffsetLineSegment, ComputedPoint } from "./evaluationTypes";
import { isLineLikeGeometryInput, type LineLikeGeometryInput } from "./linePaths";
import { approximateCubicLength, cubicPointAt, distance, interpolate, solveRealQuadratic, type Point } from "./bezierMath";
import { splitOffsetSegment } from "./splitLineEvaluator";
import { offsetLineEndpointMeasurements } from "./lineMeasurements";
import { reverseLineLikeGeometry } from "./reversePathGeometry";

const EPS = 1e-9;
const TOLERANCE_MM = 0.001;
export type ExtractBoundary = "start" | "end" | Point;
export type ExtractStation = { segmentIndex: number; t: number };
export type ExtractIntervalResult =
  | { ok: true; geometry: ComputedJoinedPath; left: ExtractStation; right: ExtractStation }
  | { ok: false; code: "invalid-source" | "closed-source" | "off-source" | "ambiguous-station" | "zero-interval"; boundary?: "left" | "right" };

const point = (p: Point): ComputedPoint => ({ kind: "point", elementId: "", name: "", ...p });
const finitePoint = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y);

/** Isolate every root on monotonic polynomial intervals, including repeated roots.
 * This is a station solver, never a nearest-segment/sample heuristic. */
const cubicRoots = (a: number, b: number, c: number, d: number): number[] => {
  const value = (t: number) => ((a * t + b) * t + c) * t + d;
  const cuts = [0, ...solveRealQuadratic(3 * a, 2 * b, c).filter(t => t > 0 && t < 1), 1].sort((x, y) => x - y);
  const roots = cuts.filter(t => Math.abs(value(t)) <= 1e-10);
  for (let i = 1; i < cuts.length; i++) {
    let lo = cuts[i - 1], hi = cuts[i];
    if (value(lo) * value(hi) >= 0) continue;
    for (let step = 0; step < 64; step++) {
      const mid = (lo + hi) / 2;
      if (value(lo) * value(mid) <= 0) hi = mid;
      else lo = mid;
    }
    roots.push((lo + hi) / 2);
  }
  return roots.sort((x, y) => x - y).filter((t, i, all) => i === 0 || t - all[i - 1] > EPS);
};

const segmentStations = (s: ComputedOffsetLineSegment, p: Point): number[] => {
  if (!finitePoint(p)) return [];
  if (s.kind === "line") {
    const dx = s.end.x - s.start.x, dy = s.end.y - s.start.y;
    const t = ((p.x - s.start.x) * dx + (p.y - s.start.y) * dy) / (dx * dx + dy * dy);
    return t >= -EPS && t <= 1 + EPS && distance(interpolate(s.start, s.end, t), p) <= TOLERANCE_MM ? [Math.max(0, Math.min(1, t))] : [];
  }
  if (s.kind === "arc") {
    if (Math.abs(distance(s.center, p) - s.radius) > TOLERANCE_MM) return [];
    if (distance(s.start, p) <= EPS) return [0];
    if (distance(s.end, p) <= EPS) return [1];
    const angle = Math.atan2(p.y - s.center.y, p.x - s.center.x) * 180 / Math.PI;
    const normalize = (n: number) => ((n % 360) + 360) % 360;
    const progress = s.sweepAngleDeg > 0 ? normalize(angle - s.startAngleDeg) : -normalize(s.startAngleDeg - angle);
    const t = progress / s.sweepAngleDeg;
    return t >= -EPS && t <= 1 + EPS ? [Math.max(0, Math.min(1, t))] : [];
  }
  const coefficients = (axis: "x" | "y") => [
    -s.start[axis] + 3 * s.control1[axis] - 3 * s.control2[axis] + s.end[axis],
    3 * s.start[axis] - 6 * s.control1[axis] + 3 * s.control2[axis],
    -3 * s.start[axis] + 3 * s.control1[axis],
    s.start[axis] - p[axis]
  ] as const;
  const x = coefficients("x"), y = coefficients("y");
  const magnitude = (c: readonly number[]) => Math.max(...c.slice(0, 3).map(Math.abs));
  const c = magnitude(x) >= magnitude(y) ? x : y;
  return cubicRoots(...c).filter(t => distance(cubicPointAt(s, t), p) <= TOLERANCE_MM);
};

const segmentsFor = (source: LineLikeGeometryInput): ComputedOffsetLineSegment[] => {
  const segment = (s: { start: Point; end: Point; kind?: string; control1?: Point; control2?: Point }): ComputedOffsetLineSegment => {
    if (s.control1 && s.control2) {
      const curve = { kind: "bezier" as const, start: point(s.start), end: point(s.end), control1: s.control1, control2: s.control2 };
      return { ...curve, length: approximateCubicLength(curve) };
    }
    return { kind: "line", start: point(s.start), end: point(s.end), length: distance(s.start, s.end) };
  };
  if (source.kind === "line") return [segment(source)];
  if (source.kind === "arcLine") return [{ kind: "arc", start: point(source.start), end: point(source.end), center: point(source.center), radius: source.radius, startAngleDeg: source.startAngleDeg, sweepAngleDeg: source.sweepAngleDeg, length: source.radius * Math.abs(source.sweepAngleDeg * (Math.PI / 180)) }];
  return source.segments.map(s => "kind" in s && s.kind === "arc"
    ? { ...s, start: point(s.start), end: point(s.end), center: point(s.center), length: s.radius * Math.abs(s.sweepAngleDeg * (Math.PI / 180)) }
    : segment(s));
};

/** Extract a directed interval without mutating the captured source. Segment
 * indexes and parameters refer to that exact prefix, including joins/reversal. */
export const extractPathInterval = (
  source: ComputedGeometry | ComputedGeometryValue,
  left: ExtractBoundary,
  right: ExtractBoundary,
  elementId: string,
  name: string
): ExtractIntervalResult => {
  if (!isLineLikeGeometryInput(source)) return { ok: false, code: "invalid-source" };
  const segments = segmentsFor(source);
  if (!segments.length || segments.some(s => !finitePoint(s.start) || !finitePoint(s.end) || !Number.isFinite(s.length) || s.length <= EPS ||
    (s.kind === "bezier" && (!finitePoint(s.control1) || !finitePoint(s.control2))) ||
    (s.kind === "arc" && (!finitePoint(s.center) || !Number.isFinite(s.startAngleDeg) || !Number.isFinite(s.sweepAngleDeg) || !Number.isFinite(s.radius) || s.radius <= EPS || !Number.isFinite(s.startAngleDeg + s.sweepAngleDeg) || s.startAngleDeg + s.sweepAngleDeg === s.startAngleDeg || Math.abs(s.sweepAngleDeg) <= EPS))) ||
    segments.some((s, i) => i > 0 && distance(segments[i - 1].end, s.start) > TOLERANCE_MM)) return { ok: false, code: "invalid-source" };
  if (("closed" in source && source.closed) || distance(segments[0].start, segments.at(-1)!.end) <= EPS || segments.some(s => s.kind === "arc" && Math.abs(s.sweepAngleDeg) >= 360 - EPS)) return { ok: false, code: "closed-source" };
  const stations: number[] = [];
  for (const [boundary, bound] of [["left", left], ["right", right]] as const) {
    if (bound === "start") { stations.push(0); continue; }
    if (bound === "end") { stations.push(segments.length); continue; }
    const hits = segments.flatMap((s, i) => segmentStations(s, bound).map(t => i + t)).sort((a, b) => a - b)
      .filter((v, i, all) => i === 0 || v - all[i - 1] > EPS);
    if (hits.length !== 1) return { ok: false, code: hits.length ? "ambiguous-station" : "off-source", boundary };
    stations.push(hits[0]);
  }
  const [a, b] = stations;
  if (Math.abs(a - b) <= EPS) return { ok: false, code: "zero-interval" };
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const selected = segments.flatMap((s, i) => {
    const from = Math.max(0, lo - i), to = Math.min(1, hi - i);
    if (to - from <= EPS) return [];
    let cut = s;
    if (to < 1) cut = splitOffsetSegment(cut, to, s.kind === "line" ? interpolate(s.start, s.end, to) : s.kind === "bezier" ? cubicPointAt(s, to) : arcPoint(s, to))[0];
    if (from > 0) cut = splitOffsetSegment(cut, from / to, s.kind === "line" ? interpolate(s.start, s.end, from) : s.kind === "bezier" ? cubicPointAt(s, from) : arcPoint(s, from))[1];
    return [cut];
  });
  const geometry: ComputedJoinedPath = {
    kind: "joinedPath", elementId, name, pathIds: "elementId" in source ? [source.elementId] : [], closed: false,
    segments: selected, length: selected.reduce((sum, s) => sum + s.length, 0), ...offsetLineEndpointMeasurements(selected)
  };
  if (geometry.length <= EPS) return { ok: false, code: "zero-interval" };
  const station = (n: number): ExtractStation => n === segments.length ? { segmentIndex: n - 1, t: 1 } : { segmentIndex: Math.floor(n), t: n % 1 };
  return { ok: true, geometry: (a > b ? reverseLineLikeGeometry(geometry) : geometry) as ComputedJoinedPath, left: station(a), right: station(b) };
};

const arcPoint = (s: Extract<ComputedOffsetLineSegment, { kind: "arc" }>, t: number): Point => {
  const angle = (s.startAngleDeg + s.sweepAngleDeg * t) * Math.PI / 180;
  return { x: s.center.x + s.radius * Math.cos(angle), y: s.center.y + s.radius * Math.sin(angle) };
};
