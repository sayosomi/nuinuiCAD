import { describe, expect, it } from "vitest";
import { compileDslToElements } from "../dsl/dslCompiler";
import { parseDsl } from "../dsl/dslParser";
import type { DiagnosticSpanContext } from "../dsl/dslDiagnosticSpan";
import type { CadElement, ElementId } from "../types/geometry";
import type { BindingAnalysis } from "./bindingAnalysis";
import {
  compilePropertyBindings,
  parsePropertyBindingOccurrenceKey,
  propertyBindingOccurrenceKey,
  PROPERTY_BINDING_INVALID_CODE,
  PROPERTY_BINDING_TYPE_MISMATCH_CODE,
  PROPERTY_BINDING_UNRESOLVED_CODE,
  type ScalarValueSource
} from "./propertyBindingCompiler";
import { analyzeTypedDeclarations } from "./typedDeclarationAnalysis";

/** Mirrors compileDslDocument's own pipeline (dsl/dslDocument.ts) up to the
 * point Task 22 hooks in, so this module is tested against the same shapes
 * production actually produces - not a lighter reinvented harness. */
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
  const compiled = compileDslToElements(source, { elements: [], mode: "document", majorVersion: 4 });
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

const sourceFor = (candidate: ScalarValueSource | undefined) =>
  candidate?.kind === "binding" ? { bindingId: candidate.bindingId, type: candidate.type, name: candidate.name } : candidate;

