import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { useEvaluationEngine } from "../geometry/useEvaluationEngine";
import {
  effectiveCompiledDocument,
  effectiveElements,
  effectiveEvaluationLimitIndex,
  say48HistoryState,
  say48SourceFingerprint,
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

type CanvasHistoryDirection = "undo" | "redo";

export const VSCodeApp = ({ api }: { api: VscodeWebviewApi }) => {
  const elements = useCadDocumentStore(effectiveElements);
  const evaluationLimitIndex = useCadDocumentStore(effectiveEvaluationLimitIndex);
  const evaluationDocument = useCadDocumentStore(effectiveCompiledDocument);
  const compiledDocumentRevision = useCadDocumentStore((state) => state.compiledDocumentRevision);
  const [benchmarkConfig, setBenchmarkConfig] = useState<VscodeBenchmarkConfig | null>(null);
  const [canvasTheme, setCanvasTheme] = useState(LEGACY_CANVAS_THEME);
  const latestHostDocumentVersionRef = useRef<number | null>(null);
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
  useEffect(() => {
    evaluationRef.current = evaluationState.evaluation;
  }, [evaluationState.evaluation]);

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
        if (message.status !== "completed") {
          pendingCanvasHistoryRef.current = [];
        }
        restoreCanvasFocus(message.status === "completed" ? pumpCanvasHistory : undefined);
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
          say48HistoryState("VSCodeApp incoming authoritative commitText before reconcile", useCadDocumentStore.getState(), {
            reason: message.reason,
            documentVersion: message.documentVersion,
            authoritativeSource: {
              fingerprint: say48SourceFingerprint(message.sourceText),
              length: message.sourceText.length
            }
          });
          useCadDocumentStore.getState().reconcileAuthoritativeHistory(message.sourceText, message.reason);
          say48HistoryState("VSCodeApp incoming authoritative commitText after reconcile", useCadDocumentStore.getState(), {
            reason: message.reason,
            documentVersion: message.documentVersion,
            authoritativeSource: {
              fingerprint: say48SourceFingerprint(message.sourceText),
              length: message.sourceText.length
            }
          });
        } else {
          say48HistoryState("VSCodeApp incoming ordinary commitText acknowledgement before", useCadDocumentStore.getState(), {
            reason: message.reason,
            documentVersion: message.documentVersion,
            acknowledgedSource: {
              fingerprint: say48SourceFingerprint(message.sourceText),
              length: message.sourceText.length
            }
          });
          useCadDocumentStore.getState().commitText(message.sourceText, "editor", {
            cursorLineAtBurstStart: null
          });
          say48HistoryState("VSCodeApp incoming ordinary commitText acknowledgement after", useCadDocumentStore.getState(), {
            reason: message.reason,
            documentVersion: message.documentVersion,
            acknowledgedSource: {
              fingerprint: say48SourceFingerprint(message.sourceText),
              length: message.sourceText.length
            }
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
  }, [api, measureCanvasTextWidth, pumpCanvasHistory, requestCanvasHistory, restoreCanvasFocus, rustTransport]);

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
          say48HistoryState("VSCodeApp outgoing canvasCommit", useCadDocumentStore.getState(), {
            expectedDocumentVersion,
            mutationKind,
            source: {
              fingerprint: say48SourceFingerprint(sourceText),
              length: sourceText.length
            },
            splices: sourceUpdate.kind === "model-patch" ? sourceUpdate.splices : undefined
          });
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
