/* eslint-disable react-refresh/only-export-components */
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { BenchmarkScenarioId } from "./benchmarkContract";
import {
  runBenchmarkCapture,
  type BenchmarkCaptureHost
} from "./benchmarkCaptureRunner";
import {
  assembleBenchmarkResult
} from "./benchmarkResultAssembly";
import {
  abortBenchmarkSample,
  beginBenchmarkSample,
  drainCompletedBenchmarkSamples,
  subscribeCompletedBenchmarkSamples,
  type BenchmarkSampleHandle,
  type CompletedBenchmarkSample
} from "./benchmarkInstrumentation";
import {
  waitForCurrentDrawAndFrame,
  type BenchmarkFrameObserver,
  type BenchmarkFrameWaitHandle
} from "./benchmarkFrameObserver";
import type {
  BenchmarkFixtureManifestEntry
} from "./benchmarkFixtureManifest";
import type {
  BenchmarkMachine,
  BenchmarkRenderSurface,
  BenchmarkResult
} from "./benchmarkResultSchema";
import { evaluationStateIsCurrentFor, type EvaluationEngineState } from "../geometry/useEvaluationEngine";
import { isPointElement } from "../model/pointAnchors";
import { resolveElementNamePath } from "../model/elementNames";
import { worldToScreen } from "../components/canvasViewport";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { CanvasViewport } from "../state/cadUiStore";
import type { CadElement, EvaluationResult } from "../types/geometry";

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

type DocumentSnapshot = {
  sourceText: string;
  docText: string;
  compiledDocumentRevision: number;
  elements: CadElement[];
};

type UiSnapshot = {
  selectedElementId: string | null;
  canvasViewport: CanvasViewport;
};

type PointerCoordinates = {
  start: { clientX: number; clientY: number };
  end: { clientX: number; clientY: number };
};

type ScenarioSetup =
  | { kind: "source" }
  | { kind: "pointer"; pointerId: number; viewport: HTMLElement; coordinates: PointerCoordinates };

export type TauriBenchmarkCaptureDependencies = {
  instrumentation: {
    beginSample: (scenarioId: BenchmarkScenarioId) => BenchmarkSampleHandle | null;
    abortSample: () => void;
    drainSamples: () => CompletedBenchmarkSample[];
    subscribeSamples: (listener: (sample: CompletedBenchmarkSample) => void) => () => void;
  };
  frameObserver: Pick<BenchmarkFrameObserver, "waitForCurrentDrawAndFrame">;
  getDocumentSnapshot: () => DocumentSnapshot;
  replaceTextDocument: (sourceText: string) => void;
  commitText: (sourceText: string) => void;
  clearPreview: () => void;
  resetCanvasViewport: () => void;
  getUiSnapshot: () => UiSnapshot;
  setSelectedElementId: (elementId: string) => void;
  getCanvasViewport: () => HTMLElement | null;
  getEvaluationSnapshot: () => EvaluationSnapshot;
  waitForRustEvaluation: (compiledDocumentRevision: number) => Promise<void>;
  getRenderSurface: () => BenchmarkRenderSurface;
  dispatchPointerEvent: (
    viewport: HTMLElement,
    type: "pointerdown" | "pointermove" | "pointerup",
    coordinates: { clientX: number; clientY: number },
    options: { pointerId: number; buttons: number; button: number }
  ) => void;
  getAppVersion: () => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  closeWindow: () => Promise<void>;
};

export type TauriBenchmarkCaptureRunInput = {
  config: TauriBenchmarkCaptureConfig;
  dependencies: TauriBenchmarkCaptureDependencies;
};

const CAPTURE_GUARD_TIMEOUT_MS = 60_000;
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
    const cssWidthPx = viewport.clientWidth;
    const cssHeightPx = viewport.clientHeight;
    const surface = {
      cssWidthPx,
      cssHeightPx,
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
  closeWindow: () => getCurrentWindow().close()
});

const withGuardTimeout = async <T,>(promise: Promise<T>, description: string): Promise<T> => {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`Benchmark ${description} timed out`)), CAPTURE_GUARD_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
};

