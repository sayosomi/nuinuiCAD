import { describe, expect, it } from "vitest";
import { compileDslToElements } from "../dsl/dslCompiler";
import { parseDsl } from "../dsl/dslParser";
import type { CadElement, ElementId } from "../types/geometry";
import type { BindingAnalysis } from "./bindingAnalysis";
import {
  compileConditionalGroupConditions,
  CONDITIONAL_GROUP_CONDITION_INVALID_CODE,
  CONDITIONAL_GROUP_CONDITION_LEGACY_REFERENCE_CODE,
  CONDITIONAL_GROUP_CONDITION_TYPE_MISMATCH_CODE,
  CONDITIONAL_GROUP_CONDITION_UNRESOLVED_CODE
} from "./conditionalGroupConditionCompiler";
import { propertyBindingOccurrenceKey } from "./propertyBindingCompiler";
import { analyzeTypedDeclarations } from "./typedDeclarationAnalysis";

/** Mirrors propertyBindingCompiler.test.ts's own harness - the same shapes
 * production actually produces, not a lighter reinvented one. */
const compileFor = (
  source: string
): { statements: ReturnType<typeof parseDsl>["statements"]; elementIdByStatementIndex: ReadonlyMap<number, ElementId>; elements: readonly CadElement[]; bindingAnalysis: BindingAnalysis } => {
  const parsed = parseDsl(source);
  expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  const statements = parsed.statements;
  const compiled = compileDslToElements(source, { elements: [], mode: "document", majorVersion: 3 });
  expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  const elementIdByStatementIndex = compiled.elementIdsByStatementIndex ?? new Map();
  const stableStatementIdByIndex = new Map<number, string>(statements.map((_, index) => [index, `stable-${index}`]));
  for (const [statementIndex, elementId] of elementIdByStatementIndex) stableStatementIdByIndex.set(statementIndex, elementId);
  const scalarAnalysisCompilation = analyzeTypedDeclarations({
    statements,
    stableStatementIdByIndex,
    reconciledContainers: { elementIdByStatementIndex, elements: compiled.elements }
  });
  expect(scalarAnalysisCompilation.diagnostics).toEqual([]);
  return {
    statements,
    elementIdByStatementIndex,
    elements: compiled.elements,
    bindingAnalysis: scalarAnalysisCompilation.analysis!.bindingAnalysis
  };
};

