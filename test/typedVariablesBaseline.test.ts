import { describe, expect, it } from "vitest";
import { compileDslDocument, serializeDocumentToDsl } from "../src/dsl/dslDocument";
import { evaluateElements } from "../src/geometry/evaluate";
import {
  BASELINE_SIZES,
  buildForGroupBaselineSource,
  buildStandardBaselineSource,
  disabledActivityBaselineSource,
  forwardReferenceBaselineSource,
  outOfScopeBaselineSource,
  semanticV2BaselineSource
} from "./typedVariablesBaselineFixtures";

const compileValidDocument = (source: string) => {
  const compiled = compileDslDocument(source);
  expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  expect(compiled.document).not.toBeNull();
  return compiled.document!;
};

const elementId = (elements: ReturnType<typeof compileValidDocument>["elements"], name: string) => {
  const element = elements.find((candidate) => candidate.name === name);
  expect(element).toBeDefined();
  return element!.id;
};

describe("typed-variable v2 compatibility baseline", () => {
  it("fixes numeric vars, scopes, measurements, interpolation, activity, placement, and round-trip", () => {
    const document = compileValidDocument(semanticV2BaselineSource);
    const evaluation = evaluateElements(document.elements);

    expect(evaluation.errors).toEqual([]);
    expect(evaluation.computedVariables.get(elementId(document.elements, "Global"))?.value).toBe(12);
    expect(evaluation.computedVariables.get(elementId(document.elements, "Long"))?.value).toBe(15);
    expect(evaluation.computedVariables.get(elementId(document.elements, "Distance"))?.value).toBeCloseTo(Math.sqrt(200));
    expect(evaluation.computedVariables.get(elementId(document.elements, "Angle"))?.value).toBeCloseTo(315);
    expect(evaluation.computedVariables.get(elementId(document.elements, "LineDistance"))?.value).toBeCloseTo(10);
    expect(evaluation.computedGeometry.get(elementId(document.elements, "Scoped"))).toMatchObject({ kind: "point", x: 15, y: 0 });
    expect(document.elements.find((element) => element.name === "ByRatio")).toMatchObject({
      type: "divisionPoint",
      placement: { kind: "ratio", value: 0.5 }
    });
    expect(document.elements.find((element) => element.name === "ByDistance")).toMatchObject({
      type: "divisionPoint",
      placement: { kind: "distance", value: 5 }
    });
    expect(evaluation.computedGeometry.get(elementId(document.elements, "ByRatio"))).toMatchObject({ kind: "point", x: 5, y: 0 });
    expect(evaluation.computedGeometry.get(elementId(document.elements, "ByDistance"))).toMatchObject({ kind: "point", x: 5, y: 0 });
    expect(evaluation.computedGeometry.get(elementId(document.elements, "Note"))).toMatchObject({ kind: "text", text: "値 12 / 10" });

    const hiddenId = elementId(document.elements, "Hidden");
    expect(evaluation.computedGeometry.get(hiddenId)).toMatchObject({ kind: "point", x: 30, y: 0 });
    expect(evaluation.effectiveVisibleElementIds.has(hiddenId)).toBe(false);
    expect(evaluation.computedGeometry.get(elementId(document.elements, "HiddenConsumer"))).toMatchObject({ kind: "point", x: 31, y: 0 });

    const serialized = serializeDocumentToDsl(document, 2);
    expect(serialized).toContain("var GroupValue = expression(");
    const recompiled = compileValidDocument(serialized);
    const reevaluation = evaluateElements(recompiled.elements);
    expect(reevaluation.errors).toEqual([]);
    expect(reevaluation.computedVariables.get(elementId(recompiled.elements, "Long"))?.value).toBe(15);
    expect(reevaluation.computedGeometry.get(elementId(recompiled.elements, "Scoped"))).toMatchObject({ kind: "point", x: 15, y: 0 });
    expect(reevaluation.computedGeometry.get(elementId(recompiled.elements, "Note"))).toMatchObject({ kind: "text", text: "値 12 / 10" });
  });

  it("keeps forward and out-of-scope legacy numeric references as evaluation failures", () => {
    for (const source of [forwardReferenceBaselineSource, outOfScopeBaselineSource]) {
      const evaluation = evaluateElements(compileValidDocument(source).elements);
      expect(evaluation.errors).not.toEqual([]);
    }
  });

  it("keeps disabled elements out of evaluation while reporting their dependent", () => {
    const document = compileValidDocument(disabledActivityBaselineSource);
    const evaluation = evaluateElements(document.elements);
    const disabledId = elementId(document.elements, "Disabled");
    const consumerId = elementId(document.elements, "DisabledConsumer");

    expect(evaluation.computedGeometry.has(disabledId)).toBe(false);
    expect(evaluation.computedGeometry.has(consumerId)).toBe(false);
    expect(evaluation.errors.some((error) => error.elementId === consumerId)).toBe(true);
  });

  it.each(BASELINE_SIZES)("compiles and evaluates a %i-statement var/geometry fixture", (statementCount) => {
    const { source, scale } = buildStandardBaselineSource(statementCount);
    const document = compileValidDocument(source);
    const evaluation = evaluateElements(document.elements);

    expect(document.elements).toHaveLength(scale.statementCount);
    expect(document.elements.filter((element) => element.type === "variable")).toHaveLength(scale.bindingCount);
    expect(document.elements.filter((element) => element.type === "freePoint")).toHaveLength(scale.geometryStatementCount);
    expect(evaluation.errors).toEqual([]);
    expect(evaluation.computedVariables.size).toBe(scale.bindingCount);
    expect(evaluation.computedGeometry.size).toBe(scale.expectedComputedGeometryCount);
    expect(evaluation.forGroupGeneratedRows ?? []).toHaveLength(scale.expectedGeneratedRowCount);
  });

  it.each(BASELINE_SIZES)("evaluates a forGroup fixture with %i generated rows", (generatedRowCount) => {
    const { source, scale } = buildForGroupBaselineSource(generatedRowCount);
    const compiled = compileDslDocument(source);
    const document = compileValidDocument(source);
    const evaluation = evaluateElements(document.elements);

    expect(compiled.statements.filter((statement) => statement.kind !== "version")).toHaveLength(scale.statementCount);
    expect(document.elements.filter((element) => element.type === "variable")).toHaveLength(scale.bindingCount);
    expect(document.elements.filter((element) => element.type === "freePoint")).toHaveLength(scale.geometryStatementCount);
    expect(evaluation.errors).toEqual([]);
    expect(evaluation.computedGeometry.size).toBe(scale.expectedComputedGeometryCount);
    expect(evaluation.forGroupGeneratedRows ?? []).toHaveLength(scale.generatedRowCount);
  });
});
