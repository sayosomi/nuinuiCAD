import { describe, expect, it } from "vitest";
import { buildNumericBindingRuntimeEntries } from "../geometry/numericBindingRuntime";
import { evaluateElements } from "../geometry/evaluate";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";

const stableIdsFor = (source: string) =>
  new Map(parseDsl(source).statements.map((_, index) => [index, `blocking:${index}`] as const));

const runtimeNames = (source: string) => {
  const compiled = compileDslDocument(source, { assignedStatementIds: stableIdsFor(source) });
  expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  expect(compiled.document).not.toBeNull();
  return compiled;
};

const evaluateCompiled = (compiled: ReturnType<typeof runtimeNames>) => {
  if (!compiled.document || !compiled.statementMap) throw new Error("expected compiled document");
  return evaluateElements(compiled.document.elements, {
    evaluationLimitIndex: compiled.document.evaluationLimitIndex,
    scalarProgram: compiled.scalarProgram,
    bindingVersions: compiled.bindingVersions,
    statementInfoByElementId: compiled.statementMap.byElementId,
    statementIdByStatementIndex: compiled.statementMap.statementIdByStatementIndex,
    sourceExecutionPositionByElementId: compiled.moduleMaterialization?.sourceExecutionPositionByRuntimeElementId,
    numericBindingEntries: compiled.scalarProgram && compiled.numericBindings
      ? buildNumericBindingRuntimeEntries(
          {
            numericBindings: compiled.numericBindings,
            elementIdByStatementIndex: compiled.statementMap.elementIdByStatementIndex
          },
          compiled.document.elements
        )
      : undefined
  });
};

describe("module materialization blocking regressions", () => {
  it("connects document-level linear mutation to a materialized call execution unit", () => {
    const compiled = runtimeNames([
      "nui 3",
      "let value: number = 0",
      "point Before = coordinate(x: @value, y: 0)",
      "set value = 10",
      "module M() {",
      "  point P = coordinate(x: 10, y: 20)",
      "  point Q = offset(from: @P, dx: 1, dy: 2)",
      "}",
      "module A = M()",
      "set value = 20",
      "point After = coordinate(x: @value, y: 0)"
    ].join("\n"));
    const materialization = compiled.moduleMaterialization!;
    const elements = compiled.document!.elements;
    const callEntries = materialization.executionStatements.filter((entry) => entry.executionUnitStatementIndex === 8);

    expect(callEntries.map((entry) => entry.type)).toEqual(["moduleInstance", "freePoint", "offsetPoint"]);
    expect(callEntries.every((entry) =>
      materialization.sourceExecutionPositionByRuntimeElementId.get(entry.runtimeElementId) === 8
    )).toBe(true);
    expect(materialization.sourceExecutionUnits.find((unit) => unit.sourceStatementIndex === 8)).toMatchObject({
      runtimeStart: 1,
      runtimeEnd: 4
    });
    expect(compiled.statementMap!.elementIdByStatementIndex.has(8)).toBe(false);

    const result = evaluateCompiled(compiled);
    const before = elements.find((element) => element.name === "Before")!;
    const after = elements.find((element) => element.name === "After")!;
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(before.id)).toMatchObject({ kind: "point", x: 0 });
    expect(result.computedGeometry.get(after.id)).toMatchObject({ kind: "point", x: 20 });
    expect(result.computedScalarBindings).toBeDefined();
  });

  it("keeps a document set after a module call out of @stop evaluation", () => {
    const compiled = runtimeNames([
      "nui 3",
      "let value: number = 0",
      "set value = 1",
      "module M() {",
      "  point P = coordinate(x: 10, y: 20)",
      "}",
      "module A = M()",
      "@stop",
      "set value = 2",
      "point After = coordinate(x: @value, y: 0)"
    ].join("\n"));

    const result = evaluateCompiled(compiled);
    const after = compiled.document!.elements.find((element) => element.name === "After")!;
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.has(after.id)).toBe(false);
    expect(result.evaluatedElementIds?.size).toBe(compiled.moduleMaterialization!.evaluationLimitIndex);
  });

  it("keeps private refs instance-local and opaque to ordinary callers", () => {
    const repeated = runtimeNames([
      "nui 3",
      "module M() {",
      "  point P = coordinate(x: 10, y: 20)",
      "  point Q = offset(from: @P, dx: 1, dy: 2)",
      "}",
      "module A = M()",
      "module B = M()"
    ].join("\n"));
    const repeatedElements = repeated.document!.elements;
    const a = repeatedElements.find((element) => element.name === "A")!;
    const b = repeatedElements.find((element) => element.name === "B")!;
    const aP = repeatedElements.find((element) => element.name === "P" && element.parentGroupId === a.id)!;
    const aQ = repeatedElements.find((element) => element.name === "Q" && element.parentGroupId === a.id)!;
    const bP = repeatedElements.find((element) => element.name === "P" && element.parentGroupId === b.id)!;
    const bQ = repeatedElements.find((element) => element.name === "Q" && element.parentGroupId === b.id)!;
    expect(aQ).toMatchObject({ fromPoint: { mode: "reference", pointId: aP.id } });
    expect(bQ).toMatchObject({ fromPoint: { mode: "reference", pointId: bP.id } });
    expect(aQ).not.toMatchObject({ fromPoint: { pointId: bP.id } });

    const caller = compileDslDocument([
      "nui 3",
      "module M() {",
      "  point P = coordinate(x: 10, y: 20)",
      "}",
      "module A = M()",
      "point Q = offset(from: @A::P, dx: 1, dy: 2)"
    ].join("\n"), { assignedStatementIds: stableIdsFor([
      "nui 3",
      "module M() {",
      "  point P = coordinate(x: 10, y: 20)",
      "}",
      "module A = M()",
      "point Q = offset(from: @A::P, dx: 1, dy: 2)"
    ].join("\n")) });
    expect(caller.document).toBeNull();
    expect(caller.diagnostics.some((diagnostic) => diagnostic.code === "module-private-member")).toBe(true);
  });

  it("retains ordinary group qualified lookup while nested module refs stay local", () => {
    const compiled = runtimeNames([
      "nui 3",
      "module Inner() {",
      "  point P = coordinate(x: 1, y: 2)",
      "  point Q = offset(from: @P, dx: 3, dy: 4)",
      "}",
      "module Outer() {",
      "  module Nested = Inner()",
      "}",
      "module A = Outer()",
      "group G {",
      "  point Child = coordinate(x: 5, y: 6)",
      "}",
      "point Outside = offset(from: @G::Child, dx: 1, dy: 2)"
    ].join("\n"));
    const elements = compiled.document!.elements;
    const nested = elements.find((element) => element.name === "Nested")!;
    const nestedP = elements.find((element) => element.name === "P" && element.parentGroupId === nested.id)!;
    const nestedQ = elements.find((element) => element.name === "Q" && element.parentGroupId === nested.id)!;
    const outside = elements.find((element) => element.name === "Outside")!;
    const child = elements.find((element) => element.name === "Child")!;
    expect(nestedQ).toMatchObject({ fromPoint: { mode: "reference", pointId: nestedP.id } });
    expect(outside).toMatchObject({ fromPoint: { mode: "reference", pointId: child.id } });
  });
});
