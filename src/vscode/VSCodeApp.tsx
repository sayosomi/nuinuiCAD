import { useEffect, useMemo, useRef, useState } from "react";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { useEvaluationEngine } from "../geometry/useEvaluationEngine";
import {
  effectiveCompiledDocument,
  effectiveElements,
  effectiveEvaluationLimitIndex,
  useCadDocumentStore
} from "../state/cadDocumentStore";
import { VSCodeDrawingCanvas } from "./VSCodeDrawingCanvas";
import { VSCodeBenchmarkCaptureRunner } from "./VSCodeBenchmarkCaptureRunner";
import { VscodeRustTransport } from "./vscodeRustTransport";
import { isStaleHostDocumentVersion } from "./hostDocumentVersion";
import { LEGACY_CANVAS_THEME } from "../components/canvasTheme";
import { readVSCodeCanvasTheme } from "./vscodeCanvasTheme";
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
  const canvasFocusRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    const refreshCanvasTheme = () => setCanvasTheme(readVSCodeCanvasTheme());
    refreshCanvasTheme();
    const onMessage = (event: MessageEvent<ExtensionToVscodeMessage>) => {
      const message = event.data;
      if (rustTransport.handleMessage(message)) return;
      if (message.type === "canvasThemeChanged") {
        refreshCanvasTheme();
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
        useCadDocumentStore.getState().commitText(message.sourceText, "editor", {
          cursorLineAtBurstStart: null
        });
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
  }, [api, rustTransport]);

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
