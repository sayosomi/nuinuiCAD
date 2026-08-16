import { StrictMode, createRef } from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import type { CadElement, EvaluationResult } from "../types/geometry";
import type { BenchmarkSampleHandle, CompletedBenchmarkSample } from "./benchmarkInstrumentation";
import {
  TauriBenchmarkCaptureRunner,
  type TauriBenchmarkCaptureConfig,
  type TauriBenchmarkCaptureDependencies,
  runTauriBenchmarkCapture
} from "./TauriBenchmarkCaptureRunner";

const machine = { platform: "test", arch: "test", osRelease: "test", cpuModel: "test", logicalCpuCount: 4 };
const source = "nui 4\nconst benchOffset: number = 6\n";
const elements: CadElement[] = [
  { id: "group", name: "Benchmark", type: "group", activity: "visible" },
  { id: "point", name: "DragPoint", type: "freePoint", parentGroupId: "group", activity: "visible", x: 0, y: 0 },
  {
    id: "curve", name: "DragCurve", type: "bezierCurve", parentGroupId: "group", activity: "visible",
    startPoint: { mode: "reference", pointId: "point" }, endPoint: { mode: "coordinate", x: 100, y: 20 },
    startHandleAngleDeg: 0, startHandleLength: 20, intermediatePoints: [], endHandleAngleDeg: 180, endHandleLength: 20
  }
];
const evaluation: EvaluationResult = {
  computedGeometry: new Map([
    ["point", { kind: "point", elementId: "point", name: "DragPoint", x: 0, y: 0 }],
    ["curve", {
      kind: "bezierCurve", elementId: "curve", name: "DragCurve", startPointId: "point", endPointId: null,
      intermediatePointIds: [], segments: [{
        startPointId: "point", endPointId: null,
        start: { kind: "point", elementId: "point", name: "DragPoint", x: 0, y: 0 },
        control1: { x: 20, y: 10 }, control2: { x: 80, y: 10 }, end: { kind: "point", elementId: "end", name: "end", x: 100, y: 20 }
      }], length: 100, startTangentAngleDeg: 0, endTangentAngleDeg: 180,
      startHandleAngleDeg: 0, startHandleLength: 20, endHandleAngleDeg: 180, endHandleLength: 20
    }]
  ]),
  errors: [],
  warnings: []
};

const fixture = (): TauriBenchmarkCaptureConfig["fixture"] => ({
  id: "interactive-medium-v1",
  file: "interactive-medium-v1.nui",
  hash: `sha256:${"a".repeat(64)}`,
  workload: { forGroupIterations: 1, generatedGeometryPerIteration: 1 },
  anchors: {
    sourceEdit: { bindingName: "benchOffset", from: "6", to: "7" },
    pointDrag: { elementPath: "Benchmark::DragPoint", pointerDeltaCssPx: { x: 12, y: 8 } },
    bezierHandleDrag: { elementPath: "Benchmark::DragCurve", handleRole: "start", pointerDeltaCssPx: { x: 12, y: -8 } },
    dependentElementPath: "Benchmark::DragCurve"
  }
});

const config = (overrides: Partial<TauriBenchmarkCaptureConfig> = {}): TauriBenchmarkCaptureConfig => ({
  runId: `test-${Math.random()}`,
  fixtureId: "interactive-medium-v1",
  fixtureHash: `sha256:${"a".repeat(64)}`,
  fixtureSource: source,
  fixture: fixture(),
  resultPath: "/tmp/benchmark-result.json",
  build: { gitCommit: "a".repeat(40), machine },
  ...overrides
});

const fakeDependencies = (overrides: Partial<TauriBenchmarkCaptureDependencies> = {}) => {
  let currentSource = source;
  let revision = 1;
  let selectedElementId: string | null = null;
  let currentSample: BenchmarkSampleHandle | null = null;
  let nextSampleId = 1;
  const queuedSamples: CompletedBenchmarkSample[] = [];
  const listeners = new Set<(sample: CompletedBenchmarkSample) => void>();
  const events: Array<{ type: string; x?: number; y?: number; pointerId?: number; buttons?: number }> = [];
  const complete = () => {
    if (!currentSample) return;
    const sample = { ...currentSample, metrics: {
      compileMs: 1, rustRoundTripMs: 2, canvasDrawMs: 3,
      sourceChangeToFrameMs: 4, pointerMoveToFrameMs: 5, previewMutationToFrameMs: 6
    } };
    queuedSamples.push(sample);
    for (const listener of listeners) listener(sample);
  };
  const viewport = document.createElement("div");
  Object.defineProperty(viewport, "clientLeft", { value: 0 });
  viewport.getBoundingClientRect = () => ({ left: 10, top: 20, width: 1000, height: 700, right: 1010, bottom: 720, x: 10, y: 20, toJSON: () => ({}) });
  const deps: TauriBenchmarkCaptureDependencies = {
    instrumentation: {
      beginSample: (scenarioId) => {
        currentSample = { sampleId: nextSampleId, scenarioId };
        nextSampleId += 1;
        return currentSample;
      },
      abortSample: () => { currentSample = null; },
      drainSamples: () => queuedSamples.splice(0, queuedSamples.length),
      subscribeSamples: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    },
    frameObserver: { waitForCurrentDrawAndFrame: () => ({ revision, promise: Promise.resolve(), cancel: vi.fn() }) },
    getDocumentSnapshot: () => ({ sourceText: currentSource, docText: currentSource, compiledDocumentRevision: revision, elements }),
    replaceTextDocument: (nextSource) => { currentSource = nextSource; revision += 1; selectedElementId = null; },
    commitText: (nextSource) => { currentSource = nextSource; revision += 1; complete(); },
    clearPreview: vi.fn(),
    resetCanvasViewport: vi.fn(),
    getUiSnapshot: () => ({ selectedElementId, canvasViewport: { panX: 0, panY: 0, zoom: 1 } }),
    setSelectedElementId: (id) => { selectedElementId = id; },
    getCanvasViewport: () => viewport,
    getEvaluationSnapshot: () => ({
      evaluation,
      evaluationState: {
        evaluation, evaluationRevision: revision, evaluationRequestRevision: revision,
        mode: "rust", source: "rust", status: "ready", rustEligible: true, isStale: false, error: null
      } satisfies EvaluationEngineState,
      compiledDocumentRevision: revision
    }),
    waitForRustEvaluation: async () => undefined,
    getRenderSurface: () => ({ cssWidthPx: 1000, cssHeightPx: 700, backingWidthPx: 2000, backingHeightPx: 1400, devicePixelRatio: 2 }),
    dispatchPointerEvent: (_viewport, type, point, options) => {
      events.push({ type, x: point.clientX, y: point.clientY, pointerId: options.pointerId, buttons: options.buttons });
      if (type === "pointermove") complete();
    },
    getAppVersion: async () => "0.0.0",
    writeFile: async () => undefined,
    closeWindow: async () => undefined,
    ...overrides
  };
  return { deps, events };
};

