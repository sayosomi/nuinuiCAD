import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import type {
  ArcLineElement,
  BezierCurveElement,
  CadElement,
  ComputedGeometry,
  ComputedJoinedPath,
  PolylineElement
} from "../types/geometry";
import { evaluateElements } from "./evaluate";

const point = (id: string, x: number, y: number): CadElement => ({
  id, name: id, type: "freePoint", activity: "visible", x, y
});

const line = (id: string, startPoint: string, endPoint: string, activity: CadElement["activity"] = "visible"): CadElement => ({
  id, name: id, type: "line", activity,
  startPoint: { mode: "reference", pointId: startPoint },
  endPoint: { mode: "reference", pointId: endPoint }
});

const bezier = (id: string, startPoint: string, endPoint: string): BezierCurveElement => ({
  id,
  name: id,
  type: "bezierCurve",
  activity: "visible",
  startPoint: { mode: "reference", pointId: startPoint },
  startHandleAngleDeg: 90,
  startHandleLength: 2,
  intermediatePoints: [],
  endPoint: { mode: "reference", pointId: endPoint },
  endHandleAngleDeg: 270,
  endHandleLength: 3
});

const arc = (id: string, centerPoint: string, startAngleDeg: number, endAngleDeg: number, direction: ArcLineElement["direction"]): ArcLineElement => ({
  id,
  name: id,
  type: "arcLine",
  activity: "visible",
  centerPoint: { mode: "reference", pointId: centerPoint },
  radius: 10,
  startAngleDeg,
  endAngleDeg,
  direction
});

const polyline = (id: string, points: string[]): PolylineElement => ({
  id,
  name: id,
  type: "polyline",
  activity: "visible",
  points: points.map((pointId) => ({ mode: "reference", pointId })),
  closed: false
});

const join = (id: string, pathIds: string[], closed = false): CadElement => ({
  id, name: id, type: "joinedPath", activity: "visible", pathIds, closed
});

const joined = (geometry: ComputedGeometry | undefined): ComputedJoinedPath => {
  if (!geometry || geometry.kind !== "joinedPath") throw new Error("expected joined path");
  return geometry;
};

