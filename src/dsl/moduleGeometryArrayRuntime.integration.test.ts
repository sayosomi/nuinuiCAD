import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";

const compileWithIds = (source: string, prefix = "array-module") => {
  const parsed = parseDsl(source);
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `${prefix}:${index}`] as const))
  });
};

const errorsOf = (compiled: ReturnType<typeof compileWithIds>) =>
  compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error");

const named = (compiled: ReturnType<typeof compileWithIds>, name: string) => {
  const element = compiled.document?.elements.find((candidate) => candidate.name === name);
  if (!element) throw new Error(`missing element ${name}`);
  return element;
};

const namedUnder = (compiled: ReturnType<typeof compileWithIds>, name: string, parentName: string) => {
  const parent = named(compiled, parentName);
  const element = compiled.document?.elements.find((candidate) => candidate.name === name && candidate.parentGroupId === parent.id);
  if (!element) throw new Error(`missing element ${parentName}::${name}`);
  return element;
};

describe("module geometry array runtime", () => {
  it("lowers literal line[] arguments at existing path-list consumers with order and duplicates", () => {
    const compiled = compileWithIds([
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "line B = segment(start: (0, 10), end: (10, 10))",
      "module M(paths: path[]) {",
      "  line Copy = offset(sources: @paths, distance: 1, side: left, closed: false, suppressTrimWarnings: false)",
      "}",
      "instance Use = M(paths: [@A, @B, @A])"
    ].join("\n"));

    expect(errorsOf(compiled)).toEqual([]);
    expect(compiled.document).not.toBeNull();
    const copy = namedUnder(compiled, "Copy", "Use");
    expect(copy.type).toBe("offsetLine");
    if (copy.type !== "offsetLine") throw new Error("expected offsetLine");
    expect(copy.baseLineIds).toEqual([named(compiled, "A").id, named(compiled, "B").id, named(compiled, "A").id]);
  });

  it("preserves line[] to path[] through local aliases and nested Module pass-through", () => {
    const compiled = compileWithIds([
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "line B = segment(start: (0, 10), end: (10, 10))",
      "module Inner(paths: path[]) {",
      "  line Copy = offset(sources: @paths, distance: 1, side: left, closed: false, suppressTrimWarnings: false)",
      "}",
      "module Outer(paths: line[]) {",
      "  const forwarded: path[] = @paths",
      "  instance Child = Inner(paths: @forwarded)",
      "}",
      "instance Use = Outer(paths: [@A, @B, @A])"
    ].join("\n"));

    expect(errorsOf(compiled)).toEqual([]);
    expect(compiled.document).not.toBeNull();
    const child = compiled.document!.elements.find((candidate) => candidate.name === "Child");
    expect(child).toBeDefined();
    const copy = compiled.document!.elements.find((candidate) => candidate.name === "Copy" && candidate.parentGroupId === child?.id);
    expect(copy?.type).toBe("offsetLine");
    if (!copy || copy.type !== "offsetLine") throw new Error("expected nested offsetLine");
    expect(copy.baseLineIds).toEqual([named(compiled, "A").id, named(compiled, "B").id, named(compiled, "A").id]);
  });

  it("resolves exported arrays through qualified instance references without flattening source semantics", () => {
    const compiled = compileWithIds([
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "line B = segment(start: (0, 10), end: (10, 10))",
      "module Producer(paths: line[]) {",
      "  export const edges: path[] = @paths",
      "}",
      "module Consumer(paths: path[]) {",
      "  line Copy = offset(sources: @paths, distance: 1, side: left, closed: false, suppressTrimWarnings: false)",
      "}",
      "instance Source = Producer(paths: [@A, @B, @A])",
      "instance Use = Consumer(paths: @Source::edges)",
      "line RootCopy = offset(sources: @Source::edges, distance: 2, side: right, closed: false, suppressTrimWarnings: false)"
    ].join("\n"));

    expect(errorsOf(compiled)).toEqual([]);
    expect(compiled.document).not.toBeNull();
    const expected = [named(compiled, "A").id, named(compiled, "B").id, named(compiled, "A").id];
    const moduleCopy = namedUnder(compiled, "Copy", "Use");
    const rootCopy = named(compiled, "RootCopy");
    expect(moduleCopy.type).toBe("offsetLine");
    expect(rootCopy.type).toBe("offsetLine");
    if (moduleCopy.type !== "offsetLine" || rootCopy.type !== "offsetLine") throw new Error("expected offsetLine values");
    expect(moduleCopy.baseLineIds).toEqual(expected);
    expect(rootCopy.baseLineIds).toEqual(expected);
  });

  it("accepts coordinate and derived point members in inline point[] arguments", () => {
    const compiled = compileWithIds([
      "nui 1",
      "line L = segment(start: (0, 0), end: (10, 0))",
      "module M(points: point[]) {",
      "}",
      "instance Use = M(points: [@L.start, @L.end, (1, 2)])"
    ].join("\n"));

    expect(errorsOf(compiled)).toEqual([]);
    expect(compiled.document).not.toBeNull();
  });

  it("passes named point[] values into polyline construction in module instances", () => {
    const compiled = compileWithIds([
      "nui 1",
      "line L = segment(start: (0, 0), end: (10, 0))",
      "line R = segment(start: (10, 0), end: (10, 10))",
      "const vertices: point[] = [@L.start, @L.end, @R.end]",
      "module M(points: point[]) {",
      "  line P = polyline(points: @points, closed: false)",
      "}",
      "instance Use = M(points: @vertices)"
    ].join("\n"));

    expect(errorsOf(compiled)).toEqual([]);
    const polyline = namedUnder(compiled, "P", "Use");
    expect(polyline.type).toBe("polyline");
    if (polyline.type !== "polyline") throw new Error("expected polyline");
    expect(polyline.points).toHaveLength(3);
  });

  it("checks array argument assignability directionally", () => {
    const compiled = compileWithIds([
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "arc Arc = arc(center: (0, 0), radius: 5, start: 0, end: 90)",
      "const strict: line[] = [@A]",
      "const broad: path[] = [@Arc]",
      "module Strict(paths: line[]) {",
      "}",
      "module Broad(paths: path[]) {",
      "}",
      "instance Allowed = Broad(paths: @strict)",
      "instance Rejected = Strict(paths: @broad)"
    ].join("\n"));

    expect(errorsOf(compiled)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "geometry-array-assignability-mismatch" })
    ]));
  });
});
