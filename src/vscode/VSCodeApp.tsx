import type { VscodeCanvasImageResources } from "./protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { evaluateElementsWithRust } from "../geometry/evaluationEngine";
import { evaluateElementsWithEngine } from "../geometry/evaluationEngineRouting";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import { evaluationStateIsCurrentFor, useEvaluationEngine } from "../geometry/useEvaluationEngine";
import {
  effectiveCompiledDocument,
  effectiveElements,
  effectiveEvaluationLimitIndex,
  useCadDocumentStore
} from "../state/cadDocumentStore";
import { MAX_CANVAS_ZOOM, useCadUiStore } from "../state/cadUiStore";
import { VSCodeDrawingCanvas } from "./VSCodeDrawingCanvas";
import type { VSCodeDrawingCanvasHandle } from "./VSCodeDrawingCanvas";
import { dispatchCommand } from "../commands/commands";
import { VSCodeBenchmarkCaptureRunner } from "./VSCodeBenchmarkCaptureRunner";
import { VscodeRustTransport } from "./vscodeRustTransport";
import { isStaleHostDocumentVersion } from "./hostDocumentVersion";
import { LEGACY_CANVAS_THEME, type CanvasTheme } from "../components/canvasTheme";
import {
  DEFAULT_CANVAS_GRID_SETTINGS,
  normalizeCanvasGridSettings,
  type CanvasGridSettings
} from "../components/canvasGrid";
import { parseCssColor, readVSCodeCanvasTheme } from "./vscodeCanvasTheme";
import { createCanvasTextWidthMeasurer } from "../components/canvasTextMeasurement";
import {
  queryDslCanvasSourceDefinition,
  queryDslCanvasSourceTarget,
  sourceOwnerForRuntimeElementId
} from "@nuinuicad/nui-language";
import { queryDslCanvasRevealSourceTarget } from "@nuinuicad/nui-language";
import {
  queryDslCanvasRevealRuntimeStatementOwner,
  queryDslCanvasRevealRuntimeTarget
} from "../dsl/dslCanvasRevealRuntime";
import { runtimeScalarDiagnostics } from "../scalars/runtimeScalarDiagnostics";
import { runtimeGeometryDiagnostics } from "../geometry/runtimeGeometryDiagnostics";
import { canvasElementDrawingBounds } from "../geometry/canvasDrawingBounds";
import { projectCanvasLayerPresentation } from "../model/canvasLayerPresentation";
import { groupCanvasGeometry } from "../geometry/groupCanvasGeometry";
import {
  canvasSelectionEligibleElementIds as computeCanvasSelectionEligibleElementIds
} from "../geometry/canvasSelectionEligibility";
import { CANVAS_FIT_PADDING_PX, fitCanvasViewportToBounds } from "../geometry/canvasViewportFit";
import {
  isVscodeCanvasRibbonId,
  normalizeVscodeCanvasRibbonPositions,
  type VscodeCanvasRibbonPositions
} from "./vscodeCanvasRibbonConfig";
import { getSelectedElementIds } from "../commands/commandRuntime";
import { resolveDisabledBakeTargetIds } from "../commands/bakeGeometry";
import { replaceCanvasSelection, resolveOwningModuleInstanceId } from "../commands/selectionCommands";
import { vscodeBakeOperationResultFromCommand } from "./vscodeBakeOperationResult";
import { canvasObservationSnapshot } from "./canvasObservation";
import { canvasNavigationContainerTarget } from "./canvasNavigationContainerTarget";
import {
  canvasModalCanvasCommandAllowed,
  canvasModalCanvasOperationAllowed,
  canvasModalModeFor
} from "./pickModeCanvasPolicy";
import { effectiveDrawElementIds, effectiveEvaluationElementIds } from "@nuinuicad/nui-language";
import { effectiveVisibleElementIdsForProfile, visibilityProfileById } from "@nuinuicad/nui-language";
import { creationPlacementForTarget, applyCreationPlacement } from "../model/elementCreationPlacement";
import { emitCreationRecipe, creationRecipeForType } from "../commands/creationRecipes";
import {
  sourceCreationTextForElements,
  sourceCreationInsertionUnsafeError,
  sourceTextInsertionAtOffset
} from "../commands/sourceCreationInsertion";
import type { SelectionSnapshot } from "../state/cadDocumentStore";
import type { ElementId } from "../types/geometry";
import type {
  ExtensionToVscodeMessage,
  VscodeBenchmarkConfig,
  VscodeWebviewApi,
  VscodeCanvasPointer,
  VscodeCanvasGraphCommitAuthority
} from "./protocol";
import {
  canvasRuntimePresentationFor,
  type VscodeMultiDocumentCanvasRuntimePresentation,
  type VscodeMultiDocumentCanvasRuntimeSnapshot
} from "./multiDocumentRuntimeTransport";
import { inlineModuleCanvasTargetProofsFor } from "./inlineModuleCanvas";
import { currentRuntimeElementIdsForSourceStatementIndexes } from "./coordinatePointConversionSelection";
import { useVscodeMultiDocumentRuntimeEvaluation } from "./useVscodeMultiDocumentRuntimeEvaluation";
import type { VscodeMultiDocumentGraphPublication } from "./multiDocumentGraphTransport";
import { canvasNavigationFreshnessFor } from "./canvasNavigationFreshness";
import {
  useVscodeWebviewPresentation,
  webviewPresentationTextFor
} from "./webviewPresentation";

type CanvasHistoryDirection = "undo" | "redo";
type CanvasHistoryEntry = "selection" | "source";

type CanvasHistoryInFlight = {
  direction: CanvasHistoryDirection;
  entry: CanvasHistoryEntry | "native";
  expectedDocumentVersion: number;
  sourceTransitionObserved: boolean;
  completedResultObserved: boolean;
};

type AuthoritativeHostSourceSnapshot = {
  documentVersion: number;
  normalizedSource: string;
  hostDocumentUri?: string;
};

type CoordinatePointCreationModeRun = {
  modeRunId: number;
  startDocumentVersion: number;
};

export const coordinatePointCreationOffDocumentVersionFor = (
  latestHostDocumentVersion: number | null,
  startDocumentVersion: number
): number => latestHostDocumentVersion ?? startDocumentVersion;

const normalizedSourceFor = (sourceText: string): string => sourceText.replace(/\r\n/g, "\n");

const sourceOffsetForLineCharacter = (sourceText: string, line: number, character: number): number | null => {
  if (!Number.isInteger(line) || line < 0 || !Number.isInteger(character) || character < 0) return null;
  let lineIndex = 0;
  let lineStart = 0;
  let cursor = 0;
  while (true) {
    let lineEnd = cursor;
    while (lineEnd < sourceText.length && sourceText[lineEnd] !== "\r" && sourceText[lineEnd] !== "\n") lineEnd += 1;
    if (lineIndex === line) return character <= lineEnd - lineStart ? lineStart + character : null;
    if (lineEnd === sourceText.length) return null;
    cursor = sourceText[lineEnd] === "\r" && sourceText[lineEnd + 1] === "\n" ? lineEnd + 2 : lineEnd + 1;
    lineStart = cursor;
    lineIndex += 1;
  }
};

const sourcePositionAtOffset = (sourceText: string, offset: number): { line: number; character: number } => {
  const prefix = normalizedSourceFor(sourceText.slice(0, offset));
  const line = prefix.split("\n").length - 1;
  return { line, character: prefix.length - prefix.lastIndexOf("\n") - 1 };
};

type PendingCanvasFreePointCommit = {
  requestId: number;
  expectedDocumentVersion: number;
  previousSourceText: string;
  previousSelection: SelectionSnapshot;
  selectionIntent: PendingCanvasFreePointSelection;
  nextSourcePosition: { line: number; character: number };
};

type PendingCanvasFreePointSelection = {
  requestId: number;
  lastDocumentGeneration: number;
  lastDocumentVersion: number;
  previousSourceText: string;
  expectedDocumentVersion: number;
  expectedSourceText: string;
  selectedElementId: ElementId;
  selectedElementIds: ElementId[];
  selectionAnchorElementId: ElementId;
  sourceStatementIndex?: number;
  acceptedDocumentVersion: number | null;
  authoritativeDocumentGeneration: number | null;
  status: "pending" | "applied" | "undone";
};

type PendingCanvasSelectionRestore = {
  sourceText: string;
  sourceRevision: number;
  hostDocumentGeneration: number;
  selection: SelectionSnapshot;
};

type PendingCoordinatePointConversionSelection = {
  requestId: number;
  documentVersion: number;
  successfulTargetSourceStatementIndexes: number[];
  expectedDocumentGeneration: number;
};

type DeferredSourceBakeRequest = {
  message: Extract<ExtensionToVscodeMessage, { type: "bakeSourceRequest" }>;
  compiledDocumentRevision: number;
};

type PendingCanvasSourceCommit = {
  operationId: number | null;
  expectedDocumentVersion: number;
  previousSourceText: string;
  expectedSourceText: string;
  accepted: boolean;
  authoritativeDocumentVersion: number | null;
};

