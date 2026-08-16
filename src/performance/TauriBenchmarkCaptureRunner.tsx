/* eslint-disable react-refresh/only-export-components */
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import {
  runBrowserBenchmarkCapture,
  type BrowserBenchmarkCaptureConfig,
  type BrowserBenchmarkCaptureDependencies
} from "./browserBenchmarkCapture";
import {
  abortBenchmarkSample,
  beginBenchmarkSample,
  drainCompletedBenchmarkSamples,
  subscribeCompletedBenchmarkSamples
} from "./benchmarkInstrumentation";
import { waitForCurrentDrawAndFrame } from "./benchmarkFrameObserver";
import type { BenchmarkFixtureManifestEntry } from "./benchmarkFixtureManifest";
import type { BenchmarkMachine, BenchmarkResult } from "./benchmarkResultSchema";
import { evaluationStateIsCurrentFor, type EvaluationEngineState } from "../geometry/useEvaluationEngine";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { EvaluationResult } from "../types/geometry";

export type TauriBenchmarkCaptureConfig = {
  runId: string;
  fixtureId: string;
  fixtureHash: string;
  fixtureSource: string;
  fixture: BenchmarkFixtureManifestEntry;
  resultPath: string;
  build: {
    gitCommit: string;
    machine: BenchmarkMachine;
  };
};

type EvaluationSnapshot = {
  evaluation: EvaluationResult;
  evaluationState: EvaluationEngineState;
  compiledDocumentRevision: number;
};

export type TauriBenchmarkCaptureDependencies = BrowserBenchmarkCaptureDependencies & {
  getAppVersion: () => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  destroyWindow: () => Promise<void>;
};

export type TauriBenchmarkCaptureRunInput = {
  config: TauriBenchmarkCaptureConfig;
  dependencies: TauriBenchmarkCaptureDependencies;
};

const claimedBenchmarkRunIds = new Set<string>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertConfig = (value: unknown): TauriBenchmarkCaptureConfig => {
  if (!isRecord(value)) throw new Error("Invalid Tauri benchmark capture config");
  const requiredStrings = ["runId", "fixtureId", "fixtureHash", "fixtureSource", "resultPath"] as const;
  for (const key of requiredStrings) {
    if (typeof value[key] !== "string" || value[key].length === 0) {
      throw new Error(`Invalid Tauri benchmark capture config: ${key}`);
    }
  }
  if (!isRecord(value.fixture) || !isRecord(value.build) || !isRecord(value.build.machine)) {
    throw new Error("Invalid Tauri benchmark capture config: fixture/build");
  }
  if (typeof value.build.gitCommit !== "string") {
    throw new Error("Invalid Tauri benchmark capture config: build.gitCommit");
  }
  return value as unknown as TauriBenchmarkCaptureConfig;
};

export const parseTauriBenchmarkCaptureConfig = (
  raw: string | undefined
): TauriBenchmarkCaptureConfig | null => {
  if (!raw) return null;
  try {
    return assertConfig(JSON.parse(raw) as unknown);
  } catch (error) {
    throw new Error(`Invalid VITE_BENCHMARK_CAPTURE_CONFIG: ${String(error)}`, { cause: error });
  }
};

export const benchmarkCaptureConfigFromEnv = (): TauriBenchmarkCaptureConfig | null =>
  parseTauriBenchmarkCaptureConfig(import.meta.env.VITE_BENCHMARK_CAPTURE_CONFIG);

const defaultDependencies = (): TauriBenchmarkCaptureDependencies => ({
  instrumentation: {
    beginSample: beginBenchmarkSample,
    abortSample: abortBenchmarkSample,
    drainSamples: drainCompletedBenchmarkSamples,
    subscribeSamples: subscribeCompletedBenchmarkSamples
  },
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
  replaceTextDocument: (sourceText) => {
    useCadDocumentStore.getState().replaceTextDocument(sourceText, {
      currentFilePath: null,
      dirtySinceSave: false
    });
  },
  commitText: (sourceText) => {
    useCadDocumentStore.getState().commitText(sourceText, "editor", { cursorLineAtBurstStart: null });
  },
  clearPreview: () => useCadDocumentStore.getState().clearPreviewDocumentChange(),
  resetCanvasViewport: () => useCadUiStore.getState().resetCanvasViewport(),
  getUiSnapshot: () => {
    const state = useCadUiStore.getState();
    return {
      selectedElementId: state.selectedElementId,
      canvasViewport: state.canvasViewport
    };
  },
  setSelectedElementId: (elementId) => useCadUiStore.getState().setSelectedElementId(elementId),
  getCanvasViewport: () => document.querySelector<HTMLElement>('[data-canvas-viewport="true"]'),
  getEvaluationSnapshot: () => {
    throw new Error("Tauri benchmark evaluation snapshot is not wired");
  },
  waitForRustEvaluation: async () => {
    throw new Error("Tauri benchmark Rust evaluation waiter is not wired");
  },
  getRenderSurface: () => {
    const viewport = document.querySelector<HTMLElement>('[data-canvas-viewport="true"]');
    const canvas = viewport?.querySelector<HTMLCanvasElement>("canvas");
    if (!viewport || !canvas) throw new Error("Benchmark canvas viewport is unavailable");
    const surface = {
      cssWidthPx: viewport.clientWidth,
      cssHeightPx: viewport.clientHeight,
      backingWidthPx: canvas.width,
      backingHeightPx: canvas.height,
      devicePixelRatio: window.devicePixelRatio || 1
    };
    if (Object.values(surface).some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new Error("Benchmark render surface is not measurable");
    }
    return surface;
  },
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
  },
  getAppVersion: () => getVersion(),
  writeFile: (path, content) => invoke("write_document_file", { path, content }),
  destroyWindow: () => getCurrentWindow().destroy()
});

