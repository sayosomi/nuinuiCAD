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
import type { DrawingCanvasHandle } from "../components/DrawingCanvas";
import { dispatchCommand } from "../commands/commands";
import { VSCodeBenchmarkCaptureRunner } from "./VSCodeBenchmarkCaptureRunner";
import { VscodeRustTransport } from "./vscodeRustTransport";
import { isStaleHostDocumentVersion } from "./hostDocumentVersion";
import { LEGACY_CANVAS_THEME } from "../components/canvasTheme";
import { readVSCodeCanvasTheme } from "./vscodeCanvasTheme";
import { createCanvasTextWidthMeasurer } from "../components/canvasTextMeasurement";
import { queryDslCanvasSourceDefinition, queryDslCanvasSourceTarget } from "../dsl/dslNavigationQuery";
import { queryDslCanvasRevealSourceTarget } from "../dsl/dslCanvasRevealQuery";
import { queryDslCanvasRevealRuntimeTarget } from "../dsl/dslCanvasRevealRuntime";
import { runtimeScalarDiagnostics } from "../scalars/runtimeScalarDiagnostics";
import { runtimeGeometryDiagnostics } from "../geometry/runtimeGeometryDiagnostics";
import { canvasElementDrawingBounds } from "../geometry/canvasDrawingBounds";
import { CANVAS_FIT_PADDING_PX, fitCanvasViewportToBounds } from "../geometry/canvasViewportFit";
import {
  normalizeVscodeCanvasRibbons,
  type VscodeCanvasRibbon
} from "./vscodeCanvasRibbonConfig";
import { getSelectedElementIds } from "../commands/commandRuntime";
import { resolveDisabledBakeTargetIds } from "../commands/bakeGeometry";
import { replaceCanvasSelection } from "../commands/selectionCommands";
import { vscodeBakeOperationResultFromCommand } from "./vscodeBakeOperationResult";
import { canvasObservationSnapshot } from "./canvasObservation";
import { canvasNavigationContainerTarget } from "./canvasNavigationContainerTarget";
import { effectiveDrawElementIds, effectiveEvaluationElementIds } from "../model/elementActivity";
import { effectiveVisibleElementIdsForProfile, visibilityProfileById } from "../model/visibilityProfiles";
import type {
  ExtensionToVscodeMessage,
  VscodeBenchmarkConfig,
  VscodeWebviewApi
} from "./protocol";

type CanvasHistoryDirection = "undo" | "redo";

type AuthoritativeHostSourceSnapshot = {
  documentVersion: number;
  normalizedSource: string;
};

const normalizedSourceFor = (sourceText: string): string => sourceText.replace(/\r\n/g, "\n");

