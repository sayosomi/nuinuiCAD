import {
  runBenchmarkCapture,
  type BenchmarkCaptureHost,
  type BenchmarkRunContext
} from "./benchmarkCaptureRunner";
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
import type { BenchmarkFixtureManifestEntry } from "./benchmarkFixtureManifest";
import {
  assembleBenchmarkResult,
  type BenchmarkResultTarget
} from "./benchmarkResultAssembly";
import type {
  BenchmarkMachine,
  BenchmarkRenderSurface,
  BenchmarkResult
} from "./benchmarkResultSchema";
import { evaluationStateIsCurrentFor, type EvaluationEngineState } from "../geometry/useEvaluationEngine";
import { isPointElement } from "../model/pointAnchors";
import { resolveElementNamePath } from "../model/elementNames";
import { worldToScreen } from "../components/canvasViewport";
import type { CanvasViewport } from "../state/cadUiStore";
import type { CadElement, EvaluationResult } from "../types/geometry";

export type BrowserBenchmarkCaptureConfig = {
  target: BenchmarkResultTarget;
  fixtureId: string;
  fixtureHash: string;
  fixtureSource: string;
  fixture: BenchmarkFixtureManifestEntry;
  build: {
    gitCommit: string;
    appVersion: string;
    machine: BenchmarkMachine;
  };
  webviewUserAgent: string;
};

export type BrowserBenchmarkCaptureDependencies = {
  instrumentation: {
    beginSample: (scenarioId: Parameters<typeof beginBenchmarkSample>[0]) => BenchmarkSampleHandle | null;
    abortSample: () => void;
    drainSamples: () => CompletedBenchmarkSample[];
    subscribeSamples: (listener: (sample: CompletedBenchmarkSample) => void) => () => void;
  };
  frameObserver: Pick<BenchmarkFrameObserver, "waitForCurrentDrawAndFrame">;
  getDocumentSnapshot: () => {
    sourceText: string;
    docText: string;
    compiledDocumentRevision: number;
    elements: CadElement[];
  };
  replaceTextDocument: (sourceText: string) => void;
  commitText: (sourceText: string) => void;
  clearPreview: () => void;
  resetCanvasViewport: () => void;
  getUiSnapshot: () => {
    selectedElementId: string | null;
    canvasViewport: CanvasViewport;
  };
  setSelectedElementId: (elementId: string) => void;
  getCanvasViewport: () => HTMLElement | null;
  getEvaluationSnapshot: () => {
    evaluation: EvaluationResult;
    evaluationState: EvaluationEngineState;
    compiledDocumentRevision: number;
  };
  waitForRustEvaluation: (compiledDocumentRevision: number) => Promise<void>;
  getRenderSurface: () => BenchmarkRenderSurface;
  dispatchPointerEvent: (
    viewport: HTMLElement,
    type: "pointerdown" | "pointermove" | "pointerup",
    coordinates: { clientX: number; clientY: number },
    options: { pointerId: number; buttons: number; button: number }
  ) => void;
};

export type BrowserBenchmarkCaptureRunInput = {
  config: BrowserBenchmarkCaptureConfig;
  dependencies: BrowserBenchmarkCaptureDependencies;
};

const CAPTURE_GUARD_TIMEOUT_MS = 60_000;
const SAMPLE_COMPLETION_GUARD_TIMEOUT_MS = 30_000;

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
  snapshot: BrowserBenchmarkCaptureDependencies["getEvaluationSnapshot"] extends () => infer T ? T : never,
  compiledDocumentRevision: number
): void => {
  if (
    snapshot.evaluationState.status !== "ready" ||
    snapshot.evaluationState.source !== "rust" ||
    snapshot.evaluationState.isStale ||
    !evaluationStateIsCurrentFor(snapshot.evaluationState, compiledDocumentRevision)
  ) {
    throw new Error("Benchmark capture requires a current ready Rust evaluation");
  }
};

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

const resolveFixtureElement = (elements: CadElement[], elementPath: string): CadElement => {
  const resolution = resolveElementNamePath({
    path: parseElementPath(elementPath),
    elements
  });
  if (resolution.status === "missing") throw new Error(`Benchmark target is missing: ${elementPath}`);
  if (resolution.status === "ambiguous") throw new Error(`Benchmark target is ambiguous: ${elementPath}`);
  return resolution.element;
};

const escapedRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const sourceEditRange = (
  source: string,
  anchor: BenchmarkFixtureManifestEntry["anchors"]["sourceEdit"]
) => {
  const expression = new RegExp(
    `\\bconst\\s+${escapedRegExp(anchor.bindingName)}\\s*:\\s*number\\s*=\\s*(${escapedRegExp(anchor.from)})\\b`,
    "g"
  );
  const matches = [...source.matchAll(expression)];
  if (matches.length !== 1) {
    throw new Error(`Source benchmark anchor must match exactly one declaration; found ${matches.length}`);
  }
  const match = matches[0];
  const valueStart = match.index! + match[0].lastIndexOf(anchor.from);
  return { valueStart, valueEnd: valueStart + anchor.from.length };
};

const sampleWaiter = (
  dependencies: BrowserBenchmarkCaptureDependencies,
  expected: BenchmarkSampleHandle,
  context: BenchmarkRunContext
): Promise<CompletedBenchmarkSample> => new Promise((resolve, reject) => {
  let finished = false;
  let unsubscribe: (() => void) | null = null;
  const timeout = { id: 0 };
  const finish = (callback: () => void) => {
    if (finished) return;
    finished = true;
    window.clearTimeout(timeout.id);
    unsubscribe?.();
    callback();
  };
  const accept = (sample: CompletedBenchmarkSample) => {
    if (finished) return;
    if (sample.sampleId !== expected.sampleId || sample.scenarioId !== expected.scenarioId) {
      finish(() => reject(new Error("Received stale or wrong benchmark sample completion")));
      return;
    }
    finish(() => resolve(sample));
  };
  timeout.id = window.setTimeout(() => finish(() => reject(new Error(
    `Benchmark sample completion timed out: scenario=${context.scenarioId}, ` +
    `sampleId=${expected.sampleId}, phase=${context.phase}, iteration=${context.iteration}`
  ))), SAMPLE_COMPLETION_GUARD_TIMEOUT_MS);
  const subscription = dependencies.instrumentation.subscribeSamples(accept);
  if (finished) subscription();
  else unsubscribe = subscription;
  const queued = dependencies.instrumentation.drainSamples();
  if (queued.length > 0) {
    if (queued.length !== 1) finish(() => reject(new Error("Multiple benchmark sample completions were queued")));
    else accept(queued[0]);
  }
});

const defaultInstrumentation = (): BrowserBenchmarkCaptureDependencies["instrumentation"] => ({
  beginSample: beginBenchmarkSample,
  abortSample: abortBenchmarkSample,
  drainSamples: drainCompletedBenchmarkSamples,
  subscribeSamples: subscribeCompletedBenchmarkSamples
});

