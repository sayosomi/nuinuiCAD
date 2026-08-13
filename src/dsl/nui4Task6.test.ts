import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel, type LastGoodDslDocument } from "../document/canonicalDocument";
import { serializeDocumentToDsl } from "./dslDocument";
import { dslStatementKeywordCompletions, parseDsl } from "./dslParser";
import { emptyDocument } from "./dslDocumentTestUtils";
import { evaluateElements } from "../geometry/evaluate";
import { buildNumericBindingRuntimeEntries } from "../geometry/numericBindingRuntime";
import { activePrintLayout, resolvePrintLayout } from "../print/printLayout";
import { printLayoutTypedBindingReferenceOptions } from "../scalars/printLayoutTypedBindingCandidates";
import { scanTextTemplateLiteral } from "../scalars/textTemplateScan";

const compileValue = (source: string) => {
  const result = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 4), source);
  if (result.status === "fatal") throw new Error(JSON.stringify(result.diagnostics));
  return result;
};

const compile = (source: string): LastGoodDslDocument => compileValue(source).doc;

const evaluationOptions = (compiled: LastGoodDslDocument) => ({
  scalarProgram: compiled.scalarProgram,
  bindingVersions: compiled.bindingVersions,
  statementInfoByElementId: compiled.statementMap.byElementId,
  statementIdByStatementIndex: compiled.statementMap.statementIdByStatementIndex,
  numericBindingEntries: buildNumericBindingRuntimeEntries({
    numericBindings: compiled.numericBindings ?? new Map(),
    elementIdByStatementIndex: compiled.statementMap.elementIdByStatementIndex
  }, compiled.document.elements)
});

