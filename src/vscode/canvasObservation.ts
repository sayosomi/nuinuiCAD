import type { CompiledDslDocument } from "../dsl/dslDocument";
import { sourceOwnerByRuntimeElementId } from "../dsl/sourceOwnership";
import { evaluationStateIsCurrentFor, type EvaluationEngineState } from "../geometry/useEvaluationEngine";
import { effectiveCompiledDocument, effectiveElements, useCadDocumentStore } from "../state/cadDocumentStore";
import type { CadSelectionSubject } from "../state/cadUiStore";
import type { CadElement } from "../types/geometry";
import type {
  VscodeCanvasObservationElementSource,
  VscodeCanvasObservationIssueSummary,
  VscodeCanvasObservationSnapshot,
  VscodeCanvasObservationSelectionSubject
} from "./protocol";

export const selectedElementSourcesForCanvasObservation = (
  selectedElementIds: readonly string[],
  compiledDocument: CompiledDslDocument,
  elements: readonly CadElement[]
): VscodeCanvasObservationElementSource[] => {
  if (!compiledDocument.statementMap) return [];
  const owners = sourceOwnerByRuntimeElementId({
    ...compiledDocument,
    statementMap: compiledDocument.statementMap
  });
  const elementsById = new Map(elements.map((element) => [element.id, element] as const));

  return selectedElementIds.flatMap((runtimeElementId) => {
    const owner = owners.get(runtimeElementId);
    const element = elementsById.get(runtimeElementId);
    if (!owner || owner.kind !== "ordinary" || !element) return [];
    return [{
      runtimeElementId,
      sourceStatementIndex: owner.sourceStatementIndex,
      elementType: element.type
    }];
  });
};

const currentSelectedElementSources = (
  selectedElementIds: readonly string[]
): VscodeCanvasObservationElementSource[] => {
  const state = useCadDocumentStore.getState();
  return selectedElementSourcesForCanvasObservation(
    selectedElementIds,
    effectiveCompiledDocument(state),
    effectiveElements(state)
  );
};

const observationSelectionFor = (
  selectionSubject: CadSelectionSubject,
  selectedElementIds: readonly string[],
  selectedElementSources: readonly VscodeCanvasObservationElementSource[]
): {
  selectionSubject: VscodeCanvasObservationSelectionSubject;
  selectedElementIds: readonly string[];
  selectedElementSources: readonly VscodeCanvasObservationElementSource[];
} => selectionSubject.kind === "binding"
  ? {
      selectionSubject: { kind: "binding", bindingId: selectionSubject.bindingId },
      selectedElementIds: [],
      selectedElementSources: []
    }
  : {
      selectionSubject: { kind: "elements" },
      selectedElementIds: [...selectedElementIds],
      selectedElementSources: selectedElementSources.filter((source) =>
        selectedElementIds.includes(source.runtimeElementId)
      )
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
  selectedElementSources?: readonly VscodeCanvasObservationElementSource[];
  selectionSubject: CadSelectionSubject;
  compiledDocumentRevision: number;
  previewActive: boolean;
  evaluationState: EvaluationEngineState;
}): VscodeCanvasObservationSnapshot => {
  const selectedElementSources = input.selectionSubject.kind === "binding"
    ? []
    : input.selectedElementSources ?? currentSelectedElementSources(input.selectedElementIds);
  const selection = observationSelectionFor(
    input.selectionSubject,
    input.selectedElementIds,
    selectedElementSources
  );
  const errors = (input.evaluationState.evaluation.errors ?? []).map(issueSummary);
  const warnings = (input.evaluationState.evaluation.warnings ?? []).map(issueSummary);

  return {
    documentVersion: input.documentVersion,
    selectedElementIds: selection.selectedElementIds,
    selectedElementSources: selection.selectedElementSources,
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
