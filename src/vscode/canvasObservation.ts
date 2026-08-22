import { evaluationStateIsCurrentFor, type EvaluationEngineState } from "../geometry/useEvaluationEngine";
import type { CadSelectionSubject } from "../state/cadUiStore";
import type {
  VscodeCanvasObservationIssueSummary,
  VscodeCanvasObservationSnapshot,
  VscodeCanvasObservationSelectionSubject
} from "./protocol";

const observationSelectionFor = (
  selectionSubject: CadSelectionSubject,
  selectedElementIds: readonly string[]
): {
  selectionSubject: VscodeCanvasObservationSelectionSubject;
  selectedElementIds: readonly string[];
} => selectionSubject.kind === "binding"
  ? {
      selectionSubject: { kind: "binding", bindingId: selectionSubject.bindingId },
      selectedElementIds: []
    }
  : {
      selectionSubject: { kind: "elements" },
      selectedElementIds: [...selectedElementIds]
    };

const issueSummary = (
  issue: { elementId: string; elementName: string; message: string }
): VscodeCanvasObservationIssueSummary => ({
  elementId: issue.elementId,
  elementName: issue.elementName,
  message: issue.message
});

export const canvasObservationSnapshot = (input: {
  documentVersion: number;
  selectedElementIds: readonly string[];
  selectionSubject: CadSelectionSubject;
  compiledDocumentRevision: number;
  previewActive: boolean;
  evaluationState: EvaluationEngineState;
}): VscodeCanvasObservationSnapshot => {
  const selection = observationSelectionFor(input.selectionSubject, input.selectedElementIds);
  const errors = (input.evaluationState.evaluation.errors ?? []).map(issueSummary);
  const warnings = (input.evaluationState.evaluation.warnings ?? []).map(issueSummary);

  return {
    documentVersion: input.documentVersion,
    selectedElementIds: selection.selectedElementIds,
    selectionSubject: selection.selectionSubject,
    compiledDocumentRevision: input.compiledDocumentRevision,
    previewActive: input.previewActive,
    evaluationRevision: input.evaluationState.evaluationRevision,
    evaluationRequestRevision: input.evaluationState.evaluationRequestRevision,
    evaluationStatus: input.evaluationState.status,
    evaluationSource: input.evaluationState.source,
    rustEligible: input.evaluationState.rustEligible,
    isStale: input.evaluationState.isStale,
    isCurrent: evaluationStateIsCurrentFor(
      input.evaluationState,
      input.compiledDocumentRevision
    ),
    errorCount: errors.length,
    warningCount: warnings.length,
    errorSummaries: errors,
    warningSummaries: warnings
  };
};
