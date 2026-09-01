import type { CompiledDslDocument } from "../dsl/dslDocument";
import type { CanonicalDocumentValue } from "../document/canonicalDocument";
import { materializedRuntimeElementId } from "../dsl/moduleMaterialization";
import type { CanvasModuleMaterialization } from "../dsl/moduleMaterialization";
import { sourceOwnerByRuntimeElementId } from "../dsl/sourceOwnership";
import { evaluationStateIsCurrentFor, type EvaluationEngineState } from "../geometry/useEvaluationEngine";
import { resolveOwningModuleInstanceId } from "../commands/selectionCommands";
import { coordinatePointConversionTargetEligibility } from "../commands/coordinatePointConversion";
import { effectiveCompiledDocument, effectiveElements, useCadDocumentStore } from "../state/cadDocumentStore";
import type { CadSelectionSubject } from "../state/cadUiStore";
import type { CadElement, ElementId } from "../types/geometry";
import type {
  VscodeCanvasObservationElementSource,
  VscodeCanvasObservationIssueSummary,
  VscodeCanvasObservationSnapshot,
  VscodeCanvasObservationSelectionSubject
} from "./canvasObservationProtocol";

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
  const materialization = compiledDocument.moduleMaterialization;
  const statementIdsByIndex = compiledDocument.statementMap.statementIdByStatementIndex;
  const statementIndexesById = compiledDocument.statementMap.statementIndexByStatementId;

  return selectedElementIds.flatMap((runtimeElementId): VscodeCanvasObservationElementSource[] => {
    const owner = owners.get(runtimeElementId);
    const element = elementsById.get(runtimeElementId);
    if (!owner || !element) return [];
    if (owner.kind === "ordinary") {
      return [{
        runtimeElementId,
        sourceStatementIndex: owner.sourceStatementIndex,
        elementType: element.type
      }];
    }

    const runtimeIdentity = materialization?.runtimeIdentityByElementId.get(runtimeElementId);
    if (
      !runtimeIdentity ||
      runtimeIdentity.kind !== owner.kind ||
      materializedRuntimeElementId(runtimeIdentity.kind, runtimeIdentity.path) !== runtimeElementId ||
      !statementIdsByIndex ||
      !statementIndexesById
    ) return [];

    const sourceStatementPath: number[] = [];
    for (const statementId of runtimeIdentity.path) {
      const statementIndex = statementIndexesById.get(statementId);
      if (
        statementIndex === undefined ||
        statementIdsByIndex.get(statementIndex) !== statementId
      ) return [];
      sourceStatementPath.push(statementIndex);
    }
    if (sourceStatementPath.length === 0) return [];

    return [{
      runtimeElementId,
      runtimeKind: runtimeIdentity.kind,
      sourceStatementPath
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
  selectedElementId?: ElementId | null;
  selectedElementSources?: readonly VscodeCanvasObservationElementSource[];
  elements?: readonly CadElement[];
  document?: CanonicalDocumentValue;
  moduleMaterialization?: Pick<CanvasModuleMaterialization, "originByRuntimeElementId">;
  selectionSubject: CadSelectionSubject;
  compiledDocumentRevision: number;
  previewActive: boolean;
  evaluationState: EvaluationEngineState;
  /** Imported runtime IDs are not root-local source observations. */
  runtimePresentationActive?: boolean;
}): VscodeCanvasObservationSnapshot => {
  const selectedElementSources = input.runtimePresentationActive || input.selectionSubject.kind === "binding"
    ? []
    : input.selectedElementSources ?? currentSelectedElementSources(input.selectedElementIds);
  const selection = observationSelectionFor(
    input.selectionSubject,
    input.selectedElementIds,
    selectedElementSources
  );
  const errors = (input.evaluationState.evaluation.errors ?? []).map(issueSummary);
  const warnings = (input.evaluationState.evaluation.warnings ?? []).map(issueSummary);
  const canvasCanSelectInstance = resolveOwningModuleInstanceId({
    selectedElementId: input.selectedElementId,
    elements: input.elements ?? [],
    moduleMaterialization: input.moduleMaterialization
  }) !== null;
  const coordinatePointConversionTargetIds = input.document &&
    !input.runtimePresentationActive &&
    !input.previewActive &&
    evaluationStateIsCurrentFor(input.evaluationState, input.compiledDocumentRevision) &&
    selection.selectionSubject.kind === "elements"
    ? selection.selectedElementIds.filter((elementId) => coordinatePointConversionTargetEligibility({
        document: input.document!,
        evaluation: input.evaluationState.evaluation
      }, elementId).eligible)
    : [];

  return {
    documentVersion: input.documentVersion,
    selectedElementIds: selection.selectedElementIds,
    coordinatePointConversionTargetIds,
    canvasCanSelectInstance,
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
