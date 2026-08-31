import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel } from "../document/canonicalDocument";
import { compileDslToElements } from "../dsl/dslCompiler";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import { parseDsl } from "../dsl/dslParser";
import type { DiagnosticSpanContext } from "../dsl/dslDiagnosticSpan";
import type { CadElement, ElementId } from "../types/geometry";
import type { BindingAnalysis } from "./bindingAnalysis";
import {
  compileConditionalGroupConditions,
  CONDITIONAL_GROUP_CONDITION_INVALID_CODE,
  CONDITIONAL_GROUP_CONDITION_TYPE_MISMATCH_CODE,
  CONDITIONAL_GROUP_CONDITION_UNRESOLVED_CODE
} from "./conditionalGroupConditionCompiler";
import { propertyBindingOccurrenceKey } from "./propertyBindingCompiler";
import { analyzeTypedDeclarations } from "./typedDeclarationAnalysis";

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
  const compiled = compileDslToElements(source, { elements: [], mode: "document", majorVersion: 1 });
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

describe("compileConditionalGroupConditions: typed candidates compile to a boolean expression", () => {
  it("boolean literal", () => {
    // A leading unrelated typed declaration is required for scalarAnalysis
    // (and therefore this compiler) to run at all in production wiring -
    // see dslDocument.ts's `scalarAnalysis ?` gate - mirroring
    // propertyBindingCompiler.test.ts's own convention.
    const compiled = compileFor(["const _unused: number = 0", "if (true) {", "}"].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compileConditionalGroupConditions(compiled);
    expect(diagnostics).toEqual([]);
    expect(sourcesByOccurrenceKey.get(propertyBindingOccurrenceKey(1, "condition"))).toMatchObject({
      kind: "booleanLiteral",
      value: true,
      type: { kind: "boolean" }
    });
  });

  it("unary not on a typed boolean reference", () => {
    const compiled = compileFor(["let flag: boolean = true", "if (not @flag) {", "}"].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compileConditionalGroupConditions(compiled);
    expect(diagnostics).toEqual([]);
    expect(sourcesByOccurrenceKey.get(propertyBindingOccurrenceKey(1, "condition"))).toMatchObject({
      kind: "unary",
      operator: "!",
      type: { kind: "boolean" }
    });
  });

  it("bare reference to a typed boolean binding", () => {
    const compiled = compileFor(["let flag: boolean = true", "if (@flag) {", "}"].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compileConditionalGroupConditions(compiled);
    expect(diagnostics).toEqual([]);
    expect(sourcesByOccurrenceKey.get(propertyBindingOccurrenceKey(1, "condition"))).toMatchObject({
      kind: "reference",
      name: "flag",
      type: { kind: "boolean" }
    });
  });

  it("comparison where an operand is a typed number binding", () => {
    const compiled = compileFor(["const n: number = 5", "if (@n > 0) {", "}"].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compileConditionalGroupConditions(compiled);
    expect(diagnostics).toEqual([]);
    expect(sourcesByOccurrenceKey.get(propertyBindingOccurrenceKey(1, "condition"))).toMatchObject({
      kind: "binary",
      operator: ">",
      type: { kind: "boolean" }
    });
  });

  it("logical  and  combining two typed boolean references", () => {
    const compiled = compileFor([
      "let a: boolean = true",
      "let b: boolean = false",
      "if (@a  and  @b) {",
      "}"
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compileConditionalGroupConditions(compiled);
    expect(diagnostics).toEqual([]);
    expect(sourcesByOccurrenceKey.get(propertyBindingOccurrenceKey(2, "condition"))).toMatchObject({
      kind: "binary",
      operator: "&&",
      type: { kind: "boolean" }
    });
  });

  it("accepts nui1 word operators and resolves an earlier geometry property", () => {
    const compiled = compileFor([
      "const _unused: number = 0",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "if (@AB.length > 0) {",
      "}"
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compileConditionalGroupConditions(compiled);
    expect(diagnostics).toEqual([]);
    expect(sourcesByOccurrenceKey.get(propertyBindingOccurrenceKey(4, "condition"))).toMatchObject({
      kind: "binary",
      operator: ">",
      left: { kind: "geometryProperty", elementId: expect.any(String), targetSourceOrder: 3 }
    });
  });

  it("rejects a forward geometry property in a conditional expression", () => {
    const compiled = compileFor([
      "const _unused: number = 0",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "if (@Later.length > 0) {",
      "}",
      "line Later = segment(start: @A, end: @B)"
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compileConditionalGroupConditions(compiled);
    expect(sourcesByOccurrenceKey.size).toBe(0);
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "geometry-property-invalid", message: expect.stringContaining("後") })
    ]));
  });
});

describe("compileConditionalGroupConditions: every scalar AST uses boolean expected type", () => {
  it("wires the boolean expected-type check through the production document compiler without typed declarations", () => {
    const result = compileCanonicalText(
      regenerateCanonicalFromModel(emptyDocument(), 1),
      ["nui 1", "if (1) {", "}"].join("\n")
    );
    expect(result.status).toBe("fatal");
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === CONDITIONAL_GROUP_CONDITION_TYPE_MISMATCH_CODE)).toHaveLength(1);
  });

  it.each([true, false])("accepts boolean literal %s", (value) => {
    const compiled = compileFor(["const _unused: number = 0", `if (${value}) {`, "}"].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compileConditionalGroupConditions(compiled);
    expect(diagnostics).toEqual([]);
    expect(sourcesByOccurrenceKey.get(propertyBindingOccurrenceKey(1, "condition"))).toMatchObject({
      kind: "booleanLiteral",
      value,
      type: { kind: "boolean" }
    });
  });

  it.each(["1", "0"])("rejects numeric truthiness for if (%s)", (condition) => {
    const compiled = compileFor(["const _unused: number = 0", `if (${condition}) {`, "}"].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compileConditionalGroupConditions(compiled);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe(CONDITIONAL_GROUP_CONDITION_TYPE_MISMATCH_CODE);
    expect(sourcesByOccurrenceKey.size).toBe(0);
  });

  it("accepts a zero-reference boolean comparison", () => {
    const compiled = compileFor(["const _unused: number = 0", "if (1 > 0) {", "}"].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compileConditionalGroupConditions(compiled);
    expect(diagnostics).toEqual([]);
    expect(sourcesByOccurrenceKey.get(propertyBindingOccurrenceKey(1, "condition"))).toMatchObject({
      kind: "binary",
      operator: ">",
      type: { kind: "boolean" }
    });
  });

  it("rejects a geometry property used as a condition without a boolean comparison", () => {
    const compiled = compileFor([
      "const _unused: number = 0",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "if (@AB.length) {",
      "}"
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compileConditionalGroupConditions(compiled);
    expect(sourcesByOccurrenceKey.size).toBe(0);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe(CONDITIONAL_GROUP_CONDITION_TYPE_MISMATCH_CODE);
  });

  it("characterization: typed-only condition syntax is not rejected earlier by the generic numeric apply stage", () => {
    // If dslApplyArgs's numeric() ever started rejecting non-numeric-grammar
    // text like `true` || `@a &&  @b` at compile time, compileFor's own
    // `compiled.diagnostics` assertion above would already fail before this
    // module even runs - this test exists to name that guarantee explicitly.
    const compiled = compileFor([
      "let a: boolean = true",
      "let b: boolean = true",
      "if (@a && @b) {",
      "}"
    ].join("\n"));
    expect(compiled.elements[0]).toMatchObject({ type: "conditionalGroup" });
    expect(typeof (compiled.elements[0] as { condition: unknown }).condition).not.toBe("undefined");
  });
});

describe("compileConditionalGroupConditions: fail-closed diagnostics once classified typed", () => {
  it("an unresolved reference inside a typed-only expression", () => {
    const compiled = compileFor(["const _unused: number = 0", "if (@missing && true) {", "}"].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compileConditionalGroupConditions(compiled);
    expect(sourcesByOccurrenceKey.size).toBe(0);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe(CONDITIONAL_GROUP_CONDITION_UNRESOLVED_CODE);
  });

  it("a non-boolean root type (bare reference to a typed number binding)", () => {
    const compiled = compileFor(["const n: number = 1", "if (@n) {", "}"].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compileConditionalGroupConditions(compiled);
    expect(sourcesByOccurrenceKey.size).toBe(0);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe(CONDITIONAL_GROUP_CONDITION_TYPE_MISMATCH_CODE);
  });

  it("an invalid (poisoned) typed declaration referenced inside a typed-only expression", () => {
    const compiled = compileFor([
      "let 壊れた: boolean = @何か",
      "if (@壊れた && true) {",
      "}"
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compileConditionalGroupConditions(compiled);
    expect(sourcesByOccurrenceKey.size).toBe(0);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe(CONDITIONAL_GROUP_CONDITION_INVALID_CODE);
  });
});
