import type { LegacyDocumentPalette } from "../palette/palette";
import { useLayoutEffect, useState } from "react";
import type {
  EvaluationEngineState } from "../geometry/useEvaluationEngine";
import type { ModuleSemanticCandidateContext } from "../model/moduleSemanticCandidateBoundary";
import type {
  CadElement,
  EvaluationResult,
  VisibilityProfile
} from "../types/geometry";

/** Document-owned Canvas inputs that must travel with one evaluation request. */
export type CanvasRevisionPresentationInputs = {
  elements: CadElement[];
  canonicalElements: CadElement[];
  evaluationLimitIndex: number | undefined;
  palette: LegacyDocumentPalette;
  visibilityProfiles: VisibilityProfile[];
  activeVisibilityProfileId: string | null;
  moduleSemanticContext: ModuleSemanticCandidateContext;
};

export type CanvasRevisionPresentationSnapshot = {
  evaluationRevision: number;
  evaluationRequestRevision: number;
  inputs: CanvasRevisionPresentationInputs;
  evaluation: EvaluationResult;
};

export type CanvasRevisionPresentation = CanvasRevisionPresentationInputs & {
  renderEvaluation: EvaluationResult;
  renderEvaluationState: EvaluationEngineState | undefined;
  isPinned: boolean;
};

const EMPTY_CANVAS_PRESENTATION: CanvasRevisionPresentationInputs = {
  elements: [],
  canonicalElements: [],
  evaluationLimitIndex: 0,
  palette: { colors: [], defaultColorId: "" },
  visibilityProfiles: [],
  activeVisibilityProfileId: null,
  moduleSemanticContext: {}
};

const stableCanvasPresentationByInstance = new WeakMap<object, CanvasRevisionPresentationSnapshot>();

const pinnedEvaluationState = (
  evaluationState: EvaluationEngineState | undefined,
  snapshot: CanvasRevisionPresentationSnapshot
): EvaluationEngineState | undefined => evaluationState
  ? {
      ...evaluationState,
      evaluation: snapshot.evaluation,
      evaluationRevision: snapshot.evaluationRevision,
      evaluationRequestRevision: snapshot.evaluationRequestRevision,
      isStale: true
    }
  : undefined;

const pinnedStablePresentation = (
  evaluationState: EvaluationEngineState | undefined,
  snapshot: CanvasRevisionPresentationSnapshot
): CanvasRevisionPresentation => ({
  ...snapshot.inputs,
  renderEvaluation: snapshot.evaluation,
  renderEvaluationState: pinnedEvaluationState(evaluationState, snapshot),
  isPinned: true
});

export const resolveRevisionCoherentCanvasPresentation = ({
  current,
  evaluation,
  compiledDocumentRevision,
  evaluationState,
  lastStable,
  holdLastStable = false
}: {
  current: CanvasRevisionPresentationInputs;
  evaluation: EvaluationResult;
  compiledDocumentRevision: number;
  evaluationState?: EvaluationEngineState;
  lastStable: CanvasRevisionPresentationSnapshot | null;
  holdLastStable?: boolean;
}): CanvasRevisionPresentation => {
  if (holdLastStable) {
    if (lastStable) return pinnedStablePresentation(evaluationState, lastStable);
    return {
      ...current,
      renderEvaluation: evaluation,
      renderEvaluationState: evaluationState
        ? { ...evaluationState, isStale: true }
        : undefined,
      isPinned: true
    };
  }

  if (!evaluationState) {
    return {
      ...current,
      renderEvaluation: evaluation,
      renderEvaluationState: undefined,
      isPinned: false
    };
  }
  if (!evaluationState.isStale && evaluationState.evaluationRevision === compiledDocumentRevision) {
    return {
      ...current,
      renderEvaluation: evaluation,
      renderEvaluationState: evaluationState,
      isPinned: false
    };
  }
  // Once a complete presentation has been accepted, it is safe to keep that
  // entire snapshot while any newer evaluation is pending. The snapshot owns
  // both its document metadata and its evaluation, so unlike the pre-SAY-102
  // path this never pairs geometry from one revision with metadata from another.
  // This also covers recovery from an errorful editor revision whose evaluation
  // completed but was deliberately never promoted to Canvas authority.
  if (lastStable) return pinnedStablePresentation(evaluationState, lastStable);

  // A remount or first-load stale request has no coherent previous presentation.
  // Fail closed until a coherent current evaluation arrives.
  return {
    ...EMPTY_CANVAS_PRESENTATION,
    renderEvaluation: evaluation,
    renderEvaluationState: evaluationState,
    isPinned: true
  };
};

/**
 * Keeps render-owned document metadata paired with the evaluation request that
 * produced the geometry. Current host revision/callbacks remain outside this
 * snapshot, so DrawingCanvas interaction guards continue to fail closed while
 * the rendered evaluation is stale.
 *
 * Recoverable editor errors are also non-authoritative for Canvas presentation:
 * while one is present, keep the previous complete render/evaluation snapshot
 * even if the partial document itself finishes evaluation successfully.
 */
export const useRevisionCoherentCanvasPresentation = ({
  current,
  evaluation,
  compiledDocumentRevision,
  evaluationState,
  holdLastStable = false
}: {
  current: CanvasRevisionPresentationInputs;
  evaluation: EvaluationResult;
  compiledDocumentRevision: number;
  evaluationState?: EvaluationEngineState;
  holdLastStable?: boolean;
}) => {
  const [instanceKey] = useState<object>(() => ({}));
  const lastStable = stableCanvasPresentationByInstance.get(instanceKey) ?? null;
  const resolved = resolveRevisionCoherentCanvasPresentation({
    current,
    evaluation,
    compiledDocumentRevision,
    evaluationState,
    lastStable,
    holdLastStable
  });
  const isStale = evaluationState?.isStale;
  const evaluationRevision = evaluationState?.evaluationRevision;
  const evaluationRequestRevision = evaluationState?.evaluationRequestRevision;

  useLayoutEffect(() => {
    if (
      holdLastStable ||
      isStale ||
      evaluationRevision === undefined ||
      evaluationRequestRevision === undefined ||
      evaluationRevision !== compiledDocumentRevision
    ) return;
    stableCanvasPresentationByInstance.set(instanceKey, {
      evaluationRevision,
      evaluationRequestRevision,
      inputs: current,
      evaluation
    });
  }, [
    compiledDocumentRevision,
    current,
    evaluation,
    evaluationRevision,
    evaluationRequestRevision,
    holdLastStable,
    instanceKey,
    isStale
  ]);

  return resolved;
};
