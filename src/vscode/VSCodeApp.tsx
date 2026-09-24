import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { evaluateElementsWithRust } from "../geometry/evaluationEngine";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
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
import { queryDslCanvasSourceDefinition, queryDslCanvasSourceTarget } from "@nuinuicad/nui-language";
import { queryDslCanvasRevealSourceTarget } from "@nuinuicad/nui-language";
import {
  queryDslCanvasRevealRuntimeStatementOwner,
  queryDslCanvasRevealRuntimeTarget
} from "../dsl/dslCanvasRevealRuntime";
import { runtimeScalarDiagnostics } from "../scalars/runtimeScalarDiagnostics";
import { runtimeGeometryDiagnostics } from "../geometry/runtimeGeometryDiagnostics";
import { canvasElementDrawingBounds } from "../geometry/canvasDrawingBounds";
import { groupCanvasGeometry } from "../geometry/groupCanvasGeometry";
import {
  canvasSelectionEligibleElementIds as computeCanvasSelectionEligibleElementIds
} from "../geometry/canvasSelectionEligibility";
import { CANVAS_FIT_PADDING_PX, fitCanvasViewportToBounds } from "../geometry/canvasViewportFit";
import {
  normalizeVscodeCanvasRibbons,
  type VscodeCanvasRibbon
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
import { commitSourceCreationInsertion } from "../commands/sourceCreationCommit";
import {
  resolveSourceCreationInsertion,
  sourceCreationInsertionUnsafeError,
  type SourceCreationCursor
} from "../commands/sourceCreationInsertion";
import type { SelectionSnapshot } from "../state/cadDocumentStore";
import type { StatementMap } from "@nuinuicad/nui-language";
import type { ElementId } from "../types/geometry";
import type {
  ExtensionToVscodeMessage,
  VscodeBenchmarkConfig,
  VscodeWebviewApi,
  VscodeCanvasPointer
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
};

const normalizedSourceFor = (sourceText: string): string => sourceText.replace(/\r\n/g, "\n");

const sourceElementIdForLine = (
  line: number,
  elements: readonly { id: string }[],
  statementMap: StatementMap
): string | null => {
  const currentElementIds = new Set(elements.map((element) => element.id));
  const candidates = [...statementMap.byElementId.entries()].filter(([elementId, info]) =>
    currentElementIds.has(elementId) &&
    info.range.startLine <= line &&
    line <= Math.max(info.range.endLine, info.endLine)
  );
  if (candidates.length === 0) return null;
  const deepestIndent = Math.max(...candidates.map(([, info]) => info.indentDepth));
  const deepest = candidates.filter(([, info]) => info.indentDepth === deepestIndent);
  return deepest.length === 1 ? deepest[0][0] : null;
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
  const [canvasTheme, setCanvasTheme] = useState(LEGACY_CANVAS_THEME);
  const [canvasGridSettings, setCanvasGridSettings] = useState<CanvasGridSettings>(DEFAULT_CANVAS_GRID_SETTINGS);
  const [canvasRibbonRibbons, setCanvasRibbonRibbons] = useState<VscodeCanvasRibbon[]>([]);
  const [multiDocumentGraphPublication, setMultiDocumentGraphPublication] = useState<VscodeMultiDocumentGraphPublication | null>(null);
  const [latestHostDocumentVersion, setLatestHostDocumentVersion] = useState<number | null>(null);
  const [coordinatePointCreationActive, setCoordinatePointCreationActive] = useState(false);
  const [authoritativeHostSourceSnapshot, setAuthoritativeHostSourceSnapshot] = useState<AuthoritativeHostSourceSnapshot | null>(null);
  const canvasThemeRef = useRef<CanvasTheme>(LEGACY_CANVAS_THEME);
  const canvasThemeGenerationRef = useRef<number | null>(null);
  const latestHostDocumentVersionRef = useRef<number | null>(null);
  const multiDocumentGraphPublicationRef = useRef<VscodeMultiDocumentGraphPublication | null>(null);
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
  useEffect(() => () => rustTransport.dispose(), [rustTransport]);
  useEffect(() => {
    api.postMessage({ type: "webviewReady" });
  }, [api]);
  const evaluationOptions = useMemo(
    () => buildEvaluationOptions({ compiledDocument: evaluationDocument, evaluationLimitIndex }),
    [evaluationDocument, evaluationLimitIndex]
  );
  const multiDocumentRuntimeSnapshot = useMemo<VscodeMultiDocumentCanvasRuntimeSnapshot | null>(() => {
    const publication = multiDocumentGraphPublication;
    const runtime = publication?.status === "current" ? publication.canvasRuntime : null;
    const graph = publication?.status === "current" ? publication.graph : null;
    const authoritative = authoritativeHostSourceSnapshot;
    if (
      !publication ||
      !runtime ||
      !graph ||
      !graph.valid ||
      publication.documentVersion !== latestHostDocumentVersion ||
      authoritative?.documentVersion !== publication.documentVersion ||
      authoritative?.normalizedSource !== normalizedSourceFor(sourceText) ||
      graph.rootSource.documentId !== graph.rootDocumentId ||
      graph.rootSource.normalizedSource !== normalizedSourceFor(sourceText) ||
      runtime.graphRevision !== graph.revision ||
      runtime.rootDocumentId !== graph.rootDocumentId ||
      runtime.rootSourceRevision !== graph.rootSource.sourceRevision
    ) return null;
    return runtime;
  }, [authoritativeHostSourceSnapshot, latestHostDocumentVersion, multiDocumentGraphPublication, sourceText]);
  const multiDocumentRuntimePresentation = useMemo(
    () => multiDocumentRuntimeSnapshot ? canvasRuntimePresentationFor(multiDocumentRuntimeSnapshot) : null,
    [multiDocumentRuntimeSnapshot]
  );
  useEffect(() => {
    multiDocumentGraphPublicationRef.current = multiDocumentGraphPublication;
    multiDocumentRuntimePresentationRef.current = multiDocumentRuntimePresentation;
  }, [multiDocumentGraphPublication, multiDocumentRuntimePresentation]);
  const multiDocumentRuntimeEvaluationState = useVscodeMultiDocumentRuntimeEvaluation(
    multiDocumentRuntimeSnapshot,
    rustTransport.transport
  );
  const localEvaluationState = useEvaluationEngine(
    elements,
    evaluationOptions,
    compiledDocumentRevision,
    multiDocumentRuntimeSnapshot ? undefined : rustTransport.transport
  );
  const evaluationState = multiDocumentRuntimeSnapshot
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
    sourceTextOverride?: string
  ) => {
    if (benchmarkConfig) return;
    const expectedDocumentVersion = latestHostDocumentVersionRef.current;
    if (expectedDocumentVersion === null) return;
    const sourceText = sourceTextOverride ?? useCadDocumentStore.getState().sourceText;
    const sourceUpdate = useCadDocumentStore.getState().sourceUpdate;
    const mutationKind = sourceUpdate.kind === "model-patch" ? "model-patch" : "reset";
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
      mutationKind,
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
      source: { normalizedSource }
    };
  }, []);

  const currentAuthoritativeDocument = useCallback((expectedDocumentVersion: number) => {
    const currentHostSource = currentHostSourceAuthorityFor(expectedDocumentVersion);
    if (!currentHostSource) return null;
    const compiled = effectiveCompiledDocument(currentHostSource.state);
    if (
      compiled.spans.sourceMap.source !== currentHostSource.source.normalizedSource ||
      compiled.spans.sourceMap.sourceRevision !== currentHostSource.state.doc.statementMap.sourceRevision
    ) return null;
    return {
      state: currentHostSource.state,
      compiled,
      source: {
        normalizedSource: currentHostSource.source.normalizedSource,
        sourceRevision: compiled.spans.sourceMap.sourceRevision
      }
    };
  }, [currentHostSourceAuthorityFor]);

  const finishCoordinatePointCreation = useCallback(() => {
    if (!coordinatePointCreationActive) return;
    setCoordinatePointCreationActive(false);
    const documentVersion = latestHostDocumentVersionRef.current;
    if (documentVersion !== null) {
      api.postMessage({
        type: "canvasCoordinatePointCreationState",
        active: false,
        documentVersion
      });
    }
  }, [api, coordinatePointCreationActive]);

  const startCoordinatePointCreation = useCallback((documentVersion: number): boolean => {
    if (
      coordinatePointCreationActive ||
      canvasModalMode() !== null ||
      latestHostDocumentVersionRef.current !== documentVersion ||
      !currentAuthoritativeDocument(documentVersion)
    ) return false;
    drawingCanvasRef.current?.clearPendingCanvasPointerIntent();
    drawingCanvasRef.current?.finalizeCanvasInteraction();
    setCoordinatePointCreationActive(true);
    api.postMessage({
      type: "canvasCoordinatePointCreationState",
      active: true,
      documentVersion
    });
    canvasFocusRef.current?.focus();
    return true;
  }, [api, canvasFocusRef, canvasModalMode, coordinatePointCreationActive, currentAuthoritativeDocument]);

  const postCoordinatePointCreationClick = useCallback((pointer: VscodeCanvasPointer) => {
    const documentVersion = latestHostDocumentVersionRef.current;
    if (
      !coordinatePointCreationActive ||
      documentVersion === null ||
      canvasHistoryInFlightRef.current !== null
    ) return;
    api.postMessage({
      type: "canvasCoordinatePointCreationClick",
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
        pending.acceptedDocumentVersion > pending.expectedDocumentVersion &&
        documentState.elements.some((element) => element.id === pending.selectedElementId)
      ) {
        const eligibility = useCadUiStore.getState().canvasSelectionEligibleElementIds;
        if (eligibility?.has(pending.selectedElementId)) {
          pending.status = "applied";
          useCadUiStore.getState().applySelection(documentState.elements, {
            selectedElementId: pending.selectedElementId,
            selectedElementIds: pending.selectedElementIds,
            selectionAnchorElementId: pending.selectionAnchorElementId
          });
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
      if (
        !Number.isInteger(message.sourcePosition.line) ||
        message.sourcePosition.line < 0 ||
        !Number.isInteger(message.sourcePosition.character) ||
        message.sourcePosition.character < 0 ||
        !Number.isFinite(message.documentVersion) ||
        !Number.isInteger(message.documentVersion)
      ) {
        useCadUiStore.getState().setCommandErrorMessage(sourceCreationInsertionUnsafeError);
        reject();
        return;
      }

      const current = currentAuthoritativeDocument(message.documentVersion);
      if (!current) {
        useCadUiStore.getState().setCommandErrorMessage(staleSourceAnchorError);
        reject();
        return;
      }

      const sourcePositionLine = message.sourcePosition.line + 1;
      const sourceTextLines = current.source.normalizedSource.split("\n");
      const sourceCursor: SourceCreationCursor = {
        sourceRevision: current.source.sourceRevision,
        line: sourcePositionLine,
        lineCount: sourceTextLines.length,
        elementId: sourceElementIdForLine(
          sourcePositionLine,
          current.state.elements,
          current.state.doc.statementMap
        )
      };
      const sourceResolution = resolveSourceCreationInsertion({
        cursor: sourceCursor,
        sourceRevision: current.source.sourceRevision,
        elements: current.state.elements,
        statementMap: current.state.doc.statementMap
      });
      if (sourceResolution.kind !== "safe") {
        useCadUiStore.getState().setCommandErrorMessage(sourceCreationInsertionUnsafeError);
        reject();
        return;
      }

      const placement = creationPlacementForTarget(
        current.state.elements,
        sourceResolution.insertion.insertionTarget,
        current.state.evaluationLimitIndex
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
          elements: current.state.elements,
          referenceElements: placement.referenceElements
        }),
        placement
      );
      if (!currentAuthoritativeDocument(message.documentVersion)) {
        useCadUiStore.getState().setCommandErrorMessage(staleSourceAnchorError);
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
      const sourceCommit = commitSourceCreationInsertion({
        elements: current.state.elements,
        insertionIndex: placement.insertionIndex,
        insertedElements: [element],
        sourceInsertionLine: sourceResolution.insertion.sourceInsertionLine
      });
      if (sourceCommit.result.status !== "applied" || !sourceCommit.selectedElementId) {
        useCadUiStore.getState().setCommandErrorMessage(sourceInsertionError);
        reject();
        return;
      }

      const committedSourceText = useCadDocumentStore.getState().sourceText;
      const selectionIntent: PendingCanvasFreePointSelection = {
        requestId: message.requestId,
        lastDocumentGeneration: hostDocumentGenerationRef.current,
        lastDocumentVersion: message.documentVersion,
        previousSourceText: normalizedSourceFor(previousSourceText),
        expectedDocumentVersion: message.documentVersion,
        expectedSourceText: normalizedSourceFor(committedSourceText),
        selectedElementId: sourceCommit.selectedElementId,
        selectedElementIds: sourceCommit.insertedElementIds,
        selectionAnchorElementId: sourceCommit.selectedElementId,
        acceptedDocumentVersion: null,
        authoritativeDocumentGeneration: null,
        status: "pending"
      };
      const committedSourceLines = normalizedSourceFor(useCadDocumentStore.getState().sourceText).split("\n");
      const insertedSourceLine = committedSourceLines[sourceResolution.insertion.sourceInsertionLine - 1] ?? "";
      pendingCanvasFreePointSelectionRef.current = selectionIntent;
      pendingCanvasFreePointCommitRef.current = {
        requestId: message.requestId,
        expectedDocumentVersion: message.documentVersion,
        previousSourceText,
        previousSelection,
        selectionIntent,
        nextSourcePosition: {
          line: sourceResolution.insertion.sourceInsertionLine - 1,
          character: insertedSourceLine.length
        }
      };
      postCanvasCommit(message.requestId);
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
        moduleMaterialization: current.compiled.moduleMaterialization,
        visibilityProfiles: current.state.visibilityProfiles,
        activeVisibilityProfileId: current.state.activeVisibilityProfileId,
        showCanvasPoints: useCadUiStore.getState().showCanvasPoints,
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
        startCoordinatePointCreation(message.documentVersion);
        return;
      } else if (message.type === "multiDocumentGraphPublication") {
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
      } else if (message.type === "canvasRibbonConfiguration") {
        setCanvasRibbonRibbons(normalizeVscodeCanvasRibbons(message.ribbons));
      } else if (message.type === "canvasGridConfiguration") {
        setCanvasGridSettings(normalizeCanvasGridSettings(message.settings));
      } else if (message.type === "canvasCommand") {
        if (!canvasModalCanvasCommandAllowed(message.commandId, canvasModalMode())) return;
        if (message.commandId === "bakeCurrentShape" || message.commandId === "bakeBaseShape") {
          void runCanvasBake(message);
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
          runtimeElementId: selectedElementId,
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
        observePendingCanvasSourceCommit(message);
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
          normalizedSource: normalizedSourceFor(message.sourceText)
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
          normalizedSource: normalizedSourceFor(message.sourceText)
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
  }, [api, applyPendingCoordinatePointConversionSelection, canvasModalMode, canvasPickModeActive, completeCanvasHistoryResult, completePendingCanvasSourceCommit, currentAuthoritativeDocument, currentHostSourceAuthorityFor, deferCoordinatePointConversionSelection, discardDeferredSourceBake, invalidateCanvasHistory, measureCanvasTextWidth, moveCanvasSourceHistory, postCanvasCommit, publishCanvasObservation, publishCanonicalRuntimeDiagnostics, publishCurrentCanvasTheme, publishInlineModuleCanvasTargets, pumpCanvasHistory, refreshCanvasTheme, requestCanvasHistory, resetCanvasHistoryChronology, restoreCanvasFocus, rustTransport, selectActiveCanvasInstance, setMultiDocumentGraphPublication, sourceInsertionError, startCoordinatePointCreation, staleSourceAnchorError, syncCanvasHistoryChronologyToSelection, canvasPointerError, tryApplyPendingCanvasSelectionRestore, tryCompleteCanvasFocus]);

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
        evaluation={evaluationState.evaluation}
        evaluationState={evaluationState}
        multiDocumentRuntimePresentation={multiDocumentRuntimePresentation}
        webviewPresentation={webviewPresentation}
        canvasFocusRef={canvasFocusRef}
        canvasTheme={canvasTheme}
        canvasGridSettings={canvasGridSettings}
        coordinatePointCreationActive={coordinatePointCreationActive}
        onFinishCoordinatePointCreation={finishCoordinatePointCreation}
        postCoordinatePointCreationClick={postCoordinatePointCreationClick}
        canvasRibbonRibbons={canvasRibbonRibbons}
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
          api.postMessage({
            type: "canvasRibbonPositionCommit",
            ribbonId,
            x: position.x,
            y: position.y
          });
        }}
        onEditCanvasRibbon={() => api.postMessage({ type: "editCanvasRibbon" })}
        currentReferencePickAuthorityFor={currentReferencePickAuthorityFor}
        currentCoordinatePointConversionAuthorityFor={currentReferencePickAuthorityFor}
        postCanvasCommit={postCanvasCommit}
        postCanonicalSourceText={(sourceText) => {
          if (benchmarkConfig) return;
          postCanvasCommit(undefined, undefined, sourceText);
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
