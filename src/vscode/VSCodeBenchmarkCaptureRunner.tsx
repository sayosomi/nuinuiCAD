import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import {
  browserBenchmarkDefaultInstrumentation,
  runBrowserBenchmarkCapture,
  type BrowserBenchmarkCaptureConfig,
  type BrowserBenchmarkCaptureDependencies
} from "../performance/browserBenchmarkCapture";
import { waitForCurrentDrawAndFrame } from "../performance/benchmarkFrameObserver";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import type { EvaluationResult } from "../types/geometry";
import type { VscodeBenchmarkConfig, VscodeWebviewApi } from "./protocol";

type VSCodeBenchmarkCaptureRunnerProps = {
  config: VscodeBenchmarkConfig | null;
  evaluation: EvaluationResult;
  evaluationState: EvaluationEngineState;
  compiledDocumentRevision: number;
  canvasFocusRef: RefObject<HTMLDivElement | null>;
  api: VscodeWebviewApi;
};

const sameRenderSurface = (
  left: ReturnType<BrowserBenchmarkCaptureDependencies["getRenderSurface"]>,
  right: ReturnType<BrowserBenchmarkCaptureDependencies["getRenderSurface"]>
) => JSON.stringify(left) === JSON.stringify(right);

const currentRenderSurface = (viewport: HTMLElement): ReturnType<BrowserBenchmarkCaptureDependencies["getRenderSurface"]> => {
  const canvas = viewport.querySelector<HTMLCanvasElement>("canvas");
  if (!canvas) throw new Error("VS Code benchmark canvas is unavailable");
  return {
    cssWidthPx: viewport.clientWidth,
    cssHeightPx: viewport.clientHeight,
    backingWidthPx: canvas.width,
    backingHeightPx: canvas.height,
    devicePixelRatio: window.devicePixelRatio || 1
  };
};

const claimedRuns = new Set<string>();

export const VSCodeBenchmarkCaptureRunner = ({
  config,
  evaluation,
  evaluationState,
  compiledDocumentRevision,
  canvasFocusRef,
  api
}: VSCodeBenchmarkCaptureRunnerProps) => {
  const latestEvaluation = useRef({ evaluation, evaluationState, compiledDocumentRevision });
  const evaluationWaiters = useRef(new Set<{
    revision: number;
    resolve: () => void;
    reject: (error: Error) => void;
  }>());

  const checkEvaluationWaiters = () => {
    for (const waiter of evaluationWaiters.current) {
      const snapshot = latestEvaluation.current;
      if (snapshot.compiledDocumentRevision !== waiter.revision) continue;
      if (snapshot.evaluationState.source === "reference" || snapshot.evaluationState.source === "fallback") {
        evaluationWaiters.current.delete(waiter);
        waiter.reject(new Error("VS Code benchmark requires Rust evaluation; reference/fallback is not allowed"));
      } else if (snapshot.evaluationState.status === "failed") {
        evaluationWaiters.current.delete(waiter);
        waiter.reject(new Error("VS Code benchmark Rust evaluation failed"));
      } else if (
        snapshot.evaluationState.status === "ready" &&
        snapshot.evaluationState.source === "rust" &&
        !snapshot.evaluationState.isStale &&
        snapshot.evaluationState.evaluationRevision === waiter.revision
      ) {
        evaluationWaiters.current.delete(waiter);
        waiter.resolve();
      }
    }
  };

  useEffect(() => {
    latestEvaluation.current = { evaluation, evaluationState, compiledDocumentRevision };
  }, [evaluation, evaluationState, compiledDocumentRevision]);

  useEffect(() => {
    checkEvaluationWaiters();
  }, [evaluation, evaluationState, compiledDocumentRevision]);

  useEffect(() => {
    if (!config || claimedRuns.has(config.runId)) return;
    claimedRuns.add(config.runId);

    const expectedSurface = config.expectedRenderSurface;
    const getRenderSurface = () => {
      const viewport = canvasFocusRef.current;
      if (!viewport) throw new Error("VS Code benchmark canvas viewport is unavailable");
      const surface = currentRenderSurface(viewport);
      if (!sameRenderSurface(surface, expectedSurface)) {
        throw new Error(`VS Code render surface mismatch: expected ${JSON.stringify(expectedSurface)}, received ${JSON.stringify(surface)}`);
      }
      return surface;
    };
    const baseDependencies: BrowserBenchmarkCaptureDependencies = {
      instrumentation: browserBenchmarkDefaultInstrumentation(),
      frameObserver: { waitForCurrentDrawAndFrame },
      getDocumentSnapshot: () => {
        const state = useCadDocumentStore.getState();
        return {
          sourceText: state.sourceText,
          docText: state.docText,
          compiledDocumentRevision: state.compiledDocumentRevision,
          elements: state.elements
        };
      },
      replaceTextDocument: (sourceText) => useCadDocumentStore.getState().replaceTextDocument(sourceText, {
        currentFilePath: null,
        dirtySinceSave: false
      }),
      commitText: (sourceText) => useCadDocumentStore.getState().commitText(sourceText, "editor", {
        cursorLineAtBurstStart: null
      }),
      clearPreview: () => useCadDocumentStore.getState().clearPreviewDocumentChange(),
      resetCanvasViewport: () => useCadUiStore.getState().resetCanvasViewport(),
      getUiSnapshot: () => {
        const state = useCadUiStore.getState();
        return { selectedElementId: state.selectedElementId, canvasViewport: state.canvasViewport };
      },
      setSelectedElementId: (elementId) => useCadUiStore.getState().setSelectedElementId(elementId),
      getCanvasViewport: () => canvasFocusRef.current,
      getEvaluationSnapshot: () => latestEvaluation.current,
      waitForRustEvaluation: (revision) => new Promise<void>((resolve, reject) => {
        const waiter = { revision, resolve, reject };
        evaluationWaiters.current.add(waiter);
        checkEvaluationWaiters();
      }),
      getRenderSurface,
      dispatchPointerEvent: (viewport, type, coordinates, options) => {
        viewport.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: coordinates.clientX,
          clientY: coordinates.clientY,
          pointerId: options.pointerId,
          pointerType: "mouse",
          isPrimary: true,
          button: options.button,
          buttons: options.buttons
        }));
      }
    };
    const browserConfig: BrowserBenchmarkCaptureConfig = {
      target: "vscode",
      fixtureId: config.fixtureId,
      fixtureHash: config.fixtureHash,
      fixtureSource: config.fixtureSource,
      fixture: config.fixture,
      build: {
        gitCommit: config.build.gitCommit,
        appVersion: config.build.appVersion,
        machine: config.build.machine
      },
      webviewUserAgent: navigator.userAgent
    };

    void runBrowserBenchmarkCapture({ config: browserConfig, dependencies: baseDependencies })
      .then((result) => api.postMessage({ type: "benchmarkResult", result }))
      .catch((error: unknown) => api.postMessage({
        type: "benchmarkError",
        error: error instanceof Error ? error.message : String(error)
      }));
  }, [api, canvasFocusRef, config]);

  return null;
};
