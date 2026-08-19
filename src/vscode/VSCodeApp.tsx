import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { useEvaluationEngine } from "../geometry/useEvaluationEngine";
import {
  effectiveCompiledDocument,
  effectiveElements,
  effectiveEvaluationLimitIndex,
  useCadDocumentStore
} from "../state/cadDocumentStore";
import { VSCodeDrawingCanvas } from "./VSCodeDrawingCanvas";
import { dispatchCommand } from "../commands/commands";
import { VSCodeBenchmarkCaptureRunner } from "./VSCodeBenchmarkCaptureRunner";
import { VscodeRustTransport } from "./vscodeRustTransport";
import { isStaleHostDocumentVersion } from "./hostDocumentVersion";
import { LEGACY_CANVAS_THEME } from "../components/canvasTheme";
import { readVSCodeCanvasTheme } from "./vscodeCanvasTheme";
import { createCanvasTextWidthMeasurer } from "../components/canvasTextMeasurement";
import type {
  ExtensionToVscodeMessage,
  VscodeBenchmarkConfig,
  VscodeWebviewApi
} from "./protocol";

export const VSCodeApp = ({ api }: { api: VscodeWebviewApi }) => {
  const elements = useCadDocumentStore(effectiveElements);
  const evaluationLimitIndex = useCadDocumentStore(effectiveEvaluationLimitIndex);
  const evaluationDocument = useCadDocumentStore(effectiveCompiledDocument);
  const compiledDocumentRevision = useCadDocumentStore((state) => state.compiledDocumentRevision);
  const [benchmarkConfig, setBenchmarkConfig] = useState<VscodeBenchmarkConfig | null>(null);
  const [canvasTheme, setCanvasTheme] = useState(LEGACY_CANVAS_THEME);
  const latestHostDocumentVersionRef = useRef<number | null>(null);
  const canvasHistoryInFlightRef = useRef<"undo" | "redo" | null>(null);
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
  useEffect(() => {
    evaluationRef.current = evaluationState.evaluation;
  }, [evaluationState.evaluation]);

  const requestCanvasHistory = useCallback((direction: "undo" | "redo") => {
    if (canvasHistoryInFlightRef.current !== null) return;
    const appliedLocally = direction === "undo"
      ? useCadDocumentStore.getState().undoCanvasSelection()
      : useCadDocumentStore.getState().redoCanvasSelection();
    if (appliedLocally) return;

    const expectedDocumentVersion = latestHostDocumentVersionRef.current;
    if (expectedDocumentVersion === null) return;
    canvasHistoryInFlightRef.current = direction;
    api.postMessage({ type: "canvasHistoryRequest", direction, expectedDocumentVersion });
  }, [api]);

  const restoreCanvasFocus = useCallback(() => {
    queueMicrotask(() => canvasFocusRef.current?.focus());
  }, []);

  useEffect(() => {
    const refreshCanvasTheme = () => setCanvasTheme(readVSCodeCanvasTheme());
    refreshCanvasTheme();
    const onMessage = (event: MessageEvent<ExtensionToVscodeMessage>) => {
      const message = event.data;
      if (rustTransport.handleMessage(message)) return;
      if (message.type === "canvasThemeChanged") {
        refreshCanvasTheme();
      } else if (message.type === "canvasCommand") {
        dispatchCommand(message.commandId, {
          evaluation: evaluationRef.current,
          getCanvasViewportRect: () => canvasFocusRef.current?.getBoundingClientRect() ?? null,
          measureCanvasTextWidth,
          recordSelectionHistory: true,
          canvasHistory: requestCanvasHistory
        });
      } else if (message.type === "canvasHistoryResult") {
        if (canvasHistoryInFlightRef.current !== message.direction) return;
        canvasHistoryInFlightRef.current = null;
        restoreCanvasFocus();
      } else if (message.type === "replaceTextDocument") {
        if (isStaleHostDocumentVersion(latestHostDocumentVersionRef.current, message.documentVersion)) return;
        latestHostDocumentVersionRef.current = message.documentVersion;
        useCadDocumentStore.getState().replaceTextDocument(message.sourceText, {
          currentFilePath: null,
          dirtySinceSave: false
        });
      } else if (message.type === "commitText") {
        if (isStaleHostDocumentVersion(latestHostDocumentVersionRef.current, message.documentVersion)) return;
        latestHostDocumentVersionRef.current = message.documentVersion;
        if (message.reason === "undo" || message.reason === "redo") {
          useCadDocumentStore.getState().reconcileAuthoritativeHistory(message.sourceText, message.reason);
          if (canvasHistoryInFlightRef.current === message.reason) {
            canvasHistoryInFlightRef.current = null;
            restoreCanvasFocus();
          }
        } else {
          useCadDocumentStore.getState().commitText(message.sourceText, "editor", {
            cursorLineAtBurstStart: null
          });
        }
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
  }, [api, measureCanvasTextWidth, requestCanvasHistory, restoreCanvasFocus, rustTransport]);

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
