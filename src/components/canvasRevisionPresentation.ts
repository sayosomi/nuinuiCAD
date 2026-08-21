import { useLayoutEffect, useRef } from "react";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import type { ModuleSemanticCandidateContext } from "../model/moduleSemanticCandidateBoundary";
import type {
  CadElement,
  DocumentPalette,
  VisibilityProfile
} from "../types/geometry";

/** Document-owned Canvas inputs that must travel with one evaluation request. */
export type CanvasRevisionPresentationInputs = {
  elements: CadElement[];
  canonicalElements: CadElement[];
  evaluationLimitIndex: number | undefined;
  palette: DocumentPalette;
  visibilityProfiles: VisibilityProfile[];
  activeVisibilityProfileId: string | null;
  moduleSemanticContext: ModuleSemanticCandidateContext;
};

export type CanvasRevisionPresentationSnapshot = {
  evaluationRevision: number;
  evaluationRequestRevision: number;
  inputs: CanvasRevisionPresentationInputs;
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

export const resolveRevisionCoherentCanvasPresentation = ({
  current,
  compiledDocumentRevision,
  evaluationState,
  lastStable
}: {
  current: CanvasRevisionPresentationInputs;
  compiledDocumentRevision: number;
  evaluationState?: EvaluationEngineState;
  lastStable: CanvasRevisionPresentationSnapshot | null;
}): CanvasRevisionPresentationInputs => {
  if (!evaluationState) return current;
  if (!evaluationState.isStale && evaluationState.evaluationRevision === compiledDocumentRevision) {
    return current;
  }
  if (
    lastStable &&
    lastStable.evaluationRevision === evaluationState.evaluationRevision &&
    lastStable.evaluationRequestRevision === evaluationState.evaluationRequestRevision
  ) {
    return lastStable.inputs;
  }
  // Never pair a stale evaluation with unrelated current-document metadata.
  // Normal transitions have an exact lastStable match; a remount or otherwise
  // unidentified stale request fails closed until a coherent evaluation arrives.
  return EMPTY_CANVAS_PRESENTATION;
};

/**
 * Keeps render-owned document metadata paired with the evaluation request that
 * produced the geometry. Current host revision/callbacks remain outside this
 * snapshot, so DrawingCanvas interaction guards continue to fail closed while
 * the rendered evaluation is stale.
 */
export const useRevisionCoherentCanvasPresentation = ({
  current,
  compiledDocumentRevision,
  evaluationState
}: {
  current: CanvasRevisionPresentationInputs;
  compiledDocumentRevision: number;
  evaluationState?: EvaluationEngineState;
}) => {
  const lastStableRef = useRef<CanvasRevisionPresentationSnapshot | null>(null);
  const resolved = resolveRevisionCoherentCanvasPresentation({
    current,
    compiledDocumentRevision,
    evaluationState,
    lastStable: lastStableRef.current
  });

  useLayoutEffect(() => {
    if (!evaluationState) return;
    if (evaluationState.isStale || evaluationState.evaluationRevision !== compiledDocumentRevision) return;
    lastStableRef.current = {
      evaluationRevision: evaluationState.evaluationRevision,
      evaluationRequestRevision: evaluationState.evaluationRequestRevision,
      inputs: current
    };
  }, [compiledDocumentRevision, current, evaluationState]);

  return resolved;
};
