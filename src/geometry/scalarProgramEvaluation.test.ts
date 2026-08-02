import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import { evaluateElements } from "./evaluate";
import { buildNumericBindingRuntimeEntries } from "./numericBindingRuntime";

const compileCanonical = (source: string) => {
  const baseline = regenerateCanonicalFromModel(emptyDocument(), 3);
  const result = compileCanonicalText(baseline, source);
  expect(result.status).not.toBe("fatal");
  return result.doc;
};

describe("evaluateElements / scalarProgram wiring (Task 20)", () => {
  it("evaluates an earlier line property in a typed number initializer", () => {
    const compiled = compileCanonical([
      "nui 3",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: A, end: B)",
      "const test: number = @AB.length",
      "point C = coordinate(x: @test, y: 0)"
    ].join("\n"));
    const bindingId = compiled.scalarProgram!.statements[0].bindingId;
    const result = evaluateElements(compiled.document!.elements, {
      scalarProgram: compiled.scalarProgram,
      numericBindingEntries: buildNumericBindingRuntimeEntries({ numericBindings: compiled.numericBindings!, elementIdByStatementIndex: compiled.statementMap!.elementIdByStatementIndex }, compiled.document!.elements)
    });
    expect(result.computedScalarBindings?.get(bindingId)).toMatchObject({ status: "ok", value: { kind: "number", value: 10 } });
    const pointC = compiled.document!.elements.find((element) => element.name === "C")!;
    expect(result.computedGeometry.get(pointC.id)).toMatchObject({ kind: "point", x: 10, y: 0 });
  });

  it("does not allow a lazy binding to read a later element after it has evaluated", () => {
    const compiled = compileCanonical([
      "nui 3",
      "const x: number = @Later.length",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Later = segment(start: A, end: B)",
      "point C = coordinate(x: @x, y: 0)"
    ].join("\n"));
    const bindingId = compiled.scalarProgram!.statements[0].bindingId;
    const result = evaluateElements(compiled.document!.elements, { scalarProgram: compiled.scalarProgram });
    expect(result.computedScalarBindings?.get(bindingId)).toMatchObject({ status: "error", issueCode: "evaluation-geometry-property-unavailable" });
  });
  it("evaluates a nested-scope outer initializer to its final value", () => {
    const compiled = compileCanonical([
      "nui 3",
      "const outer: number = 2",
      "group G {",
      "  const inner: number = @outer + 1",
      "  point A = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n"));

    const outerBindingId = compiled.scalarProgram!.statements[0].bindingId;
    const innerBindingId = compiled.scalarProgram!.statements[1].bindingId;
    const result = evaluateElements(compiled.document!.elements, { scalarProgram: compiled.scalarProgram });

    expect(result.computedScalarBindings?.get(outerBindingId)).toEqual({
      status: "ok",
      type: { kind: "number" },
      value: { kind: "number", value: 2 }
    });
    expect(result.computedScalarBindings?.get(innerBindingId)).toEqual({
      status: "ok",
      type: { kind: "number" },
      value: { kind: "number", value: 3 }
    });
  });

  it("is absent when no scalarProgram is given", () => {
    const compiled = compileCanonical(["nui 3", "point A = coordinate(x: 0, y: 0)"].join("\n"));
    const result = evaluateElements(compiled.document!.elements, {});
    expect(result.computedScalarBindings).toBeUndefined();
  });

  it("keeps Task 20's lazy result shape and insertion order when the compiled graph has no set", () => {
    const compiled = compileCanonical([
      "nui 3",
      "const first: number = 1",
      "const second: number = @first + 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n"));
    const result = evaluateElements(compiled.document!.elements, {
      scalarProgram: compiled.scalarProgram,
      bindingVersions: compiled.bindingVersions,
      statementInfoByElementId: compiled.statementMap!.byElementId
    });

    expect(result.computedScalarBindingVersions).toBeUndefined();
    expect([...result.computedScalarBindings!.keys()]).toEqual(
      compiled.scalarProgram!.statements.map((statement) => statement.bindingId)
    );
  });

  it("resolves a legacy var geometry measurement matching the legacy numeric evaluator", () => {
    const compiled = compileCanonical([
      "nui 3",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 3, y: 4)",
      "var d = pointDistance(point1: A, point2: B, state: hidden)",
      "const dist: number = @d"
    ].join("\n"));

    const distBindingId = compiled.scalarProgram!.statements[0].bindingId;
    const result = evaluateElements(compiled.document!.elements, { scalarProgram: compiled.scalarProgram });

    const variableElement = compiled.document!.elements.find((element) => element.type === "variable")!;
    expect(result.computedVariables.get(variableElement.id)?.value).toBe(5);
    expect(result.computedScalarBindings?.get(distBindingId)).toEqual({
      status: "ok",
      type: { kind: "number" },
      value: { kind: "number", value: 5 }
    });
  });

  it("poisons a typed const referencing a disabled legacy var, and propagates to a dependent binding", () => {
    const compiled = compileCanonical([
      "nui 3",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 3, y: 4)",
      "var d = pointDistance(point1: A, point2: B, state: disabled)",
      "const dist: number = @d",
      "const distPlusOne: number = @dist + 1"
    ].join("\n"));

    const [distStatement, distPlusOneStatement] = compiled.scalarProgram!.statements;
    const result = evaluateElements(compiled.document!.elements, { scalarProgram: compiled.scalarProgram });

    const variableElement = compiled.document!.elements.find((element) => element.type === "variable")!;
    expect(result.computedVariables.has(variableElement.id)).toBe(false);
    expect(result.computedScalarBindings?.get(distStatement.bindingId)).toMatchObject({
      status: "error",
      issueCode: "evaluation-external-binding-unavailable"
    });
    expect(result.computedScalarBindings?.get(distPlusOneStatement.bindingId)).toMatchObject({ status: "error" });
  });

  it("never re-evaluates a Task 13R-ineligible declaration (excluded from the program entirely)", () => {
    const compiled = compileCanonical([
      "nui 3",
      "const broken: number = @missing",
      "const dependent: number = @broken + 1",
      "const valid: number = 3"
    ].join("\n"));

    expect(compiled.scalarProgram?.statements).toHaveLength(1);
    const result = evaluateElements(compiled.document!.elements, { scalarProgram: compiled.scalarProgram });
    expect(result.computedScalarBindings?.size).toBe(1);
    expect(result.computedScalarBindings?.get(compiled.scalarProgram!.statements[0].bindingId)).toEqual({
      status: "ok",
      type: { kind: "number" },
      value: { kind: "number", value: 3 }
    });
  });
});
