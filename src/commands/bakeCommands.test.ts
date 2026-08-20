import { beforeEach, describe, expect, it } from "vitest";
import { dispatchCommand } from "./commands";
import { evaluateElements } from "../geometry/evaluate";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";

const source = [
  "nui 4",
  "point Dependency = coordinate(x: 0, y: 0, state: disabled)",
  "line Broken = segment(start: @Dependency, end: (10, 0), state: disabled)"
].join("\n");

describe("Bake command sandbox boundary", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.getState().replaceTextDocument(source, {
      currentFilePath: null,
      dirtySinceSave: false
    });
    const broken = useCadDocumentStore.getState().elements.find((element) => element.name === "Broken")!;
    useCadUiStore.getState().setSelectedElementId(broken.id);
  });

  const currentEvaluation = () => {
    const state = useCadDocumentStore.getState();
    return evaluateElements(state.elements, buildEvaluationOptions({
      compiledDocument: state.doc,
      evaluationLimitIndex: state.evaluationLimitIndex
    }));
  };

  it("does not mutate source when disabled inclusion requires an unavailable sandbox", () => {
    const result = dispatchCommand("bakeCurrentShape", {
      evaluation: currentEvaluation(),
      evaluationIsCurrent: true,
      includeDisabledGeometry: true,
      emitSkippedComments: true
    });

    expect(result).toBe(false);
    expect(useCadDocumentStore.getState().sourceText).toBe(source);
    expect(useCadDocumentStore.getState().sourceText).not.toContain("Bake skipped:");
  });

  it("does not mutate source when the supplied sandbox revision is stale", async () => {
    const state = useCadDocumentStore.getState();
    const broken = state.elements.find((element) => element.name === "Broken")!;
    const receivedTargetIds: string[][] = [];
    const result = await dispatchCommand("bakeCurrentShape", {
      evaluation: currentEvaluation(),
      evaluationIsCurrent: true,
      includeDisabledGeometry: true,
      emitSkippedComments: true,
      prepareBakeSandbox: async (targetIds) => {
        receivedTargetIds.push([...targetIds]);
        return {
          evaluation: currentEvaluation(),
          targetIds,
          compiledDocumentRevision: state.compiledDocumentRevision - 1
        };
      }
    });

    expect(result).toBe(false);
    expect(receivedTargetIds).toEqual([[broken.id]]);
    expect(useCadDocumentStore.getState().sourceText).toBe(source);
    expect(useCadDocumentStore.getState().sourceText).not.toContain("Bake skipped:");
  });
});