const assertCurrentRustEvaluation = (
  snapshot: EvaluationSnapshot,
  compiledDocumentRevision: number
): void => {
  if (
    snapshot.evaluationState.status !== "ready" ||
    snapshot.evaluationState.source !== "rust" ||
    snapshot.evaluationState.isStale ||
    !evaluationStateIsCurrentFor(snapshot.evaluationState, compiledDocumentRevision)
  ) {
    throw new Error("Tauri benchmark requires a current ready Rust evaluation");
  }
}

const sameRenderSurface = (left: BenchmarkRenderSurface, right: BenchmarkRenderSurface): boolean =>
  left.cssWidthPx === right.cssWidthPx &&
  left.cssHeightPx === right.cssHeightPx &&
  left.backingWidthPx === right.backingWidthPx &&
  left.backingHeightPx === right.backingHeightPx &&
  left.devicePixelRatio === right.devicePixelRatio;

const renderSurfaceIsCoherent = (surface: BenchmarkRenderSurface): boolean =>
  surface.backingWidthPx === Math.round(surface.cssWidthPx * surface.devicePixelRatio) &&
  surface.backingHeightPx === Math.round(surface.cssHeightPx * surface.devicePixelRatio);

const parseElementPath = (elementPath: string) => ({
  absolute: elementPath.startsWith("::"),
  parts: elementPath.replace(/^::/, "").split("::")
});

const resolveFixtureElement = (
  elements: CadElement[],
  elementPath: string
): CadElement => {
  const resolution = resolveElementNamePath({
    path: parseElementPath(elementPath),
    elements
  });
  if (resolution.status === "missing") throw new Error(`Benchmark target is missing: ${elementPath}`);
  if (resolution.status === "ambiguous") throw new Error(`Benchmark target is ambiguous: ${elementPath}`);
  return resolution.element;
};

const escapedRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const sourceEditRange = (
  source: string,
  anchor: TauriBenchmarkCaptureConfig["fixture"]["anchors"]["sourceEdit"]
) => {
  const expression = new RegExp(
    `\\bconst\\s+${escapedRegExp(anchor.bindingName)}\\s*:\\s*number\\s*=\\s*(${escapedRegExp(anchor.from)})\\b`,
    "g"
  );
  const matches = [...source.matchAll(expression)];
  if (matches.length !== 1) {
    throw new Error(
      `Source benchmark anchor must match exactly one declaration; found ${matches.length}`
    );
  }
  const match = matches[0];
  const valueStart = match.index! + match[0].lastIndexOf(anchor.from);
  return { valueStart, valueEnd: valueStart + anchor.from.length };
};

const sampleWaiter = (
  dependencies: TauriBenchmarkCaptureDependencies,
  expected: BenchmarkSampleHandle
): Promise<CompletedBenchmarkSample> => new Promise((resolve, reject) => {
  let finished = false;
  let unsubscribe: () => void = () => undefined;
  const finish = (callback: () => void) => {
    if (finished) return;
    finished = true;
    unsubscribe();
    callback();
  };
  const accept = (sample: CompletedBenchmarkSample) => {
    if (sample.sampleId !== expected.sampleId || sample.scenarioId !== expected.scenarioId) {
      finish(() => reject(new Error("Received stale or wrong benchmark sample completion")));
      return;
    }
    finish(() => resolve(sample));
  };
  unsubscribe = dependencies.instrumentation.subscribeSamples(accept);
  const queued = dependencies.instrumentation.drainSamples();
  if (queued.length > 0) {
    if (queued.length !== 1) {
      finish(() => reject(new Error("Multiple benchmark sample completions were queued")));
    } else {
      accept(queued[0]);
    }
  }
});

