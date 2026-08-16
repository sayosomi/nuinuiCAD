import type {
  BenchmarkMetricId,
  BenchmarkScenarioId
} from "./benchmarkContract";
import { REQUIRED_METRICS_BY_SCENARIO } from "./benchmarkContract";
import type { CadElement, EvaluationResult } from "../types/geometry";

export type BenchmarkMetrics = Partial<Record<BenchmarkMetricId, number>>;

export type CompletedBenchmarkSample = {
  sampleId: number;
  scenarioId: BenchmarkScenarioId;
  metrics: BenchmarkMetrics;
};

export type CompletedBenchmarkSampleListener = (sample: CompletedBenchmarkSample) => void;

export type BenchmarkSampleHandle = Readonly<{
  sampleId: number;
  scenarioId: BenchmarkScenarioId;
}>;

export type SourceChangeTiming = Readonly<{
  kind: "source";
  sampleId: number;
  startedAt: number;
}>;

export type PreviewMutationTiming = Readonly<{
  kind: "preview";
  sampleId: number;
  startedAt: number;
}>;

export type PointerMoveEntry = Readonly<{
  sampleId: number;
  enteredAt: number;
}>;

export type BenchmarkDragKind = "point" | "bezier-handle";

export type BenchmarkRustAttempt = Readonly<{
  sampleId: number;
  startedAt: number;
  rustRoundTripMs?: number;
}>;

export type BenchmarkInstrumentationDependencies = {
  now?: () => number;
  requestAnimationFrame?: (callback: (timestamp: number) => void) => number;
};

export type BenchmarkInstrumentation = {
  beginBenchmarkSample: (scenarioId: BenchmarkScenarioId) => BenchmarkSampleHandle | null;
  abortBenchmarkSample: () => void;
  drainCompletedBenchmarkSamples: () => CompletedBenchmarkSample[];
  subscribeCompletedBenchmarkSamples: (listener: CompletedBenchmarkSampleListener) => () => void;
  beginSourceChange: () => SourceChangeTiming | null;
  measureCompile: <T>(timing: SourceChangeTiming | null, compile: () => T) => T;
  beginPreviewMutation: () => PreviewMutationTiming | null;
  capturePointerMoveEntry: () => PointerMoveEntry | null;
  claimPointerMoveEntry: (entry: PointerMoveEntry | null, dragKind: BenchmarkDragKind) => boolean;
  bindElementsToActiveSample: (
    elements: CadElement[],
    timing: SourceChangeTiming | PreviewMutationTiming
  ) => boolean;
  beginRustRoundTrip: (elements: CadElement[]) => BenchmarkRustAttempt | null;
  finishRustRoundTrip: (attempt: BenchmarkRustAttempt | null, evaluation: EvaluationResult) => void;
  measureCanvasDraw: <T>(
    evaluation: EvaluationResult,
    isCurrent: boolean,
    draw: () => T
  ) => T;
};

type Sample = {
  sampleId: number;
  scenarioId: BenchmarkScenarioId;
  metrics: BenchmarkMetrics;
  sourceChangeStartedAt?: number;
  previewMutationStartedAt?: number;
  pointerMoveStartedAt?: number;
  frameScheduled: boolean;
};

type ElementBinding = {
  sampleId: number;
};

type RustAttempt = {
  sampleId: number;
  startedAt: number;
  rustRoundTripMs?: number;
};

const isFiniteNonnegative = (value: number): boolean =>
  Number.isFinite(value) && value >= 0;

const durationBetween = (end: number, start: number): number | null => {
  const duration = end - start;
  return isFiniteNonnegative(duration) ? duration : null;
};

const metricIsComplete = (metrics: BenchmarkMetrics, metricId: BenchmarkMetricId): boolean => {
  const value = metrics[metricId];
  return value !== undefined && isFiniteNonnegative(value);
};

