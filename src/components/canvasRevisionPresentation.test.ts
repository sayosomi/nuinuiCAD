import { describe, expect, it } from "vitest";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import type { CadElement, EvaluationResult, VisibilityProfile } from "../types/geometry";
import {
  resolveRevisionCoherentCanvasPresentation,
  type CanvasRevisionPresentationInputs,
  type CanvasRevisionPresentationSnapshot
} from "./canvasRevisionPresentation";

const point = (id: string, name: string, x: number): CadElement => ({
  id,
  name,
  type: "freePoint",
  activity: "visible",
  x,
  y: 0
});

const inputs = (id: string): CanvasRevisionPresentationInputs => ({
  elements: [point(id, id.toUpperCase(), id === "old" ? 0 : 10)],
  canonicalElements: [point(id, id.toUpperCase(), id === "old" ? 0 : 10)],
  evaluationLimitIndex: undefined,
  visibilityProfiles: [] as VisibilityProfile[],
  activeVisibilityProfileId: null,
  moduleSemanticContext: {}
});

const evaluation = (id: string) => ({ id } as unknown as EvaluationResult);

const evaluationState = (
  revision: number,
  requestRevision: number,
  isStale: boolean,
  result: EvaluationResult = evaluation(`revision-${revision}`)
): EvaluationEngineState => ({
  evaluation: result,
  evaluationRevision: revision,
  evaluationRequestRevision: requestRevision,
  mode: "rust",
  source: "rust",
  status: isStale ? "evaluating" : "ready",
  rustEligible: true,
  isStale,
  error: null
});

describe("revision-coherent Canvas presentation", () => {
  it("keeps the previous full presentation while a newer evaluation is stale", () => {
    const oldInputs = inputs("old");
    const currentInputs = inputs("new");
    const oldEvaluation = evaluation("old");
    const stable: CanvasRevisionPresentationSnapshot = {
      evaluationRevision: 7,
      evaluationRequestRevision: 41,
      inputs: oldInputs,
      evaluation: oldEvaluation
    };

    const resolved = resolveRevisionCoherentCanvasPresentation({
      current: currentInputs,
      evaluation: evaluation("new-pending"),
      compiledDocumentRevision: 8,
      evaluationState: evaluationState(7, 41, true, oldEvaluation),
      lastStable: stable
    });

    expect(resolved.elements.map((element) => element.id)).toEqual(["old"]);
    expect(resolved.renderEvaluation).toBe(oldEvaluation);
    expect(resolved.renderEvaluationState?.isStale).toBe(true);
  });

  it("keeps the accepted stable snapshot instead of pairing an unrelated stale request with current metadata", () => {
    const currentInputs = inputs("new");
    const oldEvaluation = evaluation("old");
    const stable: CanvasRevisionPresentationSnapshot = {
      evaluationRevision: 7,
      evaluationRequestRevision: 40,
      inputs: inputs("old"),
      evaluation: oldEvaluation
    };
    const unrelatedStaleEvaluation = evaluation("unaccepted-intermediate");

    const resolved = resolveRevisionCoherentCanvasPresentation({
      current: currentInputs,
      evaluation: unrelatedStaleEvaluation,
      compiledDocumentRevision: 9,
      evaluationState: evaluationState(8, 41, true, unrelatedStaleEvaluation),
      lastStable: stable
    });

    expect(resolved.elements.map((element) => element.id)).toEqual(["old"]);
    expect(resolved.renderEvaluation).toBe(oldEvaluation);
    expect(resolved.renderEvaluationState).toMatchObject({
      evaluationRevision: 7,
      evaluationRequestRevision: 40,
      isStale: true
    });
  });

  it("fails closed when a stale request has no accepted previous presentation", () => {
    const staleEvaluation = evaluation("first-stale");
    const resolved = resolveRevisionCoherentCanvasPresentation({
      current: inputs("new"),
      evaluation: staleEvaluation,
      compiledDocumentRevision: 2,
      evaluationState: evaluationState(1, 10, true, staleEvaluation),
      lastStable: null
    });

    expect(resolved.elements).toEqual([]);
    expect(resolved.canonicalElements).toEqual([]);
    expect(resolved.isPinned).toBe(true);
  });

  it("promotes current document inputs atomically when the newer evaluation resolves", () => {
    const currentInputs = inputs("new");
    const currentEvaluation = evaluation("new");
    const stable: CanvasRevisionPresentationSnapshot = {
      evaluationRevision: 7,
      evaluationRequestRevision: 41,
      inputs: inputs("old"),
      evaluation: evaluation("old")
    };

    const resolved = resolveRevisionCoherentCanvasPresentation({
      current: currentInputs,
      evaluation: currentEvaluation,
      compiledDocumentRevision: 8,
      evaluationState: evaluationState(8, 42, false, currentEvaluation),
      lastStable: stable
    });

    expect(resolved.elements.map((element) => element.id)).toEqual(["new"]);
    expect(resolved.renderEvaluation).toBe(currentEvaluation);
    expect(resolved.isPinned).toBe(false);
  });

  it("keeps the previous render and makes it non-authoritative when an errorful editor revision finishes evaluation", () => {
    const oldInputs = inputs("old");
    const errorfulInputs = inputs("new");
    const oldEvaluation = evaluation("old");
    const errorfulEvaluation = evaluation("errorful");
    const stable: CanvasRevisionPresentationSnapshot = {
      evaluationRevision: 7,
      evaluationRequestRevision: 41,
      inputs: oldInputs,
      evaluation: oldEvaluation
    };

    const resolved = resolveRevisionCoherentCanvasPresentation({
      current: errorfulInputs,
      evaluation: errorfulEvaluation,
      compiledDocumentRevision: 8,
      evaluationState: evaluationState(8, 42, false, errorfulEvaluation),
      lastStable: stable,
      holdLastStable: true
    });

    expect(resolved.elements.map((element) => element.id)).toEqual(["old"]);
    expect(resolved.renderEvaluation).toBe(oldEvaluation);
    expect(resolved.renderEvaluationState).toMatchObject({
      evaluationRevision: 7,
      evaluationRequestRevision: 41,
      isStale: true
    });
    expect(resolved.renderEvaluationState?.evaluation).toBe(oldEvaluation);
    expect(resolved.isPinned).toBe(true);
  });
});
