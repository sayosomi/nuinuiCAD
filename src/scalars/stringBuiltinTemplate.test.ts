import { describe, expect, it } from "vitest";
import { compileDslToElements } from "../dsl/dslCompiler";
import { parseDsl } from "../dsl/dslParser";
import type { DiagnosticSpanContext } from "../dsl/dslDiagnosticSpan";
import type { CadElement, ElementId } from "../types/geometry";
import type { BindingAnalysis } from "./bindingAnalysis";
import { propertyBindingOccurrenceKey } from "./propertyBindingCompiler";
import { compileTextTemplates, TEXT_TEMPLATE_HOLE_TYPE_MISMATCH_CODE } from "./textTemplate";
import { analyzeTypedDeclarations } from "./typedDeclarationAnalysis";

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
  const spans: DiagnosticSpanContext = {
    sourceMap: parsed.sourceMap,
    logicalStatementByRangeFrom: parsed.logicalStatementByRangeFrom
  };
  const compiled = compileDslToElements(source, { elements: [], mode: "document", majorVersion: 1 });
  expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  const elementIdByStatementIndex = compiled.elementIdsByStatementIndex ?? new Map();
  const stableStatementIdByIndex = new Map<number, string>(statements.map((_, index) => [index, `stable-${index}`]));
  for (const [statementIndex, elementId] of elementIdByStatementIndex) {
    stableStatementIdByIndex.set(statementIndex, elementId);
  }
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

const compileTemplatesFor = (source: string) => compileTextTemplates(compileFor(source));

describe("nui1 string(choice) text-template surface", () => {
  it("accepts explicit string(@choice) as a string hole", () => {
    const compiled = compileTemplatesFor([
      "const side: choice(right, left) = right",
      'text T = label(text: "side=${string(@side)}", anchor: none, size: 3)'
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    const template = compiled.templatesByOccurrenceKey.get(propertyBindingOccurrenceKey(1, "text"));
    expect(template).toBeDefined();
    expect(template?.segments.find((segment) => segment.kind === "hole")).toMatchObject({
      kind: "hole",
      holeKind: "string",
      expression: {
        kind: "call",
        target: { kind: "builtin", name: "string" },
        type: { kind: "string" }
      }
    });
  });

  it("keeps direct choice interpolation rejected", () => {
    const compiled = compileTemplatesFor([
      "const side: choice(right, left) = right",
      'text T = label(text: "side=${@side}", anchor: none, size: 3)'
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([
      expect.objectContaining({ code: TEXT_TEMPLATE_HOLE_TYPE_MISMATCH_CODE })
    ]);
  });
});
