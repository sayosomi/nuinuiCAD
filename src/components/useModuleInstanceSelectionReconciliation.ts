import { useEffect } from "react";
import type { CanvasTextWidthMeasurer } from "../geometry/canvasDrawingBounds";
import { evaluationStateIsCurrentFor, type EvaluationEngineState } from "../geometry/useEvaluationEngine";
import { reconcileModuleInstanceSelection } from "../model/moduleInstanceSelection";
import { effectiveElements, useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { EvaluationResult } from "../types/geometry";

type ModuleInstanceSelectionReconciliationInput = {
  evaluation: EvaluationResult;
  evaluationState?: EvaluationEngineState;
  measureCanvasTextWidth?: CanvasTextWidthMeasurer;
};

/** Keep concrete Module-instance selection valid for both Canvas hosts. */
export const useModuleInstanceSelectionReconciliation = ({
  evaluation,
  evaluationState,
  measureCanvasTextWidth
}: ModuleInstanceSelectionReconciliationInput) => {
  const elements = useCadDocumentStore(effectiveElements);
  const compiledDocumentRevision = useCadDocumentStore((state) => state.compiledDocumentRevision);
  const visibilityProfiles = useCadDocumentStore((state) => state.visibilityProfiles);
  const activeVisibilityProfileId = useCadDocumentStore((state) => state.activeVisibilityProfileId);
  const moduleMaterialization = useCadDocumentStore((state) => state.doc.moduleMaterialization);
  const selectedElementId = useCadUiStore((state) => state.selectedElementId);
  const selectedElementIds = useCadUiStore((state) => state.selectedElementIds);
  const selectionAnchorElementId = useCadUiStore((state) => state.selectionAnchorElementId);

  useEffect(() => {
    if (!evaluationState || !evaluationStateIsCurrentFor(evaluationState, compiledDocumentRevision)) return;
    const reconciliation = reconcileModuleInstanceSelection({
      selection: {
        selectedElementId,
        selectedElementIds,
        selectionAnchorElementId
      },
      evaluationIsCurrent: true,
      elements,
      evaluation,
      moduleMaterialization,
      visibilityProfiles,
      activeVisibilityProfileId,
      measureCanvasTextWidth
    });
    if (!reconciliation) return;
    useCadUiStore.getState().applySelection(elements, reconciliation.selection);
  }, [
    activeVisibilityProfileId,
    compiledDocumentRevision,
    elements,
    evaluation,
    evaluationState,
    measureCanvasTextWidth,
    moduleMaterialization,
    selectedElementId,
    selectedElementIds,
    selectionAnchorElementId,
    visibilityProfiles
  ]);
};
