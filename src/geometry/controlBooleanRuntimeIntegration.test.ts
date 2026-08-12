// End-to-end coverage for Task 25: compiles real nui 3 source through the
// production document pipeline, builds the elementId-keyed control-boolean
// entries/condition map, and evaluates through evaluateElements - proving
// the whole compile -> build -> resolve -> evaluate path works together for
// both conditionalGroup.condition and forGroup.showGenerated.

import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel, type LastGoodDslDocument } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import { evaluateElements } from "./evaluate";
import {
  buildConditionalGroupConditionsByElementId,
  buildControlBooleanRuntimeEntries
} from "./controlBooleanRuntime";

const compileCanonical = (source: string): LastGoodDslDocument => {
  const baseline = regenerateCanonicalFromModel(emptyDocument(), 3);
  const result = compileCanonicalText(baseline, source);
  expect(result.status).not.toBe("fatal");
  return result.doc;
};

const idByName = (compiled: LastGoodDslDocument, name: string): string => {
  const element = compiled.document.elements.find((candidate) => candidate.name === name);
  if (!element) throw new Error(`no element named "${name}" in compiled document`);
  return element.id;
};

const optionsFor = (compiled: LastGoodDslDocument) => ({
  scalarProgram: compiled.scalarProgram,
  controlBooleanEntries: buildControlBooleanRuntimeEntries(
    { propertyBindings: compiled.propertyBindings ?? new Map(), elementIdByStatementIndex: compiled.statementMap.elementIdByStatementIndex },
    compiled.document.elements
  ),
  conditionalGroupConditionsByElementId: buildConditionalGroupConditionsByElementId(
    compiled.conditionalGroupConditions ?? new Map(),
    compiled.statementMap.elementIdByStatementIndex
  )
});