export const runBrowserBenchmarkCapture = async ({
  config,
  dependencies
}: BrowserBenchmarkCaptureRunInput): Promise<BenchmarkResult> => {
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
      throw new Error(`Benchmark render surface changed during capture: expected ${JSON.stringify(initialSurface)}, received ${JSON.stringify(current)}`);
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
      if (!renderSurfaceIsCoherent(surface)) throw new Error(`Benchmark render surface is incoherent: ${JSON.stringify(surface)}`);
    }
    if (initialSurface === null) initialSurface = surface;
    else if (!sameRenderSurface(initialSurface, surface)) {
      throw new Error(`Benchmark render surface changed during capture: expected ${JSON.stringify(initialSurface)}, received ${JSON.stringify(surface)}`);
    }
  };

  const host: BenchmarkCaptureHost<
    | { kind: "source" }
    | { kind: "pointer"; pointerId: number; viewport: HTMLElement; coordinates: { start: { clientX: number; clientY: number }; end: { clientX: number; clientY: number } } }
  > = {
    reset: () => {
      dependencies.instrumentation.abortSample();
      dependencies.instrumentation.drainSamples();
      dependencies.clearPreview();
      dependencies.resetCanvasViewport();
      dependencies.replaceTextDocument(config.fixtureSource);
      const document = dependencies.getDocumentSnapshot();
      if (document.sourceText !== config.fixtureSource || document.docText !== config.fixtureSource) throw new Error("Benchmark fixture reset did not produce an exact valid document");
      resetRevision = document.compiledDocumentRevision;
      resetFrame = dependencies.frameObserver.waitForCurrentDrawAndFrame(resetRevision);
      if (initialSurface !== null) verifySurface();
    },
    settle: async () => {
      if (resetRevision === null || resetFrame === null) throw new Error("Benchmark settle started before reset");
      try {
        await withGuardTimeout(Promise.all([
          dependencies.waitForRustEvaluation(resetRevision),
          resetFrame.promise
        ]).then(() => undefined), "settle");
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
      const anchor = scenarioId === "point-drag-v1" ? config.fixture.anchors.pointDrag : config.fixture.anchors.bezierHandleDrag;
      if (scenarioId === "bezier-handle-drag-v1" && config.fixture.anchors.bezierHandleDrag.handleRole !== "start") throw new Error(`Unsupported benchmark Bezier handle role: ${config.fixture.anchors.bezierHandleDrag.handleRole}`);
      const document = dependencies.getDocumentSnapshot();
      const target = resolveFixtureElement(document.elements, anchor.elementPath);
      if (scenarioId === "point-drag-v1" && !isPointElement(target)) throw new Error(`Benchmark point target has unexpected type: ${target.type}`);
      if (scenarioId === "bezier-handle-drag-v1" && target.type !== "bezierCurve") throw new Error(`Benchmark curve target has unexpected type: ${target.type}`);
      const ui = dependencies.getUiSnapshot();
      if (ui.selectedElementId !== target.id) {
        const frame = dependencies.frameObserver.waitForCurrentDrawAndFrame(document.compiledDocumentRevision);
        dependencies.setSelectedElementId(target.id);
        try { await withGuardTimeout(frame.promise, "selection settle"); }
        catch (error) { frame.cancel(); throw error; }
      }
      const snapshot = dependencies.getEvaluationSnapshot();
      assertCurrentRustEvaluation(snapshot, document.compiledDocumentRevision);
      const geometry = snapshot.evaluation.computedGeometry.get(target.id);
      if (!geometry) throw new Error(`Benchmark target has no computed geometry: ${anchor.elementPath}`);
      const viewport = dependencies.getCanvasViewport();
      if (!viewport) throw new Error("Benchmark canvas viewport is unavailable");
      const surface = dependencies.getRenderSurface();
      const rect = viewport.getBoundingClientRect();
      const worldPoint = scenarioId === "point-drag-v1"
        ? geometry.kind === "point" ? geometry : null
        : geometry.kind === "bezierCurve" ? geometry.segments[0]?.control1 : null;
      if (!worldPoint) throw new Error(`Benchmark target geometry cannot provide the requested drag point: ${target.name}`);
      const screen = worldToScreen(worldPoint, { width: surface.cssWidthPx, height: surface.cssHeightPx }, ui.canvasViewport);
      const start = { clientX: rect.left + viewport.clientLeft + screen.x, clientY: rect.top + viewport.clientTop + screen.y };
      const end = { clientX: start.clientX + anchor.pointerDeltaCssPx.x, clientY: start.clientY + anchor.pointerDeltaCssPx.y };
      const currentPointerId = pointerId;
      pointerId += 1;
      dependencies.dispatchPointerEvent(viewport, "pointerdown", start, { pointerId: currentPointerId, button: 0, buttons: 1 });
      return { kind: "pointer", pointerId: currentPointerId, viewport, coordinates: { start, end } };
    },
    beginSample: dependencies.instrumentation.beginSample,
    performAction: (scenarioId, setup) => {
      if (scenarioId === "source-edit-v1") {
        const document = dependencies.getDocumentSnapshot();
        const anchor = config.fixture.anchors.sourceEdit;
        const range = sourceEditRange(document.sourceText, anchor);
        const nextText = `${document.sourceText.slice(0, range.valueStart)}${anchor.to}${document.sourceText.slice(range.valueEnd)}`;
        if (nextText === document.sourceText) throw new Error("Source benchmark action produced no change");
        dependencies.commitText(nextText);
        if (dependencies.getDocumentSnapshot().sourceText !== nextText) throw new Error("Source benchmark action was not committed");
        return;
      }
      if (setup.kind !== "pointer") throw new Error(`Invalid setup for ${scenarioId}`);
      dependencies.dispatchPointerEvent(setup.viewport, "pointermove", setup.coordinates.end, { pointerId: setup.pointerId, button: 0, buttons: 1 });
    },
    awaitCompletedSample: (handle, context) => sampleWaiter(dependencies, handle, context),
    teardownScenario: (scenarioId, setup) => {
      if (scenarioId === "source-edit-v1") return;
      if (setup.kind !== "pointer") throw new Error(`Invalid setup for ${scenarioId}`);
      dependencies.dispatchPointerEvent(setup.viewport, "pointerup", setup.coordinates.end, { pointerId: setup.pointerId, button: 0, buttons: 0 });
    },
    abortBenchmarkSample: dependencies.instrumentation.abortSample
  };

  const samples = await runBenchmarkCapture(host);
  verifySurface();
  return assembleBenchmarkResult({
    target: config.target,
    fixture: { id: config.fixtureId, hash: config.fixtureHash },
    build: { gitCommit: config.build.gitCommit, appVersion: config.build.appVersion },
    environment: {
      machine: config.build.machine,
      webviewUserAgent: config.webviewUserAgent,
      renderSurface: initialSurface ?? dependencies.getRenderSurface()
    },
    samples
  });
};

export const browserBenchmarkDefaultInstrumentation = defaultInstrumentation;

export { waitForCurrentDrawAndFrame };