describe("joined path construction", () => {
  it("preserves authored order, duplicates, exact source endpoints, and reverses only the computed view", () => {
    const result = evaluateElements([
      point("a", 0, 0), point("b", 10, 0), point("near", 10 + 0.5e-9, 0), point("c", 10 + 0.5e-9, 10), point("d", 20, 0),
      line("first", "a", "b"), line("second", "near", "c"), line("backward", "d", "b"),
      join("joined", ["first", "second"]), join("reversed", ["first", "backward"]), join("duplicates", ["first", "first"])
    ]);

    expect(result.errors).toEqual([]);
    expect(joined(result.computedGeometry.get("joined"))).toMatchObject({
      pathIds: ["first", "second"],
      segments: [
        { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
        { start: { x: 10 + 0.5e-9, y: 0 }, end: { x: 10 + 0.5e-9, y: 10 } }
      ]
    });
    expect(joined(result.computedGeometry.get("reversed")).segments.map((segment) => [segment.start.x, segment.end.x])).toEqual([[0, 10], [10, 20]]);
    expect(joined(result.computedGeometry.get("duplicates")).pathIds).toEqual(["first", "first"]);
  });

  it("rejects an endpoint just outside the shared epsilon and lets an epsilon tie keep authored orientation", () => {
    const result = evaluateElements([
      point("a", 0, 0), point("b", 10, 0), point("inside", 10 + 0.5e-9, 0), point("outside", 10 + 1.5e-9, 0),
      point("insideEnd", 10 - 0.5e-9, 1), point("outsideEnd", 10 + 1.5e-9, 1),
      line("first", "a", "b"), line("insideLine", "inside", "insideEnd"), line("outsideLine", "outside", "outsideEnd"),
      bezier("tie", "inside", "insideEnd"),
      join("insideJoin", ["first", "insideLine"]), join("outsideJoin", ["first", "outsideLine"]), join("tieJoin", ["first", "tie"])
    ]);

    expect(result.computedGeometry.has("insideJoin")).toBe(true);
    expect(result.computedGeometry.has("outsideJoin")).toBe(false);
    const tieSource = result.computedGeometry.get("tie");
    const tieJoined = joined(result.computedGeometry.get("tieJoin"));
    if (!tieSource || tieSource.kind !== "bezierCurve") throw new Error("expected tie Bezier");
    expect(tieJoined.segments[1]).toMatchObject({
      kind: "bezier",
      start: tieSource.segments[0].start,
      control1: tieSource.segments[0].control1,
      control2: tieSource.segments[0].control2,
      end: tieSource.segments[0].end
    });
  });

  it("reverses Bezier controls, directed arcs, broad paths, and nested joins exactly", () => {
    const result = evaluateElements([
      point("a", 0, 0), point("b", 10, 0), point("arcCenter", 0, 0),
      point("curveStart", 0, 10), point("curveEnd", 10, 0),
      point("prefixStart", -10, 0), point("nestedStart", 20, 0), point("nestedMiddle", 10, 0),
      line("first", "a", "b"), bezier("curve", "curveStart", "curveEnd"),
      arc("arc", "arcCenter", 90, 0, "clockwise"),
      polyline("broad", ["nestedStart", "nestedMiddle", "b"]),
      line("prefix", "prefixStart", "a"), line("nestedA", "nestedMiddle", "a"), line("nestedB", "nestedStart", "nestedMiddle"),
      join("curveJoin", ["first", "curve"]), join("arcJoin", ["first", "arc"]),
      join("broadJoin", ["first", "broad"]),
      join("nested", ["nestedB", "nestedA"]), join("nestedJoin", ["prefix", "nested"])
    ]);

    const curveSource = result.computedGeometry.get("curve");
    if (!curveSource || curveSource.kind !== "bezierCurve") throw new Error("expected curve");
    expect(joined(result.computedGeometry.get("curveJoin")).segments[1]).toMatchObject({
      kind: "bezier",
      start: curveSource.segments[0].end,
      control1: curveSource.segments[0].control2,
      control2: curveSource.segments[0].control1,
      end: curveSource.segments[0].start
    });

    const arcSegment = joined(result.computedGeometry.get("arcJoin")).segments[1];
    expect(arcSegment).toMatchObject({ kind: "arc", startAngleDeg: 0, sweepAngleDeg: 90 });
    expect(arcSegment.start.x).toBeCloseTo(10);
    expect(arcSegment.start.y).toBeCloseTo(0);
    expect(arcSegment.end.x).toBeCloseTo(0);
    expect(arcSegment.end.y).toBeCloseTo(10);

    const broadSource = result.computedGeometry.get("broad");
    const broadJoined = joined(result.computedGeometry.get("broadJoin"));
    if (!broadSource || broadSource.kind !== "polyline") throw new Error("expected polyline");
    expect(broadJoined.segments.slice(1)).toEqual(broadSource.segments.slice().reverse().map((segment) => ({
      kind: "line",
      start: segment.end,
      end: segment.start,
      length: segment.length
    })));
    expect(joined(result.computedGeometry.get("nestedJoin")).segments.map((segment) => [segment.start.x, segment.end.x])).toEqual([
      [-10, 0], [0, 10], [10, 20]
    ]);
  });

  it("validates open and closed continuity without synthesizing a closing segment", () => {
    const valid = evaluateElements([
      point("a", 0, 0), point("b", 10, 0), point("c", 10, 10),
      line("ab", "a", "b"), line("bc", "b", "c"), line("ca", "c", "a"),
      join("closed", ["ab", "bc", "ca"], true)
    ]);
    expect(joined(valid.computedGeometry.get("closed")).segments).toHaveLength(3);
    expect(joined(valid.computedGeometry.get("closed")).closed).toBe(true);

    const invalid = evaluateElements([
      point("a", 0, 0), point("b", 10, 0), point("c", 20, 0),
      line("ab", "a", "b"), line("bc", "b", "c"), join("closed", ["ab", "bc"], true)
    ]);
    expect(invalid.computedGeometry.has("closed")).toBe(false);
    expect(invalid.errors.at(-1)?.message).toContain("closed: true");
  });

  it("fails empty, disabled, discontinuous, and too-late dependencies", () => {
    expect(evaluateElements([join("empty", [])]).computedGeometry.has("empty")).toBe(false);
    expect(evaluateElements([
      point("a", 0, 0), point("b", 1, 0), point("c", 4, 0), point("d", 5, 0),
      line("one", "a", "b"), line("two", "c", "d"), join("bad", ["one", "two"])
    ]).computedGeometry.has("bad")).toBe(false);
    expect(evaluateElements([
      point("a", 0, 0), point("b", 1, 0), line("source", "a", "b", "disabled"), join("disabled", ["source"])
    ]).computedGeometry.has("disabled")).toBe(false);
    expect(evaluateElements([
      join("late", ["source"]), point("a", 0, 0), point("b", 1, 0), line("source", "a", "b")
    ]).computedGeometry.has("late")).toBe(false);
  });

  it("accepts path[] and rejects strict line[] covariance", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "const namedPaths: path[] = [@Base]",
      "const namedLines: line[] = [@Base]",
      "line InlineJoined = join(paths: [@Base], closed: false)",
      "line NamedPathJoined = join(paths: @namedPaths, closed: false)",
      "line CovariantJoined = join(paths: @namedLines, closed: false)"
    ].join("\n");
    const parsed = parseDsl(source);
    const compiled = compileDslDocument(source, {
      preparsed: parsed,
      assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `joined-test:${index}`]))
    });
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.document?.elements.filter((element) => element.type === "joinedPath")).toHaveLength(3);

    const strict = `${source}\nconst strictJoined: line[] = [@InlineJoined]`;
    const strictParsed = parseDsl(strict);
    const strictCompiled = compileDslDocument(strict, {
      preparsed: strictParsed,
      assignedStatementIds: new Map(strictParsed.statements.map((_, index) => [index, `joined-strict:${index}`]))
    });
    expect(strictCompiled.diagnostics.some((diagnostic) => diagnostic.message.includes("line"))).toBe(true);
  });
});
