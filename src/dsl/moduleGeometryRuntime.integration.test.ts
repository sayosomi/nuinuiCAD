import { describe, expect, it } from "vitest";
import { buildNumericBindingRuntimeEntries } from "../geometry/numericBindingRuntime";
import { buildPropertyBindingRuntimeEntries } from "../geometry/propertyBindingRuntime";
import { evaluateElements } from "../geometry/evaluate";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";

const compileWithIds = (source: string, prefix = "task7") => {
  const parsed = parseDsl(source);
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `${prefix}:${index}`] as const))
  });
};

const errorsOf = (compiled: ReturnType<typeof compileWithIds>) =>
  compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error");

const evaluateCompiled = (compiled: ReturnType<typeof compileWithIds>) => {
  if (!compiled.document || !compiled.statementMap) throw new Error("expected a compiled document");
  const elements = compiled.document.elements;
  return evaluateElements(elements, {
    evaluationLimitIndex: compiled.document.evaluationLimitIndex,
    scalarProgram: compiled.scalarProgram,
    bindingVersions: compiled.bindingVersions,
    statementInfoByElementId: compiled.statementMap.byElementId,
    statementIdByStatementIndex: compiled.statementMap.statementIdByStatementIndex,
    sourceExecutionPositionByElementId: compiled.moduleMaterialization?.sourceExecutionPositionByRuntimeElementId,
    scalarExecutionPositionByElementId: compiled.scalarExecutionPositionByRuntimeElementId,
    propertyBindingEntries: compiled.scalarProgram && compiled.propertyBindings
      ? buildPropertyBindingRuntimeEntries({
          propertyBindings: compiled.propertyBindings,
          elementIdByStatementIndex: compiled.statementMap.elementIdByStatementIndex,
          materializedPropertyBindings: compiled.materializedPropertyBindings
        }, elements)
      : undefined,
    numericBindingEntries: compiled.scalarProgram
      ? buildNumericBindingRuntimeEntries({
          numericBindings: compiled.numericBindings ?? new Map(),
          elementIdByStatementIndex: compiled.statementMap.elementIdByStatementIndex,
          materializedNumericBindings: compiled.materializedNumericBindings
        }, elements)
      : undefined
  });
};

const named = (compiled: ReturnType<typeof compileWithIds>, name: string) => {
  const element = compiled.document?.elements.find((candidate) => candidate.name === name);
  if (!element) throw new Error(`missing element ${name}`);
  return element;
};

const expectValid = (compiled: ReturnType<typeof compileWithIds>) => {
  expect(errorsOf(compiled)).toEqual([]);
  expect(compiled.document).not.toBeNull();
};