describe("compilePropertyBindings: opted-in properties resolve to a binding source", () => {
  it("text.text", () => {
    const compiled = compileFor([
      'const ラベル: string = "前身頃"',
      "text T = label(text: @ラベル, anchor: none, size: 3)"
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compilePropertyBindings(compiled);
    expect(diagnostics).toEqual([]);
    expect(sourceFor(sourcesByOccurrenceKey.get(propertyBindingOccurrenceKey(1, "text")))).toEqual({
      bindingId: "binding:stable-0",
      type: { kind: "string" },
      name: "ラベル"
    });
  });

  it("offsetLine.side (choice)", () => {
    const compiled = compileFor([
      "const 方向: choice(right, left) = right",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "line Off = offset(sources: [@AB], distance: 10, side: @方向, closed: false, suppressTrimWarnings: false)"
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compilePropertyBindings(compiled);
    expect(diagnostics).toEqual([]);
    expect(sourceFor(sourcesByOccurrenceKey.get(propertyBindingOccurrenceKey(4, "side")))).toEqual({
      bindingId: "binding:stable-0",
      type: { kind: "choice", options: ["right", "left"] },
      name: "方向"
    });
  });

  it.each([
    ["closed", "closed"],
    ["suppressTrimWarnings", "suppressTrimWarnings"]
  ])("offsetLine.%s (boolean)", (_label, argName) => {
    const otherArg = argName === "closed" ? "suppressTrimWarnings" : "closed";
    const compiled = compileFor([
      "let 有効: boolean = true",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      `line Off = offset(sources: [@AB], distance: 10, side: right, ${argName}: @有効, ${otherArg}: false)`
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compilePropertyBindings(compiled);
    expect(diagnostics).toEqual([]);
    expect(sourcesByOccurrenceKey.get(propertyBindingOccurrenceKey(4, argName))).toMatchObject({ kind: "binding", type: { kind: "boolean" } });
  });

  it("intersectionPoint.useExtensions (DSL arg name 'extensions' remaps to parameterKey 'useExtensions')", () => {
    const compiled = compileFor([
      "let 延長: boolean = true",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "point C = coordinate(x: 0, y: 10)",
      "point D = coordinate(x: 10, y: 10)",
      "line AB = segment(start: @A, end: @B)",
      "line CD = segment(start: @C, end: @D)",
      "point X = intersection(line1: @AB, line2: @CD, extensions: @延長)"
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compilePropertyBindings(compiled);
    expect(diagnostics).toEqual([]);
    expect(sourcesByOccurrenceKey.get(propertyBindingOccurrenceKey(7, "useExtensions"))).toMatchObject({ kind: "binding", type: { kind: "boolean" } });
  });

  it.each(["copy", "move"] as const)("%s mirrorX", (construction) => {
    const constructionLine = construction === "copy"
      ? "line C = copy(startPoint: @A, endPoint: @B, scale: 1, angleDeg: 0, mirrorX: @反転, baseLines: [@AB])"
      : "move(targets: [@AB], from: @A, to: @B, scale: 1, angleDeg: 0, mirrorX: @反転)";
    const compiled = compileFor([
      "let 反転: boolean = true",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      constructionLine
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compilePropertyBindings(compiled);
    expect(diagnostics).toEqual([]);
    expect(sourcesByOccurrenceKey.get(propertyBindingOccurrenceKey(4, "mirrorX"))).toMatchObject({ kind: "binding", type: { kind: "boolean" } });
  });

  it("image.mirrorX", () => {
    const compiled = compileFor([
      "let 反転: boolean = true",
      'image IMG = image(source: "x.png", origin: (0, 0), naturalWidthPx: 1, naturalHeightPx: 1, sourceDpi: 300, targetPixelsPerMm: 11.811023622047244, scale: 1, angleDeg: 0, mirrorX: @反転)'
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compilePropertyBindings(compiled);
    expect(diagnostics).toEqual([]);
    expect(sourcesByOccurrenceKey.get(propertyBindingOccurrenceKey(1, "mirrorX"))).toMatchObject({ kind: "binding", type: { kind: "boolean" } });
  });

  it("group.printEnabled", () => {
    const compiled = compileFor([
      "let 印刷: boolean = true",
      "group G (printEnabled: @印刷) {", "}"
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compilePropertyBindings(compiled);
    expect(diagnostics).toEqual([]);
    expect(sourcesByOccurrenceKey.get(propertyBindingOccurrenceKey(1, "printEnabled"))).toMatchObject({ kind: "binding", type: { kind: "boolean" } });
  });

  it("accepts compound expressions for a scalar property through the common typed AST", () => {
    const compiled = compileFor([
      "let 印刷: boolean = true",
      "let 下書き: boolean = false",
      "group G (printEnabled: @印刷  and  not @下書き) {", "}"
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compilePropertyBindings(compiled);
    expect(diagnostics).toEqual([]);
    const source = sourcesByOccurrenceKey.get(propertyBindingOccurrenceKey(2, "printEnabled"));
    expect(source).toMatchObject({ kind: "expression", type: { kind: "boolean" } });
    expect(source?.kind === "expression" ? source.expression.kind : null).toBe("binary");
  });

  it("accepts nui4 compound property expressions and resolves geometry-property leaves", () => {
    const compiled = compileFor([
      "let 下書き: boolean = false",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "line Off = offset(sources: [@AB], distance: 5, side: right, closed: not @下書き, suppressTrimWarnings: false)"
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compilePropertyBindings(compiled);
    expect(diagnostics).toEqual([]);
    const source = sourcesByOccurrenceKey.get(propertyBindingOccurrenceKey(4, "closed"));
    expect(source).toMatchObject({ kind: "expression", type: { kind: "boolean" } });
    expect(source?.kind === "expression" ? source.expression : null).toMatchObject({
      kind: "unary",
      operator: "!",
      operand: { kind: "reference", name: "下書き" }
    });

    const geometryCompiled = compileFor([
      "let _unused: boolean = true",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "line Off = offset(sources: [@AB], distance: 5, side: right, closed: @AB.length > 0, suppressTrimWarnings: false)"
    ].join("\n"));
    const geometry = compilePropertyBindings(geometryCompiled);
    expect(geometry.diagnostics).toEqual([]);
    expect(geometry.sourcesByOccurrenceKey.get(propertyBindingOccurrenceKey(4, "closed"))).toMatchObject({
      kind: "expression",
      expression: {
        kind: "binary",
        left: { kind: "geometryProperty", elementId: expect.any(String), targetSourceOrder: 3 }
      }
    });
  });

  it("rejects a forward geometry property in a property expression before runtime", () => {
    const compiled = compileFor([
      "let _unused: boolean = true",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Off = offset(sources: [@Later], distance: 5, side: right, closed: @Later.length > 0, suppressTrimWarnings: false)",
      "line Later = segment(start: @A, end: @B)"
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compilePropertyBindings(compiled);
    expect(sourcesByOccurrenceKey.size).toBe(0);
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: PROPERTY_BINDING_INVALID_CODE, message: expect.stringContaining("後") })
    ]));
  });

  it("forGroup.showGenerated", () => {
    const compiled = compileFor([
      "let 表示: boolean = true",
      "for i in range(from: 0, count: 3, showGenerated: @表示) {", "}"
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compilePropertyBindings(compiled);
    expect(diagnostics).toEqual([]);
    expect(sourcesByOccurrenceKey.get(propertyBindingOccurrenceKey(1, "showGenerated"))).toMatchObject({ kind: "binding", type: { kind: "boolean" } });
  });
});

describe("compilePropertyBindings: exact span", () => {
  it("keeps the @name token's own offsets, not the whole arg || statement", () => {
    const source = ["let 印刷: boolean = true", "group G (printEnabled: @印刷) {", "}"].join("\n");
    const compiled = compileFor(source);
    const { sourcesByOccurrenceKey } = compilePropertyBindings(compiled);
    const entry = sourcesByOccurrenceKey.get(propertyBindingOccurrenceKey(1, "printEnabled"));
    expect(entry?.kind).toBe("binding");
    if (entry?.kind !== "binding") throw new Error("expected binding source");
    const line2 = source.split("\n")[1];
    expect(line2.slice(entry.span.start, entry.span.end)).toBe("@印刷");
    expect(line2.slice(entry.nameSpan.start, entry.nameSpan.end)).toBe("印刷");
  });
});

describe("compilePropertyBindings: type mismatch", () => {
  it("rejects a number binding assigned to a choice property", () => {
    const compiled = compileFor([
      "const n: number = 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "line Off = offset(sources: [@AB], distance: 10, side: @n, closed: false, suppressTrimWarnings: false)"
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compilePropertyBindings(compiled);
    expect(sourcesByOccurrenceKey.size).toBe(0);
    expect(diagnostics).toHaveLength(1);
    const [diagnostic] = diagnostics;
    expect(diagnostic.code).toBe(PROPERTY_BINDING_TYPE_MISMATCH_CODE);
    // Task 48: exact-span regression check - the diagnostic must point at
    // the `@n` token, not the whole `line Off = offset(...)` statement (the
    // pre-Task-48 bug: every diagnostic here used statement.physicalSpan).
    expect(diagnostic.exactSpanOnly).toBe(true);
    expect(diagnostic.physicalSpan).toBeDefined();
    const source = ["const n: number = 1", "point A = coordinate(x: 0, y: 0)", "point B = coordinate(x: 10, y: 0)", "line AB = segment(start: @A, end: @B)", "line Off = offset(sources: [@AB], distance: 10, side: @n, closed: false, suppressTrimWarnings: false)"].join("\n");
    const [segment] = diagnostic.physicalSpan!.segments;
    expect(source.slice(segment.from, segment.to)).toBe("@n");
    expect(source.slice(segment.from, segment.to).length).toBeLessThan(compiled.statements[4].physicalSpan.segments[0].to - compiled.statements[4].physicalSpan.segments[0].from);
  });

  it("requires an exact choice type", () => {
    const compiled = compileFor([
      "const 方向: choice(left, right) = left",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "line Off = offset(sources: [@AB], distance: 10, side: @方向, closed: false, suppressTrimWarnings: false)"
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compilePropertyBindings(compiled);
    expect(sourcesByOccurrenceKey.size).toBe(0);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe(PROPERTY_BINDING_TYPE_MISMATCH_CODE);
  });

  it("rejects a narrower choice type", () => {
    const compiled = compileFor([
      "const 方向: choice(right) = right",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "line Off = offset(sources: [@AB], distance: 10, side: @方向, closed: false, suppressTrimWarnings: false)"
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compilePropertyBindings(compiled);
    expect(sourcesByOccurrenceKey.size).toBe(0);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe(PROPERTY_BINDING_TYPE_MISMATCH_CODE);
  });

  it("rejects a choice binding with an option outside the property's options (non-subset)", () => {
    const compiled = compileFor([
      "const 方向: choice(up, down) = up",
      "point A = coordinate(x: 0,y: 0)",
      "point B = coordinate(x: 10,y: 0)",
      "line AB = segment(start: @A,end: @B)",
      "line Off = offset(sources: [@AB],distance: 10,side: @方向,closed: false,suppressTrimWarnings: false)"
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compilePropertyBindings(compiled);
    expect(sourcesByOccurrenceKey.size).toBe(0);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe(PROPERTY_BINDING_TYPE_MISMATCH_CODE);
  });
});

describe("compilePropertyBindings: schema-driven properties", () => {
  it("accepts a binding on image.sourcePath without a property allowlist", () => {
    const compiled = compileFor([
      "const パス: string = \"x.png\"",
      'image IMG = image(source: @パス, origin: (0, 0), naturalWidthPx: 1, naturalHeightPx: 1, sourceDpi: 300, targetPixelsPerMm: 11.811023622047244, scale: 1, angleDeg: 0, mirrorX: false)'
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compilePropertyBindings(compiled);
    expect(diagnostics).toEqual([]);
    expect(sourcesByOccurrenceKey.get(propertyBindingOccurrenceKey(1, "sourcePath"))).toMatchObject({
      kind: "binding", type: { kind: "string" }, name: "パス"
    });
  });

  it("does not disturb an ordinary literal group(state/printEnabled) statement", () => {
    const compiled = compileFor([
      "const unused: number = 1",
      "group G (state: visible, printEnabled: false) {", "}"
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compilePropertyBindings(compiled);
    expect(sourcesByOccurrenceKey.size).toBe(0);
    expect(diagnostics).toEqual([]);
    expect(compiled.elements[0]).toMatchObject({ printEnabled: false });
  });
});

describe("compilePropertyBindings: unresolved", () => {
  it("undefined name", () => {
    const compiled = compileFor([
      "let 印刷: boolean = true",
      "group G (printEnabled: @Missing) {", "}"
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compilePropertyBindings(compiled);
    expect(sourcesByOccurrenceKey.size).toBe(0);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe(PROPERTY_BINDING_UNRESOLVED_CODE);
    expect(diagnostics[0].message).toContain("未定義");
  });

  it("forward-declared name (same code, different message)", () => {
    const compiled = compileFor([
      "group G (printEnabled: @Later) {", "}",
      "let Later: boolean = true"
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compilePropertyBindings(compiled);
    expect(sourcesByOccurrenceKey.size).toBe(0);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe(PROPERTY_BINDING_UNRESOLVED_CODE);
    expect(diagnostics[0].message).toContain("後で宣言");
  });
});

describe("compilePropertyBindings: invalid", () => {
  it("propagates an already-invalid binding's own declaration issue", () => {
    const compiled = compileFor([
      "let 壊れた: boolean = @何か",
      "group G (printEnabled: @壊れた) {", "}"
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compilePropertyBindings(compiled);
    expect(sourcesByOccurrenceKey.size).toBe(0);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe(PROPERTY_BINDING_INVALID_CODE);
  });

  it("rejects a property expression with the wrong result type", () => {
    const compiled = compileFor([
      "let 印刷: boolean = true",
      "group G (printEnabled: @印刷 + 1) {", "}"
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compilePropertyBindings(compiled);
    expect(sourcesByOccurrenceKey.size).toBe(0);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe(PROPERTY_BINDING_TYPE_MISMATCH_CODE);
  });
});

describe("compilePropertyBindings: literal properties are unaffected", () => {
  it("produces no entries && no diagnostics for ordinary literal args, alongside an unrelated binding", () => {
    const compiled = compileFor([
      "let 印刷: boolean = true",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "line Off = offset(sources: [@AB], distance: 10, side: right, closed: false, suppressTrimWarnings: false)",
      "group G (printEnabled: @印刷) {", "}"
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compilePropertyBindings(compiled);
    expect(diagnostics).toEqual([]);
    expect(sourcesByOccurrenceKey.size).toBe(1);
    expect(sourcesByOccurrenceKey.has(propertyBindingOccurrenceKey(4, "side"))).toBe(false);
    expect(compiled.elements.find((element) => element.type === "offsetLine")).toMatchObject({ side: "right", closed: false });
  });
});

describe("parsePropertyBindingOccurrenceKey: inverse of propertyBindingOccurrenceKey", () => {
  it("round-trips statementIndex && parameterKey for every registered opt-in property", () => {
    expect(parsePropertyBindingOccurrenceKey(propertyBindingOccurrenceKey(4, "side"))).toEqual({ statementIndex: 4, parameterKey: "side" });
    expect(parsePropertyBindingOccurrenceKey(propertyBindingOccurrenceKey(0, "text"))).toEqual({ statementIndex: 0, parameterKey: "text" });
  });

  it("returns null for a key with no separator", () => {
    expect(parsePropertyBindingOccurrenceKey("not-a-key")).toBeNull();
  });

  it("returns null when the statementIndex half is not an integer", () => {
    expect(parsePropertyBindingOccurrenceKey("abc:side")).toBeNull();
  });
});
