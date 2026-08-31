// Shared test-only fixture builder for Task 39: mirrors compileDslDocument's
// own pipeline (dsl/dslDocument.ts) up to Task 13's analyzeTypedDeclarations,
// the same shape propertyBindingCompiler.test.ts already builds for Task 22 -
// duplicated here (rather than imported) so this stays a test-only file with
// no production import edge, matching this codebase's existing per-test-file
// fixture convention.

import { expect } from "vitest";
import { compileDslToElements } from "../../dsl/dslCompiler";
import { parseDsl } from "../../dsl/dslParser";
import type { DiagnosticSpanContext } from "../../dsl/dslDiagnosticSpan";
import type { DslDiagnostic } from "../../dsl/dslTypes";
import type { CadElement, ElementId } from "../../types/geometry";
import { buildSourceLexicalNamespaceIndex } from "../../dsl/sourceLexicalNamespaceIndex";
import { analyzeTypedDeclarations, type TypedDeclarationAnalysis } from "../typedDeclarationAnalysis";

export type TypedDeclarationAnalysisFixture = {
  statements: ReturnType<typeof parseDsl>["statements"];
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
  elements: readonly CadElement[];
  bindingAnalysis: TypedDeclarationAnalysis["bindingAnalysis"];
  analysis: TypedDeclarationAnalysis;
  diagnostics: readonly DslDiagnostic[];
  /** Task 48: the real span index for `source` (from the same parse the
   * fixture's own statements came from), reused by every sibling compiler
   * test that needs to call its own compiler function against this fixture's
   * output - never a fake/stub context. */
  spans: DiagnosticSpanContext;
};

export const typedDeclarationAnalysisFor = (
  source: string,
  options: { readonly expectNoDiagnostics?: boolean } = {}
): TypedDeclarationAnalysisFixture => {
  const parsed = parseDsl(source);
  expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  const statements = parsed.statements;
  const spans: DiagnosticSpanContext = { sourceMap: parsed.sourceMap, logicalStatementByRangeFrom: parsed.logicalStatementByRangeFrom };
  const compiled = compileDslToElements(source, { elements: [], mode: "document", majorVersion: 1 });
  expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  const elementIdByStatementIndex = compiled.elementIdsByStatementIndex ?? new Map();
  const stableStatementIdByIndex = new Map<number, string>(statements.map((_, index) => [index, `stable-${index}`]));
  for (const [statementIndex, elementId] of elementIdByStatementIndex) stableStatementIdByIndex.set(statementIndex, elementId);
  const sourceNamespace = buildSourceLexicalNamespaceIndex(statements, stableStatementIdByIndex);
  const scalarAnalysisCompilation = analyzeTypedDeclarations({
    statements,
    stableStatementIdByIndex,
    reconciledContainers: { elementIdByStatementIndex, elements: compiled.elements },
    spans,
    sourceNamespace
  });
  if (options.expectNoDiagnostics !== false) expect(scalarAnalysisCompilation.diagnostics).toEqual([]);
  return {
    statements,
    elementIdByStatementIndex,
    elements: compiled.elements,
    bindingAnalysis: scalarAnalysisCompilation.analysis!.bindingAnalysis,
    analysis: scalarAnalysisCompilation.analysis!,
    diagnostics: scalarAnalysisCompilation.diagnostics,
    spans
  };
};