describe("module geometry runtime", () => {
  it("lowers actual, derived, coordinate, forwarded, and repeated point aliases", () => {
    const compiled = compileWithIds([
      "nui 3",
      "point Base = coordinate(x: 10, y: 20)",
      "line Guide = segment(start: (0, 0), end: (20, 0))",
      "module Inner(p: point) {",
      "  point P = offset(from: @p, dx: 1, dy: 2)",
      "}",
      "module Outer(p: point) {",
      "  module Nested = Inner(p: @p)",
      "}",
      "module Actual = Outer(p: @Base)",
      "module Derived = Inner(p: @Guide.start)",
      "module Coordinate = Inner(p: (7, 8))"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect([...result.computedGeometry.values()]
      .filter((geometry): geometry is Extract<typeof geometry, { kind: "point" }> => geometry.kind === "point" && geometry.elementId !== named(compiled, "Base").id)
      .map((geometry) => [geometry.x, geometry.y]))
      .toEqual([[11, 22], [1, 2], [8, 10]]);
  });

  it("keeps line aliases broad and lowers endpoint/list references", () => {
    const compiled = compileWithIds([
      "nui 3",
      "line Base = segment(start: (0, 0), end: (10, 0))",
      "arc A = arc(center: (0, 0), radius: 5, start: 0, end: 90)",
      "module M(path: line) {",
      "  point P = onLine(from: @path.end, ratio: 0.5)",
      "  line Copy = offset(sources: [@path], distance: 1, side: left, closed: false, suppressTrimWarnings: false)",
      "}",
      "module BaseInstance = M(path: @Base)",
      "module ArcInstance = M(path: @A)"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect([...result.computedGeometry.values()].filter((geometry) => geometry.kind === "point")).toHaveLength(2);
    const base = named(compiled, "Base");
    const arc = named(compiled, "A");
    const baseCopy = compiled.document!.elements.find((element) => element.name === "Copy" && element.parentGroupId === named(compiled, "BaseInstance").id)!;
    const arcCopy = compiled.document!.elements.find((element) => element.name === "Copy" && element.parentGroupId === named(compiled, "ArcInstance").id)!;
    expect((baseCopy as Extract<typeof baseCopy, { type: "offsetLine" }>).baseLineIds).toEqual([base.id]);
    expect((arcCopy as Extract<typeof arcCopy, { type: "offsetLine" }>).baseLineIds).toEqual([arc.id]);
  });

  it("resolves exported root and nested geometry through instance-local namespaces", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module Inner() {",
      "  export point P = coordinate(x: 3, y: 4)",
      "}",
      "module Outer() {",
      "  module Child = Inner()",
      "  export line L = segment(start: @Child::P, end: (10, 4))",
      "}",
      "module First = Outer()",
      "module Second = Outer()",
      "point Root = offset(from: @First::L.start, dx: 1, dy: 1)"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    const root = result.computedGeometry.get(named(compiled, "Root").id);
    expect(root).toMatchObject({ kind: "point", x: 4, y: 5 });
    const firstLine = compiled.document!.elements.find((element) => element.name === "L" && element.parentGroupId === named(compiled, "First").id)!;
    const secondLine = compiled.document!.elements.find((element) => element.name === "L" && element.parentGroupId === named(compiled, "Second").id)!;
    expect(firstLine.id).not.toBe(secondLine.id);
    expect((firstLine as Extract<typeof firstLine, { type: "line" }>).startPoint).not.toEqual((secondLine as Extract<typeof secondLine, { type: "line" }>).startPoint);
  });

  it("lowers line and point geometry properties to stable targets", () => {
    const compiled = compileWithIds([
      "nui 3",
      "point Base = coordinate(x: 10, y: 20)",
      "line Guide = segment(start: (0, 0), end: (12, 0))",
      "module M(p: point, path: line) {",
      "  const px: number = @p.x",
      "  const py: number = @p.y",
      "  const length: number = @path.length",
      "  point Result = coordinate(x: @px + @length, y: @py)",
      "}",
      "module Actual = M(p: @Base, path: @Guide)",
      "module Derived = M(p: @Guide.start, path: @Guide)"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    const points = compiled.document!.elements
      .filter((element) => element.name === "Result")
      .map((element) => result.computedGeometry.get(element.id));
    expect(points).toEqual([
      expect.objectContaining({ x: 22, y: 20 }),
      expect.objectContaining({ x: 12, y: 0 })
    ]);
  });

  it("lowers nested export properties through the same runtime target path", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module Inner() {",
      "  export line L = segment(start: (0, 0), end: (9, 0))",
      "}",
      "module Outer() {",
      "  module Child = Inner()",
      "  const length: number = @Child::L.length",
      "  point Result = coordinate(x: @length, y: 0)",
      "}",
      "module X = Outer()"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(named(compiled, "Result").id)).toMatchObject({ kind: "point", x: 9 });
  });

  it("validates exported point properties and category-aware derived points", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module Inner() {",
      "  export point P = coordinate(x: 3, y: 4)",
      "  export line L = segment(start: (0, 0), end: (10, 0))",
      "  export arc A = arc(center: (5, 6), radius: 2, start: 0, end: 90)",
      "}",
      "module Outer() {",
      "  module Child = Inner()",
      "  const px: number = @Child::P.x",
      "  const py: number = @Child::P.y",
      "  point PointProperty = coordinate(x: @px, y: @py)",
      "  point LineStart = offset(from: @Child::L.start, dx: 0, dy: 0)",
      "  point LineEnd = offset(from: @Child::L.end, dx: 0, dy: 0)",
      "  point ArcCenter = offset(from: @Child::A.center, dx: 0, dy: 0)",
      "}",
      "module X = Outer()"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(named(compiled, "PointProperty").id)).toMatchObject({ kind: "point", x: 3, y: 4 });
    expect(result.computedGeometry.get(named(compiled, "LineStart").id)).toMatchObject({ kind: "point", x: 0, y: 0 });
    expect(result.computedGeometry.get(named(compiled, "LineEnd").id)).toMatchObject({ kind: "point", x: 10, y: 0 });
    expect(result.computedGeometry.get(named(compiled, "ArcCenter").id)).toMatchObject({ kind: "point", x: 5, y: 6 });
  });

  it.each([
    ["ordinary line center", "export line L = segment(start: (0, 0), end: (10, 0))", "@X::L.center"],
    ["curve center", "export curve C = bezier(start: (0, 0), end: (10, 0), startAngle: 0, startLength: 2, endAngle: 180, endLength: 2)", "@X::C.center"],
    ["point start", "export point P = coordinate(x: 3, y: 4)", "@X::P.start"]
  ])("rejects invalid exported derived point accessor: %s", (_label, exported, reference) => {
    const compiled = compileWithIds([
      "nui 3",
      "module M() {",
      `  ${exported}`,
      "}",
      "module X = M()",
      `point Root = offset(from: ${reference}, dx: 1, dy: 1)`
    ].join("\n"));

    expect(compiled.document).toBeNull();
    expect(errorsOf(compiled)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-geometry-type-mismatch" })
    ]));
  });

  it("keeps module coordinate aliases on the existing numeric binding path", () => {
    const compiled = compileWithIds([
      "nui 3",
      "const x: number = 6",
      "module M(p: point) {",
      "  point Result = offset(from: @p, dx: 1, dy: 2)",
      "}",
      "module X = M(p: (@x, 4))"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(named(compiled, "Result").id)).toMatchObject({ x: 7, y: 6 });
  });

  it("reports private, undefined, and geometry-kind export diagnostics", () => {
    const privateMember = compileWithIds([
      "nui 3",
      "module M() {",
      "  point Private = coordinate(x: 1, y: 2)",
      "}",
      "module X = M()",
      "point Root = offset(from: @X::Private, dx: 1, dy: 1)"
    ].join("\n"));
    expect(privateMember.document).toBeNull();
    expect(errorsOf(privateMember).some((diagnostic) => diagnostic.code === "module-private-member")).toBe(true);

    const undefinedMember = compileWithIds([
      "nui 3",
      "module M() {",
      "  export point Public = coordinate(x: 1, y: 2)",
      "}",
      "module X = M()",
      "point Root = offset(from: @X::Missing, dx: 1, dy: 1)"
    ].join("\n"));
    expect(errorsOf(undefinedMember).some((diagnostic) => diagnostic.code === "module-undefined-export")).toBe(true);

    const mismatch = compileWithIds([
      "nui 3",
      "module M() {",
      "  export line Public = segment(start: (0, 0), end: (1, 0))",
      "}",
      "module X = M()",
      "point Root = offset(from: @X::Public, dx: 1, dy: 1)"
    ].join("\n"));
    expect(errorsOf(mismatch).some((diagnostic) => diagnostic.code === "module-geometry-type-mismatch")).toBe(true);
  });

  it("guards only mutation write targets for caller-owned geometry parameters", () => {
    const uninstantiated = compileWithIds([
      "nui 3",
      "module DefinitionOnly(path: line) {",
      "  reverse(target: @path)",
      "}"
    ].join("\n"));
    expect(errorsOf(uninstantiated).some((diagnostic) => diagnostic.code === "module-geometry-parameter-mutation")).toBe(true);

    for (const mutation of [
      "edge(end1: @path.start, end2: @path.end)",
      "extend(end: @path.start, to: @input)",
      "move(targets: [@path], from: @input, to: @input)",
      "mirrorMove(targets: [@path], axis1: @input, axis2: @input)",
      "reverse(target: @path)"
    ]) {
      const compiled = compileWithIds([
        "nui 3",
        "point Input = coordinate(x: 0, y: 0)",
        "module M(path: line, input: point) {",
        `  ${mutation}`,
        "}",
        "line Base = segment(start: (0, 0), end: (10, 0))",
        "module X = M(path: @Base, input: @Input)"
      ].join("\n"));
      expect(errorsOf(compiled).some((diagnostic) => diagnostic.code === "module-geometry-parameter-mutation")).toBe(true);
    }

    const allowed = compileWithIds([
      "nui 3",
      "module M(path: line) {",
      "  line Copy = copy(startPoint: @path.start, endPoint: @path.end, scale: 1, angleDeg: 0, mirrorX: false, baseLines: [@path])",
      "  reverse(target: @Copy)",
      "}",
      "line Base = segment(start: (0, 0), end: (10, 0))",
      "module X = M(path: @Base)"
    ].join("\n"));
    expect(errorsOf(allowed)).toEqual([]);
  });
});