export const createBenchmarkInstrumentation = ({
  now = () => performance.now(),
  requestAnimationFrame = (callback) =>
    (globalThis as typeof globalThis & {
      requestAnimationFrame: (frame: (timestamp: number) => void) => number;
    }).requestAnimationFrame(callback)
}: BenchmarkInstrumentationDependencies = {}): BenchmarkInstrumentation => {
  let nextSampleId = 1;
  let activeSample: Sample | null = null;
  const completedSamples: CompletedBenchmarkSample[] = [];
  const completedSampleListeners = new Set<CompletedBenchmarkSampleListener>();
  const elementsToSample = new WeakMap<CadElement[], ElementBinding>();
  const evaluationsToAttempt = new WeakMap<EvaluationResult, RustAttempt>();

  const activeSampleFor = (sampleId: number): Sample | null =>
    activeSample?.sampleId === sampleId ? activeSample : null;

  const setMetric = (sample: Sample, metricId: BenchmarkMetricId, value: number | null): void => {
    if (value !== null && isFiniteNonnegative(value)) sample.metrics[metricId] = value;
  };

  const beginBenchmarkSample = (scenarioId: BenchmarkScenarioId): BenchmarkSampleHandle | null => {
    if (activeSample) return null;
    const sample: Sample = {
      sampleId: nextSampleId,
      scenarioId,
      metrics: {},
      frameScheduled: false
    };
    nextSampleId += 1;
    activeSample = sample;
    return { sampleId: sample.sampleId, scenarioId: sample.scenarioId };
  };

  const abortBenchmarkSample = (): void => {
    activeSample = null;
  };

  const drainCompletedBenchmarkSamples = (): CompletedBenchmarkSample[] =>
    completedSamples.splice(0, completedSamples.length);

  const subscribeCompletedBenchmarkSamples = (
    listener: CompletedBenchmarkSampleListener
  ): (() => void) => {
    completedSampleListeners.add(listener);
    return () => completedSampleListeners.delete(listener);
  };

  const beginSourceChange = (): SourceChangeTiming | null => {
    const sample = activeSample;
    if (!sample || sample.scenarioId !== "source-edit-v1" || sample.sourceChangeStartedAt !== undefined) {
      return null;
    }
    const startedAt = now();
    sample.sourceChangeStartedAt = startedAt;
    return { kind: "source", sampleId: sample.sampleId, startedAt };
  };

  const measureCompile = <T>(timing: SourceChangeTiming | null, compile: () => T): T => {
    const sample = timing ? activeSampleFor(timing.sampleId) : null;
    if (!sample || timing?.kind !== "source") return compile();

    const startedAt = now();
    try {
      return compile();
    } finally {
      const finishedAt = now();
      if (activeSampleFor(timing.sampleId) === sample) {
        setMetric(sample, "compileMs", durationBetween(finishedAt, startedAt));
      }
    }
  };

  const beginPreviewMutation = (): PreviewMutationTiming | null => {
    const sample = activeSample;
    if (
      !sample ||
      (sample.scenarioId !== "point-drag-v1" && sample.scenarioId !== "bezier-handle-drag-v1") ||
      sample.pointerMoveStartedAt === undefined ||
      sample.previewMutationStartedAt !== undefined
    ) {
      return null;
    }
    const startedAt = now();
    sample.previewMutationStartedAt = startedAt;
    return { kind: "preview", sampleId: sample.sampleId, startedAt };
  };

  const capturePointerMoveEntry = (): PointerMoveEntry | null => {
    const sample = activeSample;
    if (
      !sample ||
      (sample.scenarioId !== "point-drag-v1" && sample.scenarioId !== "bezier-handle-drag-v1")
    ) {
      return null;
    }
    return { sampleId: sample.sampleId, enteredAt: now() };
  };

  const claimPointerMoveEntry = (
    entry: PointerMoveEntry | null,
    dragKind: BenchmarkDragKind
  ): boolean => {
    if (!entry) return false;
    const sample = activeSampleFor(entry.sampleId);
    if (!sample || sample.pointerMoveStartedAt !== undefined) return false;
    const expectedScenario = dragKind === "point"
      ? "point-drag-v1"
      : "bezier-handle-drag-v1";
    if (sample.scenarioId !== expectedScenario) return false;
    sample.pointerMoveStartedAt = entry.enteredAt;
    return true;
  };

  const bindElementsToActiveSample = (
    elements: CadElement[],
    timing: SourceChangeTiming | PreviewMutationTiming
  ): boolean => {
    const sample = activeSampleFor(timing.sampleId);
    if (!sample) return false;
    if (timing.kind === "source" && sample.scenarioId !== "source-edit-v1") return false;
    if (
      timing.kind === "preview" &&
      sample.scenarioId !== "point-drag-v1" &&
      sample.scenarioId !== "bezier-handle-drag-v1"
    ) return false;
    elementsToSample.set(elements, { sampleId: sample.sampleId });
    return true;
  };

  const beginRustRoundTrip = (elements: CadElement[]): BenchmarkRustAttempt | null => {
    const sample = activeSample;
    const binding = elementsToSample.get(elements);
    if (!sample || !binding || binding.sampleId !== sample.sampleId) return null;
    const attempt: RustAttempt = {
      sampleId: sample.sampleId,
      startedAt: now()
    };
    return attempt;
  };

  const finishRustRoundTrip = (
    attempt: BenchmarkRustAttempt | null,
    evaluation: EvaluationResult
  ): void => {
    if (!attempt) return;
    const sample = activeSampleFor(attempt.sampleId);
    if (!sample) return;
    const finishedAt = now();
    const rustRoundTripMs = durationBetween(finishedAt, attempt.startedAt);
    if (rustRoundTripMs === null) return;
    const mutableAttempt = attempt as RustAttempt;
    mutableAttempt.rustRoundTripMs = rustRoundTripMs;
    evaluationsToAttempt.set(evaluation, mutableAttempt);
  };

  const completeAfterFrame = (sample: Sample, frameTimestamp: number): void => {
    if (activeSample !== sample) return;

    const frameMetric = sample.scenarioId === "source-edit-v1"
      ? ["sourceChangeToFrameMs"] as const
      : ["pointerMoveToFrameMs", "previewMutationToFrameMs"] as const;
    const frameStart = sample.scenarioId === "source-edit-v1"
      ? sample.sourceChangeStartedAt
      : sample.pointerMoveStartedAt;
    const previewStart = sample.previewMutationStartedAt;
    if (frameStart === undefined) {
      activeSample = null;
      return;
    }
    setMetric(sample, frameMetric[0], durationBetween(frameTimestamp, frameStart));
    if (sample.scenarioId !== "source-edit-v1") {
      setMetric(sample, "previewMutationToFrameMs", previewStart === undefined
        ? null
        : durationBetween(frameTimestamp, previewStart));
    }

    const requiredMetrics = REQUIRED_METRICS_BY_SCENARIO[sample.scenarioId];
    if (requiredMetrics.every((metricId) => metricIsComplete(sample.metrics, metricId))) {
      const completedSample = {
        sampleId: sample.sampleId,
        scenarioId: sample.scenarioId,
        metrics: { ...sample.metrics }
      } satisfies CompletedBenchmarkSample;
      completedSamples.push(completedSample);
      for (const listener of completedSampleListeners) listener(completedSample);
    }
    activeSample = null;
  };

  const measureCanvasDraw = <T>(
    evaluation: EvaluationResult,
    isCurrent: boolean,
    draw: () => T
  ): T => {
    const attempt = evaluationsToAttempt.get(evaluation);
    const sample = attempt ? activeSampleFor(attempt.sampleId) : null;
    if (!sample || !isCurrent || sample.frameScheduled || attempt?.rustRoundTripMs === undefined) {
      return draw();
    }

    const startedAt = now();
    const result = draw();
    const finishedAt = now();
    if (activeSample !== sample || sample.frameScheduled) return result;

    setMetric(sample, "rustRoundTripMs", attempt.rustRoundTripMs);
    setMetric(sample, "canvasDrawMs", durationBetween(finishedAt, startedAt));
    sample.frameScheduled = true;
    requestAnimationFrame((frameTimestamp) => completeAfterFrame(sample, frameTimestamp));
    return result;
  };

  return {
    beginBenchmarkSample,
    abortBenchmarkSample,
    drainCompletedBenchmarkSamples,
    subscribeCompletedBenchmarkSamples,
    beginSourceChange,
    measureCompile,
    beginPreviewMutation,
    capturePointerMoveEntry,
    claimPointerMoveEntry,
    bindElementsToActiveSample,
    beginRustRoundTrip,
    finishRustRoundTrip,
    measureCanvasDraw
  };
};

const productionBenchmarkInstrumentation = createBenchmarkInstrumentation();

export const {
  beginBenchmarkSample,
  abortBenchmarkSample,
  drainCompletedBenchmarkSamples,
  subscribeCompletedBenchmarkSamples,
  beginSourceChange,
  measureCompile,
  beginPreviewMutation,
  capturePointerMoveEntry,
  claimPointerMoveEntry,
  bindElementsToActiveSample,
  beginRustRoundTrip,
  finishRustRoundTrip,
  measureCanvasDraw
} = productionBenchmarkInstrumentation;
