import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel, type LastGoodDslDocument } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import { canUseRustEvaluationForElements } from "./evaluationEngine";
import { evaluateElements, type EvaluateElementsOptions } from "./evaluate";
import { buildConditionalGroupConditionsByElementId } from "./controlBooleanRuntime";
import { buildTextTemplateEntriesByElementId } from "./textTemplateRuntime";

const compileCanonical = (source: string): LastGoodDslDocument => {
  const baseline = regenerateCanonicalFromModel(emptyDocument(), 3);
  const result = compileCanonicalText(baseline, source);
  expect(result.status).not.toBe("fatal");
  return result.doc;
};

const optionsFor = (compiled: LastGoodDslDocument): EvaluateElementsOptions => {
  const textTemplateEntriesByElementId = compiled.textTemplates
    ? buildTextTemplateEntriesByElementId({
        textTemplates: compiled.textTemplates,
        elementIdByStatementIndex: compiled.statementMap.elementIdByStatementIndex
      })
    : undefined;
  return {
    evaluationLimitIndex: compiled.document.evaluationLimitIndex,
    scalarProgram: compiled.scalarProgram,
    bindingVersions: compiled.bindingVersions,
    statementInfoByElementId: compiled.statementMap.byElementId,
    conditionalGroupConditionsByElementId: buildConditionalGroupConditionsByElementId(
      compiled.conditionalGroupConditions ?? new Map(),
      compiled.statementMap.elementIdByStatementIndex
    ),
    ...(textTemplateEntriesByElementId?.size ? { textTemplateEntriesByElementId } : {})
  };
};

const elementId = (compiled: LastGoodDslDocument, name: string): string => {
  const element = compiled.document.elements.find((candidate) => candidate.name === name);
  if (!element) throw new Error(`missing ${name}`);
  return element.id;
};

describe("Task 31 linear mutation production wiring", () => {
  it("enables Rust only for a wholly linear set graph", () => {
    const linear = compileCanonical([
      "nui 3",
      "let value: number = 1",
      "point Marker = coordinate(x: 0 y: 0)",
      "set value = 2"
    ].join("\n"));
    const controlled = compileCanonical([
      "nui 3",
      "let value: number = 1",
      "if C (true) {",
      "  set value = 2",
      "}"
    ].join("\n"));

    expect(canUseRustEvaluationForElements(linear.document.elements, optionsFor(linear))).toBe(true);
    expect(canUseRustEvaluationForElements(controlled.document.elements, optionsFor(controlled))).toBe(false);
  });

  it("advances binding slots with source order: A sees old value, B sees set value, and set reads the live legacy measurement", () => {
    const compiled = compileCanonical([
      "nui 3",
      "point P = coordinate(x: 0 y: 0)",
      "point Q = coordinate(x: 3 y: 4)",
      "var d = pointDistance(point1: P point2: Q state: hidden)",
      "let value: number = @d",
      'text A = label(text: "A={@value}" anchor: none size: 3)',
      "set value = @d + 1",
      'text B = label(text: "B={@value}" anchor: none size: 3)'
    ].join("\n"));
    const options = optionsFor(compiled);
    const result = evaluateElements(compiled.document.elements, options);

    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(elementId(compiled, "A"))).toMatchObject({ kind: "text", text: "A=5" });
    expect(result.computedGeometry.get(elementId(compiled, "B"))).toMatchObject({ kind: "text", text: "B=6" });
    const [declaration, set] = compiled.bindingVersions!.versions;
    expect(result.computedScalarBindings?.get(declaration.bindingId)).toMatchObject({ status: "ok", value: { value: 6 } });
    expect(result.computedScalarBindingVersions?.get(declaration.id)).toMatchObject({ status: "executed", bindingId: declaration.bindingId });
    expect(result.computedScalarBindingVersions?.get(set.id)).toMatchObject({
      status: "executed", statementId: set.id, bindingId: declaration.bindingId, evaluation: { value: { value: 6 } }
    });
    // text remains outside Rust support until Task 28, independently of the
    // now-supported linear binding-version payload.
    expect(canUseRustEvaluationForElements(compiled.document.elements, options)).toBe(false);
  });

  it("does not execute a set at or after @stop, including during finalization", () => {
    const compiled = compileCanonical([
      "nui 3",
      "let value: number = 1",
      'text A = label(text: "A={@value}" anchor: none size: 3)',
      "@stop",
      "set value = 2",
      'text B = label(text: "B={@value}" anchor: none size: 3)'
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    const declaration = compiled.bindingVersions!.versions[0];
    const set = compiled.bindingVersions!.versions[1];

    expect(result.computedGeometry.get(elementId(compiled, "A"))).toMatchObject({ kind: "text", text: "A=1" });
    expect(result.computedGeometry.has(elementId(compiled, "B"))).toBe(false);
    expect(result.computedScalarBindings?.get(declaration.bindingId)).toMatchObject({ value: { value: 1 } });
    expect(result.computedScalarBindingVersions?.has(set.id)).toBe(false);
  });

  it("executes a set before @stop but excludes declarations after the cutoff", () => {
    const compiled = compileCanonical([
      "nui 3",
      "let value: number = 1",
      "set value = 2",
      "@stop",
      "const later: number = 3",
      'text A = label(text: "A={@value}" anchor: none size: 3)'
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    const [declaration, set, later] = compiled.bindingVersions!.versions;

    expect(result.computedGeometry.get(elementId(compiled, "A"))).toBeUndefined();
    expect(result.computedScalarBindings?.get(declaration.bindingId)).toMatchObject({ value: { value: 2 } });
    expect(result.computedScalarBindingVersions?.get(set.id)).toMatchObject({ status: "executed" });
    expect(result.computedScalarBindings?.has(later.bindingId)).toBe(false);
  });

  it("finalizes the same one-way stream after the last element and preserves declaration map order", () => {
    const compiled = compileCanonical([
      "nui 3",
      "let x: number = 1",
      "let y: number = 2",
      "point Marker = coordinate(x: 0 y: 0)",
      "set x = @y",
      "set y = @x"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(Array.from(result.computedScalarBindings?.keys() ?? [])).toEqual(
      compiled.bindingVersions!.versions.filter((version) => version.kind === "declare").map((version) => version.bindingId)
    );
    expect(Array.from(result.computedScalarBindingVersions?.keys() ?? [])).toEqual(
      compiled.bindingVersions!.versions.map((version) => version.id)
    );
    expect(result.computedScalarBindings?.get(compiled.bindingVersions!.versions[0].bindingId)).toMatchObject({ value: { value: 2 } });
  });

  it("resolves typed conditional controls from the current slot at each group statement", () => {
    const compiled = compileCanonical([
      "nui 3",
      "let flag: boolean = false",
      "if Before (@flag) {",
      "  point ThenBefore = coordinate(x: 0 y: 0)",
      "} else {",
      "  point ElseBefore = coordinate(x: 1 y: 0)",
      "}",
      "set flag = true",
      "if After (@flag) {",
      "  point ThenAfter = coordinate(x: 2 y: 0)",
      "} else {",
      "  point ElseAfter = coordinate(x: 3 y: 0)",
      "}"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));

    expect(result.computedGeometry.has(elementId(compiled, "ElseBefore"))).toBe(true);
    expect(result.computedGeometry.has(elementId(compiled, "ThenBefore"))).toBe(false);
    expect(result.computedGeometry.has(elementId(compiled, "ThenAfter"))).toBe(true);
    expect(result.computedGeometry.has(elementId(compiled, "ElseAfter"))).toBe(false);
  });
});
