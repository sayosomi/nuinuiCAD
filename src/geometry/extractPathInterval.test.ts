import { describe, expect, it } from "vitest";
import { extractPathInterval, type ExtractBoundary } from "./extractPathInterval";
import type { LineLikeGeometryInput } from "./linePaths";
import { reverseLineLikeGeometry } from "./reversePathGeometry";
import type { ComputedJoinedPath } from "./evaluationTypes";

const p = (x: number, y: number) => ({ x, y });
const line: LineLikeGeometryInput = { kind: "line", start: p(0, 0), end: p(100, 0), length: 100, startAngleDeg: 0, endAngleDeg: 180, startTangentAngleDeg: 0, endTangentAngleDeg: 180 };
const arc: LineLikeGeometryInput = { kind: "arcLine", center: p(0, 0), radius: 100, start: p(100, 0), end: p(-100, 0), startAngleDeg: 0, endAngleDeg: 180, sweepAngleDeg: 180, length: 100 * Math.PI, startTangentAngleDeg: 90, endTangentAngleDeg: 90 };
const cubic: LineLikeGeometryInput = { kind: "bezierCurve", segments: [{ start: p(0, 0), control1: p(0, 40), control2: p(100, 40), end: p(100, 0) }], length: 130 };
const result = (source: LineLikeGeometryInput, left: ExtractBoundary, right: ExtractBoundary) => {
  const r = extractPathInterval(source, left, right, "part", "part");
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.code);
  return r;
};

