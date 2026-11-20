import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import type { CadElement, EvaluationResult, VisibilityProfile } from "../types/geometry";
import {
  resolveRevisionCoherentCanvasPresentation,
  useRevisionCoherentCanvasPresentation,
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
  moduleSemanticContext: {},
  canvasLayerSourceDocuments: []
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
  it("keeps the image owner resolver paired with last-good geometry", () => {
    const oldResolver = (sourcePath: string, elementId?: string) =>
      elementId === "old-root-image" ? `old-root:${sourcePath}` : "data:,";
    const currentResolver = (sourcePath: string, elementId?: string) =>
      elementId === "new-root-image" ? `new-root:${sourcePath}` : "data:,";
    const oldInputs = { ...inputs("old"), resolveImageSourceUrl: oldResolver };
    const currentInputs = { ...inputs("new"), resolveImageSourceUrl: currentResolver };
    const oldEvaluation = evaluation("old");
    const stable: CanvasRevisionPresentationSnapshot = {
      evaluationRevision: 7,
      evaluationRequestRevision: 40,
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
    expect(resolved.resolveImageSourceUrl?.("./reference.png", "old-root-image")).toBe("old-root:./reference.png");
    expect(resolved.resolveImageSourceUrl?.("./reference.png", "new-root-image")).toBe("data:,");
  });

  it("pins compiler layer metadata with stale geometry while current visibility state stays external", () => {
    const oldInputs = {
      ...inputs("old"),
      canvasLayerSourceDocuments: [{
        documentId: "old-document",
        declarations: [{ identity: "layer:old", name: "old-layer", ownerPath: [] }],
        membershipsBySourceStatementId: [],
        membershipsByElementId: []
      }]
    };
    const newInputs = {
      ...inputs("new"),
      canvasLayerSourceDocuments: [{
        documentId: "new-document",
        declarations: [{ identity: "layer:new", name: "new-layer", ownerPath: [] }],
        membershipsBySourceStatementId: [],
        membershipsByElementId: []
      }]
    };
    const stableEvaluation = evaluation("old-stable");
    const stableSnapshot: CanvasRevisionPresentationSnapshot = {
      evaluationRevision: 7,
      evaluationRequestRevision: 70,
      inputs: oldInputs,
      evaluation: stableEvaluation
    };
    const resolved = resolveRevisionCoherentCanvasPresentation({
      current: newInputs,
      evaluation: evaluation("new-pending"),
      compiledDocumentRevision: 8,
      evaluationState: evaluationState(7, 71, true),
      lastStable: stableSnapshot
    });

    expect(resolved.isPinned).toBe(true);
    expect(resolved.renderEvaluation).toBe(stableEvaluation);
    expect(resolved.canvasLayerSourceDocuments).toBe(oldInputs.canvasLayerSourceDocuments);
  });

  it.each([
    { mode: "rust", source: "rust", status: "evaluating", usable: false },
    { mode: "rust", source: "rust", status: "failed", usable: false },
    { mode: "rust", source: "rust", status: "ready", usable: true },
    { mode: "rust", source: "fallback", status: "failed", usable: true },
    { mode: "reference", source: "reference", status: "idle", usable: true },
    { mode: "parity", source: "reference", status: "evaluating", usable: true },
    { mode: "shadow", source: "reference", status: "failed", usable: true },
    { mode: "shadow", source: "rust", status: "evaluating", usable: false }
  ] as const)("$mode/$source/$status retains only evaluated content ($usable)", ({ mode, source, status, usable }) => {
    const current = inputs("new");
    const result = evaluation("new");
    const state: EvaluationEngineState = { ...evaluationState(8, 42, false, result), mode, source, status };
    const hook = renderHook(({ holdLastStable }) => useRevisionCoherentCanvasPresentation({
      current, evaluation: result, compiledDocumentRevision: 8, evaluationState: state, holdLastStable
    }), { initialProps: { holdLastStable: false } });
    expect(hook.result.current.hasCoherentSnapshot).toBe(usable);
    hook.rerender({ holdLastStable: true });
    // Exercise the retention effect, not a hand-built lastStable snapshot.
    expect(hook.result.current.hasCoherentSnapshot).toBe(usable);
    expect(hook.result.current.isPinned).toBe(true);
  });

  it.each(["evaluating", "failed"] as const)("does not replace accepted geometry with a same-revision Rust %s placeholder", status => {
    const accepted = evaluation("accepted");
    const current = inputs("old");
    const hook = renderHook(({ state, holdLastStable }) => useRevisionCoherentCanvasPresentation({
      current, evaluation: state.evaluation, compiledDocumentRevision: 8, evaluationState: state, holdLastStable
    }), { initialProps: { state: evaluationState(8, 41, false, accepted), holdLastStable: false } });
    const placeholder: EvaluationEngineState = { ...evaluationState(8, 42, false, evaluation("empty")), status };
    hook.rerender({ state: placeholder, holdLastStable: false });
    expect(hook.result.current.renderEvaluation).toBe(accepted);
    hook.rerender({ state: placeholder, holdLastStable: true });
    expect(hook.result.current.renderEvaluation).toBe(accepted);
    expect(hook.result.current.renderEvaluationState?.evaluationRequestRevision).toBe(41);
    const ready = evaluation("completed");
    hook.rerender({ state: evaluationState(8, 43, false, ready), holdLastStable: false });
    expect(hook.result.current.renderEvaluation).toBe(ready);
    expect(hook.result.current.isPinned).toBe(false);
  });

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

describe("Host graph frame provenance", () => {
  const graphInputs = { ...inputs("old"), graphRootDocumentId: "root-a" };

  it("holds a same-root graph frame through local readiness and graph errors until a current graph result arrives", () => {
    const accepted = evaluation("accepted graph");
    const local = evaluation("local fallback");
    const failed = evaluation("failed graph");
    const completed = evaluation("committed graph");
    const hook = renderHook(({ current, state, awaitingGraph }) => useRevisionCoherentCanvasPresentation({
      current,
      evaluation: state.evaluation,
      evaluationState: state,
      compiledDocumentRevision: state.evaluationRevision,
      scopeKey: "root-a",
      awaitingGraph
    }), { initialProps: { current: graphInputs as CanvasRevisionPresentationInputs, state: evaluationState(10, 40, false, accepted), awaitingGraph: false } });

    hook.rerender({ current: inputs("new"), state: evaluationState(11, 41, false, local), awaitingGraph: true });
    expect(hook.result.current.renderEvaluation).toBe(accepted);
    expect(hook.result.current.renderEvaluationState).toMatchObject({ evaluationRevision: 10, isStale: true });
    expect(hook.result.current.graphRootDocumentId).toBe("root-a");
    hook.rerender({
      current: graphInputs,
      state: { ...evaluationState(12, 42, false, failed), status: "failed" },
      awaitingGraph: false
    });
    expect(hook.result.current.renderEvaluation).toBe(accepted);
    hook.rerender({ current: graphInputs, state: evaluationState(13, 43, false, completed), awaitingGraph: false });
    expect(hook.result.current.renderEvaluation).toBe(completed);
    expect(hook.result.current.isPinned).toBe(false);

    for (const late of [evaluationState(12, 42, false, failed), evaluationState(13, 42, false, failed)]) {
      hook.rerender({ current: graphInputs, state: late, awaitingGraph: false });
      expect(hook.result.current.renderEvaluation).toBe(completed);
      expect(hook.result.current.renderEvaluationState?.isStale).toBe(true);
    }
  });

  it.each(["root-b", "root-a:reopen", null])("discards the last graph on a change of Host identity to %s", scopeKey => {
    const accepted = evaluation("accepted");
    const pending = evaluation("pending");
    const useFrame = ({ scope, state }: { scope: string | null; state: EvaluationEngineState }) =>
      useRevisionCoherentCanvasPresentation({
        current: graphInputs,
        evaluation: state.evaluation,
        evaluationState: state,
        compiledDocumentRevision: 10,
        scopeKey: scope,
        awaitingGraph: state.isStale
      });
    const hook = renderHook(useFrame, {
      initialProps: { scope: "root-a" as string | null, state: evaluationState(10, 40, false, accepted) }
    });
    const pendingState = evaluationState(10, 41, true, pending);
    hook.rerender({ scope: scopeKey, state: pendingState });
    expect(hook.result.current.hasCoherentSnapshot).toBe(false);
    expect(hook.result.current.elements).toEqual([]);
    hook.rerender({ scope: "root-a", state: pendingState });
    expect(hook.result.current.renderEvaluation).toBe(pending);

    hook.rerender({ scope: "root-a", state: evaluationState(10, 42, false, accepted) });
    hook.unmount();
    const reopened = renderHook(useFrame, { initialProps: { scope: "root-a", state: pendingState } });
    expect(reopened.result.current.hasCoherentSnapshot).toBe(false);
    expect(reopened.result.current.elements).toEqual([]);
  });
});
