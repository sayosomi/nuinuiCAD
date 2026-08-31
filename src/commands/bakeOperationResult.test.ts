import { beforeEach, describe, expect, it } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { dispatchCommand } from "./commands";
import { isBakeCommandResult } from "./bakeOperationResult";

const replaceSource = (source: string) => {
  useCadDocumentStore.getState().replaceTextDocument(source, {
    currentFilePath: null,
    dirtySinceSave: false
  });
};

const currentEvaluation = () => {
  const state = useCadDocumentStore.getState();
  return evaluateElements(state.elements, buildEvaluationOptions({
    compiledDocument: state.doc,
    evaluationLimitIndex: state.evaluationLimitIndex
  }));
};

describe("Bake command operation result", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  it("preserves a structured skipped target when skipped comments are disabled", () => {
    const source = [
      "nui 1",
      "text Memo = label(text: \"memo\", anchor: none, size: 3)"
    ].join("\n");
    replaceSource(source);
    const memo = useCadDocumentStore.getState().elements.find((element) => element.name === "Memo")!;

    const result = dispatchCommand("bakeCurrentShape", {
      evaluation: currentEvaluation(),
      evaluationIsCurrent: true,
      bakeSelectedElementIds: [memo.id],
      emitSkippedComments: false
    });

    expect(isBakeCommandResult(result)).toBe(true);
    if (!isBakeCommandResult(result)) throw new Error("expected Bake command result");
    expect(result.status).toBe("noop");
    expect(result.bakeSummary).toEqual({
      successfulTargetCount: 0,
      skippedTargetCount: 1,
      skippedTargets: [
        expect.objectContaining({
          targetId: memo.id,
          sourceElementId: memo.id,
          sourceLabel: "text Memo",
          reason: { code: "unsupported-geometry-kind", geometryKind: "text" }
        })
      ]
    });
    expect(useCadDocumentStore.getState().sourceText).toBe(source);
  });

  it("returns the successful target count alongside an applied mutation", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 1, y: 2)"
    ].join("\n");
    replaceSource(source);
    const point = useCadDocumentStore.getState().elements.find((element) => element.name === "A")!;

    const result = dispatchCommand("bakeCurrentShape", {
      evaluation: currentEvaluation(),
      evaluationIsCurrent: true,
      bakeSelectedElementIds: [point.id],
      emitSkippedComments: false
    });

    expect(isBakeCommandResult(result)).toBe(true);
    if (!isBakeCommandResult(result)) throw new Error("expected Bake command result");
    expect(result.status).toBe("applied");
    expect(result.bakeSummary).toEqual({
      successfulTargetCount: 1,
      skippedTargetCount: 0,
      skippedTargets: []
    });
    expect(useCadDocumentStore.getState().sourceText).toContain("point A_bake = coordinate(x: 1, y: 2)");
  });
});
