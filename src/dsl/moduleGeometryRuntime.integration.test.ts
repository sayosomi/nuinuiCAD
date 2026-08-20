import { describe, expect, it } from "vitest";
import { buildNumericBindingRuntimeEntries } from "../geometry/numericBindingRuntime";
import { buildPropertyBindingRuntimeEntries } from "../geometry/propertyBindingRuntime";
import { evaluateElements } from "../geometry/evaluate";
import { sourceOwnerForRuntimeElementId } from "./sourceOwnership";
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
      "nui 4",
      "point Base = coordinate(x: 10, y: 20)",
      "line Guide = segment(start: (0, 0), end: (20, 0))",
      "module Inner(p: point) {",
      "  point P = offset(from: @p, dx: 1, dy: 2)",
      "}",
      "module Outer(p: point) {",
      "  instance Nested = Inner(p: @p)",
      "}",
      "instance Actual = Outer(p: @Base)",
      "instance Derived = Inner(p: @Guide.start)",
      "instance Coordinate = Inner(p: (7, 8))"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect([...result.computedGeometry.values()]
      .filter((geometry): geometry is Extract<typeof geometry, { kind: "point" }> => geometry.kind === "point" && geometry.elementId !== named(compiled, "Base").id)
      .map((geometry) => [geometry.x, geometry.y]))
      .toEqual([[11, 22], [1, 2], [8, 10]]);
  });

  it("keeps path aliases broad and lowers endpoint/list references", () => {
    const compiled = compileWithIds([
      "nui 4",
      "line Base = segment(start: (0, 0), end: (10, 0))",
      "arc A = arc(center: (0, 0), radius: 5, start: 0, end: 90)",
      "module M(path: path) {",
      "  point P = onLine(from: @path.end, ratio: 0.5)",
      "  line Copy = offset(sources: [@path], distance: 1, side: left, closed: false, suppressTrimWarnings: false)",
      "}",
      "instance BaseInstance = M(path: @Base)",
      "instance ArcInstance = M(path: @A)"
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

  it("checks strict line and broad path interfaces at direct Module argument boundaries", () => {
    const compiled = compileWithIds([
      "nui 4",
      "line Straight = segment(start: (0, 0), end: (10, 0))",
      "line Polar = polar(start: (0, 0), angle: 0, length: 10)",
      "curve Bezier = bezier(start: (0, 0), end: (10, 0))",
      "arc Arc = arc(center: (0, 0), radius: 5, start: 0, end: 90)",
      "module Strict(input: line) {",
      "}",
      "module Broad(input: path) {",
      "}",
      "instance StraightCall = Strict(input: @Straight)",
      "instance PolarCall = Strict(input: @Polar)",
      "instance ArcCall = Strict(input: @Arc)",
      "instance BezierCall = Strict(input: @Bezier)",
      "instance ArcPathCall = Broad(input: @Arc)",
      "instance BezierPathCall = Broad(input: @Bezier)"
    ].join("\n"));

    expect(errorsOf(compiled)).toHaveLength(2);
    expect(errorsOf(compiled)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-geometry-type-mismatch" })
    ]));
  });

  it("uses the public geometry interface in direct Module argument diagnostics", () => {
    const compiled = compileWithIds([
      "nui 4",
      "point Point = coordinate(x: 0, y: 0)",
      "module Broad(input: path) {",
      "}",
      "module Strict(input: line) {",
      "}",
      "instance BroadCall = Broad(input: @Point)",
      "instance StrictCall = Strict(input: @Point)"
    ].join("\n"));
    const mismatches = errorsOf(compiled).filter((diagnostic) => diagnostic.code === "module-geometry-type-mismatch");

    expect(mismatches).toHaveLength(2);
    expect(mismatches.find((diagnostic) => diagnostic.message.includes("期待: path"))?.message).toBe(
      "geometry reference「Point」の型が一致しません(期待: path)。"
    );
    expect(mismatches.find((diagnostic) => diagnostic.message.includes("期待: line"))?.message).toBe(
      "geometry reference「Point」の型が一致しません(期待: line)。"
    );
  });

  it("checks line-to-path and path-to-line parameter forwarding directionally", () => {
    const compiled = compileWithIds([
      "nui 4",
      "line Straight = segment(start: (0, 0), end: (10, 0))",
      "module AcceptPath(input: path) {",
      "}",
      "module AcceptLine(input: line) {",
      "}",
      "module ForwardLine(input: line) {",
      "  instance Nested = AcceptPath(input: @input)",
      "}",
      "module ForwardPath(input: path) {",
      "  instance Nested = AcceptLine(input: @input)",
      "}",
      "instance LineCall = ForwardLine(input: @Straight)",
      "instance PathCall = ForwardPath(input: @Straight)"
    ].join("\n"));

    expect(errorsOf(compiled)).toHaveLength(1);
    expect(errorsOf(compiled)[0]).toMatchObject({ code: "module-geometry-type-mismatch" });
  });

  it("applies the same interface check to qualified exported geometry", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module Producer() {",
      "  export line Straight = segment(start: (0, 0), end: (10, 0))",
      "  export curve Bezier = bezier(start: (0, 0), end: (10, 0))",
      "  export arc Arc = arc(center: (0, 0), radius: 5, start: 0, end: 90)",
      "}",
      "module Strict(input: line) {",
      "}",
      "module Broad(input: path) {",
      "}",
      "instance Source = Producer()",
      "instance StraightLine = Strict(input: @Source::Straight)",
      "instance StraightPath = Broad(input: @Source::Straight)",
      "instance ArcPath = Broad(input: @Source::Arc)",
      "instance BezierPath = Broad(input: @Source::Bezier)",
      "instance ArcLine = Strict(input: @Source::Arc)",
      "instance BezierLine = Strict(input: @Source::Bezier)"
    ].join("\n"));

    expect(errorsOf(compiled)).toHaveLength(2);
    expect(errorsOf(compiled)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-geometry-type-mismatch" })
    ]));
  });

  it("resolves exported root and nested geometry through instance-local namespaces", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module Inner() {",
      "  export point P = coordinate(x: 3, y: 4)",
      "}",
      "module Outer() {",
      "  instance Child = Inner()",
      "  export line L = segment(start: @Child::P, end: (10, 4))",
      "}",
      "instance First = Outer()",
      "instance Second = Outer()",
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
      "nui 4",
      "point Base = coordinate(x: 10, y: 20)",
      "line Guide = segment(start: (0, 0), end: (12, 0))",
      "module M(p: point, path: line) {",
      "  const px: number = @p.x",
      "  const py: number = @p.y",
      "  const length: number = @path.length",
      "  point Result = coordinate(x: @px + @length, y: @py)",
      "}",
      "instance Actual = M(p: @Base, path: @Guide)",
      "instance Derived = M(p: @Guide.start, path: @Guide)"
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
      "nui 4",
      "module Inner() {",
      "  export line L = segment(start: (0, 0), end: (9, 0))",
      "}",
      "module Outer() {",
      "  instance Child = Inner()",
      "  const length: number = @Child::L.length",
      "  point Result = coordinate(x: @length, y: 0)",
      "}",
      "instance X = Outer()"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(named(compiled, "Result").id)).toMatchObject({ kind: "point", x: 9 });
  });

  it("validates exported point properties and category-aware derived points", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module Inner() {",
      "  export point P = coordinate(x: 3, y: 4)",
      "  export line L = segment(start: (0, 0), end: (10, 0))",
      "  export arc A = arc(center: (5, 6), radius: 2, start: 0, end: 90)",
      "}",
      "module Outer() {",
      "  instance Child = Inner()",
      "  const px: number = @Child::P.x",
      "  const py: number = @Child::P.y",
      "  point PointProperty = coordinate(x: @px, y: @py)",
      "  point LineStart = offset(from: @Child::L.start, dx: 0, dy: 0)",
      "  point LineEnd = offset(from: @Child::L.end, dx: 0, dy: 0)",
      "  point ArcCenter = offset(from: @Child::A.center, dx: 0, dy: 0)",
      "}",
      "instance X = Outer()"
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
      "nui 4",
      "module M() {",
      `  ${exported}`,
      "}",
      "instance X = M()",
      `point Root = offset(from: ${reference}, dx: 1, dy: 1)`
    ].join("\n"));

    expect(compiled.document).toBeNull();
    expect(errorsOf(compiled)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-geometry-type-mismatch" })
    ]));
  });

  it("keeps module coordinate aliases on the existing numeric binding path", () => {
    const compiled = compileWithIds([
      "nui 4",
      "const x: number = 6",
      "module M(p: point) {",
      "  point Result = offset(from: @p, dx: 1, dy: 2)",
      "}",
      "instance X = M(p: (@x, 4))"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(named(compiled, "Result").id)).toMatchObject({ x: 7, y: 6 });
  });

  it("captures distinct pre-mutation Bezier snapshots for materialized Module occurrences", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(origin: point) {",
      "  curve Curve = bezier(start: @origin, end: (100, 0), startAngle: 0, startLength: 20, endAngle: 180, endLength: 30)",
      "}",
      "instance First = M(origin: (0, 0))",
      "instance Second = M(origin: (40, 20))"
    ].join("\n"));
    expectValid(compiled);
    if (!compiled.document || !compiled.statementMap) throw new Error("expected a compiled document");

    const result = evaluateCompiled(compiled);
    const elements = compiled.document.elements;
    const first = named(compiled, "First");
    const second = named(compiled, "Second");
    const firstCurve = elements.find((element) => element.name === "Curve" && element.parentGroupId === first.id);
    const secondCurve = elements.find((element) => element.name === "Curve" && element.parentGroupId === second.id);
    if (!firstCurve || !secondCurve) throw new Error("expected materialized Bezier occurrences");

    const firstSnapshot = result.preMutationBezierGeometry?.get(firstCurve.id);
    const secondSnapshot = result.preMutationBezierGeometry?.get(secondCurve.id);
    expect(firstCurve.id).not.toBe(secondCurve.id);
    expect(result.errors).toEqual([]);
    expect(firstSnapshot).toMatchObject({
      elementId: firstCurve.id,
      segments: [{ start: { x: 0, y: 0 }, control1: { x: 20, y: 0 } }]
    });
    expect(secondSnapshot).toMatchObject({
      elementId: secondCurve.id,
      segments: [{ start: { x: 40, y: 20 }, control1: { x: 60, y: 20 } }]
    });
    expect(firstSnapshot).not.toEqual(secondSnapshot);
    expect([...result.preMutationBezierGeometry?.keys() ?? []]).toEqual([firstCurve.id, secondCurve.id]);

    const ownershipDocument = { ...compiled, statementMap: compiled.statementMap };
    expect(sourceOwnerForRuntimeElementId(ownershipDocument, firstCurve.id)).toMatchObject({
      kind: "moduleBody",
      sourceStatementId: "task7:2",
      sourceStatementIndex: 2
    });
    expect(sourceOwnerForRuntimeElementId(ownershipDocument, secondCurve.id)).toMatchObject({
      kind: "moduleBody",
      sourceStatementId: "task7:2",
      sourceStatementIndex: 2
    });
  });

  it("reports private, undefined, and geometry-kind export diagnostics", () => {
    const privateMember = compileWithIds([
      "nui 4",
      "module M() {",
      "  point Private = coordinate(x: 1, y: 2)",
      "}",
      "instance X = M()",
      "point Root = offset(from: @X::Private, dx: 1, dy: 1)"
    ].join("\n"));
    expect(privateMember.document).toBeNull();
    expect(errorsOf(privateMember).some((diagnostic) => diagnostic.code === "module-private-member")).toBe(true);

    const undefinedMember = compileWithIds([
      "nui 4",
      "module M() {",
      "  export point Public = coordinate(x: 1, y: 2)",
      "}",
      "instance X = M()",
      "point Root = offset(from: @X::Missing, dx: 1, dy: 1)"
    ].join("\n"));
    expect(errorsOf(undefinedMember).some((diagnostic) => diagnostic.code === "module-undefined-export")).toBe(true);

    const mismatch = compileWithIds([
      "nui 4",
      "module M() {",
      "  export line Public = segment(start: (0, 0), end: (1, 0))",
      "}",
      "instance X = M()",
      "point Root = offset(from: @X::Public, dx: 1, dy: 1)"
    ].join("\n"));
    expect(errorsOf(mismatch).some((diagnostic) => diagnostic.code === "module-geometry-type-mismatch")).toBe(true);
  });

  it("guards only mutation write targets for caller-owned geometry parameters", () => {
    const uninstantiated = compileWithIds([
      "nui 4",
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
        "nui 4",
        "point Input = coordinate(x: 0, y: 0)",
        "module M(path: line, input: point) {",
        `  ${mutation}`,
        "}",
        "line Base = segment(start: (0, 0), end: (10, 0))",
        "instance X = M(path: @Base, input: @Input)"
      ].join("\n"));
      expect(errorsOf(compiled).some((diagnostic) => diagnostic.code === "module-geometry-parameter-mutation")).toBe(true);
    }

    const allowed = compileWithIds([
      "nui 4",
      "module M(path: line) {",
      "  line Copy = transformCopy(startPoint: @path.start, endPoint: @path.end, scale: 1, angleDeg: 0, mirrorX: false, baseLines: [@path])",
      "  reverse(target: @Copy)",
      "}",
      "line Base = segment(start: (0, 0), end: (10, 0))",
      "instance X = M(path: @Base)"
    ].join("\n"));
    expect(errorsOf(allowed)).toEqual([]);
  });
});