export const VSCodeApp = ({ api }: { api: VscodeWebviewApi }) => {
  const elements = useCadDocumentStore(effectiveElements);
  const evaluationLimitIndex = useCadDocumentStore(effectiveEvaluationLimitIndex);
  const evaluationDocument = useCadDocumentStore(effectiveCompiledDocument);
  const compiledDocumentRevision = useCadDocumentStore((state) => state.compiledDocumentRevision);
  const previewActive = useCadDocumentStore((state) => state.previewElements !== null);
  const observationSelectionSubject = useCadUiStore((state) => state.selectionSubject);
  const observationSelectedElementIds = useCadUiStore((state) => state.selectedElementIds);
  const [benchmarkConfig, setBenchmarkConfig] = useState<VscodeBenchmarkConfig | null>(null);
  const [canvasTheme, setCanvasTheme] = useState(LEGACY_CANVAS_THEME);
  const [canvasRibbonRibbons, setCanvasRibbonRibbons] = useState<VscodeCanvasRibbon[]>([]);
  const latestHostDocumentVersionRef = useRef<number | null>(null);
  const lastAuthoritativeHostSourceSnapshotRef = useRef<AuthoritativeHostSourceSnapshot | null>(null);
  const latestCanvasNavigationRequestRef = useRef<number | null>(null);
  const deferredCanvasNavigationRequestRef = useRef<
    Extract<ExtensionToVscodeMessage, { type: "canvasNavigationRequest" }> | null
  >(null);
  const pendingCanvasFocusRequestRef = useRef<number | null>(null);
  const canvasHistoryInFlightRef = useRef<CanvasHistoryDirection | null>(null);
  const pendingCanvasHistoryRef = useRef<CanvasHistoryDirection[]>([]);
  const canvasFocusRef = useRef<HTMLDivElement>(null);
  const drawingCanvasRef = useRef<DrawingCanvasHandle>(null);
  const measureCanvasTextWidth = useMemo(
    () => createCanvasTextWidthMeasurer(() =>
      document.querySelector<HTMLElement>('[data-canvas-viewport="true"]')
    ),
    []
  );
  const rustTransport = useMemo(() => new VscodeRustTransport(api.postMessage), [api]);
  const evaluationOptions = useMemo(
    () => buildEvaluationOptions({ compiledDocument: evaluationDocument, evaluationLimitIndex }),
    [evaluationDocument, evaluationLimitIndex]
  );
  const evaluationState = useEvaluationEngine(
    elements,
    evaluationOptions,
    compiledDocumentRevision,
    rustTransport.transport
  );
  const evaluationRef = useRef(evaluationState.evaluation);
  const evaluationStateRef = useRef(evaluationState);
  useEffect(() => {
    evaluationRef.current = evaluationState.evaluation;
    evaluationStateRef.current = evaluationState;
    const deferredCanvasNavigation = deferredCanvasNavigationRequestRef.current;
    if (!deferredCanvasNavigation) return;
    if (latestCanvasNavigationRequestRef.current !== deferredCanvasNavigation.requestId) {
      deferredCanvasNavigationRequestRef.current = null;
      return;
    }
    deferredCanvasNavigationRequestRef.current = null;
    window.dispatchEvent(new MessageEvent("message", { data: deferredCanvasNavigation }));
  }, [evaluationState]);

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

  const pumpCanvasHistory = useCallback(() => {
    while (
      canvasHistoryInFlightRef.current === null
      && pendingCanvasHistoryRef.current.length > 0
    ) {
      const direction = pendingCanvasHistoryRef.current.shift()!;
      const appliedLocally = direction === "undo"
        ? useCadDocumentStore.getState().undoCanvasSelection()
        : useCadDocumentStore.getState().redoCanvasSelection();
      if (appliedLocally) continue;

      const expectedDocumentVersion = latestHostDocumentVersionRef.current;
      if (expectedDocumentVersion === null) return;
      canvasHistoryInFlightRef.current = direction;
      api.postMessage({ type: "canvasHistoryRequest", direction, expectedDocumentVersion });
    }
  }, [api]);

  const requestCanvasHistory = useCallback((direction: CanvasHistoryDirection) => {
    pendingCanvasFocusRequestRef.current = null;
    latestCanvasNavigationRequestRef.current = null;
    deferredCanvasNavigationRequestRef.current = null;
    drawingCanvasRef.current?.finalizeCanvasInteraction();
    pendingCanvasHistoryRef.current.push(direction);
    pumpCanvasHistory();
  }, [pumpCanvasHistory]);

  const postCanvasCommit = useCallback(() => {
    if (benchmarkConfig) return;
    const expectedDocumentVersion = latestHostDocumentVersionRef.current;
    if (expectedDocumentVersion === null) return;
    const sourceUpdate = useCadDocumentStore.getState().sourceUpdate;
    const mutationKind = sourceUpdate.kind === "model-patch" ? "model-patch" : "reset";
    api.postMessage({
      type: "canvasCommit",
      sourceText: useCadDocumentStore.getState().sourceText,
      expectedDocumentVersion,
      mutationKind,
      ...(sourceUpdate.kind === "model-patch" ? { splices: sourceUpdate.splices } : {})
    });
  }, [api, benchmarkConfig]);

  const currentAuthoritativeDocument = useCallback((expectedDocumentVersion: number) => {
    const state = useCadDocumentStore.getState();
    const compiled = effectiveCompiledDocument(state);
    const normalizedSource = normalizedSourceFor(state.sourceText);
    const authoritative = lastAuthoritativeHostSourceSnapshotRef.current;
    if (
      latestHostDocumentVersionRef.current !== expectedDocumentVersion ||
      authoritative?.documentVersion !== expectedDocumentVersion ||
      authoritative?.normalizedSource !== normalizedSource ||
      compiled.spans.sourceMap.source !== normalizedSource ||
      compiled.spans.sourceMap.sourceRevision !== state.doc.statementMap.sourceRevision
    ) return null;
    return {
      state,
      compiled,
      source: {
        normalizedSource,
        sourceRevision: compiled.spans.sourceMap.sourceRevision
      }
    };
  }, []);

  const publishCanvasObservation = useCallback((documentVersion: number) => {
    const current = currentAuthoritativeDocument(documentVersion);
    if (!current) return;
    const uiState = useCadUiStore.getState();
    api.postMessage({
      type: "canvasObservationPublication",
      snapshot: canvasObservationSnapshot({
        documentVersion,
        selectedElementIds: uiState.selectedElementIds,
        selectionSubject: uiState.selectionSubject,
        compiledDocumentRevision: current.state.compiledDocumentRevision,
        previewActive: current.state.previewElements !== null,
        evaluationState: evaluationStateRef.current
      })
    });
  }, [api, currentAuthoritativeDocument]);

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
          elements: current.state.elements,
          freshness: { isSourceDirty: false, isEvaluationStale: false }
        })
      : [];
    const diagnostics = [
      ...scalarDiagnostics,
      ...runtimeGeometryDiagnostics({
        errors: evaluationRef.current.errors,
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
    if (documentVersion !== null) publishCanvasObservation(documentVersion);
  }, [
    compiledDocumentRevision,
    evaluationState,
    observationSelectedElementIds,
    observationSelectionSubject,
    previewActive,
    publishCanvasObservation
  ]);

  useEffect(() => {
    const refreshCanvasTheme = () => setCanvasTheme(readVSCodeCanvasTheme());
    refreshCanvasTheme();
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
      if (!current || !currentEvaluationIsCurrent || !target) {
        api.postMessage({ type: "bakeSourceResult", requestId: message.requestId, status: !current || !currentEvaluationIsCurrent ? "stale" : "rejected" });
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

    const onMessage = (event: MessageEvent<ExtensionToVscodeMessage>) => {
      const message = event.data;
      if (rustTransport.handleMessage(message)) return;
      if (message.type === "canvasThemeChanged") {
        refreshCanvasTheme();
      } else if (message.type === "canvasRibbonConfiguration") {
        setCanvasRibbonRibbons(normalizeVscodeCanvasRibbons(message.ribbons));
      } else if (message.type === "canvasCommand") {
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
          finalizeCanvasInteraction: () => drawingCanvasRef.current?.finalizeCanvasInteraction(),
          canvasHistory: requestCanvasHistory
        });
      } else if (message.type === "bakeSourceRequest") {
        void runSourceBake(message);
        return;
      } else if (message.type === "canvasHistoryResult") {
        if (canvasHistoryInFlightRef.current !== message.direction) return;
        pendingCanvasFocusRequestRef.current = null;
        latestCanvasNavigationRequestRef.current = null;
        deferredCanvasNavigationRequestRef.current = null;
        canvasHistoryInFlightRef.current = null;
        if (message.status !== "completed") {
          pendingCanvasHistoryRef.current = [];
        }
        restoreCanvasFocus(message.status === "completed" ? pumpCanvasHistory : undefined);
      } else if (message.type === "canvasSourceDefinitionRequest") {
        const expectedDocumentVersion = latestHostDocumentVersionRef.current;
        if (expectedDocumentVersion === null || canvasHistoryInFlightRef.current !== null) {
          api.postMessage({
            type: "canvasSourceDefinitionResult",
            requestId: message.requestId,
            documentVersion: null,
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
          range
        });
      } else if (message.type === "canvasNavigationRequest") {
        pendingCanvasFocusRequestRef.current = null;
        deferredCanvasNavigationRequestRef.current = null;
        latestCanvasNavigationRequestRef.current = message.requestId;
        const current = currentAuthoritativeDocument(message.documentVersion);
        if (!current || canvasHistoryInFlightRef.current !== null) {
          api.postMessage({
            type: "canvasNavigationResult",
            requestId: message.requestId,
            status: "failed",
            reason: "source-mismatch"
          });
          return;
        }
        const sourceTarget = queryDslCanvasRevealSourceTarget({
          source: current.source,
          compiled: current.compiled,
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
        const revealResult = queryDslCanvasRevealRuntimeTarget({
          target: sourceTarget.target,
          compiled: current.compiled,
          moduleGeometryRuntime: current.compiled.moduleGeometryRuntime,
          elements: runtimeElements,
          effectiveVisibleElementIds,
          effectiveEnabledElementIds,
          profileVisibleElementIds
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

        const currentEvaluation = evaluationRef.current;
        const currentEvaluationIsCurrent = evaluationStateIsCurrentFor(
          evaluationStateRef.current,
          current.state.compiledDocumentRevision
        );
        const selectionIds = [...revealResult.runtimeElementIds];
        const primarySelectionId = revealResult.primaryRuntimeElementId;
        let revealBounds = null;
        if (selectionIds.length === 1) {
          const containerTarget = canvasNavigationContainerTarget({
            runtimeElementIds: selectionIds,
            elements: runtimeElements,
            evaluation: currentEvaluation,
            evaluationIsCurrent: currentEvaluationIsCurrent,
            moduleMaterialization: current.compiled.moduleMaterialization,
            visibilityProfiles: current.state.visibilityProfiles,
            activeVisibilityProfileId: current.state.activeVisibilityProfileId,
            measureCanvasTextWidth
          });
          if (containerTarget.status === "stale") {
            deferredCanvasNavigationRequestRef.current = message;
            return;
          }
          if (containerTarget.status === "ready") revealBounds = containerTarget.bounds;
        }

        if (!replaceCanvasSelection(selectionIds, primarySelectionId, true, "requested")) {
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
                  visibilityProfiles: current.state.visibilityProfiles,
                  activeVisibilityProfileId: current.state.activeVisibilityProfileId,
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
        pendingCanvasFocusRequestRef.current = null;
        latestCanvasNavigationRequestRef.current = null;
        deferredCanvasNavigationRequestRef.current = null;
        latestHostDocumentVersionRef.current = message.documentVersion;
        lastAuthoritativeHostSourceSnapshotRef.current = {
          documentVersion: message.documentVersion,
          normalizedSource: normalizedSourceFor(message.sourceText)
        };
        useCadDocumentStore.getState().replaceTextDocument(message.sourceText, {
          currentFilePath: null,
          dirtySinceSave: false
        });
        api.postMessage({ type: "webviewAuthoritativeDocumentReady", documentVersion: message.documentVersion });
        publishCanonicalRuntimeDiagnostics(message.documentVersion);
        publishCanvasObservation(message.documentVersion);
      } else if (message.type === "commitText") {
        if (isStaleHostDocumentVersion(latestHostDocumentVersionRef.current, message.documentVersion)) return;
        pendingCanvasFocusRequestRef.current = null;
        latestCanvasNavigationRequestRef.current = null;
        deferredCanvasNavigationRequestRef.current = null;
        latestHostDocumentVersionRef.current = message.documentVersion;
        lastAuthoritativeHostSourceSnapshotRef.current = {
          documentVersion: message.documentVersion,
          normalizedSource: normalizedSourceFor(message.sourceText)
        };
        if (message.reason === "undo" || message.reason === "redo") {
          useCadDocumentStore.getState().reconcileAuthoritativeHistory(message.sourceText, message.reason);
        } else {
          useCadDocumentStore.getState().commitText(message.sourceText, "editor", {
            cursorLineAtBurstStart: null
          });
        }
        api.postMessage({ type: "webviewAuthoritativeDocumentReady", documentVersion: message.documentVersion });
        publishCanonicalRuntimeDiagnostics(message.documentVersion);
        publishCanvasObservation(message.documentVersion);
      } else if (message.type === "benchmarkConfig") {
        setBenchmarkConfig(message.config);
      }
    };
    window.addEventListener("message", onMessage);
    api.postMessage({ type: "webviewReady" });
    return () => {
      window.removeEventListener("message", onMessage);
      deferredCanvasNavigationRequestRef.current = null;
      rustTransport.dispose();
    };
  }, [api, currentAuthoritativeDocument, measureCanvasTextWidth, postCanvasCommit, publishCanvasObservation, publishCanonicalRuntimeDiagnostics, pumpCanvasHistory, requestCanvasHistory, restoreCanvasFocus, rustTransport, tryCompleteCanvasFocus]);

  const surfaceStyle = benchmarkConfig
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
        canvasFocusRef={canvasFocusRef}
        canvasTheme={canvasTheme}
        canvasRibbonRibbons={canvasRibbonRibbons}
        measureCanvasTextWidth={measureCanvasTextWidth}
        onCanvasRibbonPositionCommit={(ribbonId, position) => {
          api.postMessage({
            type: "canvasRibbonPositionCommit",
            ribbonId,
            x: position.x,
            y: position.y
          });
        }}
        onEditCanvasRibbon={() => api.postMessage({ type: "editCanvasRibbon" })}
        postCanonicalSourceText={(sourceText) => {
          if (benchmarkConfig) return;
          const expectedDocumentVersion = latestHostDocumentVersionRef.current;
          if (expectedDocumentVersion === null) return;
          const sourceUpdate = useCadDocumentStore.getState().sourceUpdate;
          const mutationKind = sourceUpdate.kind === "model-patch" ? "model-patch" : "reset";
          api.postMessage({
            type: "canvasCommit",
            sourceText,
            expectedDocumentVersion,
            mutationKind,
            ...(sourceUpdate.kind === "model-patch" ? { splices: sourceUpdate.splices } : {})
          });
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