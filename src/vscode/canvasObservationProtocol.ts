export type VscodeCanvasObservationSelectionSubject =
  | { kind: "elements" }
  | { kind: "binding"; bindingId: string };

export type VscodeCanvasObservationElementSource = {
  runtimeElementId: string;
  sourceStatementIndex: number;
  elementType: string;
} | {
  runtimeElementId: string;
  /** Runtime identity kind for a materialized Module element. */
  runtimeKind: "moduleInstance" | "moduleBody";
  /** The complete runtime identity path, expressed in current source indexes. */
  sourceStatementPath: readonly number[];
};

export type VscodeCanvasObservationIssueSummary = {
  elementId: string;
  elementName: string;
  message: string;
};

/** Compact JSON-safe facts published only from the ordinary canonical Canvas state. */
export type VscodeCanvasObservationSnapshot = {
  documentVersion: number;
  selectedElementIds: readonly string[];
  canvasCanSelectInstance: boolean;
  /** Source ownership used by agent-facing adapters to project runtime IDs into stable snapshot IDs. */
  selectedElementSources?: readonly VscodeCanvasObservationElementSource[];
  selectionSubject: VscodeCanvasObservationSelectionSubject;
  compiledDocumentRevision: number;
  previewActive: boolean;
  evaluationRevision: number;
  evaluationRequestRevision: number;
  evaluationStatus: "idle" | "evaluating" | "ready" | "failed";
  evaluationSource: "reference" | "rust" | "fallback";
  rustEligible: boolean;
  isStale: boolean;
  isCurrent: boolean;
  errorCount: number;
  warningCount: number;
  errorSummaries: readonly VscodeCanvasObservationIssueSummary[];
  warningSummaries: readonly VscodeCanvasObservationIssueSummary[];
};

export type VscodeCanvasObservationPublication = {
  type: "canvasObservationPublication";
  snapshot: VscodeCanvasObservationSnapshot;
};

export type VscodeCanvasObservationToExtensionMessage = VscodeCanvasObservationPublication;