export const runTauriBenchmarkCapture = async ({
  config,
  dependencies
}: TauriBenchmarkCaptureRunInput): Promise<BenchmarkResult> => {
  const appVersion = await dependencies.getAppVersion();
  const browserConfig: BrowserBenchmarkCaptureConfig = {
    target: "tauri",
    fixtureId: config.fixtureId,
    fixtureHash: config.fixtureHash,
    fixtureSource: config.fixtureSource,
    fixture: config.fixture,
    build: {
      gitCommit: config.build.gitCommit,
      appVersion,
      machine: config.build.machine
    },
    webviewUserAgent: navigator.userAgent
  };
  return runBrowserBenchmarkCapture({ config: browserConfig, dependencies });
};

export const writeTauriBenchmarkError = async (
  config: TauriBenchmarkCaptureConfig,
  dependencies: Pick<TauriBenchmarkCaptureDependencies, "writeFile">,
  error: unknown
): Promise<void> => {
  await dependencies.writeFile(`${config.resultPath}.error.json`, JSON.stringify({
    runId: config.runId,
    error: error instanceof Error ? error.message : String(error)
  }, null, 2));
};

export const claimTauriBenchmarkRun = (runId: string): boolean => {
  if (claimedBenchmarkRunIds.has(runId)) return false;
  claimedBenchmarkRunIds.add(runId);
  return true;
};

export const TauriBenchmarkCaptureRunner = ({
  config: configuredConfig,
  evaluation,
  evaluationState,
  compiledDocumentRevision,
  canvasFocusRef,
  dependencies: dependencyOverrides
}: {
  config?: TauriBenchmarkCaptureConfig | null;
  evaluation: EvaluationResult;
  evaluationState: EvaluationEngineState;
  compiledDocumentRevision: number;
  canvasFocusRef: RefObject<HTMLDivElement | null>;
  dependencies?: Partial<TauriBenchmarkCaptureDependencies>;
}) => {
  const config = configuredConfig === undefined ? benchmarkCaptureConfigFromEnv() : configuredConfig;
  const latestEvaluation = useRef<EvaluationSnapshot>({ evaluation, evaluationState, compiledDocumentRevision });
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
        waiter.reject(new Error("Benchmark capture requires Rust evaluation; reference/fallback is not allowed"));
      } else if (snapshot.evaluationState.status === "failed") {
        evaluationWaiters.current.delete(waiter);
        waiter.reject(new Error("Benchmark Rust evaluation failed"));
      } else if (
        snapshot.evaluationState.status === "ready" &&
        snapshot.evaluationState.source === "rust" &&
        !snapshot.evaluationState.isStale &&
        evaluationStateIsCurrentFor(snapshot.evaluationState, waiter.revision)
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
    if (!config || !claimTauriBenchmarkRun(config.runId)) return;
    const dependencies = {
      ...defaultDependencies(),
      ...dependencyOverrides,
      getEvaluationSnapshot: () => latestEvaluation.current,
      getCanvasViewport: dependencyOverrides?.getCanvasViewport ?? (() => canvasFocusRef.current),
      waitForRustEvaluation: dependencyOverrides?.waitForRustEvaluation ?? ((revision: number) => new Promise<void>((resolve, reject) => {
        const waiter = { revision, resolve, reject };
        evaluationWaiters.current.add(waiter);
        checkEvaluationWaiters();
      }))
    } satisfies TauriBenchmarkCaptureDependencies;

    void runTauriBenchmarkCapture({ config, dependencies })
      .then(async (result) => {
        await dependencies.writeFile(config.resultPath, `${JSON.stringify(result, null, 2)}\n`);
      })
      .catch(async (error: unknown) => {
        try {
          await writeTauriBenchmarkError(config, dependencies, error);
        } catch (writeError) {
          console.error("Unable to write Tauri benchmark error", writeError);
        }
      })
      .finally(async () => {
        try {
          await dependencies.destroyWindow();
        } catch (error) {
          console.error("Unable to destroy benchmark window", error);
        }
      });
  }, [canvasFocusRef, config, dependencyOverrides]);

  return null;
};
