import { describe, expect, it } from "vitest";
import { evaluateElements } from "./evaluate";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import type { CadElement, ComputedGeometry, ComputedJoinedPath } from "../types/geometry";

const point = (id: string, x: number, y: number): CadElement => ({
  id,
  name: id,
  type: "freePoint",
  activity: "visible",
  x,
  y
});

const line = (id: string, startPoint: string, endPoint: string, activity: CadElement["activity"] = "visible"): CadElement => ({
  id,
  name: id,
  type: "line",
  activity,
  startPoint: { mode: "reference", pointId: startPoint },
  endPoint: { mode: "reference", pointId: endPoint }
});

const join = (id: string, pathIds: string[], closed = false, activity: CadElement["activity"] = "visible"): CadElement => ({
  id,
  name: id,
  type: "joinedPath",
  activity,
  pathIds,
  closed
});

const evaluate = (elements: CadElement[]) => evaluateElements(elements).computedGeometry;
const joined = (geometry: ComputedGeometry | undefined): ComputedJoinedPath => {
  if (!geometry || geometry.kind !== "joinedPath") throw new Error("expected joined path");
  return geometry;
};

describe("joined path construction", () => {
  it("preserves authored order, duplicates, and exact endpoints without snapping", () => {
    const geometries = evaluate([
      point("a", 0, 0),
      point("b", 10, 0),
      point("near", 10 + 0.5e-9, 0),
      point("c", 10 + 0.5e-9, 10),
      line("first", "a", "b"),
      line("second", "near", "c"),
      line("duplicate", "b", "b"),
      join("joined", ["first", "second"]),
      join("duplicateJoin", ["first", "duplicate", "duplicate"])
    ]);
    expect(joined(geometries.get("joined")).pathIds).toEqual(["first", "second"]);
    expect(joined(geometries.get("joined")).segments[1]).toMatchObject({ start: { x: 10 + 0.5e-9, y: 0 }, end: { x: 10 + 0.5e-9, y: 10 } });
    expect(joined(geometries.get("duplicateJoin")).pathIds).toEqual(["first", "duplicate", "duplicate"]);
  });

  it("accepts one path, preserves forward members, and reverses only the joined result", () => {
    const elements = [
      point("a", 0, 0), point("b", 10, 0), point("c", 20, 0),
      line("first", "a", "b"), line("backward", "c", "b"),
      join("single", ["first"]), join("joined", ["first", "backward"])
    ];
    const geometries = evaluate(elements);
    expect(joined(geometries.get("single")).segments).toHaveLength(1);
    const result = joined(geometries.get("joined"));
    expect(result.pathIds).toEqual(["first", "backward"]);
    expect(result.segments.map((segment) => [segment.start.x, segment.end.x])).toEqual([[0, 10], [10, 20]]);
    expect((elements.find((element) => element.id === "backward") as Extract<CadElement, { type: "line" }>).startPoint).toEqual({ mode: "reference", pointId: "c" });
  });

  it("uses the shared endpoint tolerance without snapping or accepting a point beyond it", () => {
    const within = evaluate([
      point("a", 0, 0), point("b", 10, 0), point("near", 10 + 0.999e-9, 0), point("c", 10 + 0.999e-9, 10),
      line("first", "a", "b"), line("second", "near", "c"), join("joined", ["first", "second"])
    ]);
    expect(within.has("joined")).toBe(true);
    expect(joined(within.get("joined")).segments[1]?.start.x).toBe(10 + 0.999e-9);

    const outside = evaluate([
      point("a", 0, 0), point("b", 10, 0), point("near", 10 + 1.001e-9, 0), point("c", 10 + 1.001e-9, 10),
      line("first", "a", "b"), line("second", "near", "c"), join("joined", ["first", "second"])
    ]);
    expect(outside.has("joined")).toBe(false);
  });

  it("prefers authored orientation when both endpoints coincide and preserves exact primitives", () => {
    const geometries = evaluate([
      point("a", 0, 0), point("b", 10, 0),
      line("first", "a", "b"),
      {
        id: "degenerateBezier",
        name: "degenerateBezier",
        type: "bezierCurve",
        activity: "visible",
        startPoint: { mode: "reference", pointId: "b" },
        startHandleAngleDeg: 0,
        startHandleLength: 2,
        intermediatePoints: [],
        endPoint: { mode: "reference", pointId: "b" },
        endHandleAngleDeg: 180,
        endHandleLength: 2
      },
      join("joined", ["first", "degenerateBezier"])
    ]);
    const result = joined(geometries.get("joined"));
    expect(result.segments[1]).toMatchObject({ kind: "bezier", start: { x: 10, y: 0 }, end: { x: 10, y: 0 }, control1: { x: 12, y: 0 } });
  });

  it("preserves directed arcs and negates the sweep when an arc is reversed", () => {
    const reversed = evaluate([
      point("origin", 0, 0),
      point("top", 0, 10),
      line("first", "origin", "top"),
      { id: "arc", name: "arc", type: "arcLine", activity: "visible", centerPoint: { mode: "reference", pointId: "origin" }, radius: 10, startAngleDeg: 0, endAngleDeg: 90 },
      join("joined", ["first", "arc"])
    ]);
    const reversedArc = joined(reversed.get("joined")).segments[1];
    expect(reversedArc).toMatchObject({ kind: "arc", startAngleDeg: 90, sweepAngleDeg: -90 });
    expect(reversedArc?.start.x).toBeCloseTo(0);
    expect(reversedArc?.start.y).toBeCloseTo(10);
    expect(reversedArc?.end.x).toBeCloseTo(10);
    expect(reversedArc?.end.y).toBeCloseTo(0);

    const authored = evaluate([
      point("origin", 0, 0),
      point("top", 0, 10),
      line("first", "origin", "top"),
      { id: "arc", name: "arc", type: "arcLine", activity: "visible", centerPoint: { mode: "reference", pointId: "origin" }, radius: 10, startAngleDeg: 90, endAngleDeg: 0, direction: "clockwise" },
      join("joined", ["first", "arc"])
    ]);
    expect(joined(authored.get("joined")).segments[1]).toMatchObject({ kind: "arc", startAngleDeg: 90, sweepAngleDeg: -90 });
  });

  it("supports closed validation without synthesizing a segment", () => {
    const valid = evaluate([
      point("a", 0, 0), point("b", 10, 0), point("c", 10, 10),
      line("ab", "a", "b"), line("bc", "b", "c"), line("ca", "c", "a"), join("closed", ["ab", "bc", "ca"], true)
    ]);
    const result = joined(valid.get("closed"));
    expect(result.closed).toBe(true);
    expect(result.segments).toHaveLength(3);

    const invalid = evaluate([
      point("a", 0, 0), point("b", 10, 0), point("c", 20, 0),
      line("ab", "a", "b"), line("bc", "b", "c"), join("closed", ["ab", "bc"], true)
    ]);
    expect(invalid.has("closed")).toBe(false);
  });

  it("fails empty, discontinuous, disabled, and too-late dependencies", () => {
    const empty = evaluate([join("empty", [])]);
    expect(empty.has("empty")).toBe(false);
    const disconnected = evaluate([point("a", 0, 0), point("b", 1, 0), point("c", 4, 0), point("d", 5, 0), line("one", "a", "b"), line("two", "c", "d"), join("bad", ["one", "two"]) ]);
    expect(disconnected.has("bad")).toBe(false);
    const disabled = evaluate([point("a", 0, 0), point("b", 1, 0), line("source", "a", "b", "disabled"), join("disabledJoin", ["source"]) ]);
    expect(disabled.has("disabledJoin")).toBe(false);
    const late = evaluate([join("lateJoin", ["source"]), point("a", 0, 0), point("b", 1, 0), line("source", "a", "b")]);
    expect(late.has("lateJoin")).toBe(false);
  });

  it("evaluates hidden sources and preserves the joined element activity state", () => {
    const result = evaluateElements([
      point("a", 0, 0), point("b", 1, 0),
      line("hiddenSource", "a", "b", "hidden"),
      join("hiddenJoin", ["hiddenSource"], false, "hidden"),
      join("visibleJoin", ["hiddenSource"])
    ]);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.has("hiddenSource")).toBe(true);
    expect(result.computedGeometry.has("hiddenJoin")).toBe(true);
    expect(result.computedGeometry.has("visibleJoin")).toBe(true);
    expect(result.effectiveVisibleElementIds?.has("hiddenJoin")).toBe(false);
    expect(result.effectiveVisibleElementIds?.has("visibleJoin")).toBe(true);
  });

  it("is a broad path in the existing typed geometry-array language", () => {
    const source = `nui 4
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 10, y: 0)
line Base = segment(start: @A, end: @B)
const namedPaths: path[] = [@Base]
const namedLines: line[] = [@Base]
line InlineJoined = join(paths: [@Base], closed: false)
line NamedPathJoined = join(paths: @namedPaths, closed: false)
line CovariantJoined = join(paths: @namedLines, closed: false)
`;
    const parsed = parseDsl(source);
    const compiled = compileDslDocument(source, {
      preparsed: parsed,
      assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `joined-test:${index}`]))
    });
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.document?.elements.filter((element) => element.type === "joinedPath")).toHaveLength(3);

    const emptySource = "nui 4\nline Empty = join(paths: [], closed: false)";
    const emptyParsed = parseDsl(emptySource);
    const emptyCompiled = compileDslDocument(emptySource, {
      preparsed: emptyParsed,
      assignedStatementIds: new Map(emptyParsed.statements.map((_, index) => [index, `joined-empty:${index}`]))
    });
    expect(emptyCompiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "join-empty-paths" })
    ]));

    const strictSource = `${source}\nconst strictJoined: line[] = [@InlineJoined]`;
    const strictParsed = parseDsl(strictSource);
    const strictCompiled = compileDslDocument(strictSource, {
      preparsed: strictParsed,
      assignedStatementIds: new Map(strictParsed.statements.map((_, index) => [index, `joined-strict:${index}`]))
    });
    expect(strictCompiled.diagnostics.some((diagnostic) => diagnostic.message.includes("line"))).toBe(true);
  });
});
