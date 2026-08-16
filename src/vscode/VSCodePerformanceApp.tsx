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
import type {
  ExtensionToVscodeMessage,
  VscodeBenchmarkConfig,
  VscodeWebviewApi
} from "./protocol";

export const VSCodePerformanceApp = ({ api }: { api: VscodeWebviewApi }) => {
  const elements = useCadDocumentStore(effectiveElements);
  const evaluationLimitIndex = useCadDocumentStore(effectiveEvaluationLimitIndex);
  const evaluationDocument = useCadDocumentStore(effectiveCompiledDocument);
  const compiledDocumentRevision = useCadDocumentStore((state) => state.compiledDocumentRevision);
  const [benchmarkConfig, setBenchmarkConfig] = useState<VscodeBenchmarkConfig | null>(null);
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
    const onMessage = (event: MessageEvent<ExtensionToVscodeMessage>) => {
      const message = event.data;
      if (rustTransport.handleMessage(message)) return;
      if (message.type === "replaceTextDocument") {
        useCadDocumentStore.getState().replaceTextDocument(message.sourceText, {
          currentFilePath: null,
          dirtySinceSave: false
        });
      } else if (message.type === "commitText") {
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
        postCanonicalSourceText={(sourceText) => api.postMessage({ type: "canvasCommit", sourceText })}
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
