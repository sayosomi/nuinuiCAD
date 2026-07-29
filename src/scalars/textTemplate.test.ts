import { describe, expect, it } from "vitest";
import { compileDslToElements } from "../dsl/dslCompiler";
import { parseDsl } from "../dsl/dslParser";
import type { DiagnosticSpanContext } from "../dsl/dslDiagnosticSpan";
import type { CadElement, ElementId } from "../types/geometry";
import type { BindingAnalysis } from "./bindingAnalysis";
import type { ScalarSpan } from "./literalScanner";
import { scanTextTemplateLiteral } from "./textTemplateScan";
import {
  compileTextTemplates,
  TEXT_TEMPLATE_HOLE_INVALID_CODE,
  TEXT_TEMPLATE_HOLE_LEGACY_REFERENCE_CODE,
  TEXT_TEMPLATE_HOLE_TYPE_MISMATCH_CODE,
  TEXT_TEMPLATE_HOLE_UNRESOLVED_CODE,
  type TextTemplateAst,
  type TextTemplateHoleSegment
} from "./textTemplate";
import { propertyBindingOccurrenceKey } from "./propertyBindingCompiler";
import { analyzeTypedDeclarations } from "./typedDeclarationAnalysis";

const fullSpan = (source: string): ScalarSpan => ({ start: 0, end: source.length });

/** Mirrors propertyBindingCompiler.test.ts's own harness - the same shapes
 * production actually produces, not a lighter reinvented one. */
const compileFor = (
  source: string
): {
  statements: ReturnType<typeof parseDsl>["statements"];
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
  elements: readonly CadElement[];
  bindingAnalysis: BindingAnalysis;
  spans: DiagnosticSpanContext;
} => {
  const parsed = parseDsl(source);
  expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  const statements = parsed.statements;
  const spans: DiagnosticSpanContext = { sourceMap: parsed.sourceMap, logicalStatementByRangeFrom: parsed.logicalStatementByRangeFrom };
  const compiled = compileDslToElements(source, { elements: [], mode: "document", majorVersion: 3 });
  expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  const elementIdByStatementIndex = compiled.elementIdsByStatementIndex ?? new Map();
  const stableStatementIdByIndex = new Map<number, string>(statements.map((_, index) => [index, `stable-${index}`]));
  for (const [statementIndex, elementId] of elementIdByStatementIndex) stableStatementIdByIndex.set(statementIndex, elementId);
  const scalarAnalysisCompilation = analyzeTypedDeclarations({
    statements,
    stableStatementIdByIndex,
    reconciledContainers: { elementIdByStatementIndex, elements: compiled.elements },
    spans
  });
  expect(scalarAnalysisCompilation.diagnostics).toEqual([]);
  return {
    statements,
    elementIdByStatementIndex,
    elements: compiled.elements,
    bindingAnalysis: scalarAnalysisCompilation.analysis!.bindingAnalysis,
    spans
  };
};

const compileTemplatesFor = (source: string) => {
  const compiled = compileFor(source);
  return compileTextTemplates(compiled);
};

const holeAt = (template: TextTemplateAst, index: number): TextTemplateHoleSegment =>
  template.segments.filter((segment) => segment.kind === "hole")[index] as TextTemplateHoleSegment;

