import { describe, expect, it } from "vitest";
import { isLastGoodDslDocument } from "../document/canonicalDocument";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import type { CadElement } from "../types/geometry";
import { evaluateElements } from "./evaluate";
import { buildGeometrySourceFlowByRuntimeElementId } from "./geometrySourceFlow";
import { buildEvaluationOptions } from "./productionEvaluationContext";

const compileWithIds = (source: string, prefix = "flow") => {
  const parsed = parseDsl(source);
  const compiled = compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `${prefix}:${index}`] as const))
  });
  expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  expect(compiled.document).not.toBeNull();
  expect(compiled.statementMap).not.toBeNull();
  return compiled;
};

const evaluateCompiled = (compiled: CompiledDslDocument) => {
  if (!isLastGoodDslDocument(compiled)) throw new Error("expected a last-good compiled document");
  return evaluateElements(
    compiled.document.elements,
    buildEvaluationOptions({
      compiledDocument: compiled,
      evaluationLimitIndex: compiled.document.evaluationLimitIndex
    })
  );
};

const named = (compiled: CompiledDslDocument, name: string) => {
  const element = compiled.document?.elements.find((candidate) => candidate.name === name);
  if (!element) throw new Error(`missing ${name}`);
  return element;
};

const point = (id: string, x: number, y: number): CadElement => ({
  id, name: id, type: "freePoint", activity: "visible", x, y
});

describe("geometry source flow", () => {
  it("emits a declaration-only construction step", () => {
    const compiled = compileWithIds([
      "nui 4",
      "line AB = segment(start: (0, 0), end: (10, 0))"
    ].join("\n"));
    const evaluation = evaluateCompiled(compiled);
    const line = named(compiled, "AB");
    const flow = buildGeometrySourceFlowByRuntimeElementId(compiled, evaluation).get(line.id);

    expect(flow?.steps.map((step) => [step.kind, step.operation])).toEqual([["construction", "segment"]]);
  });

  it("preserves successful mutation execution order and exact authored spans", () => {
    const compiled = compileWithIds([
      "nui 4",
      "line AB = segment(start: (0, 0), end: (10, 0))",
      "reverse(target: @AB)",
      "reverse(target: @AB)"
    ].join("\n"));
    const evaluation = evaluateCompiled(compiled);
    const line = named(compiled, "AB");
    const flow = buildGeometrySourceFlowByRuntimeElementId(compiled, evaluation).get(line.id);
    const reverseStatements = compiled.statements.filter(
      (statement) => statement.kind === "element" && statement.construction === "reverse"
    );

    expect(evaluation.errors).toEqual([]);
    expect(flow?.steps.map((step) => [step.kind, step.operation])).toEqual([
      ["construction", "segment"],
      ["mutation", "reverse"],
      ["mutation", "reverse"]
    ]);
    expect(flow?.steps[1].sourceSpan).toEqual(reverseStatements[0]?.physicalSpan);
    expect(flow?.steps[2].sourceSpan).toEqual(reverseStatements[1]?.physicalSpan);
    expect(flow?.steps.every((step) => step.sourceStatementId.length > 0)).toBe(true);
  });

  it("does not turn ordinary geometry references into flow steps", () => {
    const compiled = compileWithIds([
      "nui 4",
      "line Source = segment(start: (0, 0), end: (10, 0))",
      "line Offset = offset(sources: [@Source], distance: 1, side: left, closed: false, suppressTrimWarnings: false)"
    ].join("\n"));
    const evaluation = evaluateCompiled(compiled);
    const flows = buildGeometrySourceFlowByRuntimeElementId(compiled, evaluation);

    expect(flows.get(named(compiled, "Source").id)?.steps.map((step) => step.operation)).toEqual(["segment"]);
    expect(flows.get(named(compiled, "Offset").id)?.steps.map((step) => step.operation)).toEqual(["offset"]);
  });

  it("excludes failed and disabled mutations from runtime facts", () => {
    const failed = evaluateElements([{
      id: "reverse", name: "", type: "pathReverse", activity: "visible", targetLineId: "missing"
    }]);
    const disabled = evaluateElements([
      point("a", 0, 0),
      point("b", 10, 0),
      {
        id: "line", name: "line", type: "line", activity: "visible",
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      { id: "reverse", name: "", type: "pathReverse", activity: "disabled", targetLineId: "line" }
    ]);

    expect(failed.geometryMutationExecutions).toEqual([]);
    expect(disabled.geometryMutationExecutions).toEqual([]);
  });

  it("maps for-generated runtime geometry and mutation occurrences back to authored template steps", () => {
    const compiled = compileWithIds([
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "for i in range(from: 0, count: 2, step: 1) {",
      "  line AB = segment(start: @A, end: @B)",
      "  reverse(target: @AB)",
      "}"
    ].join("\n"));
    const evaluation = evaluateCompiled(compiled);
    const lineRows = (evaluation.forGroupGeneratedRows ?? []).filter((row) => row.elementType === "line");
    const reverseRows = (evaluation.forGroupGeneratedRows ?? []).filter((row) => row.elementType === "pathReverse");
    const flows = buildGeometrySourceFlowByRuntimeElementId(compiled, evaluation);

    expect(lineRows).toHaveLength(2);
    expect(reverseRows).toHaveLength(2);
    for (const [index, row] of lineRows.entries()) {
      const flow = flows.get(row.generatedElementId);
      expect(flow?.steps.map((step) => step.operation)).toEqual(["segment", "reverse"]);
      expect(flow?.steps[0].runtimeOperationElementId).toBe(row.generatedElementId);
      expect(flow?.steps[1].runtimeOperationElementId).toBe(reverseRows[index]?.generatedElementId);
    }
  });

  it("maps separate module runtime occurrences to the same authoritative authored operations", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M() {",
      "  export line L = segment(start: (0, 0), end: (10, 0))",
      "  reverse(target: @L)",
      "}",
      "instance First = M()",
      "instance Second = M()"
    ].join("\n"), "module-flow");
    const evaluation = evaluateCompiled(compiled);
    const lines = compiled.document!.elements.filter((element) => element.name === "L");
    const flows = buildGeometrySourceFlowByRuntimeElementId(compiled, evaluation);

    expect(lines).toHaveLength(2);
    const first = flows.get(lines[0].id);
    const second = flows.get(lines[1].id);
    expect(first?.steps.map((step) => step.operation)).toEqual(["segment", "reverse"]);
    expect(second?.steps.map((step) => step.operation)).toEqual(["segment", "reverse"]);
    expect(first?.steps.map((step) => step.sourceStatementId)).toEqual(
      second?.steps.map((step) => step.sourceStatementId)
    );
    expect(first?.steps.map((step) => step.runtimeOperationElementId)).not.toEqual(
      second?.steps.map((step) => step.runtimeOperationElementId)
    );
  });
});
