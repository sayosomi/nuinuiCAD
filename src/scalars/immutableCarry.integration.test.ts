import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel, type LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import { emptyDocument } from "@nuinuicad/nui-language";
import { evaluateElements } from "../geometry/evaluate";
import { buildForGroupExecutionOwners, forGroupMutationOwnerByElementId } from "./forGroupMutationControl";

const compile = (source: string): LastGoodDslDocument => {
  const result = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), source);
  if (result.status === "fatal") throw new Error(JSON.stringify(result.diagnostics));
  return result.doc;
};

const optionsFor = (compiled: LastGoodDslDocument) => ({
  scalarProgram: compiled.scalarProgram,
  geometryInputTargetsByElementId: compiled.geometryInputTargetsByElementId,
  geometryCollectionNodesByValueId: compiled.moduleGeometryRuntime?.geometryCollectionNodesByValueId,
  bindingVersions: compiled.bindingVersions,
  statementInfoByElementId: compiled.statementMap.byElementId,
  statementIdByStatementIndex: compiled.statementMap.statementIdByStatementIndex,
  sourceExecutionPositionByElementId: compiled.moduleMaterialization?.sourceExecutionPositionByRuntimeElementId,
  scalarExecutionPositionByElementId: compiled.scalarExecutionPositionByRuntimeElementId,
  forGroupMutationOwnerByElementId: compiled.bindingVersions
    ? new Map([
        ...forGroupMutationOwnerByElementId(buildForGroupExecutionOwners(
          compiled.bindingVersions,
          compiled.document.elements,
          compiled.statementMap.byElementId,
          compiled.statementMap.statementIdByStatementIndex,
          new Set(compiled.moduleForGroupExecutionOwnerByElementId
            ? [...compiled.moduleForGroupExecutionOwnerByElementId.values()].map((owner) => owner.ownerStatementId)
            : [])
        )),
        ...(compiled.moduleForGroupExecutionOwnerByElementId ? [...compiled.moduleForGroupExecutionOwnerByElementId] : [])
      ])
    : undefined,
  moduleForGroupExecutionOwnerByElementId: compiled.moduleForGroupExecutionOwnerByElementId
});