describe("scanTextTemplateLiteral", () => {
  it("plain text with no holes is a single literal segment", () => {
    const source = '"Cut 1 piece"';
    const result = scanTextTemplateLiteral(source, fullSpan(source));
    if (result.kind !== "string") throw new Error("expected string");
    expect(result.segments).toEqual([
      { kind: "literal", span: { start: 1, end: 12 }, cookedRange: { start: 0, end: 11 }, cooked: "Cut 1 piece" }
    ]);
  });

  it("distinguishes escaped braces from hole delimiters in one pass", () => {
    const source = '"cost \\{5\\} yen {@a}"';
    const result = scanTextTemplateLiteral(source, fullSpan(source));
    if (result.kind !== "string") throw new Error("expected string");
    expect(result.segments[0]).toMatchObject({ kind: "literal", cooked: "cost {5} yen " });
    expect(result.segments[1]).toMatchObject({ kind: "hole" });
  });

  it("all 8 escapes cook correctly and advance cookedRange by cooked length", () => {
    const source = '"\\\\ \\" \\\' \\n \\r \\t \\{ \\}"';
    const result = scanTextTemplateLiteral(source, fullSpan(source));
    if (result.kind !== "string") throw new Error("expected string");
    expect(result.segments).toHaveLength(1);
    const literal = result.segments[0];
    if (literal.kind !== "literal") throw new Error("expected literal");
    expect(literal.cooked).toBe("\\ \" ' \n \r \t { }");
    expect(literal.cookedRange).toEqual({ start: 0, end: literal.cooked.length });
    expect(literal.span.end - literal.span.start).toBeGreaterThan(literal.cooked.length);
  });

  it("hole cookedInsertOffset accounts for escape-shortened cooked text before it", () => {
    const source = '"\\n{@a}"'; // raw "\n{@a}" - 2 raw chars before hole, 1 cooked char
    const result = scanTextTemplateLiteral(source, fullSpan(source));
    if (result.kind !== "string") throw new Error("expected string");
    const hole = result.segments.find((segment) => segment.kind === "hole");
    if (!hole || hole.kind !== "hole") throw new Error("expected hole");
    expect(hole.cookedInsertOffset).toBe(1);
  });

  it("unclosed hole is unterminated-interpolation", () => {
    const source = '"prefix {@a"';
    const result = scanTextTemplateLiteral(source, fullSpan(source));
    expect(result).toMatchObject({ kind: "error", issueCode: "unterminated-interpolation" });
  });

  it("nested unescaped brace is interpolation-nested-not-supported", () => {
    const source = '"{@a {@b}}"';
    const result = scanTextTemplateLiteral(source, fullSpan(source));
    expect(result).toMatchObject({ kind: "error", issueCode: "interpolation-nested-not-supported" });
  });

  it("unmatched closing brace is interpolation-unmatched-closing-brace", () => {
    const source = '"oops }"';
    const result = scanTextTemplateLiteral(source, fullSpan(source));
    expect(result).toMatchObject({ kind: "error", issueCode: "interpolation-unmatched-closing-brace" });
  });

  it("empty hole is interpolation-empty", () => {
    const source = '"{}"';
    const result = scanTextTemplateLiteral(source, fullSpan(source));
    expect(result).toMatchObject({ kind: "error", issueCode: "interpolation-empty" });
  });

  it("unknown escape is invalid-string-escape", () => {
    const source = '"\\q"';
    const result = scanTextTemplateLiteral(source, fullSpan(source));
    expect(result).toMatchObject({ kind: "error", issueCode: "invalid-string-escape" });
  });
});