describe("nui4 Task 6 syntax lowering and lexical behavior", () => {
  it("parses unnamed if, range for, bare stop, and keeps control names empty", () => {
    const parsed = parseDsl([
      "nui 4",
      "if (@condition) {",
      "}",
      "for i in range(from: 0, count: 5, step: 1) {",
      "}",
      "stop"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements.filter((statement) => statement.kind === "element").map((statement) => statement.name)).toEqual(["", ""]);
    const loop = parsed.statements.find((statement) => statement.kind === "element" && statement.type === "forGroup");
    expect(loop?.attrs.find((attribute) => attribute.key === "variable")?.value).toBe("i");
    expect(parsed.statements.at(-1)?.kind).toBe("atStop");
    expect(dslStatementKeywordCompletions).toContain("stop");
    expect(dslStatementKeywordCompletions).not.toContain("@stop");
  });

  it("uses ${...} holes while ordinary braces remain literal", () => {
    const source = '"literal { braces } and ${@value}"';
    const result = scanTextTemplateLiteral(source, { start: 0, end: source.length });
    expect(result.kind).toBe("string");
    if (result.kind !== "string") return;
    expect(result.segments).toEqual([
      expect.objectContaining({ kind: "literal", cooked: "literal { braces } and " }),
      expect.objectContaining({ kind: "hole", contentSpan: { start: 26, end: 32 } })
    ]);
  });

  it("connects canonical interpolation to the existing typed template AST", () => {
    const compiled = compile([
      "nui 4",
      'const label: string = "縫い代"',
      'text T = label(text: "縫い代 ${@label} mm", anchor: none, size: 3)'
    ].join("\n"));
    const template = compiled.textTemplates ? [...compiled.textTemplates.values()][0] : undefined;
    expect(template?.segments.filter((segment) => segment.kind === "hole")).toHaveLength(1);
    expect(template?.segments.find((segment) => segment.kind === "hole")).toMatchObject({
      contentSpan: expect.objectContaining({ start: expect.any(Number), end: expect.any(Number) })
    });
    const serialized = serializeDocumentToDsl(compiled.document, 4);
    expect(serialized).toContain("${@label}");
    expect(serialized).not.toContain('text: "${@label}');
  });

  it("does not turn escaped literal braces into interpolation while regenerating text", () => {
    const compiled = compile([
      "nui 4",
      'text T = label(text: "literal \\{@notAReference\\}", anchor: none, size: 3)'
    ].join("\n"));
    const serialized = serializeDocumentToDsl(compiled.document, 4);
    expect(serialized).toContain('text: "literal \\\\{@notAReference\\\\}"');
    expect(serialized).not.toContain("${@notAReference}");
  });

  it("evaluates printLayout locals through the shared scalar and numeric binding path", () => {
    const compiled = compile([
      "nui 4",
      "group G {",
      "}",
      "printLayout A4(",
      "  width: 210,",
      "  height: 297,",
      ") {",
      "  const margin: number = 10",
      "  let offset: number = @margin + 5",
      "  place @G(x: @offset, y: @margin, angle: 0, mirrorX: false)",
      "}"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, evaluationOptions(compiled));
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
    expect(resolved.svgCanvasWidthMm).toBe(210);
    expect(resolved.svgCanvasHeightMm).toBe(297);
    expect(resolved.placements[0]).toMatchObject({ x: 15, y: 10 });
    expect([...compiled.bindingAnalysis!.catalog.scopeIndex.scopes.values()].some((scope) => scope.kind === "printLayout")).toBe(true);
  });

  it("keeps printLayout binding candidates source-ordered and scoped to the body", () => {
    const compiled = compile([
      "nui 4",
      "const outer: number = 1",
      "group G {",
      "  point Anchor = coordinate(x: 0, y: 0)",
      "}",
      "printLayout A4(width: 210, height: 297) {",
      "  const margin: number = 10",
      "  place @G(x: @margin, y: @outer, angle: 0, mirrorX: false)",
      "  const later: number = 20",
      "}"
    ].join("\n"));
    const layoutId = compiled.document.printLayouts[0].id;
    const layoutInfo = compiled.statementMap.byKey.get(`printLayout:${layoutId}`);
    const placeInfo = compiled.statementMap.byKey.get(`place:${layoutId}:0`);
    expect(layoutInfo).toBeDefined();
    expect(placeInfo).toBeDefined();
    const headerOptions = printLayoutTypedBindingReferenceOptions(
      layoutId,
      compiled.statementMap.byKey,
      compiled.bindingAnalysis
    ).map((option) => option.expression);
    const placeOptions = printLayoutTypedBindingReferenceOptions(
      layoutId,
      compiled.statementMap.byKey,
      compiled.bindingAnalysis,
      placeInfo!.statementIndex
    ).map((option) => option.expression);
    expect(headerOptions).toContain("@outer");
    expect(headerOptions).not.toContain("@margin");
    expect(headerOptions).not.toContain("@later");
    expect(placeOptions).toEqual(expect.arrayContaining(["@outer", "@margin"]));
    expect(placeOptions).not.toContain("@later");
  });

  it("allows locals in every printLayout without leaking same-named bindings across scopes", () => {
    const compiled = compile([
      "nui 4",
      "group G {",
      "}",
      "printLayout A4(",
      "  width: 210,",
      "  height: 297,",
      ") {",
      "  const margin: number = 10",
      "  place @G(x: @margin, y: 0, angle: 0, mirrorX: false)",
      "}",
      "printLayout A3(",
      "  width: 297,",
      "  height: 420,",
      ") {",
      "  const margin: number = 20",
      "  place @G(x: @margin, y: 0, angle: 0, mirrorX: false)",
      "}"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, evaluationOptions(compiled));
    const resolved = compiled.document.printLayouts.map((layout) => resolvePrintLayout({
      layout,
      elements: compiled.document.elements,
      evaluation,
      numericBindingLookup: {
        numericBindings: compiled.numericBindings ?? new Map(),
        byKey: compiled.statementMap.byKey,
        bindingVersions: compiled.bindingVersions
      }
    }));
    expect(resolved.map((layout) => layout.placements[0]?.x)).toEqual([10, 20]);
    const margins = [...compiled.bindingAnalysis!.catalog.bindings].filter((binding) => binding.name === "margin");
    expect(margins).toHaveLength(2);
    expect(new Set(margins.map((binding) => binding.effectiveScopeId)).size).toBe(2);
  });

  it("allows let/set/place in printLayout and uses the updated value", () => {
    const compiled = compile([
      "nui 4",
      "group G {",
      "}",
      "printLayout A4(width: 210, height: 297) {",
      "  let margin: number = 10",
      "  set margin = 20",
      "  place @G(x: @margin, y: 0, angle: 0, mirrorX: false)",
      "}"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, evaluationOptions(compiled));
    const resolved = resolvePrintLayout({
      layout: compiled.document.printLayouts[0],
      elements: compiled.document.elements,
      evaluation,
      numericBindingLookup: {
        numericBindings: compiled.numericBindings ?? new Map(),
        byKey: compiled.statementMap.byKey,
        bindingVersions: compiled.bindingVersions
      }
    });
    expect(resolved.placements[0]?.x).toBe(20);
  });

  it("evaluates printLayout let/set/place in source order", () => {
    const compiled = compile([
      "nui 4",
      "group G {",
      "}",
      "printLayout A4(width: 210, height: 297) {",
      "  let margin: number = 10",
      "  place @G(x: @margin, y: 0, angle: 0, mirrorX: false)",
      "  set margin = 20",
      "  place @G(x: @margin, y: 0, angle: 0, mirrorX: false)",
      "}"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, evaluationOptions(compiled));
    const resolved = resolvePrintLayout({
      layout: compiled.document.printLayouts[0],
      elements: compiled.document.elements,
      evaluation,
      numericBindingLookup: {
        numericBindings: compiled.numericBindings ?? new Map(),
        byKey: compiled.statementMap.byKey,
        bindingVersions: compiled.bindingVersions
      }
    });
    expect(resolved.placements.map((placement) => placement.x)).toEqual([10, 20]);
  });

  it("continues rejecting arbitrary geometry statements inside printLayout", () => {
    const result = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 4), [
      "nui 4",
      "printLayout A4(width: 210, height: 297) {",
      "  point P = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n"));
    expect(result.status).toBe("fatal");
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error" && diagnostic.message.includes("printLayout"))).toBe(true);
  });

  it("keeps for iteration bindings immutable and body-only while allowing prior outer range bindings", () => {
    const compiled = compile([
      "nui 4",
      "const start: number = 1",
      "for i in range(from: @start, count: 2, step: 1) {",
      "  point P = coordinate(x: @i, y: 0)",
      "}"
    ].join("\n"));
    const loopIndex = compiled.statements.findIndex((statement) => statement.kind === "element" && statement.type === "forGroup");
    const iteration = [...compiled.bindingAnalysis!.catalog.bindings].find(
      (binding) => binding.kind === "iteration" && binding.statementIndex === loopIndex
    );
    expect(iteration).toMatchObject({ name: "i", mutability: "readonly", declaredType: null });
    const bodyPointIndex = compiled.statements.findIndex((statement) => statement.kind === "element" && statement.name === "P");
    expect(compiled.bindingAnalysis!.catalog.scopeIndex.scopeOfStatement.get(bodyPointIndex)).toBe(`for:${compiled.statementMap.statementIdByStatementIndex!.get(loopIndex)}`);
    expect(compiled.bindingAnalysis!.catalog.scopeIndex.scopeOfStatement.get(loopIndex)).toBe("root");
  });

  it("keeps control statement identities across source edits without deriving them from user-visible names", () => {
    const source = [
      "nui 4",
      "const condition: boolean = true",
      "if (@condition) {",
      "  point A = coordinate(x: 0, y: 0)",
      "}",
      "for i in range(from: 0, count: 2, step: 1) {",
      "  point B = coordinate(x: @i, y: 0)",
      "}"
    ].join("\n");
    const firstValue = compileValue(source);
    const first = firstValue.doc;
    const edited = compileCanonicalText(firstValue, source.replace("x: 0, y: 0", "x: 1, y: 0"));
    expect(edited.status).not.toBe("fatal");
    const firstControls = first.statements
      .map((statement, index) => ({ statement, index }))
      .filter(({ statement }) => statement.kind === "element" && (statement.type === "conditionalGroup" || statement.type === "forGroup"));
    const editedControls = edited.doc.statements
      .map((statement, index) => ({ statement, index }))
      .filter(({ statement }) => statement.kind === "element" && (statement.type === "conditionalGroup" || statement.type === "forGroup"));
    expect(firstControls.map(({ statement }) => statement.name)).toEqual(["", ""]);
    expect(editedControls.map(({ statement }) => statement.name)).toEqual(["", ""]);
    expect(editedControls.map(({ index }) => edited.doc.statementMap.statementIdByStatementIndex!.get(index))).toEqual(
      firstControls.map(({ index }) => first.statementMap.statementIdByStatementIndex!.get(index))
    );
  });

  it("regenerates unnamed controls and bare stop without inventing user names", () => {
    const compiled = compile([
      "nui 4",
      "const condition: boolean = true",
      "if (@condition) {",
      "}",
      "for i in range(from: 0, count: 2, step: 1) {",
      "}",
      "stop"
    ].join("\n"));
    const serialized = serializeDocumentToDsl(compiled.document, 4);
    expect(serialized).toContain("if (@condition) {");
    expect(serialized).toContain("for i in range(from: 0, count: 2, step: 1) {");
    expect(serialized).toContain("stop");
    expect(serialized).not.toContain("if ifブロック");
    expect(serialized).not.toContain("for forブロック");
  });
});