describe("Task 25 conditionalGroup.condition, end-to-end through the real compiler", () => {
  it("boolean literal condition selects the then branch", () => {
    // A leading unrelated typed declaration is required for scalarAnalysis
    // (and therefore this compiler) to run at all in production wiring.
    const compiled = compileCanonical([
      "nui 3",
      "const _unused: number = 0",
      "if C (true) {",
      "  point A = coordinate(x: 0, y: 0)",
      "} else {",
      "  point B = coordinate(x: 1, y: 1)",
      "}"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.has(idByName(compiled, "A"))).toBe(true);
    expect(result.conditionInactiveElementIds?.has(idByName(compiled, "B"))).toBe(true);
  });

  it("bare boolean binding reference condition selects the correct branch", () => {
    const compiled = compileCanonical([
      "nui 3",
      "let flag: boolean = false",
      "if C (@flag) {",
      "  point A = coordinate(x: 0, y: 0)",
      "} else {",
      "  point B = coordinate(x: 1, y: 1)",
      "}"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.has(idByName(compiled, "B"))).toBe(true);
    expect(result.conditionInactiveElementIds?.has(idByName(compiled, "A"))).toBe(true);
  });

  it("comparison condition (typed number binding) selects the correct branch", () => {
    const compiled = compileCanonical([
      "nui 3",
      "const n: number = 5",
      "if C (@n > 10) {",
      "  point A = coordinate(x: 0, y: 0)",
      "} else {",
      "  point B = coordinate(x: 1, y: 1)",
      "}"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.has(idByName(compiled, "B"))).toBe(true);
    expect(result.conditionInactiveElementIds?.has(idByName(compiled, "A"))).toBe(true);
  });

  it("logical && condition (typed boolean bindings) selects the correct branch", () => {
    const compiled = compileCanonical([
      "nui 3",
      "let a: boolean = true",
      "let b: boolean = false",
      "if C (@a && @b) {",
      "  point A = coordinate(x: 0, y: 0)",
      "} else {",
      "  point B = coordinate(x: 1, y: 1)",
      "}"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.has(idByName(compiled, "B"))).toBe(true);
    expect(result.conditionInactiveElementIds?.has(idByName(compiled, "A"))).toBe(true);
  });

  it("a poisoned typed condition disables both branches (matches legacy poison semantics)", () => {
    const compiled = compileCanonical([
      "nui 3",
      "point Z1 = coordinate(x: 0, y: 0)",
      "point Z2 = coordinate(x: 3, y: 4)",
      "line D = segment(start: @Z1, end: @Z2, state: disabled)",
      "let flag: boolean = @D.length > 0",
      "if C (@flag) {",
      "  point A = coordinate(x: 0, y: 0)",
      "} else {",
      "  point B = coordinate(x: 1, y: 1)",
      "}"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(result.computedGeometry.has(idByName(compiled, "A"))).toBe(false);
    expect(result.computedGeometry.has(idByName(compiled, "B"))).toBe(false);
    expect(result.conditionInactiveElementIds?.has(idByName(compiled, "A"))).toBe(true);
    expect(result.conditionInactiveElementIds?.has(idByName(compiled, "B"))).toBe(true);
  });

  it("a plain legacy numeric condition (no typed declarations at all) is unaffected", () => {
    const compiled = compileCanonical([
      "nui 3",
      "if C (1) {",
      "  point A = coordinate(x: 0, y: 0)",
      "} else {",
      "  point B = coordinate(x: 1, y: 1)",
      "}"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.has(idByName(compiled, "A"))).toBe(true);
    expect(result.conditionInactiveElementIds?.has(idByName(compiled, "B"))).toBe(true);
  });

  it("a typed condition inside a forGroup template resolves the same active branch on every generated iteration", () => {
    const compiled = compileCanonical([
      "nui 3",
      "let flag: boolean = true",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "for 繰返し (i, from: 0, count: 3, step: 1) {",
      "  if C (@flag) {",
      "    line Then = copy(startPoint: @A, endPoint: @B, scale: 1, angleDeg: 0, mirrorX: false, baseLines: [@AB])",
      "  } else {",
      "    line Else = copy(startPoint: @A, endPoint: @B, scale: 1, angleDeg: 0, mirrorX: true, baseLines: [@AB])",
      "  }",
      "}"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(result.errors).toEqual([]);
    // Generated row `elementName` carries an iteration-label prefix (e.g.
    // "[i=0] Then"), so match by templateElementId instead of an exact name.
    const thenTemplateId = idByName(compiled, "Then");
    const elseTemplateId = idByName(compiled, "Else");
    const thenRows = (result.forGroupGeneratedRows ?? []).filter((row) => row.templateElementId === thenTemplateId);
    const elseRows = (result.forGroupGeneratedRows ?? []).filter((row) => row.templateElementId === elseTemplateId);
    expect(thenRows).toHaveLength(3);
    expect(elseRows).toHaveLength(3);
    for (const row of thenRows) expect(result.computedGeometry.has(row.generatedElementId)).toBe(true);
    for (const row of elseRows) {
      expect(result.computedGeometry.has(row.generatedElementId)).toBe(false);
      expect(result.conditionInactiveElementIds?.has(row.generatedElementId)).toBe(true);
    }
  });
});

describe("Task 25 forGroup.showGenerated, end-to-end through the real compiler", () => {
  it("showGenerated: false (literal) never affects iteration count or generated rows", () => {
    const compiled = compileCanonical([
      "nui 3",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "for 繰返し (i, from: 0, count: 3, step: 1, showGenerated: false) {",
      "  line C = copy(startPoint: @A, endPoint: @B, scale: 1, angleDeg: 0, mirrorX: false, baseLines: [@AB])",
      "}"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(result.errors).toEqual([]);
    expect(result.forGroupGeneratedRows).toHaveLength(3);
    expect(result.forGroupEffectiveShowGeneratedIds?.has(idByName(compiled, "繰返し"))).toBe(false);
  });

  it("showGenerated: false (bound to a typed boolean binding) never affects iteration count or generated rows", () => {
    const compiled = compileCanonical([
      "nui 3",
      "let 表示: boolean = false",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "for 繰返し (i, from: 0, count: 3, step: 1, showGenerated: @表示) {",
      "  line C = copy(startPoint: @A, endPoint: @B, scale: 1, angleDeg: 0, mirrorX: false, baseLines: [@AB])",
      "}"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(result.errors).toEqual([]);
    const loopId = idByName(compiled, "繰返し");
    const copyId = idByName(compiled, "C");
    const rows = result.forGroupGeneratedRows ?? [];
    expect(rows).toHaveLength(3);
    expect(result.forGroupEffectiveShowGeneratedIds?.has(loopId)).toBe(false);
    for (const row of rows) {
      expect(result.computedGeometry.has(row.generatedElementId)).toBe(true);
      expect(result.effectiveVisibleElementIds?.has(row.generatedElementId)).toBe(false);
      expect(row.templateElementId).toBe(copyId);
    }
  });

  it("showGenerated: true (bound) is reflected in forGroupEffectiveShowGeneratedIds without affecting rows", () => {
    const compiled = compileCanonical([
      "nui 3",
      "let 表示: boolean = true",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "for 繰返し (i, from: 0, count: 3, step: 1, showGenerated: @表示) {",
      "  line C = copy(startPoint: @A, endPoint: @B, scale: 1, angleDeg: 0, mirrorX: false, baseLines: [@AB])",
      "}"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(result.errors).toEqual([]);
    expect(result.forGroupGeneratedRows).toHaveLength(3);
    expect(result.forGroupEffectiveShowGeneratedIds?.has(idByName(compiled, "繰返し"))).toBe(true);
  });

  it("an outer hidden loop removes every nested generated descendant from the draw mask", () => {
    const compiled = compileCanonical([
      "nui 3",
      "let outerShown: boolean = false",
      "let innerShown: boolean = true",
      "for Outer (i, from: 0, count: 2, step: 1, showGenerated: @outerShown) {",
      "  for Inner (j, from: 0, count: 2, step: 1, showGenerated: @innerShown) {",
      "    point P = coordinate(x: 10, y: 20)",
      "  }",
      "}"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    const outerId = idByName(compiled, "Outer");
    const pointId = idByName(compiled, "P");
    const pointRows = (result.forGroupGeneratedRows ?? []).filter((row) => row.templateElementId === pointId);

    expect(result.errors).toEqual([]);
    expect(pointRows.length).toBeGreaterThan(0);
    expect(result.forGroupEffectiveShowGeneratedIds?.has(outerId)).toBe(false);
    for (const row of pointRows) {
      expect(result.computedGeometry.has(row.generatedElementId)).toBe(true);
      expect(result.effectiveEnabledElementIds?.has(row.generatedElementId)).toBe(true);
      expect(result.effectiveVisibleElementIds?.has(row.generatedElementId)).toBe(false);
    }
  });

  it("a poisoned showGenerated binding fails closed to hidden without affecting iteration/rows", () => {
    const compiled = compileCanonical([
      "nui 3",
      "point Z1 = coordinate(x: 0, y: 0)",
      "point Z2 = coordinate(x: 3, y: 4)",
      "line D = segment(start: @Z1, end: @Z2, state: disabled)",
      "let 表示: boolean = @D.length > 0",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "for 繰返し (i, from: 0, count: 3, step: 1, showGenerated: @表示) {",
      "  line C = copy(startPoint: @A, endPoint: @B, scale: 1, angleDeg: 0, mirrorX: false, baseLines: [@AB])",
      "}"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(result.forGroupGeneratedRows).toHaveLength(3);
    expect(result.forGroupEffectiveShowGeneratedIds?.has(idByName(compiled, "繰返し"))).toBe(false);
  });
});