describe("immutable statement-for carries", () => {
  it("compiles and evaluates the normative multiline carry header", () => {
    const compiled = compile([
      "nui 1",
      "for i in range(min: 0, max: 2, step: 1)",
      "carry total: number = 0",
      "carry count: number = 0 {",
      "  next total = @total + @i",
      "  next count = @count + 1",
      "}",
      "const result: number = @total"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 3 }
    });
  });

  it("swaps multiple carries from one iteration-start snapshot and escapes the final value", () => {
    const compiled = compile([
      "nui 1",
      "for i in range(min: 0, max: 2, step: 1) carry a: number = 0 carry b: number = 1 {",
      "  next a = @b",
      "  next b = @a",
      "}",
      "const result: number = @a"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 1 }
    });
  });

  it("iterates scalar collection members with their exact binder type", () => {
    const compiled = compile([
      "nui 1",
      "const items: string[] = [\"a\", \"b\"]",
      "for item in @items carry last: string = \"\" {",
      "  next last = @item",
      "}",
      "const result: string = @last"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);
    const forGroup = compiled.document.elements.find((element) => element.type === "forGroup");
    expect(forGroup).toMatchObject({ iterationElementType: { kind: "string" } });
    expect(forGroup && forGroup.type === "forGroup" ? forGroup.iterationSourceValueId : undefined).toMatch(/^statement:typedDeclaration:/);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "string", value: "b" }
    });
  });

  it("keeps the carry initializer outside the per-iteration frame", () => {
    const compiled = compile([
      "nui 1",
      "for i in range(min: 0, max: 2, step: 1) carry total: number = 0 {",
      "  next total = @total + 1",
      "}",
      "const result: number = @total"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 3 }
    });
  });

  it("swaps collection carries through the shared collection runtime", () => {
    const compiled = compile([
      "nui 1",
      "const first: number[] = [1, 2]",
      "const second: number[] = [3, 4]",
      "for i in range(min: 0, max: 1, step: 1) carry a: number[] = @first carry b: number[] = @second {",
      "  next a = @b",
      "  next b = @a",
      "}",
      "const result: number = @a[0] + @b[1]"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 5 }
    });
  });

  it("rejects branch-local next instead of compiling an unconditional update", () => {
    const result = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "for i in range(min: 0, max: 1, step: 1) carry total: number = 0 {",
      "  if (true) {",
      "    next total = 1",
      "  }",
      "}",
      "const result: number = @total"
    ].join("\n"));
    expect(result.status).toBe("fatal");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "next-inside-conditional")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "missing-next")).toBe(false);
  });

  it("requires the canonical @reference form for collection sources", () => {
    const result = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "const items: number[] = [1, 2]",
      "for item in items {",
      "}"
    ].join("\n"));
    expect(result.status).toBe("fatal");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-for-source-reference")).toBe(true);
  });

  it("rejects a descending numeric range instead of returning its carry initializer", () => {
    const compiled = compile([
      "nui 1",
      "for i in range(min: 2, max: 1, step: 1) carry total: number = 7 {",
      "  next total = @total + 1",
      "}",
      "const result: number = @total"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    const forGroupId = compiled.document.elements.find((element) => element.type === "forGroup")!.id;
    expect(evaluation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        elementId: forGroupId,
        missingDependencyId: forGroupId,
        message: expect.stringContaining("min は max 以下")
      })
    ]));
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)?.status).not.toBe("ok");
  });

  it("keeps the carry initializer for a genuinely empty collection source", () => {
    const compiled = compile([
      "nui 1",
      "const items: number[] = []",
      "for item in @items carry total: number = 7 {",
      "  next total = @total + 1",
      "}",
      "const result: number = @total"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 7 }
    });
  });

  it("keeps a Module collection carry initializer when the source is empty", () => {
    const compiled = compile([
      "nui 1",
      "module M() {",
      "  const items: number[] = []",
      "  for item in @items carry total: number = 7 {",
      "    next total = @total + 1",
      "    point Mark = coordinate(x: 0, y: 0)",
      "  }",
      "  export const output: number = @total",
      "}",
      "instance A = M()",
      "const result: number = @A::output"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);
    const loop = compiled.document.elements.find((element) => element.type === "forGroup");
    expect(loop).toMatchObject({ iterationElementValueType: { kind: "number" } });

    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.kind === "typed" && binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 7 }
    });
    expect(evaluation.forGroupGeneratedRows?.filter((row) => row.forGroupId === loop?.id) ?? []).toEqual([]);
  });

  it("propagates state through an inner carry and rejects direct outer next", () => {
    const valid = compile([
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) carry outer: number = 0 {",
      "  for j in range(min: 0, max: 1, step: 1) carry inner: number = @outer {",
      "    next inner = @inner + 1",
      "  }",
      "  next outer = @inner",
      "}",
      "const result: number = @outer"
    ].join("\n"));
    expect(valid.diagnostics).toEqual([]);
    const validEvaluation = evaluateElements(valid.document.elements, optionsFor(valid));
    expect(validEvaluation.errors).toEqual([]);
    const validResultId = valid.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(validEvaluation.computedScalarBindings?.get(validResultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 2 }
    });

    const invalidResult = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) carry outer: number = 0 {",
      "  for j in range(min: 0, max: 0, step: 1) {",
      "    next outer = 1",
      "  }",
      "  next outer = @outer",
      "}"
    ].join("\n"));
    expect(invalidResult.status).toBe("fatal");
    expect(invalidResult.diagnostics.some((diagnostic) => diagnostic.code === "next-outer-carry")).toBe(true);
  });

  it("carries a nominal record through a loop", () => {
    const compiled = compile([
      "nui 1",
      "record Pair(x: number, label: string)",
      'const first: Pair = Pair(x: 1, label: "ok")',
      "for i in range(min: 0, max: 0, step: 1) carry last: Pair = @first {",
      '  next last = Pair(x: @last.x + 1, label: @last.label)',
      "}",
      "const result: number = @last.x"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 2 }
    });
  });

  it("preserves generalized record geometry, collection, and nested fields", () => {
    const compiled = compile([
      "nui 1",
      "point A = coordinate(x: 3, y: 4)",
      "line Edge = segment(start: (0, 0), end: (10, 0))",
      "record Metadata(label: string)",
      "record Piece(count: number, edge: line, points: point[], metadata: Metadata)",
      'const first: Piece = Piece(count: 1, edge: @Edge, points: [@A], metadata: Metadata(label: "ok"))',
      "for i in range(min: 0, max: 0, step: 1) carry last: Piece = @first {",
      '  next last = Piece(count: @last.count + 1, edge: @last.edge, points: @last.points, metadata: @last.metadata)',
      "}",
      "const count: number = @last.count",
      "const pointCount: number = @last.points.length",
      "const edgeLength: number = @last.edge.length",
      "const label: string = @last.metadata.label"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const value = (name: string) => {
      const id = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === name)!.id;
      return evaluation.computedScalarBindings?.get(id);
    };
    expect(value("count")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
    expect(value("pointCount")).toMatchObject({ status: "ok", value: { kind: "number", value: 1 } });
    expect(value("edgeLength")).toMatchObject({ status: "ok", value: { kind: "number", value: 10 } });
    expect(value("label")).toMatchObject({ status: "ok", value: { kind: "string", value: "ok" } });
  });

  it("iterates nominal record collection members through their field bindings", () => {
    const compiled = compile([
      "nui 1",
      "record Pair(x: number, label: string)",
      'const first: Pair = Pair(x: 1, label: "ok")',
      "const items: Pair[] = [@first]",
      "for item in @items carry total: number = 0 {",
      "  next total = @item.x",
      "}",
      "const result: number = @total"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 1 }
    });
  });

  it("feeds same-iteration geometry into a geometry carry next", () => {
    const compiled = compile([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "for i in range(min: 0, max: 1, step: 1) carry cursor: point = @A {",
      "  line Edge = segment(start: @cursor, end: @A)",
      "  next cursor = @Edge.end",
      "}",
      "const result: number = @cursor.x"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 0 }
    });
  });

  it("iterates immutable geometry collection members", () => {
    const compiled = compile([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 2, y: 0)",
      "const items: point[] = [@A, @B]",
      "for item in @items carry cursor: point = @A {",
      "  next cursor = @item",
      "}",
      "const result: number = @cursor.x"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 2 }
    });
  });

  it("uses the exact choice type for scalar carries and accepts value-if next", () => {
    const compiled = compile([
      "nui 1",
      "const side: choice(left, right) = left",
      "for i in range(min: 0, max: 1, step: 1) carry last: choice(left, right) = @side {",
      "  next last = if (true) { right } else { left }",
      "}",
      "const result: choice(left, right) = @last"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "choice", value: "right", options: ["left", "right"] }
    });
  });

  it("accepts exhaustive choice match as a carry next RHS", () => {
    const compiled = compile([
      "nui 1",
      "const side: choice(left, right) = left",
      "for i in range(min: 0, max: 1, step: 1) carry last: choice(left, right) = @side {",
      "  next last = match @side { left => right right => left }",
      "}",
      "const result: choice(left, right) = @last"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "choice", value: "right", options: ["left", "right"] }
    });
  });

  it("keeps missing, duplicate, unknown, and wrong-type next diagnostics deterministic", () => {
    const source = (body: string) => [
      "nui 1",
      "for i in range(min: 0, max: 1, step: 1) carry total: number = 0 {",
      body,
      "}"
    ].join("\n");
    const diagnostics = (body: string) => compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), source(body)).diagnostics;
    expect(diagnostics("")).toEqual(expect.arrayContaining([expect.objectContaining({ code: "missing-next" })]));
    expect(diagnostics("  next total = 1\n  next total = 2")).toEqual(expect.arrayContaining([expect.objectContaining({ code: "duplicate-next" })]));
    expect(diagnostics("  next missing = 1")).toEqual(expect.arrayContaining([expect.objectContaining({ code: "unknown-next-carry" })]));
    expect(diagnostics('  next total = "wrong"')).not.toEqual([]);
  });

  it("uses canonical assignability for scalar choice and nominal record collections", () => {
    const choiceMismatch = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "const left: choice(left, right)[] = [left]",
      "const other: choice(up, down)[] = [up]",
      "for i in range(min: 0, max: 1, step: 1) carry values: choice(left, right)[] = @other {",
      "  next values = @left",
      "}"
    ].join("\n"));
    expect(choiceMismatch.status).toBe("fatal");
    expect(choiceMismatch.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "carry-collection-expression-invalid" })]));

    const recordMismatch = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "record Foo(value: number)",
      "record Bar(value: number)",
      "const bar: Bar = Bar(value: 1)",
      "const bars: Bar[] = [@bar]",
      "for i in range(min: 0, max: 1, step: 1) carry foos: Foo[] = @bars {",
      "  next foos = @bars",
      "}"
    ].join("\n"));
    expect(recordMismatch.status).toBe("fatal");
    expect(recordMismatch.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "carry-collection-expression-invalid" })]));
  });

  it("applies directional canonical assignability to geometry carries", () => {
    const lineToPath = compile([
      "nui 1",
      "line L = segment(start: (0, 0), end: (10, 0))",
      "for i in range(min: 0, max: 1, step: 1) carry pathValue: path = @L {",
      "  next pathValue = @L",
      "}"
    ].join("\n"));
    expect(lineToPath.diagnostics).toEqual([]);

    const pathToLine = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "curve C = bezier(start: (0, 0), end: (10, 0))",
      "for i in range(min: 0, max: 1, step: 1) carry lineValue: line = @C {",
      "  next lineValue = @C",
      "}"
    ].join("\n"));
    expect(pathToLine.status).toBe("fatal");
    expect(pathToLine.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "carry-geometry-type-mismatch" })]));
  });

  it("applies directional canonical assignability to geometry collection carries", () => {
    const lineToPath = compile([
      "nui 1",
      "line L = segment(start: (0, 0), end: (10, 0))",
      "const lines: line[] = [@L]",
      "for i in range(min: 0, max: 1, step: 1) carry paths: path[] = @lines {",
      "  next paths = @lines",
      "}"
    ].join("\n"));
    expect(lineToPath.diagnostics).toEqual([]);

    const pathToLine = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "curve C = bezier(start: (0, 0), end: (10, 0))",
      "const paths: path[] = [@C]",
      "for i in range(min: 0, max: 1, step: 1) carry lines: line[] = @paths {",
      "  next lines = @paths",
      "}"
    ].join("\n"));
    expect(pathToLine.status).toBe("fatal");
    expect(pathToLine.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "carry-collection-expression-invalid" })]));

    const pointLineMismatch = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "point P = coordinate(x: 0, y: 0)",
      "const points: point[] = [@P]",
      "for i in range(min: 0, max: 1, step: 1) carry lines: line[] = @points {",
      "  next lines = @points",
      "}"
    ].join("\n"));
    expect(pointLineMismatch.status).toBe("fatal");
    expect(pointLineMismatch.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "carry-collection-expression-invalid" })]));
  });
});
