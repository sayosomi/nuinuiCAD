import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel, type LastGoodDslDocument } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import { evaluateElements, type EvaluateElementsOptions } from "../geometry/evaluate";
import { buildNumericBindingRuntimeEntries } from "../geometry/numericBindingRuntime";
import { activePrintLayout, resolvePrintLayout } from "./printLayout";
import { evaluatePrintLayoutTypedNumericBinding } from "./printLayoutNumericBindingRuntime";

const compile = (source: string): LastGoodDslDocument => {
  const result = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 4), source);
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
      byKey: compiled.statementMap.byKey,
      bindingVersions: compiled.bindingVersions
    }
  });
  return resolved.scale;
};

describe("resolvePrintLayout: typed const/let binding materialization (Task 53)", () => {
  it("evaluates ref-free arithmetic in printLayout header numeric fields", () => {
    const compiled = compile([
      "nui 4",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2 ^ 3, rows: 5 % 3, overlap: 2 ^ -2, scale: 2 ^ -2, canvas: (2 ^ 3, 5 % 3)) {",
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
        byKey: compiled.statementMap.byKey,
        bindingVersions: compiled.bindingVersions
      }
    });

    expect(resolved).toMatchObject({ columns: 8, rows: 2, overlapMm: 0.25, scale: 0.25, svgCanvasWidthMm: 8, svgCanvasHeightMm: 2 });
  });

  it("evaluates ref-free arithmetic in place coordinates and angle", () => {
    const compiled = compile([
      "nui 4",
      "point Origin = coordinate(x: 0, y: 0)",
      "group G (printEnabled: true, printAnchor: @Origin) {",
      "  point A = coordinate(x: 0, y: 0)",
      "}",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: 1, canvas: (410, 584)) {",
      "  place @G(x: 2 ^ 3, y: 5 % 3, angle: 2 ^ -2, mirrorX: false)",
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
        byKey: compiled.statementMap.byKey,
        bindingVersions: compiled.bindingVersions
      }
    });

    expect(resolved.placements[0]).toMatchObject({ x: 8, y: 2, angleDeg: 0.25 });
  });

  it("evaluates typed binding plus arithmetic in a place angle", () => {
    const compiled = compile([
      "nui 4",
      "const base: number = 2",
      "group G {",
      "  point A = coordinate(x: 0, y: 0)",
      "}",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: 1, canvas: (410, 584)) {",
      "  place @G(x: 0, y: 0, angle: @base ^ 5, mirrorX: false)",
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
        byKey: compiled.statementMap.byKey,
        bindingVersions: compiled.bindingVersions
      }
    });

    expect(resolved.placements[0].angleDeg).toBe(32);
  });

  it("evaluates printLayout-local bindings after a preceding stop and moves place coordinates", () => {
    const compileWithMargin = (margin: number) => compile([
      "nui 4",
      "point Origin = coordinate(x: 0, y: 0)",
      "group Pattern (printEnabled: true, printAnchor: @Origin) {",
      "  point B = coordinate(x: 100, y: 0)",
      "  point C = coordinate(x: 100, y: 50)",
      "  line AB = segment(start: @Origin, end: @B)",
      "  line BC = segment(start: @B, end: @C)",
      "}",
      "stop",
      "printLayout A4 (width: 210, height: 297) {",
      `  const margin: number = ${margin}`,
      "  place @Pattern(x: @margin, y: @margin, angle: 0, mirrorX: false)",
      "}"
    ].join("\n"));

    const resolvedPlacement = (margin: number) => {
      const compiled = compileWithMargin(margin);
      const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
      const layout = activePrintLayout(compiled.document.printLayouts, compiled.document.activePrintLayoutId);
      return resolvePrintLayout({
        layout,
        elements: compiled.document.elements,
        evaluation,
        numericBindingLookup: {
          numericBindings: compiled.numericBindings ?? new Map(),
          byKey: compiled.statementMap.byKey,
          bindingVersions: compiled.bindingVersions
        }
      }).placements[0];
    };

    const compiled = compileWithMargin(10);
    const localBinding = compiled.scalarProgram?.statements.find(
      (statement) => statement.sourceOrder > (compiled.scalarProgram?.evaluationLimitSourceOrder ?? -1)
    );
    const placeXBinding = [...(compiled.numericBindings?.values() ?? [])]
      .find((binding) => binding.parameterKey === "x");
    expect(localBinding).toBeDefined();
    expect(compiled.scalarProgram?.postStopBindingIds).toEqual([localBinding!.bindingId]);
    expect(placeXBinding?.references[0].bindingId).toBe(localBinding!.bindingId);

    expect(resolvedPlacement(10)).toMatchObject({ x: 10, y: 10 });
    expect(resolvedPlacement(30)).toMatchObject({ x: 30, y: 30 });
  });

  it("evaluates printLayout-local let/set bindings after a preceding stop", () => {
    const compiled = compile([
      "nui 4",
      "group Pattern {",
      "  point Origin = coordinate(x: 0, y: 0)",
      "}",
      "stop",
      "printLayout A4 (width: 210, height: 297) {",
      "  let margin: number = 10",
      "  set margin = 30",
      "  place @Pattern(x: @margin, y: @margin, angle: 0, mirrorX: false)",
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
        byKey: compiled.statementMap.byKey,
        bindingVersions: compiled.bindingVersions
      }
    });

    expect(resolved.placements[0]).toMatchObject({ x: 30, y: 30 });
  });

  it("resolves a typed const number reference in scale", () => {
    const compiled = compile([
      "nui 4",
      "const printScale: number = 2.5",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: @printScale, canvas: (410, 584)) {",
      "}"
    ].join("\n"));
    expect(resolveScale(compiled)).toBe(2.5);
  });

  it("resolves a typed let reassigned via set to its terminal value (Task 53 binding version semantics)", () => {
    const compiled = compile([
      "nui 4",
      "let v: number = 1",
      "set v = 3",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: @v, canvas: (410, 584)) {",
      "}"
    ].join("\n"));
    const scaleBinding = compiled.numericBindings?.get("3:scale");
    expect(scaleBinding?.typedExpression).toBeDefined();
    expect(resolveScale(compiled)).toBe(3);
  });

  it("matches the value an element numeric parameter sees for the same let+set binding", () => {
    const compiled = compile([
      "nui 4",
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
      "nui 4",
      "const ang: number = 30",
      "group G {",
      "  point A = coordinate(x: 0, y: 0)",
      "}",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: 1, canvas: (410, 584)) {",
      "  place @G(at: (0, 0), angle: @ang, mirrorX: false)",
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
        byKey: compiled.statementMap.byKey,
        bindingVersions: compiled.bindingVersions
      }
    });
    expect(resolved.placements[0].angleDeg).toBe(30);
  });

  it("evaluates geometry property arithmetic in a printLayout field", () => {
    const compiled = compile([
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: @AB.length % 6, canvas: (410, 584)) {",
      "}"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(resolveScale(compiled)).toBe(4);
    expect(compiled.numericBindings?.get("4:scale")?.typedExpression).toBeDefined();
    expect(evaluation.computedGeometry.get(compiled.document.elements[2].id)).toMatchObject({ kind: "line" });
  });

  it("returns typed remainder-by-zero and uses field fallback without legacy retry", () => {
    const compiled = compile([
      "nui 4",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: 5 % 0, canvas: (410, 584)) {",
      "}"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    const layout = activePrintLayout(compiled.document.printLayouts, compiled.document.activePrintLayoutId);
    const lookup = {
      numericBindings: compiled.numericBindings ?? new Map(),
      byKey: compiled.statementMap.byKey,
      bindingVersions: compiled.bindingVersions
    };
    const binding = compiled.numericBindings?.get("1:scale");
    expect(binding?.typedExpression).toBeDefined();
    expect(evaluatePrintLayoutTypedNumericBinding(binding!, evaluation, lookup, 1)).toMatchObject({
      status: "error",
      issueCode: "evaluation-remainder-by-zero"
    });
    expect(resolvePrintLayout({ layout, elements: compiled.document.elements, evaluation, numericBindingLookup: lookup }).scale).toBe(1);
  });

  it("keeps the typed binding reference and its resolved value across a save -> reopen round-trip", () => {
    const original = [
      "nui 4",
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
      "nui 4",
      "const printScale: number = 2.5",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: @printScale, canvas: (410, 584)) {",
      "}"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    const layout = activePrintLayout(compiled.document.printLayouts, compiled.document.activePrintLayoutId);
    const resolved = resolvePrintLayout({ layout, elements: compiled.document.elements, evaluation });
    // Unmaterialized `@printScale` isn't a recognized local variable, so the
    // legacy evaluator fails && the field falls back to its literal default.
    expect(resolved.scale).toBe(1);
  });
});