describe("Tauri benchmark capture runner", () => {
  it("does nothing without benchmark config", () => {
    const closeWindow = vi.fn();
    const { deps } = fakeDependencies({ closeWindow });
    render(
      <TauriBenchmarkCaptureRunner
        config={null}
        evaluation={evaluation}
        evaluationState={fakeDependencies().deps.getEvaluationSnapshot().evaluationState}
        compiledDocumentRevision={1}
        canvasFocusRef={createRef()}
        dependencies={deps}
      />
    );
    expect(closeWindow).not.toHaveBeenCalled();
  });

  it("uses production reset/commit boundaries and one real pointer event per drag action", async () => {
    const base = fakeDependencies();
    const replaceTextDocument = vi.fn(base.deps.replaceTextDocument);
    const commitText = vi.fn(base.deps.commitText);
    const deps = { ...base.deps, replaceTextDocument, commitText };
    const { events } = base;
    const result = await runTauriBenchmarkCapture({ config: config(), dependencies: deps });
    expect(result.target).toBe("tauri");
    expect(replaceTextDocument).toHaveBeenCalled();
    expect(commitText).toHaveBeenCalled();
    expect(events.filter((event) => event.type === "pointermove")).toHaveLength(52);
    const pointDown = events.find((event) => event.type === "pointerdown" && event.pointerId === 10_000)!;
    const pointMove = events.find((event) => event.type === "pointermove" && event.pointerId === 10_000)!;
    expect(pointMove.x! - pointDown.x!).toBe(12);
    expect(pointMove.y! - pointDown.y!).toBe(8);
    const curveDown = events.find((event) => event.type === "pointerdown" && event.pointerId === 10_026)!;
    const curveMove = events.find((event) => event.type === "pointermove" && event.pointerId === 10_026)!;
    expect(curveDown.x).toBe(530);
    expect(curveDown.y).toBe(360);
    expect(curveMove.x! - curveDown.x!).toBe(12);
    expect(curveMove.y! - curveDown.y!).toBe(-8);
  });

  it("fails closed for reference evaluation, changed surface, wrong target type, and bad source anchors", async () => {
    const reference = fakeDependencies().deps.getEvaluationSnapshot();
    const referenceDeps = fakeDependencies({
      getEvaluationSnapshot: () => ({ ...reference, evaluationState: { ...reference.evaluationState, source: "reference" } })
    }).deps;
    await expect(runTauriBenchmarkCapture({ config: config(), dependencies: referenceDeps })).rejects.toThrow("Rust");

    let surfaceCall = 0;
    const surfaceDeps = fakeDependencies({
      getRenderSurface: () => {
        surfaceCall += 1;
        return surfaceCall === 1
          ? { cssWidthPx: 1000, cssHeightPx: 700, backingWidthPx: 2000, backingHeightPx: 1400, devicePixelRatio: 2 }
          : { cssWidthPx: 999, cssHeightPx: 700, backingWidthPx: 1998, backingHeightPx: 1400, devicePixelRatio: 2 };
      }
    }).deps;
    await expect(runTauriBenchmarkCapture({ config: config(), dependencies: surfaceDeps })).rejects.toThrow("surface changed");

    const badSource = config({ fixtureSource: "nui 4\nconst benchOffset: number = 6\nconst benchOffset: number = 6\n" });
    await expect(runTauriBenchmarkCapture({ config: badSource, dependencies: fakeDependencies().deps })).rejects.toThrow("exactly one");
    const missingTarget = config({ fixture: {
      ...fixture(),
      anchors: { ...fixture().anchors, pointDrag: { ...fixture().anchors.pointDrag, elementPath: "Benchmark::Missing" } }
    } });
    await expect(runTauriBenchmarkCapture({ config: missingTarget, dependencies: fakeDependencies().deps })).rejects.toThrow("missing");
  });

  it("claims a StrictMode runId only once", async () => {
    const { deps } = fakeDependencies();
    const closeWindow = vi.fn(async () => undefined);
    const runId = `strict-${Date.now()}-${Math.random()}`;
    render(
      <StrictMode>
        <TauriBenchmarkCaptureRunner
          config={config({ runId })}
          evaluation={evaluation}
          evaluationState={deps.getEvaluationSnapshot().evaluationState}
          compiledDocumentRevision={1}
          canvasFocusRef={createRef()}
          dependencies={{ ...deps, closeWindow }}
        />
      </StrictMode>
    );
    await waitFor(() => expect(closeWindow).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });
});
