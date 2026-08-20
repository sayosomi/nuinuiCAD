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
import { useCadUiStore } from "../state/cadUiStore";
import { VSCodeDrawingCanvas } from "./VSCodeDrawingCanvas";
import { dispatchCommand } from "../commands/commands";
import { VSCodeBenchmarkCaptureRunner } from "./VSCodeBenchmarkCaptureRunner";
import { VscodeRustTransport } from "./vscodeRustTransport";
import { isStaleHostDocumentVersion } from "./hostDocumentVersion";
import { LEGACY_CANVAS_THEME } from "../components/canvasTheme";
import { readVSCodeCanvasTheme } from "./vscodeCanvasTheme";
import { createCanvasTextWidthMeasurer } from "../components/canvasTextMeasurement";
import { queryDslCanvasSourceDefinition, queryDslCanvasSourceTarget } from "../dsl/dslNavigationQuery";
import { sourceOwnerByRuntimeElementId } from "../dsl/sourceOwnership";
import { canvasElementDrawingBounds } from "../geometry/canvasDrawingBounds";
import { minimumCanvasPanForBounds } from "../geometry/canvasViewportReveal";
import { getSelectedElementIds } from "../commands/commandRuntime";
import { resolveDisabledBakeTargetIds } from "../commands/bakeGeometry";
import { replaceCanvasSelection } from "../commands/selectionCommands";
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
  const [benchmarkConfig, setBenchmarkConfig] = useState<VscodeBenchmarkConfig | null>(null);
  const [canvasTheme, setCanvasTheme] = useState(LEGACY_CANVAS_THEME);
  const latestHostDocumentVersionRef = useRef<number | null>(null);
  const lastAuthoritativeHostSourceSnapshotRef = useRef<AuthoritativeHostSourceSnapshot | null>(null);
  const latestCanvasNavigationRequestRef = useRef<number | null>(null);
  const canvasHistoryInFlightRef = useRef<CanvasHistoryDirection | null>(null);
  const pendingCanvasHistoryRef = useRef<CanvasHistoryDirection[]>([]);
  const canvasFocusRef = useRef<HTMLDivElement>(null);
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
  }, [evaluationState]);

  const restoreCanvasFocus = useCallback((afterFocus?: () => void) => {
    queueMicrotask(() => {
      canvasFocusRef.current?.focus();
      afterFocus?.();
    });
  }, []);

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
          canvasHistory: requestCanvasHistory
        });
        if (typeof result === "object" && result !== null && "status" in result && result.status === "applied") {
          postCanvasCommit();
        }
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
        const applied = typeof result === "object" && result !== null && "status" in result && result.status === "applied";
        if (applied) postCanvasCommit();
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
          canvasHistory: requestCanvasHistory
        });
      } else if (message.type === "bakeSourceRequest") {
        void runSourceBake(message);
        return;
      } else if (message.type === "canvasHistoryResult") {
        if (canvasHistoryInFlightRef.current !== message.direction) return;
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
        latestCanvasNavigationRequestRef.current = message.requestId;
        const current = currentAuthoritativeDocument(message.documentVersion);
        if (!current || canvasHistoryInFlightRef.current !== null) {
          api.postMessage({ type: "canvasNavigationResult", requestId: message.requestId, status: "stale" });
          return;
        }
        const target = queryDslCanvasSourceTarget({
          source: current.source,
          compiled: current.compiled,
          position: message.normalizedSourceOffset
        });
        if (!target) {
          api.postMessage({ type: "canvasNavigationResult", requestId: message.requestId, status: "no-target" });
          return;
        }
        const owners = sourceOwnerByRuntimeElementId(current.compiled);
        const runtimeElementIds = current.state.elements
          .filter((element) => owners.get(element.id)?.sourceStatementIndex === target.sourceStatementIndex)
          .map((element) => element.id);
        if (runtimeElementIds.length === 0 || !replaceCanvasSelection(runtimeElementIds, runtimeElementIds[0], true)) {
          api.postMessage({ type: "canvasNavigationResult", requestId: message.requestId, status: "no-target" });
          return;
        }

        const viewport = canvasFocusRef.current;
        if (viewport) {
          const rect = viewport.getBoundingClientRect();
          const evaluation = evaluationRef.current;
          const bounds = evaluation &&
            evaluationStateIsCurrentFor(evaluationStateRef.current, current.state.compiledDocumentRevision) &&
            evaluation.computedGeometry instanceof Map
            ? canvasElementDrawingBounds({
                elementId: runtimeElementIds[0]!,
                elements: effectiveElements(current.state),
                evaluation,
                visibilityProfiles: current.state.visibilityProfiles,
                activeVisibilityProfileId: current.state.activeVisibilityProfileId,
                measureCanvasTextWidth
              })
            : null;
          if (bounds && Number.isFinite(rect.width) && Number.isFinite(rect.height)) {
            const pan = minimumCanvasPanForBounds(bounds, useCadUiStore.getState().canvasViewport, {
              width: rect.width,
              height: rect.height
            });
            if (pan && (pan.dx !== 0 || pan.dy !== 0)) {
              useCadUiStore.getState().panCanvasViewport(pan.dx, pan.dy);
            }
          }
        }
        api.postMessage({ type: "canvasNavigationResult", requestId: message.requestId, status: "ready" });
      } else if (message.type === "focusCanvas") {
        if (latestCanvasNavigationRequestRef.current !== message.requestId) return;
        canvasFocusRef.current?.focus();
        api.postMessage({ type: "canvasNavigationResult", requestId: message.requestId, status: "focused" });
      } else if (message.type === "replaceTextDocument") {
        if (isStaleHostDocumentVersion(latestHostDocumentVersionRef.current, message.documentVersion)) return;
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
      } else if (message.type === "commitText") {
        if (isStaleHostDocumentVersion(latestHostDocumentVersionRef.current, message.documentVersion)) return;
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
      } else if (message.type === "benchmarkConfig") {
        setBenchmarkConfig(message.config);
      }
    };
    window.addEventListener("message", onMessage);
    api.postMessage({ type: "webviewReady" });
    return () => {
      window.removeEventListener("message", onMessage);
      rustTransport.dispose();
    };
  }, [api, currentAuthoritativeDocument, measureCanvasTextWidth, postCanvasCommit, pumpCanvasHistory, requestCanvasHistory, restoreCanvasFocus, rustTransport]);

  const surfaceStyle = benchmarkConfig
    ? {
        width: `${benchmarkConfig.expectedRenderSurface.cssWidthPx}px`,
        height: `${benchmarkConfig.expectedRenderSurface.cssHeightPx}px`
      }
    : { width: "100vw", height: "100vh" };

  return (
    <main className="canvas-workspace" style={surfaceStyle}>
      <VSCodeDrawingCanvas
        evaluation={evaluationState.evaluation}
        evaluationState={evaluationState}
        canvasFocusRef={canvasFocusRef}
        canvasTheme={canvasTheme}
        postCanonicalSourceText={() => postCanvasCommit()}
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