describe("compileConditionalGroupConditions: typed candidates compile to a boolean expression", () => {
  it("boolean literal", () => {
    // A leading unrelated typed declaration is required for scalarAnalysis
    // (and therefore this compiler) to run at all in production wiring -
    // see dslDocument.ts's `scalarAnalysis ?` gate - mirroring
    // propertyBindingCompiler.test.ts's own convention.
    const compiled = compileFor(["const _unused: number = 0", "if C (true) {", "}"].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compileConditionalGroupConditions(compiled);
    expect(diagnostics).toEqual([]);
    expect(sourcesByOccurrenceKey.get(propertyBindingOccurrenceKey(1, "condition"))).toMatchObject({
      kind: "booleanLiteral",
      value: true,
      type: { kind: "boolean" }
    });
  });

  it("unary not on a typed boolean reference", () => {
    const compiled = compileFor(["let flag: boolean = true", "if C (!@flag) {", "}"].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compileConditionalGroupConditions(compiled);
    expect(diagnostics).toEqual([]);
    expect(sourcesByOccurrenceKey.get(propertyBindingOccurrenceKey(1, "condition"))).toMatchObject({
      kind: "unary",
      operator: "!",
      type: { kind: "boolean" }
    });
  });

  it("bare reference to a typed boolean binding", () => {
    const compiled = compileFor(["let flag: boolean = true", "if C (@flag) {", "}"].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compileConditionalGroupConditions(compiled);
    expect(diagnostics).toEqual([]);
    expect(sourcesByOccurrenceKey.get(propertyBindingOccurrenceKey(1, "condition"))).toMatchObject({
      kind: "reference",
      name: "flag",
      type: { kind: "boolean" }
    });
  });

  it("comparison where an operand is a typed number binding", () => {
    const compiled = compileFor(["const n: number = 5", "if C (@n > 0) {", "}"].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compileConditionalGroupConditions(compiled);
    expect(diagnostics).toEqual([]);
    expect(sourcesByOccurrenceKey.get(propertyBindingOccurrenceKey(1, "condition"))).toMatchObject({
      kind: "binary",
      operator: ">",
      type: { kind: "boolean" }
    });
  });

  it("logical && combining two typed boolean references", () => {
    const compiled = compileFor([
      "let a: boolean = true",
      "let b: boolean = false",
      "if C (@a && @b) {",
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
});

describe("compileConditionalGroupConditions: legacy-eligible conditions are left untouched", () => {
  it("a plain numeric literal produces no entry and no diagnostic", () => {
    const compiled = compileFor(["const _unused: number = 0", "if C (1) {", "}"].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compileConditionalGroupConditions(compiled);
    expect(diagnostics).toEqual([]);
    expect(sourcesByOccurrenceKey.size).toBe(0);
    expect(compiled.elements[0]).toMatchObject({ type: "conditionalGroup", condition: 1 });
  });

  it("a zero-reference numeric comparison produces no entry and no diagnostic", () => {
    const compiled = compileFor(["const _unused: number = 0", "if C (1 > 0) {", "}"].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compileConditionalGroupConditions(compiled);
    expect(diagnostics).toEqual([]);
    expect(sourcesByOccurrenceKey.size).toBe(0);
  });

  it("a comparison referencing only legacy vars produces no entry and no diagnostic", () => {
    const compiled = compileFor([
      "const _unused: number = 0",
      "var legacyA = 1",
      "var legacyB = 2",
      "if C (@legacyA > @legacyB) {",
      "}"
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compileConditionalGroupConditions(compiled);
    expect(diagnostics).toEqual([]);
    expect(sourcesByOccurrenceKey.size).toBe(0);
  });

  it("a logical && referencing only legacy vars produces no entry and no diagnostic", () => {
    const compiled = compileFor([
      "const _unused: number = 0",
      "var legacyA = 1",
      "var legacyB = 1",
      "if C (@legacyA && @legacyB) {",
      "}"
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compileConditionalGroupConditions(compiled);
    expect(diagnostics).toEqual([]);
    expect(sourcesByOccurrenceKey.size).toBe(0);
  });

  it("characterization: typed-only condition syntax is not rejected earlier by the generic numeric apply stage", () => {
    // If dslApplyArgs's numeric() ever started rejecting non-numeric-grammar
    // text like `true` or `@a && @b` at compile time, compileFor's own
    // `compiled.diagnostics` assertion above would already fail before this
    // module even runs - this test exists to name that guarantee explicitly.
    const compiled = compileFor([
      "let a: boolean = true",
      "let b: boolean = true",
      "if C (@a && @b) {",
      "}"
    ].join("\n"));
    expect(compiled.elements[0]).toMatchObject({ type: "conditionalGroup" });
    expect(typeof (compiled.elements[0] as { condition: unknown }).condition).not.toBe("undefined");
  });
});

describe("compileConditionalGroupConditions: fail-closed diagnostics once classified typed", () => {
  it("an unresolved reference inside a typed-only expression", () => {
    const compiled = compileFor(["const _unused: number = 0", "if C (@missing && true) {", "}"].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compileConditionalGroupConditions(compiled);
    expect(sourcesByOccurrenceKey.size).toBe(0);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe(CONDITIONAL_GROUP_CONDITION_UNRESOLVED_CODE);
  });

  it("a non-boolean root type (bare reference to a typed number binding)", () => {
    const compiled = compileFor(["const n: number = 1", "if C (@n) {", "}"].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compileConditionalGroupConditions(compiled);
    expect(sourcesByOccurrenceKey.size).toBe(0);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe(CONDITIONAL_GROUP_CONDITION_TYPE_MISMATCH_CODE);
  });

  it("a legacy var reference mixed into an otherwise-typed-only expression", () => {
    const compiled = compileFor([
      "const _unused: number = 0",
      "var legacyA = 1",
      "if C (@legacyA && true) {",
      "}"
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compileConditionalGroupConditions(compiled);
    expect(sourcesByOccurrenceKey.size).toBe(0);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe(CONDITIONAL_GROUP_CONDITION_LEGACY_REFERENCE_CODE);
  });

  it("an invalid (poisoned) typed declaration referenced inside a typed-only expression", () => {
    const compiled = compileFor([
      "let 壊れた: boolean = @何か",
      "if C (@壊れた && true) {",
      "}"
    ].join("\n"));
    const { sourcesByOccurrenceKey, diagnostics } = compileConditionalGroupConditions(compiled);
    expect(sourcesByOccurrenceKey.size).toBe(0);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe(CONDITIONAL_GROUP_CONDITION_INVALID_CODE);
  });
});