describe("compileTextTemplates: typed holes", () => {
  it("single string binding hole inserts as a string hole", () => {
    const compiled = compileTemplatesFor([
      'const ラベル: string = "前身頃"',
      'text T = label(text: "{@ラベル}を2枚カット" anchor: none size: 3)'
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);
    const template = compiled.templatesByOccurrenceKey.get(propertyBindingOccurrenceKey(1, "text"))!;
    expect(template).toBeDefined();
    const hole = holeAt(template, 0);
    expect(hole.holeKind).toBe("string");
    expect(template.dependencies).toHaveLength(1);
    expect(template.dependencies[0]).toMatchObject({ name: "ラベル" });
  });

  it("typed number binding hole and arithmetic combination classify as number", () => {
    const compiled = compileTemplatesFor([
      "const 幅: number = 10",
      "const 高さ: number = 20",
      'text T = label(text: "size {@幅 + @高さ}" anchor: none size: 3)'
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);
    const template = compiled.templatesByOccurrenceKey.get(propertyBindingOccurrenceKey(2, "text"))!;
    const hole = holeAt(template, 0);
    expect(hole.holeKind).toBe("number");
    expect(template.dependencies.map((dependency) => dependency.name).sort()).toEqual(["幅", "高さ"].sort());
  });

  it("boolean-typed hole is interpolation-type-mismatch", () => {
    const compiled = compileTemplatesFor([
      "let 表示する: boolean = true",
      'text T = label(text: "flag {@表示する}" anchor: none size: 3)'
    ].join("\n"));
    expect(compiled.diagnostics).toHaveLength(1);
    expect(compiled.diagnostics[0].code).toBe(TEXT_TEMPLATE_HOLE_TYPE_MISMATCH_CODE);
  });

  it("choice-typed hole is interpolation-type-mismatch", () => {
    const compiled = compileTemplatesFor([
      "const 方向: choice(right, left) = right",
      'text T = label(text: "dir {@方向}" anchor: none size: 3)'
    ].join("\n"));
    expect(compiled.diagnostics).toHaveLength(1);
    expect(compiled.diagnostics[0].code).toBe(TEXT_TEMPLATE_HOLE_TYPE_MISMATCH_CODE);
  });

  it("literal true/false hole (no binding) still typechecks as boolean mismatch", () => {
    const compiled = compileTemplatesFor([
      "const _unused: number = 0",
      'text T = label(text: "flag {true}" anchor: none size: 3)'
    ].join("\n"));
    expect(compiled.diagnostics).toHaveLength(1);
    expect(compiled.diagnostics[0].code).toBe(TEXT_TEMPLATE_HOLE_TYPE_MISMATCH_CODE);
  });

  it("undefined reference is text-template-hole-unresolved", () => {
    const compiled = compileTemplatesFor([
      "const _unused: number = 0",
      'text T = label(text: "{!@nope}" anchor: none size: 3)'
    ].join("\n"));
    expect(compiled.diagnostics).toHaveLength(1);
    expect(compiled.diagnostics[0].code).toBe(TEXT_TEMPLATE_HOLE_UNRESOLVED_CODE);
  });

  it("legacy var mixed into typed-only syntax is text-template-hole-legacy-reference", () => {
    const compiled = compileTemplatesFor([
      "const _unused: number = 0",
      "var legacyVar = 5",
      'text T = label(text: "{!(@legacyVar == 1)}" anchor: none size: 3)'
    ].join("\n"));
    expect(compiled.diagnostics.map((d) => d.code)).toContain(TEXT_TEMPLATE_HOLE_LEGACY_REFERENCE_CODE);
  });

  it("reference to an invalid declaration is text-template-hole-invalid", () => {
    const compiled = compileTemplatesFor([
      "const 壊れた: string = @何か",
      'text T = label(text: "{@壊れた}" anchor: none size: 3)'
    ].join("\n"));
    expect(compiled.diagnostics.map((d) => d.code)).toContain(TEXT_TEMPLATE_HOLE_INVALID_CODE);
  });
});

describe("compileTextTemplates: legacy holes stay untouched", () => {
  it("a plain legacy var reference produces no diagnostics and a legacy hole", () => {
    const compiled = compileTemplatesFor([
      "const _unused: number = 0",
      "var legacyVar = 5",
      'text T = label(text: "value {@legacyVar}" anchor: none size: 3)'
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);
    const template = compiled.templatesByOccurrenceKey.get(propertyBindingOccurrenceKey(2, "text"))!;
    expect(holeAt(template, 0).holeKind).toBe("legacy");
    expect(template.dependencies).toEqual([]);
  });

  it("legacy element-property syntax the typed grammar can't parse at all falls through untouched", () => {
    const compiled = compileTemplatesFor([
      "const _unused: number = 0",
      "point A = coordinate(x: 0 y: 0)",
      "point B = coordinate(x: 10 y: 0)",
      "line AB = segment(start: A end: B)",
      'text T = label(text: "length {AB.length}" anchor: none size: 3)'
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);
    const template = compiled.templatesByOccurrenceKey.get(propertyBindingOccurrenceKey(4, "text"))!;
    expect(holeAt(template, 0)).toMatchObject({ holeKind: "legacy", raw: "AB.length" });
  });

  it("plain numeric expression hole with no references is legacy-eligible", () => {
    const compiled = compileTemplatesFor([
      "const _unused: number = 0",
      'text T = label(text: "sum {2+3}" anchor: none size: 3)'
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);
    const template = compiled.templatesByOccurrenceKey.get(propertyBindingOccurrenceKey(1, "text"))!;
    expect(holeAt(template, 0).holeKind).toBe("legacy");
  });
});

describe("compileTextTemplates: runs without any typed declaration in the document", () => {
  const noTypedDeclarationSource = [
    "point A = coordinate(x: 0 y: 0)",
    "point B = coordinate(x: 10 y: 0)",
    "line AB = segment(start: A end: B)",
    'text T = label(text: "length \\{AB.length\\} = {AB.length}" anchor: none size: 3)'
  ].join("\n");

  it("characterization: analyzeTypedDeclarations produces no analysis for a nui 3 doc with zero typed declarations", () => {
    const parsed = parseDsl(noTypedDeclarationSource);
    const compiled = compileDslToElements(noTypedDeclarationSource, { elements: [], mode: "document", majorVersion: 3 });
    const elementIdByStatementIndex = compiled.elementIdsByStatementIndex ?? new Map();
    const stableStatementIdByIndex = new Map<number, string>(parsed.statements.map((_, index) => [index, `stable-${index}`]));
    for (const [statementIndex, elementId] of elementIdByStatementIndex) stableStatementIdByIndex.set(statementIndex, elementId);
    const scalarAnalysisCompilation = analyzeTypedDeclarations({
      statements: parsed.statements,
      stableStatementIdByIndex,
      reconciledContainers: { elementIdByStatementIndex, elements: compiled.elements },
      spans: { sourceMap: parsed.sourceMap, logicalStatementByRangeFrom: parsed.logicalStatementByRangeFrom }
    });
    expect(scalarAnalysisCompilation.diagnostics).toEqual([]);
    expect(scalarAnalysisCompilation.analysis).toBeUndefined();
  });

  it("still scans brace/escape structure and classifies holes as legacy with bindingAnalysis undefined", () => {
    const parsed = parseDsl(noTypedDeclarationSource);
    const compiled = compileDslToElements(noTypedDeclarationSource, { elements: [], mode: "document", majorVersion: 3 });
    const elementIdByStatementIndex = compiled.elementIdsByStatementIndex ?? new Map();
    const result = compileTextTemplates({
      statements: parsed.statements,
      elementIdByStatementIndex,
      elements: compiled.elements,
      bindingAnalysis: undefined,
      spans: { sourceMap: parsed.sourceMap, logicalStatementByRangeFrom: parsed.logicalStatementByRangeFrom }
    });
    expect(result.diagnostics).toEqual([]);
    const template = result.templatesByOccurrenceKey.get(propertyBindingOccurrenceKey(3, "text"))!;
    expect(template).toBeDefined();
    expect(template.segments[0]).toMatchObject({ kind: "literal", cooked: "length {AB.length} = " });
    expect(holeAt(template, 0)).toMatchObject({ holeKind: "legacy", raw: "AB.length" });
    expect(template.dependencies).toEqual([]);
  });

  it("typed-only syntax (no bindingAnalysis) still fails closed on any reference as unresolved", () => {
    const source = ['text T = label(text: "{!@x}" anchor: none size: 3)'].join("\n");
    const parsed = parseDsl(source);
    const compiled = compileDslToElements(source, { elements: [], mode: "document", majorVersion: 3 });
    const result = compileTextTemplates({
      statements: parsed.statements,
      elementIdByStatementIndex: compiled.elementIdsByStatementIndex ?? new Map(),
      elements: compiled.elements,
      bindingAnalysis: undefined,
      spans: { sourceMap: parsed.sourceMap, logicalStatementByRangeFrom: parsed.logicalStatementByRangeFrom }
    });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe(TEXT_TEMPLATE_HOLE_UNRESOLVED_CODE);
  });
});