describe("exact directed extract interval kernel", () => {
  it("matches independent line and reversed interval oracles without mutating the source", () => {
    const before = structuredClone(line);
    for (const [a, b] of [[40, 70], [70, 40]]) {
      const { geometry: g } = result(line, p(a, 0), p(b, 0));
      expect(g.length).toBeCloseTo(30, 12);
      expect(g.start).toMatchObject(p(a, 0)); expect(g.end).toMatchObject(p(b, 0));
      expect(g.startTangentAngleDeg).toBe(a < b ? 0 : 180);
    }
    expect(line).toEqual(before);
  });
  it("matches independent signed arc sweep and length oracles", () => {
    const polar = (deg: number) => p(100 * Math.cos(deg * Math.PI / 180), 100 * Math.sin(deg * Math.PI / 180));
    for (const [a, b] of [[30, 120], [120, 30]]) {
      const { geometry: g } = result(arc, polar(a), polar(b));
      expect(g.length).toBeCloseTo(50 * Math.PI, 10);
      expect(g.segments[0]).toMatchObject({ kind: "arc", radius: 100 });
      if (g.segments[0].kind !== "arc") throw new Error("arc lost");
      expect(g.segments[0].startAngleDeg).toBeCloseTo(a, 10);
      expect(g.segments[0].sweepAngleDeg).toBeCloseTo(b - a, 10);
    }
  });
  it("matches the independent de Casteljau subcubic oracle in both directions", () => {
    const expected = { start: p(15.625, 22.5), control1: p(34.375, 32.5), control2: p(65.625, 32.5), end: p(84.375, 22.5) };
    const forward = result(cubic, expected.start, expected.end);
    const backward = result(cubic, expected.end, expected.start);
    for (const [g, shape] of [[forward.geometry, expected], [backward.geometry, { start: expected.end, control1: expected.control2, control2: expected.control1, end: expected.start }]] as const) {
      const s = g.segments[0]; if (s.kind !== "bezier") throw new Error("cubic lost");
      for (const key of ["start", "control1", "control2", "end"] as const) {
        expect(s[key].x).toBeCloseTo(shape[key].x, 10); expect(s[key].y).toBeCloseTo(shape[key].y, 10);
      }
    }
    expect(forward.left).toEqual({ segmentIndex: 0, t: 0.25 });
    expect(forward.right).toEqual({ segmentIndex: 0, t: 0.75 });
  });
  it("supports explicit divisions, middle-only, gaps, overlap and equal intervals with independent owners", () => {
    const intervals: [ExtractBoundary, ExtractBoundary, number][] = [["start", p(40, 0), 40], [p(40, 0), p(70, 0), 30], [p(70, 0), "end", 30], ["start", p(70, 0), 70], [p(40, 0), "end", 60]];
    for (const [a, b, length] of intervals) expect(result(line, a, b).geometry.length).toBeCloseTo(length, 12);
    const first = result(line, p(40, 0), p(70, 0));
    const second = extractPathInterval(line, p(40, 0), p(70, 0), "other", "other");
    expect(second.ok && second.geometry.elementId).toBe("other"); expect(first.geometry.elementId).toBe("part");
  });
  it.each(["polyline", "offsetLine", "joinedPath"] as const)("retains joins/stations and recomputes %s intervals", kind => {
    const path = { kind, closed: false, segments: [
      { kind: "line" as const, start: p(0, 0), end: p(100, 0), length: 100 },
      { kind: "line" as const, start: p(100, 0), end: p(100, 100), length: 100 }
    ], start: p(0, 0), end: p(100, 100), length: 200, startTangentAngleDeg: 0, endTangentAngleDeg: 270 } as Extract<LineLikeGeometryInput, { kind: "polyline" | "offsetLine" | "joinedPath" }>;
    const g = result(path, p(40, 0), p(100, 70)).geometry;
    expect(g.segments).toHaveLength(2); expect(g.length).toBeCloseTo(130, 12);
    expect(result(path, p(100, 0), "end").left).toEqual({ segmentIndex: 1, t: 0 });
    const reversed = reverseLineLikeGeometry(g) as ComputedJoinedPath;
    expect(result(reversed, "start", "end").geometry.start).toEqual(g.end);
    path.segments[0].start.y = 10; path.segments[0].end.y = 10; path.segments[1].start.y = 10;
    expect(extractPathInterval(path, p(40, 0), "end", "p", "p")).toMatchObject({ ok: false, code: "off-source", boundary: "left" });
    expect(result(path, p(40, 10), p(100, 70)).geometry.length).toBeCloseTo(120, 12);
  });
  it("rejects ambiguous stations at self intersections, including coincident segment interiors", () => {
    const path = { kind: "joinedPath", closed: false, segments: [
      { kind: "line", start: p(0, 0), end: p(100, 100), length: Math.sqrt(20000) },
      { kind: "line", start: p(100, 100), end: p(0, 100), length: 100 },
      { kind: "line", start: p(0, 100), end: p(100, 0), length: Math.sqrt(20000) }
    ] } as LineLikeGeometryInput;
    expect(extractPathInterval(path, "start", p(50, 50), "p", "p")).toEqual({ ok: false, code: "ambiguous-station", boundary: "right" });
  });
  it("rejects multiple stations within one retraced cubic without choosing the nearest root", () => {
    const path = { kind: "bezierCurve", segments: [{ start: p(0, 0), control1: p(200, 0), control2: p(-100, 0), end: p(100, 0) }], length: 200 } as LineLikeGeometryInput;
    expect(extractPathInterval(path, p(50, 0), "end", "p", "p")).toMatchObject({ ok: false, code: "ambiguous-station", boundary: "left" });
  });
  it("fails closed on equal, off-source, nonfinite, closed and disconnected geometry", () => {
    expect(extractPathInterval(line, p(40, 0), p(40, 0), "p", "p")).toMatchObject({ ok: false, code: "zero-interval" });
    expect(extractPathInterval(line, p(40, 2), "end", "p", "p")).toMatchObject({ ok: false, code: "off-source" });
    expect(extractPathInterval(line, p(NaN, 0), "end", "p", "p")).toMatchObject({ ok: false, code: "off-source" });
    const closed = { kind: "polyline", closed: true, segments: [{ kind: "line", start: p(0, 0), end: p(1, 0), length: 1 }] } as LineLikeGeometryInput;
    expect(extractPathInterval(closed, "start", "end", "p", "p")).toMatchObject({ ok: false, code: "closed-source" });
  });
  it("preserves exact mixed offset/joined segments and the captured traversal provenance", () => {
    const source = { kind: "offsetLine", closed: false, start: p(0, 0), end: p(200, 0), length: 300, startTangentAngleDeg: 90, endTangentAngleDeg: 270,
      segments: [
        { kind: "bezier", start: p(0, 0), control1: p(0, 40), control2: p(100, 40), end: p(100, 0), length: 130 },
        { kind: "arc", center: p(150, 0), start: p(100, 0), end: p(200, 0), radius: 50, startAngleDeg: 180, sweepAngleDeg: 180, length: 50 * Math.PI }
      ] } as LineLikeGeometryInput;
    const extracted = result(source, p(15.625, 22.5), p(150, -50));
    expect(extracted.left).toEqual({ segmentIndex: 0, t: 0.25 });
    expect(extracted.right).toEqual({ segmentIndex: 1, t: 0.5 });
    expect(extracted.geometry.segments.map(s => s.kind)).toEqual(["bezier", "arc"]);
    expect(extracted.geometry.segments[1]).toMatchObject({ radius: 50, startAngleDeg: 180, sweepAngleDeg: 90 });
    const reverseSource = reverseLineLikeGeometry(result(source, "start", "end").geometry);
    const reversed = result(reverseSource, p(150, -50), p(15.625, 22.5));
    expect(reversed.left).toEqual({ segmentIndex: 0, t: 0.5 });
    expect(reversed.right).toEqual({ segmentIndex: 1, t: 0.75 });
    expect(reversed.geometry.segments.map(s => s.kind)).toEqual(["arc", "bezier"]);
    expect(reversed.geometry.length).toBeCloseTo(extracted.geometry.length, 10);
  });
  it("preserves the analytic subcubic after a source rotation, reflection and translation", () => {
    const transform = (v: { x: number; y: number }) => p(70 - v.y, 30 - v.x);
    if (cubic.kind !== "bezierCurve") throw new Error("cubic expected");
    const s = cubic.segments[0];
    const source = { ...cubic, segments: [{ start: transform(s.start), control1: transform(s.control1), control2: transform(s.control2), end: transform(s.end) }] };
    const r = result(source, transform(p(15.625, 22.5)), transform(p(84.375, 22.5)));
    const cut = r.geometry.segments[0]; if (cut.kind !== "bezier") throw new Error("cubic lost");
    for (const [key, value] of [["start", p(15.625, 22.5)], ["control1", p(34.375, 32.5)], ["control2", p(65.625, 32.5)], ["end", p(84.375, 22.5)]] as const) {
      expect(cut[key].x).toBeCloseTo(transform(value).x, 10); expect(cut[key].y).toBeCloseTo(transform(value).y, 10);
    }
  });
  it("rejects non-path sources, disconnected joins and unstable arc traversal", () => {
    for (const kind of ["point", "text", "image"] as const) {
      expect(extractPathInterval({ kind } as never, "start", "end", "p", "p")).toEqual({ ok: false, code: "invalid-source" });
    }
    const disconnected = { kind: "joinedPath", closed: false, segments: [
      { kind: "line", start: p(0, 0), end: p(100, 0) }, { kind: "line", start: p(200, 0), end: p(300, 0) }
    ] } as LineLikeGeometryInput;
    expect(extractPathInterval(disconnected, "start", "end", "p", "p")).toEqual({ ok: false, code: "invalid-source" });
    for (const patch of [{ radius: NaN }, { sweepAngleDeg: Infinity }, { startAngleDeg: 1e300 }]) {
      expect(extractPathInterval({ ...arc, ...patch } as LineLikeGeometryInput, "start", "end", "p", "p")).toMatchObject({ ok: false, code: "invalid-source" });
    }
  });

});