export const runTauriBenchmarkCapture = async ({
  config,
  dependencies
}: TauriBenchmarkCaptureRunInput): Promise<BenchmarkResult> => {
  let initialSurface: BenchmarkRenderSurface | null = null;
  let resetRevision: number | null = null;
  let resetFrame: BenchmarkFrameWaitHandle | null = null;
  let pointerId = 10_000;

  const verifySurface = () => {
    const current = dependencies.getRenderSurface();
    if (initialSurface === null) {
      initialSurface = current;
      return;
    }
    if (!sameRenderSurface(initialSurface, current)) {
      throw new Error(
        `Benchmark render surface changed during capture: ` +
        `expected ${JSON.stringify(initialSurface)}, received ${JSON.stringify(current)}`
      );
    }
  };

  const establishSurfaceBaseline = async (compiledDocumentRevision: number): Promise<void> => {
    let surface = dependencies.getRenderSurface();
    if (!renderSurfaceIsCoherent(surface)) {
      const frame = dependencies.frameObserver.waitForCurrentDrawAndFrame(compiledDocumentRevision);
      try {
        await withGuardTimeout(frame.promise, "render surface settle");
      } catch (error) {
        frame.cancel();
        throw error;
      }
      surface = dependencies.getRenderSurface();
      if (!renderSurfaceIsCoherent(surface)) {
        throw new Error(`Benchmark render surface is incoherent: ${JSON.stringify(surface)}`);
      }
    }
    if (initialSurface === null) initialSurface = surface;
    else if (!sameRenderSurface(initialSurface, surface)) {
      throw new Error(
        `Benchmark render surface changed during capture: ` +
        `expected ${JSON.stringify(initialSurface)}, received ${JSON.stringify(surface)}`
      );
    }
  };

  const host: BenchmarkCaptureHost<ScenarioSetup> = {
    reset: () => {
      dependencies.instrumentation.abortSample();
      dependencies.instrumentation.drainSamples();
      dependencies.clearPreview();
      dependencies.resetCanvasViewport();
      dependencies.replaceTextDocument(config.fixtureSource);
      const document = dependencies.getDocumentSnapshot();
      if (document.sourceText !== config.fixtureSource || document.docText !== config.fixtureSource) {
        throw new Error("Benchmark fixture reset did not produce an exact valid document");
      }
      resetRevision = document.compiledDocumentRevision;
      resetFrame = dependencies.frameObserver.waitForCurrentDrawAndFrame(resetRevision);
      if (initialSurface !== null) verifySurface();
    },
    settle: async () => {
      if (resetRevision === null || resetFrame === null) throw new Error("Benchmark settle started before reset");
      try {
        await withGuardTimeout(
          Promise.all([
            dependencies.waitForRustEvaluation(resetRevision),
            resetFrame.promise
          ]).then(() => undefined),
          "settle"
        );
      } catch (error) {
        resetFrame.cancel();
        throw error;
      }
      const snapshot = dependencies.getEvaluationSnapshot();
      assertCurrentRustEvaluation(snapshot, resetRevision);
      await establishSurfaceBaseline(resetRevision);
    },
    setupScenario: async (scenarioId) => {
      if (scenarioId === "source-edit-v1") return { kind: "source" };

      const anchor = scenarioId === "point-drag-v1"
        ? config.fixture.anchors.pointDrag
        : config.fixture.anchors.bezierHandleDrag;
      if (
        scenarioId === "bezier-handle-drag-v1" &&
        config.fixture.anchors.bezierHandleDrag.handleRole !== "start"
      ) {
        throw new Error(`Unsupported benchmark Bezier handle role: ${config.fixture.anchors.bezierHandleDrag.handleRole}`);
      }
      const document = dependencies.getDocumentSnapshot();
      const target = resolveFixtureElement(document.elements, anchor.elementPath);
      if (scenarioId === "point-drag-v1" && !isPointElement(target)) {
        throw new Error(`Benchmark point target has unexpected type: ${target.type}`);
      }
      if (scenarioId === "bezier-handle-drag-v1" && target.type !== "bezierCurve") {
        throw new Error(`Benchmark curve target has unexpected type: ${target.type}`);
      }

      const ui = dependencies.getUiSnapshot();
      if (ui.selectedElementId !== target.id) {
        const frame = dependencies.frameObserver.waitForCurrentDrawAndFrame(document.compiledDocumentRevision);
        dependencies.setSelectedElementId(target.id);
        try {
          await withGuardTimeout(frame.promise, "selection settle");
        } catch (error) {
          frame.cancel();
          throw error;
        }
      }

      const snapshot = dependencies.getEvaluationSnapshot();
      assertCurrentRustEvaluation(snapshot, document.compiledDocumentRevision);
      const geometry = snapshot.evaluation.computedGeometry.get(target.id);
      if (!geometry) throw new Error(`Benchmark target has no computed geometry: ${anchor.elementPath}`);

      const viewport = dependencies.getCanvasViewport();
      if (!viewport) throw new Error("Benchmark canvas viewport is unavailable");
      const surface = dependencies.getRenderSurface();
      const rect = viewport.getBoundingClientRect();
      const viewportSize = { width: surface.cssWidthPx, height: surface.cssHeightPx };
      const worldPoint = scenarioId === "point-drag-v1"
        ? geometry.kind === "point" ? geometry : null
        : geometry.kind === "bezierCurve" ? geometry.segments[0]?.control1 : null;
      if (!worldPoint) throw new Error(`Benchmark target geometry cannot provide the requested drag point: ${target.name}`);
      const screen = worldToScreen(worldPoint, viewportSize, ui.canvasViewport);
      const start = {
        clientX: rect.left + viewport.clientLeft + screen.x,
        clientY: rect.top + viewport.clientTop + screen.y
      };
      const delta = anchor.pointerDeltaCssPx;
      const end = {
        clientX: start.clientX + delta.x,
        clientY: start.clientY + delta.y
      };
      const currentPointerId = pointerId;
      pointerId += 1;
      dependencies.dispatchPointerEvent(viewport, "pointerdown", start, {
        pointerId: currentPointerId,
        button: 0,
        buttons: 1
      });
      return {
        kind: "pointer",
        pointerId: currentPointerId,
        viewport,
        coordinates: { start, end }
      };
    },
    beginSample: dependencies.instrumentation.beginSample,
    performAction: (scenarioId, setup) => {
      if (scenarioId === "source-edit-v1") {
        const document = dependencies.getDocumentSnapshot();
        const anchor = config.fixture.anchors.sourceEdit;
        const range = sourceEditRange(document.sourceText, anchor);
        const nextText = `${document.sourceText.slice(0, range.valueStart)}${anchor.to}${document.sourceText.slice(range.valueEnd)}`;
        if (nextText === document.sourceText) throw new Error("Source benchmark action produced no change");
        // The editor origin is part of the production timing contract.
        dependencies.commitText(nextText);
        if (dependencies.getDocumentSnapshot().sourceText !== nextText) {
          throw new Error("Source benchmark action was not committed");
        }
        return;
      }
      if (setup.kind !== "pointer") throw new Error(`Invalid setup for ${scenarioId}`);
      dependencies.dispatchPointerEvent(setup.viewport, "pointermove", setup.coordinates.end, {
        pointerId: setup.pointerId,
        button: 0,
        buttons: 1
      });
    },
    awaitCompletedSample: (handle) => sampleWaiter(dependencies, handle),
    teardownScenario: (scenarioId, setup) => {
      if (scenarioId === "source-edit-v1") return;
      if (setup.kind !== "pointer") throw new Error(`Invalid setup for ${scenarioId}`);
      dependencies.dispatchPointerEvent(setup.viewport, "pointerup", setup.coordinates.end, {
        pointerId: setup.pointerId,
        button: 0,
        buttons: 0
      });
    },
    abortBenchmarkSample: dependencies.instrumentation.abortSample
  };

  const samples = await runBenchmarkCapture(host);
  verifySurface();
  const appVersion = await dependencies.getAppVersion();
  return assembleBenchmarkResult({
    fixture: { id: config.fixtureId, hash: config.fixtureHash },
    build: { gitCommit: config.build.gitCommit, appVersion },
    environment: {
      machine: config.build.machine,
      webviewUserAgent: navigator.userAgent,
      renderSurface: initialSurface ?? dependencies.getRenderSurface()
    },
    samples
  });
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
  const config = configuredConfig === undefined
    ? benchmarkCaptureConfigFromEnv()
    : configuredConfig;
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
          await dependencies.closeWindow();
        } catch (error) {
          console.error("Unable to close benchmark window", error);
        }
      });
  }, [canvasFocusRef, config, dependencyOverrides]);

  return null;
};