export const VSCodeApp = ({ api }: { api: VscodeWebviewApi }) => {
  const webviewPresentation = useVscodeWebviewPresentation();
  const staleSourceAnchorError = webviewPresentationTextFor(
    webviewPresentation,
    "canvas.commandError.staleSourceAnchor",
    "現在のSource位置が古くなっています。現在のSourceでキャレットを再確定してから再試行してください。"
  );
  const canvasPointerError = webviewPresentationTextFor(
    webviewPresentation,
    "canvas.commandError.pointer",
    "Canvas上にポインターを置いてから実行してください。"
  );
  const sourceInsertionError = webviewPresentationTextFor(
    webviewPresentation,
    "canvas.commandError.sourceInsertion",
    "現在のDSLテキストにはこの操作を適用できません。"
  );
  const importedGraphAuthorityError = "The imported Canvas graph is stale, invalid, or belongs to a different Host document. Refresh the Canvas before editing.";
  const importedGraphUriError = "Canvas editing was rejected because the imported graph belongs to a different Host document.";
  const elements = useCadDocumentStore(effectiveElements);
  const evaluationLimitIndex = useCadDocumentStore(effectiveEvaluationLimitIndex);
  const evaluationDocument = useCadDocumentStore(effectiveCompiledDocument);
  const compiledDocumentRevision = useCadDocumentStore((state) => state.compiledDocumentRevision);
  const sourceText = useCadDocumentStore((state) => state.sourceText);
  const sourceRevision = useCadDocumentStore((state) => state.sourceRevision);
  const previewActive = useCadDocumentStore((state) => state.previewElements !== null);
  const observationSelectionSubject = useCadUiStore((state) => state.selectionSubject);
  const observationSelectedElementIds = useCadUiStore((state) => state.selectedElementIds);
  const canvasSelectionEligibleElementIds = useCadUiStore((state) => state.canvasSelectionEligibleElementIds);
  const [benchmarkConfig, setBenchmarkConfig] = useState<VscodeBenchmarkConfig | null>(null);
  const [imageResources, setImageResources] = useState<VscodeCanvasImageResources>({});
  const [canvasTheme, setCanvasTheme] = useState(LEGACY_CANVAS_THEME);
  const [canvasGridSettings, setCanvasGridSettings] = useState<CanvasGridSettings>(DEFAULT_CANVAS_GRID_SETTINGS);
  const [canvasRibbonPositions, setCanvasRibbonPositions] = useState<VscodeCanvasRibbonPositions>({});
  const [multiDocumentGraphPublication, setMultiDocumentGraphPublication] = useState<VscodeMultiDocumentGraphPublication | null>(null);
  const [latestHostDocumentVersion, setLatestHostDocumentVersion] = useState<number | null>(null);
  const [coordinatePointCreationActive, setCoordinatePointCreationActive] = useState(false);
  const coordinatePointCreationModeRunRef = useRef<CoordinatePointCreationModeRun | null>(null);
  const [authoritativeHostSourceSnapshot, setAuthoritativeHostSourceSnapshot] = useState<AuthoritativeHostSourceSnapshot | null>(null);
  const [canvasDocumentEpoch, setCanvasDocumentEpoch] = useState(0);
  const canvasThemeRef = useRef<CanvasTheme>(LEGACY_CANVAS_THEME);
  const canvasThemeGenerationRef = useRef<number | null>(null);
  const latestHostDocumentVersionRef = useRef<number | null>(null);
  const multiDocumentGraphPublicationRef = useRef<VscodeMultiDocumentGraphPublication | null>(null);
  const lastGraphPublicationRef = useRef<{ rootDocumentId: string; revision: number } | null>(null);
  const multiDocumentRuntimePresentationRef = useRef<VscodeMultiDocumentCanvasRuntimePresentation | null>(null);
  const hostDocumentGenerationRef = useRef(0);
  const lastAuthoritativeHostSourceSnapshotRef = useRef<AuthoritativeHostSourceSnapshot | null>(null);
  const latestCanvasNavigationRequestRef = useRef<number | null>(null);
  const deferredCanvasNavigationRequestRef = useRef<
    Extract<ExtensionToVscodeMessage, { type: "canvasNavigationRequest" }> | null
  >(null);
  const deferredInlineModuleSelectionRequestRef = useRef<
    Extract<ExtensionToVscodeMessage, { type: "inlineModuleSelectionRequest" }> | null
  >(null);
  const deferredSourceBakeRequestRef = useRef<DeferredSourceBakeRequest | null>(null);
  const pendingCanvasFocusRequestRef = useRef<number | null>(null);
  const pendingCanvasFreePointCommitRef = useRef<PendingCanvasFreePointCommit | null>(null);
  const pendingCanvasFreePointSelectionRef = useRef<PendingCanvasFreePointSelection | null>(null);
  const pendingCanvasSelectionRestoreRef = useRef<PendingCanvasSelectionRestore | null>(null);
  const pendingCoordinatePointConversionSelectionRef = useRef<PendingCoordinatePointConversionSelection | null>(null);
  const pendingCanvasSourceCommitRef = useRef<PendingCanvasSourceCommit | null>(null);
  const lastCanvasSourceHistoryCommitRef = useRef<{
    documentVersion: number;
    normalizedSource: string;
  } | null>(null);
  const canvasHistoryPastRef = useRef<CanvasHistoryEntry[]>([]);
  const canvasHistoryFutureRef = useRef<CanvasHistoryEntry[]>([]);
  const canvasHistoryStoreMutationRef = useRef(false);
  const canvasHistoryInFlightRef = useRef<CanvasHistoryInFlight | null>(null);
  const pendingCanvasHistoryRef = useRef<CanvasHistoryDirection[]>([]);
  const canvasFocusRef = useRef<HTMLDivElement>(null);
  const drawingCanvasRef = useRef<VSCodeDrawingCanvasHandle>(null);
  const canvasPickModeActive = useCallback(
    () => Boolean(useCadUiStore.getState().activePickModeSession || drawingCanvasRef.current?.isReferencePickActive()),
    []
  );
  const canvasModalMode = useCallback(
    () => canvasModalModeFor({
      pickModeActive: canvasPickModeActive(),
      coordinatePointCreationActive
    }),
    [canvasPickModeActive, coordinatePointCreationActive]
  );
  const measureCanvasTextWidth = useMemo(
    () => createCanvasTextWidthMeasurer(() =>
      document.querySelector<HTMLElement>('[data-canvas-viewport="true"]')
    ),
    []
  );
  const rustTransport = useMemo(() => new VscodeRustTransport(api.postMessage), [api]);
  const evaluateReferencePickCandidate = useCallback((compiled: LastGoodDslDocument) =>
    evaluateElementsWithEngine(compiled.document.elements, buildEvaluationOptions({
      compiledDocument: compiled,
      evaluationLimitIndex: compiled.document.evaluationLimitIndex
    }), rustTransport.transport), [rustTransport]);
  useEffect(() => () => rustTransport.dispose(), [rustTransport]);
  useEffect(() => {
    api.postMessage({ type: "webviewReady" });
  }, [api]);
  const evaluationOptions = useMemo(
    () => buildEvaluationOptions({ compiledDocument: evaluationDocument, evaluationLimitIndex }),
    [evaluationDocument, evaluationLimitIndex]
  );
  const currentHostGraph = useMemo(() => {
    const publication = multiDocumentGraphPublication;
    if (publication?.status !== "current") return null;
    const { graph } = publication;
    const authoritative = authoritativeHostSourceSnapshot;
    if (
      !graph.valid ||
      publication.documentVersion !== latestHostDocumentVersion ||
      authoritative?.documentVersion !== publication.documentVersion ||
      authoritative?.normalizedSource !== normalizedSourceFor(sourceText) ||
      !authoritative.hostDocumentUri ||
      publication.hostDocumentUri !== authoritative.hostDocumentUri ||
      graph.rootDocumentId !== authoritative.hostDocumentUri ||
      graph.rootSource.documentId !== graph.rootDocumentId ||
      graph.rootSource.normalizedSource !== authoritative.normalizedSource
    ) return null;
    return publication;
  }, [authoritativeHostSourceSnapshot, latestHostDocumentVersion, multiDocumentGraphPublication, sourceText]);
  const multiDocumentRuntimeSnapshot = useMemo<VscodeMultiDocumentCanvasRuntimeSnapshot | null>(() => {
    if (!currentHostGraph?.canvasRuntime) return null;
    const { canvasRuntime: runtime, graph } = currentHostGraph;
    if (
      runtime.graphRevision !== graph.revision ||
      runtime.rootDocumentId !== graph.rootDocumentId ||
      runtime.rootSourceRevision !== graph.rootSource.sourceRevision
    ) return null;
    return runtime;
  }, [currentHostGraph]);
  const activeMultiDocumentRuntimeSnapshot = multiDocumentRuntimeSnapshot?.identityOnly
    ? null
    : multiDocumentRuntimeSnapshot;
  const multiDocumentRuntimePresentation = useMemo(
    () => activeMultiDocumentRuntimeSnapshot ? canvasRuntimePresentationFor(activeMultiDocumentRuntimeSnapshot) : null,
    [activeMultiDocumentRuntimeSnapshot]
  );
  useEffect(() => {
    multiDocumentGraphPublicationRef.current = multiDocumentGraphPublication;
    multiDocumentRuntimePresentationRef.current = multiDocumentRuntimePresentation;
  }, [multiDocumentGraphPublication, multiDocumentRuntimePresentation]);
  const multiDocumentRuntimeEvaluationState = useVscodeMultiDocumentRuntimeEvaluation(
    activeMultiDocumentRuntimeSnapshot,
    rustTransport.transport
  );
  const localEvaluationState = useEvaluationEngine(
    elements,
    evaluationOptions,
    compiledDocumentRevision,
    activeMultiDocumentRuntimeSnapshot ? undefined : rustTransport.transport
  );
  const evaluationState = activeMultiDocumentRuntimeSnapshot
    ? multiDocumentRuntimeEvaluationState
    : localEvaluationState;
  const evaluationRef = useRef(evaluationState.evaluation);
  const evaluationStateRef = useRef(evaluationState);
  useEffect(() => {
    evaluationRef.current = evaluationState.evaluation;
    evaluationStateRef.current = evaluationState;
    const deferredCanvasNavigation = deferredCanvasNavigationRequestRef.current;
    if (deferredCanvasNavigation) {
      if (latestCanvasNavigationRequestRef.current !== deferredCanvasNavigation.requestId) {
        deferredCanvasNavigationRequestRef.current = null;
      } else {
        const runtimePresentation = multiDocumentRuntimePresentationRef.current;
        const graphReady = deferredCanvasNavigation.graphRevision === undefined || (
          runtimePresentation?.graphRevision === deferredCanvasNavigation.graphRevision &&
          runtimePresentation.rootSourceRevision === deferredCanvasNavigation.sourceRevision
        );
        const presentationRevision = runtimePresentation?.graphRevision ?? compiledDocumentRevision;
        if (graphReady && evaluationStateIsCurrentFor(evaluationState, presentationRevision)) {
          deferredCanvasNavigationRequestRef.current = null;
          window.dispatchEvent(new MessageEvent("message", { data: deferredCanvasNavigation }));
        }
      }
    }
    const deferredInlineModuleSelection = deferredInlineModuleSelectionRequestRef.current;
    if (
      deferredInlineModuleSelection &&
      evaluationStateIsCurrentFor(evaluationState, compiledDocumentRevision)
    ) {
      deferredInlineModuleSelectionRequestRef.current = null;
      window.dispatchEvent(new MessageEvent("message", { data: deferredInlineModuleSelection }));
    }
  }, [compiledDocumentRevision, evaluationState, multiDocumentRuntimePresentation]);

  const restoreCanvasFocus = useCallback((afterFocus?: () => void) => {
    queueMicrotask(() => {
      canvasFocusRef.current?.focus();
      afterFocus?.();
    });
  }, []);

  const tryCompleteCanvasFocus = useCallback((requestId: number) => {
    if (pendingCanvasFocusRequestRef.current !== requestId) return;
    if (latestCanvasNavigationRequestRef.current !== requestId) {
      pendingCanvasFocusRequestRef.current = null;
      return;
    }
    const viewport = canvasFocusRef.current;
    if (!viewport) return;
    viewport.focus();
    if (pendingCanvasFocusRequestRef.current !== requestId) return;
    if (latestCanvasNavigationRequestRef.current !== requestId) return;
    if (!document.hasFocus() || document.activeElement !== viewport) return;
    pendingCanvasFocusRequestRef.current = null;
    latestCanvasNavigationRequestRef.current = null;
    api.postMessage({ type: "canvasNavigationResult", requestId, status: "focused" });
  }, [api]);

  useEffect(() => {
    const onWindowFocus = () => {
      const requestId = pendingCanvasFocusRequestRef.current;
      if (requestId !== null) tryCompleteCanvasFocus(requestId);
    };
    window.addEventListener("focus", onWindowFocus);
    return () => {
      window.removeEventListener("focus", onWindowFocus);
      pendingCanvasFocusRequestRef.current = null;
    };
  }, [tryCompleteCanvasFocus]);

  const resetCanvasHistoryChronology = useCallback((selectionCount = 0) => {
    canvasHistoryPastRef.current = Array.from({ length: selectionCount }, () => "selection" as const);
    canvasHistoryFutureRef.current = [];
  }, []);

  const syncCanvasHistoryChronologyToSelection = useCallback(() => {
    resetCanvasHistoryChronology(useCadDocumentStore.getState().selectionPast.length);
  }, [resetCanvasHistoryChronology]);

  const invalidateCanvasHistory = useCallback(() => {
    canvasHistoryInFlightRef.current = null;
    pendingCanvasHistoryRef.current = [];
    resetCanvasHistoryChronology();
  }, [resetCanvasHistoryChronology]);

  const recordAcceptedCanvasSourceHistory = useCallback((documentVersion: number, sourceText: string) => {
    const normalizedSource = normalizedSourceFor(sourceText);
    const lastCommit = lastCanvasSourceHistoryCommitRef.current;
    if (lastCommit?.documentVersion === documentVersion && lastCommit.normalizedSource === normalizedSource) return;

    const documentState = useCadDocumentStore.getState();
    if (canvasHistoryPastRef.current.length === 0 && documentState.selectionPast.length === 0) {
      const adjacentSelectionPast = documentState.past.at(-1)?.selectionPast.length ?? 0;
      if (adjacentSelectionPast > 0) {
        canvasHistoryPastRef.current = Array.from({ length: adjacentSelectionPast }, () => "selection" as const);
      }
    }
    canvasHistoryFutureRef.current = [];
    canvasHistoryPastRef.current.push("source");
    lastCanvasSourceHistoryCommitRef.current = { documentVersion, normalizedSource };
  }, []);

  const completePendingCanvasSourceCommit = useCallback(() => {
    const pending = pendingCanvasSourceCommitRef.current;
    if (!pending || !pending.accepted || pending.authoritativeDocumentVersion === null) return false;
    recordAcceptedCanvasSourceHistory(
      pending.authoritativeDocumentVersion,
      pending.expectedSourceText
    );
    pendingCanvasSourceCommitRef.current = null;
    return true;
  }, [recordAcceptedCanvasSourceHistory]);

  const moveCanvasSourceHistory = useCallback((direction: CanvasHistoryDirection) => {
    if (direction === "undo") {
      if (canvasHistoryPastRef.current.at(-1) !== "source") return false;
      canvasHistoryPastRef.current.pop();
      canvasHistoryFutureRef.current.unshift("source");
      return true;
    }
    if (canvasHistoryFutureRef.current[0] !== "source") return false;
    canvasHistoryFutureRef.current.shift();
    canvasHistoryPastRef.current.push("source");
    return true;
  }, []);

  const applyLocalCanvasHistory = useCallback((direction: CanvasHistoryDirection) => {
    canvasHistoryStoreMutationRef.current = true;
    try {
      const appliedLocally = direction === "undo"
        ? useCadDocumentStore.getState().undoCanvasSelection()
        : useCadDocumentStore.getState().redoCanvasSelection();
      if (!appliedLocally) return false;
      if (direction === "undo") {
        if (canvasHistoryPastRef.current.at(-1) === "selection") {
          canvasHistoryPastRef.current.pop();
          canvasHistoryFutureRef.current.unshift("selection");
        }
      } else if (canvasHistoryFutureRef.current[0] === "selection") {
        canvasHistoryFutureRef.current.shift();
        canvasHistoryPastRef.current.push("selection");
      }
      return true;
    } finally {
      canvasHistoryStoreMutationRef.current = false;
    }
  }, []);

  useEffect(() => {
    resetCanvasHistoryChronology(useCadDocumentStore.getState().selectionPast.length);
    const unsubscribe = useCadDocumentStore.subscribe((state, previous) => {
      if (canvasHistoryStoreMutationRef.current) return;
      if (state.selectionPast.length <= previous.selectionPast.length) return;
      const added = state.selectionPast.length - previous.selectionPast.length;
      canvasHistoryPastRef.current.push(...Array.from({ length: added }, () => "selection" as const));
      canvasHistoryFutureRef.current = [];
    });
    return unsubscribe;
  }, [resetCanvasHistoryChronology]);

  const pumpCanvasHistory = useCallback(() => {
    while (
      canvasHistoryInFlightRef.current === null
      && pendingCanvasHistoryRef.current.length > 0
    ) {
      const direction = pendingCanvasHistoryRef.current.shift()!;
      const localEntry = direction === "undo"
        ? canvasHistoryPastRef.current.at(-1)
        : canvasHistoryFutureRef.current[0];
      const appliedLocally = localEntry === "selection"
        ? applyLocalCanvasHistory(direction)
        : false;
      if (appliedLocally) continue;

      const expectedDocumentVersion = latestHostDocumentVersionRef.current;
      if (expectedDocumentVersion === null) return;
      canvasHistoryInFlightRef.current = {
        direction,
        entry: localEntry === "source" ? "source" : "native",
        expectedDocumentVersion,
        sourceTransitionObserved: false,
        completedResultObserved: false
      };
      api.postMessage({ type: "canvasHistoryRequest", direction, expectedDocumentVersion });
    }
  }, [api, applyLocalCanvasHistory]);

  const completeCanvasHistoryResult = useCallback((
    message: Extract<ExtensionToVscodeMessage, { type: "canvasHistoryResult" }>
  ) => {
    const inFlight = canvasHistoryInFlightRef.current;
    if (!inFlight || inFlight.direction !== message.direction) return;
    pendingCanvasFocusRequestRef.current = null;
    latestCanvasNavigationRequestRef.current = null;
    deferredCanvasNavigationRequestRef.current = null;
    if (message.status === "completed" && inFlight.entry === "source" && !inFlight.sourceTransitionObserved) {
      inFlight.completedResultObserved = true;
      return;
    }
    canvasHistoryInFlightRef.current = null;
    if (message.status !== "completed") pendingCanvasHistoryRef.current = [];
    restoreCanvasFocus(message.status === "completed" ? pumpCanvasHistory : undefined);
  }, [pumpCanvasHistory, restoreCanvasFocus]);

  const requestCanvasHistory = useCallback((direction: CanvasHistoryDirection) => {
    pendingCanvasFocusRequestRef.current = null;
    latestCanvasNavigationRequestRef.current = null;
    deferredCanvasNavigationRequestRef.current = null;
    drawingCanvasRef.current?.finalizeCanvasInteraction();
    pendingCanvasHistoryRef.current.push(direction);
    pumpCanvasHistory();
  }, [pumpCanvasHistory]);

  const postCanvasCommit = useCallback((
    operationId?: number,
    coordinatePointConversionRequestId?: number,
    sourceTextOverride?: string,
    graphAuthority?: VscodeCanvasGraphCommitAuthority
  ) => {
    if (benchmarkConfig) return;
    const expectedDocumentVersion = latestHostDocumentVersionRef.current;
    if (expectedDocumentVersion === null) return;
    const sourceText = sourceTextOverride ?? useCadDocumentStore.getState().sourceText;
    const sourceUpdate = useCadDocumentStore.getState().sourceUpdate;
    const mutationKind = sourceUpdate.kind === "model-patch"
      ? "model-patch"
      : sourceUpdate.kind === "text-insertion"
        ? "text-insertion"
        : "reset";
    const expectedSourceText = normalizedSourceFor(sourceText);
    const previousSourceText = lastAuthoritativeHostSourceSnapshotRef.current?.normalizedSource ?? "";
    pendingCanvasSourceCommitRef.current = {
      operationId: operationId ?? null,
      expectedDocumentVersion,
      previousSourceText,
      expectedSourceText,
      accepted: operationId === undefined,
      authoritativeDocumentVersion: null
    };
    api.postMessage({
      type: "canvasCommit",
      sourceText,
      expectedDocumentVersion,
      ...(lastAuthoritativeHostSourceSnapshotRef.current?.hostDocumentUri
        ? { hostDocumentUri: lastAuthoritativeHostSourceSnapshotRef.current.hostDocumentUri }
        : {}),
      ...(graphAuthority ? { graphAuthority } : {}),
      mutationKind,
      ...(sourceUpdate.kind === "text-insertion" ? {
        textInsertion: {
          originalSourceText: sourceUpdate.originalSourceText,
          offset: sourceUpdate.offset,
          insertedText: sourceUpdate.insertedText
        }
      } : {}),
      ...(operationId === undefined ? {} : { operationId }),
      ...(coordinatePointConversionRequestId === undefined ? {} : { coordinatePointConversionRequestId }),
      ...(sourceUpdate.kind === "model-patch" ? { splices: sourceUpdate.splices } : {})
    });
  }, [api, benchmarkConfig]);

  const currentHostSourceAuthorityFor = useCallback((expectedDocumentVersion: number) => {
    const state = useCadDocumentStore.getState();
    const normalizedSource = normalizedSourceFor(state.sourceText);
    const authoritative = lastAuthoritativeHostSourceSnapshotRef.current;
    if (
      latestHostDocumentVersionRef.current !== expectedDocumentVersion ||
      authoritative?.documentVersion !== expectedDocumentVersion ||
      authoritative.normalizedSource !== normalizedSource
    ) return null;
    return {
      state,
      source: { normalizedSource, hostDocumentUri: authoritative.hostDocumentUri }
    };
  }, []);

  const canvasAuthorityRejectionErrorFor = useCallback((expectedDocumentVersion: number): string => {
    const authority = lastAuthoritativeHostSourceSnapshotRef.current;
    if (
      latestHostDocumentVersionRef.current !== expectedDocumentVersion ||
      authority?.documentVersion !== expectedDocumentVersion ||
      authority.normalizedSource !== normalizedSourceFor(useCadDocumentStore.getState().sourceText)
    ) return staleSourceAnchorError;
    const publication = multiDocumentGraphPublicationRef.current;
    if (!authority.hostDocumentUri || !publication) return importedGraphAuthorityError;
    if (
      publication.hostDocumentUri !== authority.hostDocumentUri ||
      (publication.status === "current" && publication.graph.rootDocumentId !== authority.hostDocumentUri)
    ) return importedGraphUriError;
    if (publication.status !== "current" || !publication.graph.valid) return importedGraphAuthorityError;
    if (publication.graph.rootSource.normalizedSource !== authority.normalizedSource) {
      return "Canvas editing was rejected because the imported graph does not match the current Source.";
    }
    return staleSourceAnchorError;
  }, [importedGraphAuthorityError, importedGraphUriError, staleSourceAnchorError]);

  const currentAuthoritativeDocument = useCallback((expectedDocumentVersion: number) => {
    const currentHostSource = currentHostSourceAuthorityFor(expectedDocumentVersion);
    if (!currentHostSource) return null;
    const compiled = effectiveCompiledDocument(currentHostSource.state);
    if (
      !compiled.document ||
      !compiled.statementMap ||
      compiled.spans.sourceMap.source !== currentHostSource.source.normalizedSource ||
      compiled.spans.sourceMap.sourceRevision !== currentHostSource.state.doc.statementMap.sourceRevision
    ) return null;
    return {
      state: currentHostSource.state,
      compiled,
      source: {
        normalizedSource: currentHostSource.source.normalizedSource,
        hostDocumentUri: currentHostSource.source.hostDocumentUri,
        sourceRevision: compiled.spans.sourceMap.sourceRevision
      }
    };
  }, [currentHostSourceAuthorityFor]);

  const currentAuthoritativeCanvasSourceDocument = useCallback((expectedDocumentVersion: number) => {
    const hostSource = currentHostSourceAuthorityFor(expectedDocumentVersion);
    if (!hostSource) return null;
    const publication = multiDocumentGraphPublicationRef.current;
    if (publication?.status === "current" && (
      !hostSource.source.hostDocumentUri ||
      publication.hostDocumentUri !== hostSource.source.hostDocumentUri ||
      publication.graph.rootDocumentId !== hostSource.source.hostDocumentUri ||
      publication.graph.rootSource.documentId !== hostSource.source.hostDocumentUri
    )) return null;

    const current = currentAuthoritativeDocument(expectedDocumentVersion);
    if (current) {
      return {
        state: current.state,
        source: current.source,
        elements: current.state.elements,
        statementMap: current.compiled.statementMap,
        evaluationLimitIndex: current.state.evaluationLimitIndex,
        sourceEditing: null,
        graphAuthority: undefined
      };
    }

    const runtime = multiDocumentRuntimePresentationRef.current;
    const graph = publication?.status === "current" ? publication.graph : null;
    const sourceEditing = runtime?.sourceEditing;
    const sourceEditingMatchesHost = Boolean(sourceEditing &&
      sourceEditing.sourceText === hostSource.source.normalizedSource &&
      publication?.status === "current" &&
      sourceEditing.sourceRevision === publication.graph.rootSource.sourceRevision &&
      runtime &&
      runtime.rootDocumentId === hostSource.source.hostDocumentUri &&
      runtime.graphRevision === publication.graph.revision &&
      runtime.rootSourceRevision === sourceEditing.sourceRevision &&
      sourceEditing.compiled.statementMap.sourceRevision === sourceEditing.sourceRevision);
    const rootIdentityMatches = publication === null
      ? true
      : hostSource.source.hostDocumentUri !== undefined &&
        publication.hostDocumentUri === hostSource.source.hostDocumentUri &&
        (publication.status !== "current" || (
          publication.graph.rootDocumentId === hostSource.source.hostDocumentUri &&
          publication.graph.rootSource.documentId === hostSource.source.hostDocumentUri
        ));

    if (rootIdentityMatches && !sourceEditingMatchesHost) {
      const currentCompiled = hostSource.state.currentCompiled;
      const sourceRevision = hostSource.state.currentSourceRevision;
      if (
        currentCompiled.spans.sourceMap.source === hostSource.source.normalizedSource &&
        currentCompiled.spans.sourceMap.sourceRevision === sourceRevision
      ) {
        return {
          state: hostSource.state,
          source: {
            normalizedSource: hostSource.source.normalizedSource,
            hostDocumentUri: hostSource.source.hostDocumentUri,
            sourceRevision
          },
          elements: hostSource.state.elements,
          statementMap: currentCompiled.statementMap,
          evaluationLimitIndex: hostSource.state.evaluationLimitIndex,
          sourceEditing: null,
          graphAuthority: undefined
        };
      }
    }

    if (
      !hostSource ||
      !publication ||
      publication.status !== "current" ||
      publication.documentVersion !== expectedDocumentVersion ||
      !graph?.valid ||
      !runtime ||
      !sourceEditing ||
      graph.rootDocumentId !== runtime.rootDocumentId ||
      publication.hostDocumentUri !== hostSource.source.hostDocumentUri ||
      graph.rootDocumentId !== hostSource.source.hostDocumentUri ||
      graph.rootSource.documentId !== graph.rootDocumentId ||
      graph.rootSource.normalizedSource !== hostSource.source.normalizedSource ||
      runtime.graphRevision !== graph.revision ||
      runtime.rootSourceRevision !== graph.rootSource.sourceRevision ||
      sourceEditing.sourceText !== hostSource.source.normalizedSource ||
      sourceEditing.sourceRevision !== graph.rootSource.sourceRevision ||
      sourceEditing.compiled.statementMap.sourceRevision !== sourceEditing.sourceRevision
    ) return null;

    const elements = [...sourceEditing.compiled.sourceElementsByStatementIndex.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, element]) => element);
    return {
      state: hostSource.state,
      source: {
        normalizedSource: hostSource.source.normalizedSource,
        hostDocumentUri: hostSource.source.hostDocumentUri,
        sourceRevision: sourceEditing.sourceRevision
      },
      elements,
      statementMap: sourceEditing.compiled.statementMap,
      evaluationLimitIndex: sourceEditing.compiled.document.evaluationLimitIndex,
      sourceEditing,
      graphAuthority: {
        rootDocumentId: graph.rootDocumentId,
        graphRevision: graph.revision
      }
    };
  }, [currentAuthoritativeDocument, currentHostSourceAuthorityFor]);

  const finishCoordinatePointCreation = useCallback(() => {
    const modeRun = coordinatePointCreationModeRunRef.current;
    if (!modeRun) return;
    coordinatePointCreationModeRunRef.current = null;
    setCoordinatePointCreationActive(false);
    api.postMessage({
      type: "canvasCoordinatePointCreationState",
      active: false,
      modeRunId: modeRun.modeRunId,
      documentVersion: coordinatePointCreationOffDocumentVersionFor(
        latestHostDocumentVersionRef.current,
        modeRun.startDocumentVersion
      )
    });
  }, [api]);

  const startCoordinatePointCreation = useCallback((
    requestId: number,
    documentVersion: number,
    hostDocumentUri: string
  ): "started" | "ignored" | "rejected" => {
    if (coordinatePointCreationActive || coordinatePointCreationModeRunRef.current !== null || canvasModalMode() !== null) {
      api.postMessage({
        type: "canvasCoordinatePointCreationStartResult",
        requestId,
        documentVersion,
        status: "ignored"
      });
      return "ignored";
    }
    const localDocument = currentAuthoritativeDocument(documentVersion);
    const hostSource = currentHostSourceAuthorityFor(documentVersion);
    const graphDocument = currentAuthoritativeCanvasSourceDocument(documentVersion);
    const publication = multiDocumentGraphPublicationRef.current;
    const graphRootIdentityMismatch = publication?.status === "current" && (
      publication.hostDocumentUri !== hostDocumentUri ||
      publication.graph.rootDocumentId !== hostDocumentUri ||
      publication.graph.rootSource.documentId !== hostDocumentUri
    );
    if (
      latestHostDocumentVersionRef.current !== documentVersion ||
      !hostSource ||
      hostSource.source.hostDocumentUri !== hostDocumentUri ||
      graphRootIdentityMismatch ||
      (!localDocument && (!graphDocument || graphDocument.source.hostDocumentUri !== hostDocumentUri))
    ) {
      const errorMessage = hostSource && hostSource.source.hostDocumentUri !== hostDocumentUri
        ? "Coordinate point creation was rejected because the Canvas belongs to a different Host document."
        : hostSource && !localDocument && !graphDocument
          ? canvasAuthorityRejectionErrorFor(documentVersion)
          : staleSourceAnchorError;
      useCadUiStore.getState().setCommandErrorMessage(errorMessage);
      api.postMessage({
        type: "canvasCoordinatePointCreationStartResult",
        requestId,
        documentVersion,
        status: "rejected",
        errorMessage
      });
      return "rejected";
    }
    drawingCanvasRef.current?.clearPendingCanvasPointerIntent();
    drawingCanvasRef.current?.finalizeCanvasInteraction();
    coordinatePointCreationModeRunRef.current = { modeRunId: requestId, startDocumentVersion: documentVersion };
    setCoordinatePointCreationActive(true);
    api.postMessage({
      type: "canvasCoordinatePointCreationState",
      active: true,
      modeRunId: requestId,
      documentVersion
    });
    api.postMessage({
      type: "canvasCoordinatePointCreationStartResult",
      requestId,
      documentVersion,
      status: "started"
    });
    canvasFocusRef.current?.focus();
    return "started";
  }, [api, canvasAuthorityRejectionErrorFor, canvasFocusRef, canvasModalMode, coordinatePointCreationActive, currentAuthoritativeCanvasSourceDocument, currentAuthoritativeDocument, currentHostSourceAuthorityFor, staleSourceAnchorError]);

  const postCoordinatePointCreationClick = useCallback((pointer: VscodeCanvasPointer) => {
    const modeRun = coordinatePointCreationModeRunRef.current;
    const documentVersion = latestHostDocumentVersionRef.current;
    if (
      !coordinatePointCreationActive ||
      !modeRun ||
      documentVersion === null ||
      canvasHistoryInFlightRef.current !== null
    ) return;
    api.postMessage({
      type: "canvasCoordinatePointCreationClick",
      modeRunId: modeRun.modeRunId,
      documentVersion,
      pointer
    });
  }, [api, coordinatePointCreationActive]);

  const discardDeferredSourceBake = useCallback(() => {
    const deferred = deferredSourceBakeRequestRef.current;
    if (!deferred) return;
    deferredSourceBakeRequestRef.current = null;
    api.postMessage({
      type: "bakeSourceResult",
      requestId: deferred.message.requestId,
      status: "stale"
    });
  }, [api]);

  useEffect(() => {
    const deferred = deferredSourceBakeRequestRef.current;
    if (!deferred) return;
    const current = currentAuthoritativeDocument(deferred.message.documentVersion);
    if (!current || current.state.compiledDocumentRevision !== deferred.compiledDocumentRevision) {
      discardDeferredSourceBake();
      return;
    }
    if (!evaluationStateIsCurrentFor(evaluationState, deferred.compiledDocumentRevision)) return;
    deferredSourceBakeRequestRef.current = null;
    window.dispatchEvent(new MessageEvent("message", { data: deferred.message }));
  }, [currentAuthoritativeDocument, discardDeferredSourceBake, evaluationState]);

  const currentReferencePickAuthorityFor = useCallback((expectedDocumentVersion: number) => {
    const currentHostSource = currentHostSourceAuthorityFor(expectedDocumentVersion);
    return currentHostSource
      ? {
          documentVersion: expectedDocumentVersion,
          normalizedSource: currentHostSource.source.normalizedSource
        }
      : null;
  }, [currentHostSourceAuthorityFor]);

  const selectActiveCanvasInstance = useCallback((): boolean => {
    const state = useCadDocumentStore.getState();
    const runtimePresentation = multiDocumentRuntimePresentationRef.current;
    const activeElements = runtimePresentation?.elements ?? state.elements;
    const ownerId = resolveOwningModuleInstanceId({
      selectedElementId: useCadUiStore.getState().selectedElementId,
      elements: activeElements,
      moduleMaterialization: runtimePresentation?.moduleMaterialization ?? state.doc.moduleMaterialization
    });
    return ownerId
      ? replaceCanvasSelection(
          [ownerId],
          ownerId,
          true,
          "requested",
          useCadUiStore.getState().canvasSelectionEligibleElementIds ?? undefined,
          activeElements
        )
      : false;
  }, []);

  const tryApplyPendingCanvasSelectionRestore = useCallback(() => {
    const pending = pendingCanvasFreePointSelectionRef.current;
    if (pending) {
      const documentState = useCadDocumentStore.getState();
      const currentSourceText = normalizedSourceFor(documentState.sourceText);
      const sourceIsKnown = currentSourceText === pending.expectedSourceText || currentSourceText === pending.previousSourceText;
      if (!sourceIsKnown) {
        pendingCanvasFreePointSelectionRef.current = null;
      } else if (pending.status === "pending" && (
        pending.authoritativeDocumentGeneration === null
          ? latestHostDocumentVersionRef.current !== pending.expectedDocumentVersion
          : pending.acceptedDocumentVersion !== null && (
              latestHostDocumentVersionRef.current !== pending.acceptedDocumentVersion ||
              hostDocumentGenerationRef.current !== pending.authoritativeDocumentGeneration
            )
      )) {
        pendingCanvasFreePointSelectionRef.current = null;
      } else if (
        pending.status === "pending" &&
        pending.acceptedDocumentVersion !== null &&
        pending.acceptedDocumentVersion > pending.expectedDocumentVersion
      ) {
        const runtimePresentation = multiDocumentRuntimePresentationRef.current;
        const graphRuntimeIsCurrent = runtimePresentation?.sourceEditing?.sourceText === currentSourceText &&
          runtimePresentation.rootSourceRevision === runtimePresentation.sourceEditing.sourceRevision;
        const graphRuntimeElementId = pending.sourceStatementIndex === undefined || !graphRuntimeIsCurrent
          ? null
          : runtimePresentation?.revealMaterialization?.elementIdBySourceStatementIndex.get(pending.sourceStatementIndex) ?? null;
        const selectionElements = graphRuntimeElementId && runtimePresentation
          ? runtimePresentation.elements
          : documentState.elements;
        const selectedElementId = graphRuntimeElementId ?? pending.selectedElementId;
        const selectedElementIds = graphRuntimeElementId
          ? [graphRuntimeElementId]
          : pending.selectedElementIds;
        if (selectionElements.some((element) => element.id === selectedElementId)) {
          const eligibility = useCadUiStore.getState().canvasSelectionEligibleElementIds;
          if (eligibility?.has(selectedElementId)) {
            pending.status = "applied";
            useCadUiStore.getState().applySelection(selectionElements, {
              selectedElementId,
              selectedElementIds,
              selectionAnchorElementId: selectedElementId
            });
          }
        }
      }
    }

    const restore = pendingCanvasSelectionRestoreRef.current;
    if (!restore) return;
    const documentState = useCadDocumentStore.getState();
    if (
      normalizedSourceFor(documentState.sourceText) !== restore.sourceText ||
      documentState.sourceRevision !== restore.sourceRevision ||
      hostDocumentGenerationRef.current !== restore.hostDocumentGeneration
    ) {
      pendingCanvasSelectionRestoreRef.current = null;
      return;
    }
    const hasSelection = restore.selection.selectedElementId !== null || restore.selection.selectedElementIds.length > 0;
    if (hasSelection && useCadUiStore.getState().canvasSelectionEligibleElementIds === null) return;
    pendingCanvasSelectionRestoreRef.current = null;
    useCadUiStore.getState().applySelection(documentState.elements, restore.selection);
  }, []);

  useEffect(() => {
    tryApplyPendingCanvasSelectionRestore();
  }, [canvasSelectionEligibleElementIds, compiledDocumentRevision, elements, sourceRevision, sourceText, tryApplyPendingCanvasSelectionRestore]);

  const publishCanvasObservation = useCallback((documentVersion: number) => {
    const current = currentAuthoritativeDocument(documentVersion);
    if (!current) return;
    const runtimePresentation = multiDocumentRuntimePresentationRef.current;
    const uiState = useCadUiStore.getState();
    api.postMessage({
      type: "canvasObservationPublication",
      snapshot: canvasObservationSnapshot({
        documentVersion,
        selectedElementId: uiState.selectedElementId,
        selectedElementIds: uiState.selectedElementIds,
        document: {
          sourceText: current.state.sourceText,
          doc: current.state.doc,
          docText: current.state.docText,
          diagnostics: current.state.diagnostics,
          bindingIssueDiagnostics: current.state.bindingIssueDiagnostics,
          typedDependencyGraph: current.state.typedDependencyGraph
        },
        elements: runtimePresentation?.elements ?? current.state.elements,
        moduleMaterialization: runtimePresentation?.moduleMaterialization ?? current.state.doc.moduleMaterialization,
        selectionSubject: uiState.selectionSubject,
        compiledDocumentRevision: runtimePresentation?.graphRevision ?? current.state.compiledDocumentRevision,
        previewActive: current.state.previewElements !== null,
        evaluationState: evaluationStateRef.current,
        runtimePresentationActive: runtimePresentation !== null
      })
    });
  }, [api, currentAuthoritativeDocument]);

  const applyPendingCoordinatePointConversionSelection = useCallback(() => {
    const pending = pendingCoordinatePointConversionSelectionRef.current;
    if (!pending) return;
    const current = currentAuthoritativeDocument(pending.documentVersion);
    if (!current) return;
    pendingCoordinatePointConversionSelectionRef.current = null;
    const currentRuntimeElementIds = currentRuntimeElementIdsForSourceStatementIndexes(
      current.compiled,
      pending.successfulTargetSourceStatementIndexes
    );
    if (!currentRuntimeElementIds) return;
    drawingCanvasRef.current?.clearPendingCanvasPointerIntent();
    if (replaceCanvasSelection(
      currentRuntimeElementIds,
      currentRuntimeElementIds.at(-1),
      false,
      "requested",
      new Set(currentRuntimeElementIds),
      current.compiled.document.elements
    )) publishCanvasObservation(pending.documentVersion);
  }, [currentAuthoritativeDocument, publishCanvasObservation]);

  const deferCoordinatePointConversionSelection = useCallback((
    message: Extract<ExtensionToVscodeMessage, { type: "coordinatePointConversionSelection" }>
  ): void => {
    const currentDocumentVersion = latestHostDocumentVersionRef.current;
    if (currentDocumentVersion === null || message.documentVersion <= currentDocumentVersion) return;
    pendingCoordinatePointConversionSelectionRef.current = {
      requestId: message.requestId,
      documentVersion: message.documentVersion,
      successfulTargetSourceStatementIndexes: [...message.successfulTargetSourceStatementIndexes],
      expectedDocumentGeneration: hostDocumentGenerationRef.current
    };
  }, []);

  const publishInlineModuleCanvasTargets = useCallback((documentVersion: number) => {
    const current = currentAuthoritativeDocument(documentVersion);
    if (!current) return;
    const uiState = useCadUiStore.getState();
    const runtimePresentation = multiDocumentRuntimePresentationRef.current;
    const elements = runtimePresentation?.elements ?? current.state.elements;
    const moduleMaterialization = runtimePresentation?.moduleMaterialization ?? current.compiled.moduleMaterialization;
    const targets = inlineModuleCanvasTargetProofsFor({
      source: current.source,
      compiled: current.compiled,
      elements,
      selectedElementIds: uiState.selectedElementIds,
      moduleMaterialization
    });
    api.postMessage({
      type: "inlineModuleCanvasTargetsPublication",
      documentVersion,
      normalizedSource: current.source.normalizedSource,
      targets
    });
  }, [api, currentAuthoritativeDocument]);

  const publishCanvasTheme = useCallback((
    documentVersion: number,
    theme: CanvasTheme,
    generation: number
  ) => {
    if (!currentAuthoritativeDocument(documentVersion) || !parseCssColor(theme.background)) return;
    api.postMessage({
      type: "canvasThemePublication",
      documentVersion,
      generation,
      theme
    });
  }, [api, currentAuthoritativeDocument]);

  const publishCurrentCanvasTheme = useCallback((documentVersion: number) => {
    const generation = canvasThemeGenerationRef.current;
    if (generation === null) return;
    publishCanvasTheme(documentVersion, canvasThemeRef.current, generation);
  }, [publishCanvasTheme]);

  const refreshCanvasTheme = useCallback((generation: number | null) => {
    const resolvedTheme = readVSCodeCanvasTheme();
    canvasThemeRef.current = resolvedTheme;
    canvasThemeGenerationRef.current = generation;
    setCanvasTheme(resolvedTheme);
    const documentVersion = latestHostDocumentVersionRef.current;
    if (generation !== null && documentVersion !== null) {
      publishCanvasTheme(documentVersion, resolvedTheme, generation);
    }
  }, [publishCanvasTheme]);

  const publishCanonicalRuntimeDiagnostics = useCallback((documentVersion: number) => {
    const current = currentAuthoritativeDocument(documentVersion);
    if (
      !current ||
      current.state.previewElements !== null ||
      current.state.docText !== current.state.sourceText ||
      !evaluationStateIsCurrentFor(
        evaluationStateRef.current,
        current.state.compiledDocumentRevision
      )
    ) return;

    const bindingAnalysis = current.compiled.bindingAnalysis;
    const scalarDiagnostics = bindingAnalysis
      ? runtimeScalarDiagnostics({
          computedScalarBindings: evaluationRef.current.computedScalarBindings,
          bindingAnalysis,
          statements: current.compiled.statements,
          spans: current.compiled.spans,
          elementIdByStatementIndex: current.compiled.statementMap.elementIdByStatementIndex,
          propertySourcesByOccurrenceKey: current.compiled.propertyBindings ?? new Map(),
          occurrenceKeysByBindingId: current.compiled.occurrenceKeysByBindingId ?? new Map(),
          numericConsumerReferencesByBindingId: current.compiled.numericConsumerReferencesByBindingId ?? new Map(),
          elements: current.state.elements,
          freshness: { isSourceDirty: false, isEvaluationStale: false }
        })
      : [];
    const diagnostics = [
      ...scalarDiagnostics,
      ...runtimeGeometryDiagnostics({
        errors: evaluationRef.current.errors,
        geometryValueErrors: evaluationRef.current.geometryValueErrors,
        compiledDocument: current.compiled
      })
    ];
    api.postMessage({
      type: "runtimeDiagnosticsPublication",
      documentVersion,
      // Keep the Extension Host protocol strictly JSON-safe even if the
      // host-neutral diagnostic type later gains readonly/prototype-backed data.
      diagnostics: JSON.parse(JSON.stringify(diagnostics)) as typeof diagnostics
    });
  }, [api, currentAuthoritativeDocument]);

  useEffect(() => {
    const documentVersion = latestHostDocumentVersionRef.current;
    if (documentVersion !== null) publishCanonicalRuntimeDiagnostics(documentVersion);
  }, [evaluationState, publishCanonicalRuntimeDiagnostics]);

  useEffect(() => {
    const documentVersion = latestHostDocumentVersionRef.current;
    if (documentVersion !== null) {
      publishCanvasObservation(documentVersion);
      publishInlineModuleCanvasTargets(documentVersion);
    }
  }, [
    compiledDocumentRevision,
    evaluationState,
    multiDocumentRuntimePresentation,
    observationSelectedElementIds,
    observationSelectionSubject,
    previewActive,
    publishCanvasObservation,
    publishInlineModuleCanvasTargets
  ]);

  useEffect(() => {
    refreshCanvasTheme(canvasThemeGenerationRef.current);
    const observeHostSourceMessage = (
      message: Extract<ExtensionToVscodeMessage, { type: "replaceTextDocument" | "commitText" }>
    ): void => {
      const nextGeneration = hostDocumentGenerationRef.current + 1;
      const pendingSelectionRestore = pendingCanvasSelectionRestoreRef.current;
      if (pendingSelectionRestore && pendingSelectionRestore.hostDocumentGeneration !== nextGeneration) {
        pendingCanvasSelectionRestoreRef.current = null;
      }
      const pendingCoordinateSelection = pendingCoordinatePointConversionSelectionRef.current;
      if (pendingCoordinateSelection && (
        message.documentVersion !== pendingCoordinateSelection.documentVersion ||
        nextGeneration !== pendingCoordinateSelection.expectedDocumentGeneration + 1
      )) {
        pendingCoordinatePointConversionSelectionRef.current = null;
      }
      const pending = pendingCanvasFreePointSelectionRef.current;
      const isPendingCreationEcho = message.type === "commitText" &&
        message.reason === "edit" &&
        pending !== null &&
        pending.status !== "undone" &&
        nextGeneration === pending.lastDocumentGeneration + 1 &&
        message.documentVersion >= pending.lastDocumentVersion &&
        message.documentVersion > pending.expectedDocumentVersion &&
        normalizedSourceFor(message.sourceText) === pending.expectedSourceText &&
        (pending.acceptedDocumentVersion === null || pending.acceptedDocumentVersion === message.documentVersion);
      const isPendingCreationUndo = message.type === "commitText" &&
        message.reason === "undo" &&
        pending !== null &&
        pending.status !== "undone" &&
        nextGeneration === pending.lastDocumentGeneration + 1 &&
        message.documentVersion > pending.lastDocumentVersion &&
        normalizedSourceFor(message.sourceText) === pending.previousSourceText;
      const isPendingCreationRedo = message.type === "commitText" &&
        message.reason === "redo" &&
        pending?.status === "undone" &&
        nextGeneration === pending.lastDocumentGeneration + 1 &&
        message.documentVersion > pending.lastDocumentVersion &&
        normalizedSourceFor(message.sourceText) === pending.expectedSourceText;
      if (isPendingCreationEcho && pending) {
        pending.authoritativeDocumentGeneration = nextGeneration;
        pending.lastDocumentGeneration = nextGeneration;
        pending.lastDocumentVersion = message.documentVersion;
      } else if (isPendingCreationUndo && pending) {
        pending.status = "undone";
        pending.acceptedDocumentVersion = null;
        pending.authoritativeDocumentGeneration = null;
        pending.lastDocumentGeneration = nextGeneration;
        pending.lastDocumentVersion = message.documentVersion;
      } else if (isPendingCreationRedo && pending) {
        pending.status = "pending";
        pending.acceptedDocumentVersion = message.documentVersion;
        pending.authoritativeDocumentGeneration = nextGeneration;
        pending.lastDocumentGeneration = nextGeneration;
        pending.lastDocumentVersion = message.documentVersion;
      } else if (pending) {
        pendingCanvasFreePointSelectionRef.current = null;
      }
      hostDocumentGenerationRef.current = nextGeneration;
    };
    const isDuplicateHostSourceMessage = (
      message: Extract<ExtensionToVscodeMessage, { type: "replaceTextDocument" | "commitText" }>
    ): boolean => {
      const authoritative = lastAuthoritativeHostSourceSnapshotRef.current;
      return latestHostDocumentVersionRef.current === message.documentVersion &&
        authoritative?.documentVersion === message.documentVersion &&
        authoritative.hostDocumentUri === message.hostDocumentUri &&
        authoritative.normalizedSource === normalizedSourceFor(message.sourceText) &&
        normalizedSourceFor(useCadDocumentStore.getState().sourceText) === authoritative.normalizedSource;
    };

    const observePendingCanvasSourceCommit = (
      message: Extract<ExtensionToVscodeMessage, { type: "replaceTextDocument" | "commitText" }>
    ): boolean => {
      const pending = pendingCanvasSourceCommitRef.current;
      if (
        !pending ||
        message.type !== "commitText" ||
        message.reason !== "edit" ||
        message.documentVersion <= pending.expectedDocumentVersion ||
        normalizedSourceFor(message.sourceText) !== pending.expectedSourceText ||
        pending.previousSourceText === pending.expectedSourceText
      ) return false;
      pending.authoritativeDocumentVersion = message.documentVersion;
      completePendingCanvasSourceCommit();
      return true;
    };

    const observeCanvasCommitResult = (
      message: Extract<ExtensionToVscodeMessage, { type: "canvasCommitResult" }>
    ): void => {
      const pending = pendingCanvasSourceCommitRef.current;
      if (!pending || pending.operationId !== message.operationId) return;
      if (message.status === "rejected") {
        pendingCanvasSourceCommitRef.current = null;
        useCadUiStore.getState().setCommandErrorMessage(staleSourceAnchorError);
        return;
      }
      if (
        message.documentVersion <= pending.expectedDocumentVersion ||
        pending.previousSourceText === pending.expectedSourceText
      ) return;
      pending.accepted = true;
      if (
        pending.authoritativeDocumentVersion === null &&
        latestHostDocumentVersionRef.current === message.documentVersion &&
        lastAuthoritativeHostSourceSnapshotRef.current?.documentVersion === message.documentVersion &&
        lastAuthoritativeHostSourceSnapshotRef.current.normalizedSource === pending.expectedSourceText
      ) {
        pending.authoritativeDocumentVersion = message.documentVersion;
      }
      completePendingCanvasSourceCommit();
    };

    const runCanvasBake = async (
      message: Extract<ExtensionToVscodeMessage, { type: "canvasCommand" }>
    ) => {
      if (message.commandId !== "bakeCurrentShape" && message.commandId !== "bakeBaseShape") return;
      const expectedDocumentVersion = latestHostDocumentVersionRef.current;
      if (expectedDocumentVersion === null) return;
      const initialState = useCadDocumentStore.getState();
      const initialCompiled = effectiveCompiledDocument(initialState);
      const initialElements = effectiveElements(initialState);
      const initialCompiledDocumentRevision = initialState.compiledDocumentRevision;
      const selectedElementIds = getSelectedElementIds();
      const disabledTargetIds = message.includeDisabledGeometry
        ? resolveDisabledBakeTargetIds({
            compiled: initialCompiled,
            elements: initialElements,
            selectedElementIds
          })
        : [];
      const capturedEvaluation = evaluationRef.current;
      const commandId = message.commandId;
      const dispatchBake = (sandbox?: {
        evaluation: typeof capturedEvaluation;
        targetIds: readonly string[];
        compiledDocumentRevision: number;
      }) => {
        const result = dispatchCommand(commandId, {
          evaluation: capturedEvaluation,
          baseEvaluation: capturedEvaluation,
          evaluationIsCurrent: evaluationStateIsCurrentFor(
            evaluationStateRef.current,
            initialCompiledDocumentRevision
          ),
          bakeSelectedElementIds: selectedElementIds,
          includeHiddenGeometry: message.includeHiddenGeometry,
          includeDisabledGeometry: message.includeDisabledGeometry,
          emitSkippedComments: message.emitSkippedComments,
          ...(sandbox ? {
            bakeDisabledEvaluation: sandbox.evaluation,
            bakeDisabledEvaluationTargetIds: sandbox.targetIds,
            bakeDisabledEvaluationIsCurrent: true
          } : {}),
          getCanvasViewportRect: () => canvasFocusRef.current?.getBoundingClientRect() ?? null,
          measureCanvasTextWidth,
          recordSelectionHistory: true,
          selectInstance: selectActiveCanvasInstance,
          finalizeCanvasInteraction: () => drawingCanvasRef.current?.finalizeCanvasInteraction(),
          canvasHistory: requestCanvasHistory
        });
        const operationResult = vscodeBakeOperationResultFromCommand(result);
        if (!operationResult) return;
        if (operationResult.status === "applied") postCanvasCommit();
        api.postMessage({
          type: "bakeOperationResult",
          surface: "canvas",
          mode: commandId === "bakeCurrentShape" ? "current" : "base",
          ...operationResult
        });
      };

      if (disabledTargetIds.length === 0) {
        dispatchBake();
        return;
      }

      let sandboxEvaluation;
      try {
        sandboxEvaluation = await evaluateElementsWithRust(initialElements, {
          ...buildEvaluationOptions({
            compiledDocument: initialCompiled,
            evaluationLimitIndex: effectiveEvaluationLimitIndex(initialState)
          }),
          allowDisabledElementIds: new Set(disabledTargetIds)
        }, rustTransport.transport);
      } catch {
        return;
      }
      const current = currentAuthoritativeDocument(expectedDocumentVersion);
      if (
        !current ||
        current.state.compiledDocumentRevision !== initialCompiledDocumentRevision ||
        !evaluationStateIsCurrentFor(evaluationStateRef.current, initialCompiledDocumentRevision)
      ) return;
      dispatchBake({
        evaluation: sandboxEvaluation,
        targetIds: disabledTargetIds,
        compiledDocumentRevision: initialCompiledDocumentRevision
      });
    };

    const runSourceBake = async (
      message: Extract<ExtensionToVscodeMessage, { type: "bakeSourceRequest" }>
    ) => {
      const current = currentAuthoritativeDocument(message.documentVersion);
      const currentEvaluation = evaluationRef.current;
      const currentEvaluationIsCurrent = current && evaluationStateIsCurrentFor(
        evaluationStateRef.current,
        current.state.compiledDocumentRevision
      );
      const target = current
        ? queryDslCanvasSourceTarget({
            source: current.source,
            compiled: current.compiled,
            position: message.normalizedSourceOffset
          })
        : null;
      if (!current) {
        api.postMessage({ type: "bakeSourceResult", requestId: message.requestId, status: "stale" });
        return;
      }
      if (!target) {
        api.postMessage({ type: "bakeSourceResult", requestId: message.requestId, status: "rejected" });
        return;
      }
      if (!currentEvaluationIsCurrent) {
        const deferred = deferredSourceBakeRequestRef.current;
        if (deferred && deferred.message.requestId !== message.requestId) {
          api.postMessage({ type: "bakeSourceResult", requestId: deferred.message.requestId, status: "stale" });
        }
        deferredSourceBakeRequestRef.current = {
          message,
          compiledDocumentRevision: current.state.compiledDocumentRevision
        };
        return;
      }
      const initialCompiledDocumentRevision = current.state.compiledDocumentRevision;
      const initialElements = effectiveElements(current.state);
      const disabledTargetIds = message.includeDisabledGeometry
        ? resolveDisabledBakeTargetIds({
            compiled: current.compiled,
            elements: initialElements,
            sourceStatementIndex: target.sourceStatementIndex
          })
        : [];
      const dispatchBake = (sandbox?: {
        evaluation: typeof currentEvaluation;
        targetIds: readonly string[];
        compiledDocumentRevision: number;
      }) => {
        const result = dispatchCommand(message.mode === "current" ? "bakeCurrentShape" : "bakeBaseShape", {
          evaluation: currentEvaluation,
          baseEvaluation: currentEvaluation,
          evaluationIsCurrent: true,
          sourceStatementIndex: target.sourceStatementIndex,
          emitSkippedComments: message.emitSkippedComments,
          includeHiddenGeometry: message.includeHiddenGeometry,
          includeDisabledGeometry: message.includeDisabledGeometry,
          ...(sandbox ? {
            bakeDisabledEvaluation: sandbox.evaluation,
            bakeDisabledEvaluationTargetIds: sandbox.targetIds,
            bakeDisabledEvaluationIsCurrent: true
          } : {})
        });
        const operationResult = vscodeBakeOperationResultFromCommand(result);
        const applied = operationResult?.status === "applied";
        if (applied) postCanvasCommit();
        if (operationResult) {
          api.postMessage({
            type: "bakeOperationResult",
            surface: "source",
            requestId: message.requestId,
            mode: message.mode,
            ...operationResult
          });
        }
        api.postMessage({ type: "bakeSourceResult", requestId: message.requestId, status: applied ? "applied" : "nothing" });
      };

      if (disabledTargetIds.length === 0) {
        dispatchBake();
        return;
      }

      let sandboxEvaluation;
      try {
        sandboxEvaluation = await evaluateElementsWithRust(initialElements, {
          ...buildEvaluationOptions({
            compiledDocument: current.compiled,
            evaluationLimitIndex: effectiveEvaluationLimitIndex(current.state)
          }),
          allowDisabledElementIds: new Set(disabledTargetIds)
        }, rustTransport.transport);
      } catch {
        api.postMessage({ type: "bakeSourceResult", requestId: message.requestId, status: "rejected" });
        return;
      }
      const revalidated = currentAuthoritativeDocument(message.documentVersion);
      if (
        !revalidated ||
        revalidated.state.compiledDocumentRevision !== initialCompiledDocumentRevision ||
        !evaluationStateIsCurrentFor(evaluationStateRef.current, initialCompiledDocumentRevision)
      ) {
        api.postMessage({ type: "bakeSourceResult", requestId: message.requestId, status: "stale" });
        return;
      }
      dispatchBake({
        evaluation: sandboxEvaluation,
        targetIds: disabledTargetIds,
        compiledDocumentRevision: initialCompiledDocumentRevision
      });
    };

    const runCanvasFreePointAtPointer = (
      message: Extract<ExtensionToVscodeMessage, { type: "canvasFreePointAtPointer" }>
    ): void => {
      const reject = (): void => {
        api.postMessage({
          type: "canvasFreePointAtPointerResult",
          requestId: message.requestId,
          status: "rejected",
          documentVersion: latestHostDocumentVersionRef.current ?? message.documentVersion
        });
      };
      if (pendingCanvasFreePointCommitRef.current !== null) {
        useCadUiStore.getState().setCommandErrorMessage(staleSourceAnchorError);
        reject();
        return;
      }
      if (!Number.isFinite(message.pointer.x) || !Number.isFinite(message.pointer.y)) {
        useCadUiStore.getState().setCommandErrorMessage(canvasPointerError);
        reject();
        return;
      }
      if (!Number.isFinite(message.documentVersion) || !Number.isInteger(message.documentVersion)) {
        useCadUiStore.getState().setCommandErrorMessage(sourceCreationInsertionUnsafeError);
        reject();
        return;
      }

      const current = currentAuthoritativeCanvasSourceDocument(message.documentVersion);
      if (!current) {
        useCadUiStore.getState().setCommandErrorMessage(canvasAuthorityRejectionErrorFor(message.documentVersion));
        reject();
        return;
      }
      const graphAuthority = current.graphAuthority;

      const sourceTextLines = current.source.normalizedSource.split("\n");
      const requestedSourcePosition = message.sourcePosition;
      const requestedPositionIsCurrentAndValid =
        requestedSourcePosition.documentVersion === message.documentVersion &&
        Number.isInteger(requestedSourcePosition.line) &&
        requestedSourcePosition.line >= 0 &&
        requestedSourcePosition.line < sourceTextLines.length &&
        Number.isInteger(requestedSourcePosition.character) &&
        requestedSourcePosition.character >= 0 &&
        requestedSourcePosition.character <= (sourceTextLines[requestedSourcePosition.line]?.length ?? -1);
      const sourceInsertionOffset = requestedPositionIsCurrentAndValid
        ? sourceOffsetForLineCharacter(
            current.state.sourceText,
            requestedSourcePosition.line,
            requestedSourcePosition.character
          )
        : current.state.sourceText.length;
      if (sourceInsertionOffset === null) {
        useCadUiStore.getState().setCommandErrorMessage(sourceCreationInsertionUnsafeError);
        reject();
        return;
      }

      const placement = creationPlacementForTarget(
        current.elements,
        { insertionIndex: 0 },
        current.evaluationLimitIndex
      );
      const recipe = creationRecipeForType("freePoint");
      if (!recipe) {
        useCadUiStore.getState().setCommandErrorMessage(sourceCreationInsertionUnsafeError);
        reject();
        return;
      }
      const element = applyCreationPlacement(
        emitCreationRecipe(recipe, {
          x: message.pointer.x,
          y: message.pointer.y
        }, {
          elements: current.elements,
          referenceElements: placement.referenceElements
        }),
        placement
      );
      const revalidated = currentAuthoritativeCanvasSourceDocument(message.documentVersion);
      if (
        !revalidated ||
        revalidated.source.sourceRevision !== current.source.sourceRevision ||
        revalidated.source.normalizedSource !== current.source.normalizedSource ||
        revalidated.state.sourceRevision !== current.state.sourceRevision ||
        revalidated.state.sourceText !== current.state.sourceText ||
        revalidated.sourceEditing?.sourceText !== current.sourceEditing?.sourceText
      ) {
        useCadUiStore.getState().setCommandErrorMessage(canvasAuthorityRejectionErrorFor(message.documentVersion));
        reject();
        return;
      }

      const uiState = useCadUiStore.getState();
      const previousSelection: SelectionSnapshot = {
        selectedElementId: uiState.selectedElementId,
        selectedElementIds: [...uiState.selectedElementIds],
        selectionAnchorElementId: uiState.selectionAnchorElementId
      };
      const previousSourceText = useCadDocumentStore.getState().sourceText;
      const declarationText = sourceCreationTextForElements([element]);
      const textInsertion = declarationText === null ? null : sourceTextInsertionAtOffset({
        sourceText: current.state.sourceText,
        offset: sourceInsertionOffset,
        declarationText
      });
      if (!textInsertion) {
        useCadUiStore.getState().setCommandErrorMessage(sourceInsertionError);
        reject();
        return;
      }
      const sourceCommitResult = useCadDocumentStore.getState().commitAuthoritativeSourceInsertion(
        {
          sourceText: current.state.sourceText,
          sourceRevision: current.state.sourceRevision
        },
        sourceInsertionOffset,
        textInsertion.insertedText,
        { createdElementIds: [element.id] }
      );
      const insertedElementIds: ElementId[] = [element.id];
      const selectedElementId: ElementId | null = element.id;
      const compiled = useCadDocumentStore.getState().currentCompiled;
      const selectedSourceStatementIndex = [...compiled.sourceElementsByStatementIndex.entries()]
        .find(([, sourceElement]) => sourceElement.id === element.id)?.[0];
      if (sourceCommitResult.status !== "applied") {
        useCadUiStore.getState().setCommandErrorMessage(
          sourceCommitResult.status === "rejected"
            ? canvasAuthorityRejectionErrorFor(message.documentVersion)
            : sourceInsertionError
        );
        reject();
        return;
      }

      const committedSourceText = useCadDocumentStore.getState().sourceText;
      const declarationEndOffset = textInsertion.declarationOffset + textInsertion.declarationLength;
      const selectionIntent: PendingCanvasFreePointSelection = {
        requestId: message.requestId,
        lastDocumentGeneration: hostDocumentGenerationRef.current,
        lastDocumentVersion: message.documentVersion,
        previousSourceText: normalizedSourceFor(previousSourceText),
        expectedDocumentVersion: message.documentVersion,
        expectedSourceText: normalizedSourceFor(committedSourceText),
        selectedElementId,
        selectedElementIds: insertedElementIds,
        selectionAnchorElementId: selectedElementId,
        ...(selectedSourceStatementIndex !== undefined ? { sourceStatementIndex: selectedSourceStatementIndex } : {}),
        acceptedDocumentVersion: null,
        authoritativeDocumentGeneration: null,
        status: "pending"
      };
      pendingCanvasFreePointSelectionRef.current = selectionIntent;
      pendingCanvasFreePointCommitRef.current = {
        requestId: message.requestId,
        expectedDocumentVersion: message.documentVersion,
        previousSourceText,
        previousSelection,
        selectionIntent,
        nextSourcePosition: sourcePositionAtOffset(committedSourceText, declarationEndOffset)
      };
      postCanvasCommit(message.requestId, undefined, undefined, graphAuthority);
    };

    const handleInlineModuleSelectionRequest = (
      message: Extract<ExtensionToVscodeMessage, { type: "inlineModuleSelectionRequest" }>
    ): void => {
      const current = currentAuthoritativeDocument(message.documentVersion);
      if (!current || current.source.normalizedSource !== message.normalizedSource) {
        api.postMessage({
          type: "inlineModuleSelectionResult",
          requestId: message.requestId,
          documentVersion: message.documentVersion,
          status: "rejected"
        });
        return;
      }
      if (!evaluationStateIsCurrentFor(evaluationStateRef.current, current.state.compiledDocumentRevision)) {
        deferredInlineModuleSelectionRequestRef.current = message;
        return;
      }

      const currentEvaluation = evaluationRef.current;
      const runtimeElements = effectiveElements(current.state);
      const runtimePresentation = multiDocumentRuntimePresentationRef.current;
      const layerPresentation = projectCanvasLayerPresentation({
        compiledDocument: current.compiled,
        sourceDocuments: runtimePresentation?.layerSourceDocuments,
        moduleMaterialization: runtimePresentation?.revealMaterialization ?? current.compiled.moduleMaterialization,
        elements: runtimeElements,
        evaluation: currentEvaluation,
        hiddenLayerIds: useCadUiStore.getState().hiddenCanvasLayerIds
      });
      const drawingModifiers = current.state.modifiers ?? [];
      const effectiveVisibleElementIds = effectiveDrawElementIds(runtimeElements, drawingModifiers);
      const effectiveEnabledElementIds = effectiveEvaluationElementIds(runtimeElements, drawingModifiers);
      const activeVisibilityProfile = visibilityProfileById(
        current.state.visibilityProfiles,
        current.state.activeVisibilityProfileId
      );
      const profileVisibleElementIds = effectiveVisibleElementIdsForProfile({
        elements: [...runtimeElements],
        profile: activeVisibilityProfile
      });
      const selectionEligibleIds = computeCanvasSelectionEligibleElementIds({
        elements: runtimeElements,
        evaluation: currentEvaluation,
        moduleMaterialization: runtimePresentation?.revealMaterialization ?? current.compiled.moduleMaterialization,
        visibilityProfiles: current.state.visibilityProfiles,
        activeVisibilityProfileId: current.state.activeVisibilityProfileId,
        showCanvasPoints: useCadUiStore.getState().showCanvasPoints,
        canvasLayerPresentation: layerPresentation,
        measureCanvasTextWidth
      });
      const revealEligibleIds = new Set(selectionEligibleIds);
      for (const element of runtimeElements) {
        if (element.type === "group") revealEligibleIds.add(element.id);
      }

      const selectionIds: string[] = [];
      const seenSelectionIds = new Set<string>();
      for (const proof of message.generatedGroups) {
        const statement = current.compiled.statements[proof.sourceStatementIndex];
        const statementId = current.compiled.statementMap?.statementIdByStatementIndex?.get(proof.sourceStatementIndex);
        if (
          !statementId ||
          !statement ||
          statement.kind !== "group" ||
          statement.name !== proof.generatedGroupName ||
          statement.sourceRevision !== current.source.sourceRevision ||
          statement.documentRange.from !== proof.sourceRange.from ||
          statement.documentRange.to !== proof.sourceRange.to
        ) continue;
        const sourceTarget = queryDslCanvasRevealSourceTarget({
          source: current.source,
          compiled: current.compiled,
          position: proof.sourceRange.from
        });
        if (
          sourceTarget.status !== "resolved" ||
          sourceTarget.target.kind !== "statement-owner" ||
          sourceTarget.target.sourceStatementIndex !== proof.sourceStatementIndex
        ) continue;
        const revealResult = queryDslCanvasRevealRuntimeTarget({
          target: sourceTarget.target,
          compiled: current.compiled,
          moduleGeometryRuntime: current.compiled.moduleGeometryRuntime,
          elements: runtimeElements,
          effectiveVisibleElementIds,
          effectiveEnabledElementIds,
          profileVisibleElementIds,
          selectionEligibleElementIds: revealEligibleIds
        });
        if (revealResult.status !== "resolved") continue;
        for (const runtimeElementId of revealResult.runtimeElementIds) {
          const element = runtimeElements.find((candidate) => candidate.id === runtimeElementId);
          const descendants = element?.type === "group"
            ? groupCanvasGeometry({
                groupId: runtimeElementId,
                elements: runtimeElements,
                evaluation: currentEvaluation,
                visibilityProfiles: current.state.visibilityProfiles,
                activeVisibilityProfileId: current.state.activeVisibilityProfileId,
                measureCanvasTextWidth
              })?.renderableDescendantIds ?? []
            : [runtimeElementId];
          for (const selectionId of descendants) {
            if (!selectionEligibleIds.has(selectionId) || seenSelectionIds.has(selectionId)) continue;
            seenSelectionIds.add(selectionId);
            selectionIds.push(selectionId);
          }
        }
      }

      if (selectionIds.length === 0 || !replaceCanvasSelection(
        selectionIds,
        selectionIds[0],
        false,
        "requested",
        selectionEligibleIds
      )) {
        api.postMessage({
          type: "inlineModuleSelectionResult",
          requestId: message.requestId,
          documentVersion: message.documentVersion,
          status: "rejected"
        });
        return;
      }
      api.postMessage({
        type: "inlineModuleSelectionResult",
        requestId: message.requestId,
        documentVersion: message.documentVersion,
        status: "selected",
        selectedRuntimeElementIds: selectionIds
      });
    };

    const onMessage = (event: MessageEvent<ExtensionToVscodeMessage>) => {
      const message = event.data;
      if (rustTransport.handleMessage(message)) return;
      if (message.type === "canvasCoordinatePointCreationStart") {
        startCoordinatePointCreation(message.requestId, message.documentVersion, message.hostDocumentUri);
        return;
      } else if (message.type === "multiDocumentGraphPublication") {
        const openRoot = lastAuthoritativeHostSourceSnapshotRef.current?.hostDocumentUri;
        if (message.documentVersion !== null &&
          isStaleHostDocumentVersion(latestHostDocumentVersionRef.current, message.documentVersion)) return;
        if (message.status === "current" && message.hostDocumentUri === message.graph.rootDocumentId &&
          (!openRoot || openRoot === message.hostDocumentUri)) {
          const last = lastGraphPublicationRef.current;
          const { rootDocumentId, revision } = message.graph;
          if (last?.rootDocumentId === rootDocumentId && revision <= last.revision) return;
          lastGraphPublicationRef.current = { rootDocumentId, revision };
        }
        multiDocumentGraphPublicationRef.current = message;
        multiDocumentRuntimePresentationRef.current = null;
        setMultiDocumentGraphPublication(message);
        return;
      } else if (message.type === "canvasFreePointAtPointer") {
        runCanvasFreePointAtPointer(message);
        return;
      } else if (message.type === "canvasCommitResult") {
        observeCanvasCommitResult(message);
        const pending = pendingCanvasFreePointCommitRef.current;
        if (!pending || pending.requestId !== message.operationId) return;
        pendingCanvasFreePointCommitRef.current = null;
        if (
          pendingCanvasFreePointSelectionRef.current !== pending.selectionIntent ||
          (message.status === "accepted" && pending.selectionIntent.status === "undone")
        ) {
          api.postMessage({
            type: "canvasFreePointAtPointerResult",
            requestId: pending.requestId,
            status: "rejected",
            documentVersion: latestHostDocumentVersionRef.current ?? message.documentVersion
          });
          return;
        }
        if (
          message.status !== "accepted" ||
          !Number.isInteger(message.documentVersion) ||
          message.documentVersion < pending.expectedDocumentVersion
        ) {
          pendingCanvasFreePointSelectionRef.current = null;
          useCadDocumentStore.getState().replaceTextDocument(pending.previousSourceText, {
            currentFilePath: null,
            dirtySinceSave: false
          });
          pendingCanvasSelectionRestoreRef.current = {
            sourceText: normalizedSourceFor(pending.previousSourceText),
            sourceRevision: useCadDocumentStore.getState().sourceRevision,
            hostDocumentGeneration: hostDocumentGenerationRef.current,
            selection: pending.previousSelection
          };
          tryApplyPendingCanvasSelectionRestore();
          useCadUiStore.getState().setCommandErrorMessage(staleSourceAnchorError);
          api.postMessage({
            type: "canvasFreePointAtPointerResult",
            requestId: pending.requestId,
            status: "rejected",
            documentVersion: message.documentVersion
          });
          return;
        }
        if (
          pendingCanvasFreePointSelectionRef.current === pending.selectionIntent &&
          pending.selectionIntent.status === "pending" &&
          message.documentVersion > pending.expectedDocumentVersion
        ) {
          pending.selectionIntent.acceptedDocumentVersion = message.documentVersion;
          pending.selectionIntent.lastDocumentVersion = message.documentVersion;
          tryApplyPendingCanvasSelectionRestore();
        }
        api.postMessage({
          type: "canvasFreePointAtPointerResult",
          requestId: pending.requestId,
          status: "applied",
          documentVersion: message.documentVersion,
          nextSourcePosition: pending.nextSourcePosition
        });
        return;
      } else if (message.type === "coordinatePointConversionSelection") {
        const current = currentAuthoritativeDocument(message.documentVersion);
        if (message.successfulTargetSourceStatementIndexes.length === 0) return;
        if (!current) {
          deferCoordinatePointConversionSelection(message);
          return;
        }
        pendingCoordinatePointConversionSelectionRef.current = null;
        const currentRuntimeElementIds = currentRuntimeElementIdsForSourceStatementIndexes(
          current.compiled,
          message.successfulTargetSourceStatementIndexes
        );
        if (!currentRuntimeElementIds) return;
        drawingCanvasRef.current?.clearPendingCanvasPointerIntent();
        if (replaceCanvasSelection(
          currentRuntimeElementIds,
          currentRuntimeElementIds.at(-1),
          false,
          "requested",
          new Set(currentRuntimeElementIds),
          current.compiled.document.elements
        )) publishCanvasObservation(message.documentVersion);
        return;
      } else if (message.type === "canvasThemeChanged") {
        if (Number.isInteger(message.generation)) refreshCanvasTheme(message.generation);
      } else if (message.type === "canvasRibbonPositions") {
        setCanvasRibbonPositions(normalizeVscodeCanvasRibbonPositions(message.positions));
      } else if (message.type === "canvasGridConfiguration") {
        setCanvasGridSettings(normalizeCanvasGridSettings(message.settings));
      } else if (message.type === "canvasCommand") {
        if (!canvasModalCanvasCommandAllowed(message.commandId, canvasModalMode())) return;
        if (message.commandId === "bakeCurrentShape" || message.commandId === "bakeBaseShape") {
          void runCanvasBake(message);
          return;
        }
        if (message.commandId === "fitDrawing") {
          drawingCanvasRef.current?.fitDrawing();
          return;
        }
        dispatchCommand(message.commandId, {
          evaluation: evaluationRef.current,
          baseEvaluation: evaluationRef.current,
          evaluationIsCurrent: evaluationStateIsCurrentFor(
            evaluationStateRef.current,
            useCadDocumentStore.getState().compiledDocumentRevision
          ),
          getCanvasViewportRect: () => canvasFocusRef.current?.getBoundingClientRect() ?? null,
          measureCanvasTextWidth,
          recordSelectionHistory: true,
          selectInstance: selectActiveCanvasInstance,
          finalizeCanvasInteraction: () => drawingCanvasRef.current?.finalizeCanvasInteraction(),
          canvasHistory: requestCanvasHistory
        });
      } else if (message.type === "bakeSourceRequest") {
        void runSourceBake(message);
        return;
      } else if (message.type === "canvasHistoryResult") {
        completeCanvasHistoryResult(message);
      } else if (message.type === "canvasSourceDefinitionRequest") {
        const expectedDocumentVersion = latestHostDocumentVersionRef.current;
        if (expectedDocumentVersion === null || canvasHistoryInFlightRef.current !== null) {
          api.postMessage({
            type: "canvasSourceDefinitionResult",
            requestId: message.requestId,
            documentVersion: null,
            runtimeElementId: null,
            range: null
          });
          return;
        }
        const current = currentAuthoritativeDocument(expectedDocumentVersion);
        const selectedElementId = useCadUiStore.getState().selectedElementId;
        const publication = multiDocumentGraphPublicationRef.current;
        const graphRuntime = publication?.status === "current" ? publication.canvasRuntime : null;
        let runtimeElementId: string | null = selectedElementId;
        if (graphRuntime?.identityOnly) {
          runtimeElementId = null;
          const graph = publication?.status === "current" ? publication.graph : null;
          const projectionIsCurrent = Boolean(
            current &&
            publication?.status === "current" &&
            publication.documentVersion === expectedDocumentVersion &&
            graph?.valid &&
            graph.rootDocumentId === graphRuntime.rootDocumentId &&
            graph.rootSource.normalizedSource === current.source.normalizedSource &&
            graphRuntime.graphRevision === graph.revision &&
            graphRuntime.rootSourceRevision === graph.rootSource.sourceRevision
          );
          const localOwner = current && selectedElementId && current.compiled.statementMap
            ? sourceOwnerForRuntimeElementId(current.compiled, selectedElementId)
            : null;
          if (projectionIsCurrent && localOwner?.kind === "ordinary") {
            runtimeElementId = new Map(graphRuntime.sourceElementRuntimeIdsByStatementIndex ?? [])
              .get(localOwner.sourceStatementIndex) ?? null;
          }
        }
        const range = current && selectedElementId
          ? queryDslCanvasSourceDefinition({
              source: current.source,
              compiled: current.compiled,
              runtimeElementId: selectedElementId
            })
          : null;
        api.postMessage({
          type: "canvasSourceDefinitionResult",
          requestId: message.requestId,
          documentVersion: expectedDocumentVersion,
          runtimeElementId,
          range
        });
      } else if (message.type === "inlineModuleSelectionRequest") {
        handleInlineModuleSelectionRequest(message);
      } else if (message.type === "canvasNavigationRequest") {
        pendingCanvasFocusRequestRef.current = null;
        deferredCanvasNavigationRequestRef.current = null;
        latestCanvasNavigationRequestRef.current = message.requestId;
        if (canvasHistoryInFlightRef.current !== null) {
          api.postMessage({
            type: "canvasNavigationResult",
            requestId: message.requestId,
            status: "failed",
            reason: "source-mismatch"
          });
          return;
        }
        const graphBackedRequest = message.graphRevision !== undefined &&
          message.sourceRevision !== undefined &&
          message.sourceTarget !== undefined;
        const graphBackedImportedStatementOwnerRequest = graphBackedRequest &&
          message.sourceTarget.kind === "statement-owner";
        const currentHostSource = currentHostSourceAuthorityFor(message.documentVersion);
        const current = graphBackedImportedStatementOwnerRequest
          ? null
          : currentAuthoritativeDocument(message.documentVersion);
        const freshness = canvasNavigationFreshnessFor(graphBackedRequest
          ? {
              authoritativeDocumentAvailable: graphBackedImportedStatementOwnerRequest
                ? currentHostSource !== null
                : current !== null,
              graphBackedRequest: true,
              documentVersion: message.documentVersion,
              normalizedSource: (graphBackedImportedStatementOwnerRequest
                ? currentHostSource?.source.normalizedSource
                : current?.source.normalizedSource) ?? "",
              sourceRevision: message.sourceRevision,
              graphRevision: message.graphRevision,
              publication: multiDocumentGraphPublicationRef.current,
              runtimePresentation: multiDocumentRuntimePresentationRef.current
            }
          : {
              authoritativeDocumentAvailable: current !== null,
              graphBackedRequest: false
            });
        if (freshness.status === "failed") {
          api.postMessage({
            type: "canvasNavigationResult",
            requestId: message.requestId,
            status: "failed",
            reason: "source-mismatch"
          });
          return;
        }
        if (freshness.status === "defer") {
          deferredCanvasNavigationRequestRef.current = message;
          return;
        }
        if (graphBackedImportedStatementOwnerRequest && message.runtimeProjection === undefined) {
          api.postMessage({
            type: "canvasNavigationResult",
            requestId: message.requestId,
            status: "failed",
            reason: "source-mismatch"
          });
          return;
        }
        if (!graphBackedImportedStatementOwnerRequest && !current) return;
        const sourceTarget = graphBackedRequest
          ? { status: "resolved" as const, target: message.sourceTarget }
          : queryDslCanvasRevealSourceTarget({
              source: current!.source,
              compiled: current!.compiled,
              position: message.normalizedSourceOffset
            });
        if (sourceTarget.status === "failed") {
          api.postMessage({
            type: "canvasNavigationResult",
            requestId: message.requestId,
            status: "failed",
            reason: sourceTarget.reason
          });
          return;
        }

        const currentEvaluation = evaluationRef.current;
        const runtimePresentation = multiDocumentRuntimePresentationRef.current;
        const presentationRevision = runtimePresentation?.graphRevision ?? (
          graphBackedImportedStatementOwnerRequest
            ? currentHostSource!.state.compiledDocumentRevision
            : current!.state.compiledDocumentRevision
        );
        const currentEvaluationIsCurrent = evaluationStateIsCurrentFor(
          evaluationStateRef.current,
          presentationRevision
        );
        if (!currentEvaluationIsCurrent) {
          deferredCanvasNavigationRequestRef.current = message;
          return;
        }

        const runtimeElements = runtimePresentation?.elements ?? effectiveElements(
          graphBackedImportedStatementOwnerRequest ? currentHostSource!.state : current!.state
        );
        const revealCompiled = graphBackedImportedStatementOwnerRequest
          ? null
          : graphBackedRequest && runtimePresentation?.revealMaterialization
            ? { ...current!.compiled, moduleMaterialization: runtimePresentation.revealMaterialization }
            : current!.compiled;
        const runtimeModuleMaterialization = graphBackedRequest
          ? runtimePresentation?.revealMaterialization
          : current!.compiled.moduleMaterialization;
        if (graphBackedRequest && !runtimePresentation?.revealMaterialization) {
          api.postMessage({
            type: "canvasNavigationResult",
            requestId: message.requestId,
            status: "failed",
            reason: "no-revealable-runtime-target"
          });
          return;
        }
        const currentState = graphBackedImportedStatementOwnerRequest
          ? currentHostSource!.state
          : current!.state;
        const drawingModifiers = currentState.modifiers ?? [];
        const effectiveVisibleElementIds = effectiveDrawElementIds(runtimeElements, drawingModifiers);
        const effectiveEnabledElementIds = effectiveEvaluationElementIds(runtimeElements, drawingModifiers);
        const presentationVisibilityProfiles = runtimePresentation?.visibilityProfiles ?? currentState.visibilityProfiles;
        const presentationActiveVisibilityProfileId = runtimePresentation?.activeVisibilityProfileId ?? currentState.activeVisibilityProfileId;
        const layerPresentation = projectCanvasLayerPresentation({
          compiledDocument: graphBackedImportedStatementOwnerRequest
            ? effectiveCompiledDocument(currentHostSource!.state)
            : current!.compiled,
          sourceDocuments: runtimePresentation?.layerSourceDocuments,
          moduleMaterialization: runtimeModuleMaterialization,
          elements: runtimeElements,
          evaluation: currentEvaluation,
          hiddenLayerIds: useCadUiStore.getState().hiddenCanvasLayerIds
        });
        const activeVisibilityProfile = visibilityProfileById(
          presentationVisibilityProfiles,
          presentationActiveVisibilityProfileId
        );
        const profileVisibleElementIds = effectiveVisibleElementIdsForProfile({
          elements: [...runtimeElements],
          profile: activeVisibilityProfile
        });
        const selectionEligibleIds = computeCanvasSelectionEligibleElementIds({
          elements: runtimeElements,
          evaluation: currentEvaluation,
          moduleMaterialization: runtimeModuleMaterialization,
          visibilityProfiles: presentationVisibilityProfiles,
          activeVisibilityProfileId: presentationActiveVisibilityProfileId,
          showCanvasPoints: useCadUiStore.getState().showCanvasPoints,
          canvasLayerPresentation: layerPresentation,
          measureCanvasTextWidth
        });
        const revealResult = graphBackedImportedStatementOwnerRequest
          ? queryDslCanvasRevealRuntimeStatementOwner({
              candidates: message.runtimeProjection!.candidates,
              elements: runtimeElements,
              effectiveVisibleElementIds,
              effectiveEnabledElementIds,
              profileVisibleElementIds,
              selectionEligibleElementIds: selectionEligibleIds
            })
          : queryDslCanvasRevealRuntimeTarget({
              target: sourceTarget.target,
              compiled: revealCompiled!,
              moduleGeometryRuntime: current!.compiled.moduleGeometryRuntime,
              elements: runtimeElements,
              effectiveVisibleElementIds,
              effectiveEnabledElementIds,
              profileVisibleElementIds,
              selectionEligibleElementIds: selectionEligibleIds
            });
        if (revealResult.status === "failed") {
          api.postMessage({
            type: "canvasNavigationResult",
            requestId: message.requestId,
            status: "failed",
            reason: revealResult.reason
          });
          return;
        }

        const selectionIds = [...revealResult.runtimeElementIds];
        const primarySelectionId = revealResult.primaryRuntimeElementId;
        let revealBounds = null;
        if (selectionIds.length === 1) {
          const containerTarget = canvasNavigationContainerTarget({
            runtimeElementIds: selectionIds,
            elements: runtimeElements,
            evaluation: currentEvaluation,
            evaluationIsCurrent: currentEvaluationIsCurrent,
            moduleMaterialization: runtimeModuleMaterialization,
            canvasLayerPresentation: layerPresentation,
            visibilityProfiles: presentationVisibilityProfiles,
            activeVisibilityProfileId: presentationActiveVisibilityProfileId,
            measureCanvasTextWidth
          });
          if (containerTarget.status === "stale") {
            deferredCanvasNavigationRequestRef.current = message;
            return;
          }
          if (containerTarget.status === "ready") revealBounds = containerTarget.bounds;
        }

        if (!replaceCanvasSelection(
          selectionIds,
          primarySelectionId,
          true,
          "requested",
          currentEvaluationIsCurrent ? selectionEligibleIds : undefined,
          runtimeElements,
          { preservePickMode: canvasModalCanvasOperationAllowed("reveal", canvasModalMode()) }
        )) {
          api.postMessage({
            type: "canvasNavigationResult",
            requestId: message.requestId,
            status: "failed",
            reason: "no-revealable-runtime-target"
          });
          return;
        }

        const viewport = canvasFocusRef.current;
        if (viewport) {
          const rect = viewport.getBoundingClientRect();
          const bounds = revealBounds ?? (
            currentEvaluation &&
            currentEvaluationIsCurrent &&
            currentEvaluation.computedGeometry instanceof Map
              ? canvasElementDrawingBounds({
                  elementId: primarySelectionId,
                  elements: runtimeElements,
                  evaluation: currentEvaluation,
                  visibilityProfiles: presentationVisibilityProfiles,
                  activeVisibilityProfileId: presentationActiveVisibilityProfileId,
                  measureCanvasTextWidth
                })
              : null
          );
          if (bounds) {
            const uiState = useCadUiStore.getState();
            const fittedViewport = fitCanvasViewportToBounds({
              bounds,
              size: { width: rect.width, height: rect.height },
              currentZoom: uiState.canvasViewport.zoom,
              paddingPx: CANVAS_FIT_PADDING_PX,
              maxZoom: MAX_CANVAS_ZOOM
            });
            if (fittedViewport) uiState.setCanvasViewport(fittedViewport);
          }
        }
        api.postMessage({
          type: "canvasNavigationResult",
          requestId: message.requestId,
          status: "resolved",
          degradations: revealResult.degradations
        });
      } else if (message.type === "focusCanvas") {
        if (latestCanvasNavigationRequestRef.current !== message.requestId) return;
        drawingCanvasRef.current?.finalizeCanvasInteraction();
        pendingCanvasFocusRequestRef.current = message.requestId;
        tryCompleteCanvasFocus(message.requestId);
      } else if (message.type === "replaceTextDocument") {
        if (isStaleHostDocumentVersion(latestHostDocumentVersionRef.current, message.documentVersion)) return;
        setImageResources(message.imageResources ?? {});
        observePendingCanvasSourceCommit(message);
        if (isDuplicateHostSourceMessage(message)) {
          api.postMessage({ type: "webviewAuthoritativeDocumentReady", documentVersion: message.documentVersion });
          return;
        }
        useCadUiStore.getState().resetCanvasLayerVisibility();
        setCanvasDocumentEpoch((epoch) => epoch + 1);
        lastGraphPublicationRef.current = null;
        observeHostSourceMessage(message);
        pendingCanvasFocusRequestRef.current = null;
        latestCanvasNavigationRequestRef.current = null;
        deferredCanvasNavigationRequestRef.current = null;
        deferredInlineModuleSelectionRequestRef.current = null;
        discardDeferredSourceBake();
        latestHostDocumentVersionRef.current = message.documentVersion;
        setLatestHostDocumentVersion(message.documentVersion);
        multiDocumentGraphPublicationRef.current = null;
        multiDocumentRuntimePresentationRef.current = null;
        setMultiDocumentGraphPublication(null);
        lastAuthoritativeHostSourceSnapshotRef.current = {
          documentVersion: message.documentVersion,
          normalizedSource: normalizedSourceFor(message.sourceText),
          hostDocumentUri: message.hostDocumentUri
        };
        setAuthoritativeHostSourceSnapshot(lastAuthoritativeHostSourceSnapshotRef.current);
        useCadDocumentStore.getState().replaceTextDocument(message.sourceText, {
          currentFilePath: null,
          dirtySinceSave: false
        });
        pendingCanvasSourceCommitRef.current = null;
        lastCanvasSourceHistoryCommitRef.current = null;
        invalidateCanvasHistory();
        api.postMessage({ type: "webviewAuthoritativeDocumentReady", documentVersion: message.documentVersion });
        publishCurrentCanvasTheme(message.documentVersion);
        publishCanonicalRuntimeDiagnostics(message.documentVersion);
        publishCanvasObservation(message.documentVersion);
        publishInlineModuleCanvasTargets(message.documentVersion);
        tryApplyPendingCanvasSelectionRestore();
        applyPendingCoordinatePointConversionSelection();
      } else if (message.type === "commitText") {
        if (isStaleHostDocumentVersion(latestHostDocumentVersionRef.current, message.documentVersion)) return;
        setImageResources(message.imageResources ?? {});
        const pendingCanvasSourceObserved = observePendingCanvasSourceCommit(message);
        if (isDuplicateHostSourceMessage(message)) {
          api.postMessage({ type: "webviewAuthoritativeDocumentReady", documentVersion: message.documentVersion });
          return;
        }
        observeHostSourceMessage(message);
        pendingCanvasFocusRequestRef.current = null;
        latestCanvasNavigationRequestRef.current = null;
        deferredCanvasNavigationRequestRef.current = null;
        deferredInlineModuleSelectionRequestRef.current = null;
        discardDeferredSourceBake();
        latestHostDocumentVersionRef.current = message.documentVersion;
        setLatestHostDocumentVersion(message.documentVersion);
        multiDocumentGraphPublicationRef.current = null;
        multiDocumentRuntimePresentationRef.current = null;
        setMultiDocumentGraphPublication(null);
        lastAuthoritativeHostSourceSnapshotRef.current = {
          documentVersion: message.documentVersion,
          normalizedSource: normalizedSourceFor(message.sourceText),
          hostDocumentUri: message.hostDocumentUri
        };
        setAuthoritativeHostSourceSnapshot(lastAuthoritativeHostSourceSnapshotRef.current);
        if (message.reason === "undo" || message.reason === "redo") {
          const sourceBeforeHistory = useCadDocumentStore.getState().sourceText;
          const inFlightBeforeHistory = canvasHistoryInFlightRef.current;
          const trackedSourceHistoryTransition =
            inFlightBeforeHistory?.entry === "source" &&
            inFlightBeforeHistory.direction === message.reason &&
            message.documentVersion > inFlightBeforeHistory.expectedDocumentVersion &&
            normalizedSourceFor(sourceBeforeHistory) !== normalizedSourceFor(message.sourceText);
          const adjacentCheckpoint = trackedSourceHistoryTransition
            ? message.reason === "undo"
              ? useCadDocumentStore.getState().past.at(-1)
              : useCadDocumentStore.getState().future[0]
            : null;
          const adjacentSelection = adjacentCheckpoint &&
            normalizedSourceFor(adjacentCheckpoint.text) === normalizedSourceFor(message.sourceText)
            ? {
                selectedElementId: adjacentCheckpoint.selection.selectedElementId,
                selectedElementIds: [...adjacentCheckpoint.selection.selectedElementIds],
                selectionAnchorElementId: adjacentCheckpoint.selection.selectionAnchorElementId
              }
            : null;
          canvasHistoryStoreMutationRef.current = true;
          let historyOutcome: "reconciled" | "reset";
          try {
            historyOutcome = useCadDocumentStore.getState().reconcileAuthoritativeHistory(
              message.sourceText,
              message.reason
            );
          } finally {
            canvasHistoryStoreMutationRef.current = false;
          }
          if (historyOutcome === "reconciled" && trackedSourceHistoryTransition && adjacentSelection) {
            const reconciledState = useCadDocumentStore.getState();
            pendingCanvasSelectionRestoreRef.current = {
              sourceText: normalizedSourceFor(reconciledState.sourceText),
              sourceRevision: reconciledState.sourceRevision,
              hostDocumentGeneration: hostDocumentGenerationRef.current,
              selection: adjacentSelection
            };
            tryApplyPendingCanvasSelectionRestore();
          }
          const inFlight = canvasHistoryInFlightRef.current;
          const sourceTransitionObserved =
            historyOutcome === "reconciled" &&
            message.documentVersion > (inFlight?.expectedDocumentVersion ?? -1) &&
            normalizedSourceFor(sourceBeforeHistory) !== normalizedSourceFor(message.sourceText);
          if (sourceTransitionObserved && inFlight?.direction === message.reason) {
            if (inFlight.entry === "source") {
              inFlight.sourceTransitionObserved = moveCanvasSourceHistory(message.reason);
              if (inFlight.sourceTransitionObserved && inFlight.completedResultObserved) {
                completeCanvasHistoryResult({
                  type: "canvasHistoryResult",
                  direction: message.reason,
                  status: "completed",
                  documentVersion: message.documentVersion
                });
              }
            } else {
              syncCanvasHistoryChronologyToSelection();
            }
          } else if (historyOutcome === "reconciled") {
            syncCanvasHistoryChronologyToSelection();
          } else {
            invalidateCanvasHistory();
            pendingCanvasSourceCommitRef.current = null;
            lastCanvasSourceHistoryCommitRef.current = null;
          }
        } else {
          useCadDocumentStore.getState().commitText(message.sourceText, "editor", {
            cursorLineAtBurstStart: null
          });
          if (!pendingCanvasSourceObserved) invalidateCanvasHistory();
        }
        const committedDocument = useCadDocumentStore.getState();
        const committedSelection = useCadUiStore.getState();
        const committedElementIds = new Set(committedDocument.elements.map((element) => element.id));
        const editorHasErrors = committedDocument.sourceUpdate.kind === "editor" && (
          committedDocument.diagnostics.some((diagnostic) => diagnostic.severity === "error") ||
          committedDocument.bindingIssueDiagnostics.some((diagnostic) => diagnostic.severity === "error")
        );
        const editorErrors = [
          ...committedDocument.diagnostics,
          ...committedDocument.bindingIssueDiagnostics
        ].filter((diagnostic) => diagnostic.severity === "error");
        const currentCompiled = committedDocument.currentCompiled;
        const fatalSourceStatementsByElementId = currentCompiled.statementMap === null
          ? new Map([...currentCompiled.sourceElementsByStatementIndex].flatMap(([statementIndex, element]) => {
              const statement = currentCompiled.statements[statementIndex];
              return statement ? [[element.id, statement] as const] : [];
            }))
          : null;
        const hasStaleElementSelection = committedSelection.selectionSubject.kind === "elements" && [
          ...committedSelection.selectedElementIds,
          committedSelection.selectedElementId,
          committedSelection.selectionAnchorElementId
        ].some((elementId) => {
          if (elementId === null) return false;
          if (!committedElementIds.has(elementId)) return true;
          const statement = currentCompiled.statementMap?.byElementId.get(elementId);
          const fatalStatement = fatalSourceStatementsByElementId?.get(elementId);
          if (!statement && currentCompiled.statementMap !== null) return false;
          if (!statement && !fatalStatement) return true;
          const statementStartLine = statement?.range.startLine ?? fatalStatement!.line;
          const statementEndLine = statement?.range.endLine ?? fatalStatement!.endLine;
          return editorErrors.some((diagnostic) =>
            diagnostic.line >= statementStartLine &&
            diagnostic.line <= statementEndLine
          );
        });
        if (editorHasErrors && hasStaleElementSelection) {
          pendingCanvasSelectionRestoreRef.current = null;
          committedSelection.clearElementSelection();
        }
        api.postMessage({ type: "webviewAuthoritativeDocumentReady", documentVersion: message.documentVersion });
        publishCurrentCanvasTheme(message.documentVersion);
        publishCanonicalRuntimeDiagnostics(message.documentVersion);
        publishCanvasObservation(message.documentVersion);
        publishInlineModuleCanvasTargets(message.documentVersion);
        tryApplyPendingCanvasSelectionRestore();
        applyPendingCoordinatePointConversionSelection();
      } else if (message.type === "benchmarkConfig") {
        setBenchmarkConfig(message.config);
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [api, applyPendingCoordinatePointConversionSelection, canvasAuthorityRejectionErrorFor, canvasModalMode, canvasPickModeActive, completeCanvasHistoryResult, completePendingCanvasSourceCommit, currentAuthoritativeCanvasSourceDocument, currentAuthoritativeDocument, currentHostSourceAuthorityFor, deferCoordinatePointConversionSelection, discardDeferredSourceBake, invalidateCanvasHistory, measureCanvasTextWidth, moveCanvasSourceHistory, postCanvasCommit, publishCanvasObservation, publishCanonicalRuntimeDiagnostics, publishCurrentCanvasTheme, publishInlineModuleCanvasTargets, pumpCanvasHistory, refreshCanvasTheme, requestCanvasHistory, resetCanvasHistoryChronology, restoreCanvasFocus, rustTransport, selectActiveCanvasInstance, setMultiDocumentGraphPublication, sourceInsertionError, startCoordinatePointCreation, staleSourceAnchorError, syncCanvasHistoryChronologyToSelection, canvasPointerError, tryApplyPendingCanvasSelectionRestore, tryCompleteCanvasFocus]);

  const surfaceStyle = benchmarkConfig?.expectedRenderSurface
    ? {
        width: `${benchmarkConfig.expectedRenderSurface.cssWidthPx}px`,
        height: `${benchmarkConfig.expectedRenderSurface.cssHeightPx}px`
      }
    : { width: "100vw", height: "100vh" };

  return (
    <main className="canvas-workspace" style={surfaceStyle}>
      <VSCodeDrawingCanvas
        ref={drawingCanvasRef}
        imageResources={imageResources}
        evaluation={evaluationState.evaluation}
        evaluationState={evaluationState}
        multiDocumentRuntimePresentation={multiDocumentRuntimePresentation}
        hostRootDocumentId={
          multiDocumentGraphPublication?.status === "unavailable" ||
          (multiDocumentGraphPublication &&
            multiDocumentGraphPublication.hostDocumentUri !== authoritativeHostSourceSnapshot?.hostDocumentUri)
            ? null
            : authoritativeHostSourceSnapshot?.hostDocumentUri ?? null
        }
        hostDocumentEpoch={canvasDocumentEpoch}
        awaitingHostGraph={!currentHostGraph || Boolean(currentHostGraph.canvasRuntime && !multiDocumentRuntimeSnapshot)}
        webviewPresentation={webviewPresentation}
        canvasFocusRef={canvasFocusRef}
        canvasTheme={canvasTheme}
        canvasGridSettings={canvasGridSettings}
        coordinatePointCreationActive={coordinatePointCreationActive}
        onFinishCoordinatePointCreation={finishCoordinatePointCreation}
        postCoordinatePointCreationClick={postCoordinatePointCreationClick}
        canvasRibbonPositions={canvasRibbonPositions}
        measureCanvasTextWidth={measureCanvasTextWidth}
        postCanvasPointerPosition={(pointer: VscodeCanvasPointer) => {
          const documentVersion = latestHostDocumentVersionRef.current;
          if (documentVersion === null || !currentAuthoritativeDocument(documentVersion)) return;
          api.postMessage({
            type: "canvasPointerPublication",
            documentVersion,
            pointer
          });
        }}
        onCanvasRibbonPositionCommit={(ribbonId, position) => {
          if (!isVscodeCanvasRibbonId(ribbonId)) return;
          api.postMessage({
            type: "canvasRibbonPositionCommit",
            ribbonId,
            x: position.x,
            y: position.y
          });
        }}
        onToggleCanvasGrid={() => api.postMessage({ type: "toggleCanvasGrid" })}
        onConfigureCanvasGrid={() => api.postMessage({ type: "configureCanvasGrid" })}
        onToggleCanvasGridSnap={() => api.postMessage({ type: "toggleCanvasGridSnap" })}
        currentReferencePickAuthorityFor={currentReferencePickAuthorityFor}
        evaluateReferencePickCandidate={evaluateReferencePickCandidate}
        currentCoordinatePointConversionAuthorityFor={currentReferencePickAuthorityFor}
        postCanvasCommit={postCanvasCommit}
        postCanonicalSourceText={(sourceText, operationId, graphAuthority) => {
          if (benchmarkConfig) return;
          postCanvasCommit(operationId, undefined, sourceText, graphAuthority);
        }}
      />
      <VSCodeBenchmarkCaptureRunner
        config={benchmarkConfig}
        evaluation={evaluationState.evaluation}
        evaluationState={evaluationState}
        compiledDocumentRevision={compiledDocumentRevision}
        canvasFocusRef={canvasFocusRef}
        api={api}
      />
    </main>
  );
};
