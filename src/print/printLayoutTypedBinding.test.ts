import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel, type LastGoodDslDocument } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import { evaluateElements, type EvaluateElementsOptions } from "../geometry/evaluate";
import { buildNumericBindingRuntimeEntries } from "../geometry/numericBindingRuntime";
import { activePrintLayout, resolvePrintLayout } from "./printLayout";

const compile = (source: string): LastGoodDslDocument => {
  const result = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 3), source);
  if (result.status === "fatal") throw new Error(JSON.stringify(result.diagnostics));
  return result.doc;
};

const optionsFor = (compiled: LastGoodDslDocument): EvaluateElementsOptions => ({
  scalarProgram: compiled.scalarProgram,
  bindingVersions: compiled.bindingVersions,
  statementInfoByElementId: compiled.statementMap.byElementId,
  statementIdByStatementIndex: compiled.statementMap.statementIdByStatementIndex,
  numericBindingEntries: buildNumericBindingRuntimeEntries({
    numericBindings: compiled.numericBindings ?? new Map(),
    elementIdByStatementIndex: compiled.statementMap.elementIdByStatementIndex
  }, compiled.document.elements)
});

const resolveScale = (compiled: LastGoodDslDocument) => {
  const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
  const layout = activePrintLayout(compiled.document.printLayouts, compiled.document.activePrintLayoutId);
  const resolved = resolvePrintLayout({
    layout,
    elements: compiled.document.elements,
    evaluation,
    numericBindingLookup: {
      numericBindings: compiled.numericBindings ?? new Map(),
      byKey: compiled.statementMap.byKey
    }
  });
  return resolved.scale;
};

describe("resolvePrintLayout: typed const/let binding materialization (Task 53)", () => {
  it("resolves a typed const number reference in scale", () => {
    const compiled = compile([
      "nui 3",
      "const printScale: number = 2.5",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: @printScale, canvas: (410, 584)) {",
      "}"
    ].join("\n"));
    expect(resolveScale(compiled)).toBe(2.5);
  });

  it("resolves a typed let reassigned via set to its terminal value (Task 53 binding version semantics)", () => {
    const compiled = compile([
      "nui 3",
      "let v: number = 1",
      "set v = 3",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: @v, canvas: (410, 584)) {",
      "}"
    ].join("\n"));
    expect(resolveScale(compiled)).toBe(3);
  });

  it("matches the value an element numeric parameter sees for the same let+set binding", () => {
    const compiled = compile([
      "nui 3",
      "let v: number = 1",
      "set v = 3",
      "point A = coordinate(x: @v, y: 0)",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: @v, canvas: (410, 584)) {",
      "}"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    const point = compiled.document.elements.find((element) => element.name === "A");
    const geometry = evaluation.computedGeometry.get(point!.id) as { x: number };
    expect(resolveScale(compiled)).toBe(geometry.x);
    expect(resolveScale(compiled)).toBe(3);
  });

  it("resolves place's angle/at against a typed binding", () => {
    const compiled = compile([
      "nui 3",
      "const ang: number = 30",
      "group G {",
      "  point A = coordinate(x: 0, y: 0)",
      "}",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: 1, canvas: (410, 584)) {",
      "  place G (at: (0, 0), angle: @ang, mirrorX: false)",
      "}"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    const layout = activePrintLayout(compiled.document.printLayouts, compiled.document.activePrintLayoutId);
    const resolved = resolvePrintLayout({
      layout,
      elements: compiled.document.elements,
      evaluation,
      numericBindingLookup: {
        numericBindings: compiled.numericBindings ?? new Map(),
        byKey: compiled.statementMap.byKey
      }
    });
    expect(resolved.placements[0].angleDeg).toBe(30);
  });

  it("keeps the typed binding reference and its resolved value across a save -> reopen round-trip", () => {
    const original = [
      "nui 3",
      "const printScale: number = 2.5",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: @printScale, canvas: (410, 584)) {",
      "}"
    ].join("\n");
    const compiled = compile(original);
    expect(resolveScale(compiled)).toBe(2.5);

    // The persisted document is the canonical `sourceText` itself (AGENTS.md:
    // "sourceText is the canonical, durable state" - never a whole-file
    // `serializeDocumentToDsl` reserialization, which doesn't even round-trip
    // typed declarations since they aren't part of `DslDocumentData`). "Save"
    // writes `sourceText` (here, the already-canonical `original` the store
    // would hold verbatim after a first commit) to disk; "reopen" re-compiles
    // that exact text fresh.
    expect(original).toContain("@printScale");

    const reopened = compile(original);
    expect(reopened.document.printLayouts[0].scale).toEqual({ kind: "expression", expression: "@printScale" });
    expect(resolveScale(reopened)).toBe(2.5);
  });

  it("falls back to the literal default when the numericBindingLookup is omitted", () => {
    const compiled = compile([
      "nui 3",
      "const printScale: number = 2.5",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: @printScale, canvas: (410, 584)) {",
      "}"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    const layout = activePrintLayout(compiled.document.printLayouts, compiled.document.activePrintLayoutId);
    const resolved = resolvePrintLayout({ layout, elements: compiled.document.elements, evaluation });
    // Unmaterialized `@printScale` isn't a recognized local variable, so the
    // legacy evaluator fails and the field falls back to its literal default.
    expect(resolved.scale).toBe(1);
  });
});
