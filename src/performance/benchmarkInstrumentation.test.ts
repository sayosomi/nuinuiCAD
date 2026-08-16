import { describe, expect, it, vi } from "vitest";
import type { CadElement, EvaluationResult } from "../types/geometry";
import { createBenchmarkInstrumentation } from "./benchmarkInstrumentation";

const elements = [] as CadElement[];

const evaluation = (): EvaluationResult => ({
  computedGeometry: new Map(),
  errors: [],
  warnings: []
});

const harness = () => {
  let time = 0;
  const now = vi.fn(() => time);
  const frames: Array<(timestamp: number) => void> = [];
  const instrumentation = createBenchmarkInstrumentation({
    now,
    requestAnimationFrame: (callback) => {
      frames.push(callback);
      return frames.length;
    }
  });
  return {
    instrumentation,
    now,
    frames,
    setTime: (nextTime: number) => {
      time = nextTime;
    }
  };
};

describe("benchmark instrumentation", () => {
  it("stays passive without an active sample", () => {
    const { instrumentation, now, frames } = harness();
    const result = evaluation();

    expect(instrumentation.beginSourceChange()).toBeNull();
    expect(instrumentation.beginPreviewMutation()).toBeNull();
    expect(instrumentation.capturePointerMoveEntry()).toBeNull();
    expect(instrumentation.beginRustRoundTrip(elements)).toBeNull();
    expect(instrumentation.measureCanvasDraw(result, true, () => "drawn")).toBe("drawn");

    expect(now).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
  });

  it("arms one sample, records source and Rust/draw timings, and drains once", () => {
    const { instrumentation, frames, setTime } = harness();
    const sample = instrumentation.beginBenchmarkSample("source-edit-v1");
    expect(sample).not.toBeNull();
    expect(instrumentation.beginBenchmarkSample("source-edit-v1")).toBeNull();

    setTime(10);
    const sourceTiming = instrumentation.beginSourceChange();
    setTime(20);
    instrumentation.measureCompile(sourceTiming, () => {
      setTime(25);
      return undefined;
    });
    expect(sourceTiming).not.toBeNull();
    expect(instrumentation.bindElementsToActiveSample(elements, sourceTiming!)).toBe(true);

    setTime(30);
    const attempt = instrumentation.beginRustRoundTrip(elements);
    const result = evaluation();
    setTime(40);
    instrumentation.finishRustRoundTrip(attempt, result);

    setTime(50);
    expect(instrumentation.measureCanvasDraw(result, true, () => {
      setTime(60);
      return "drawn";
    })).toBe("drawn");
    expect(frames).toHaveLength(1);

    frames[0](100);
    expect(instrumentation.drainCompletedBenchmarkSamples()).toEqual([{
      sampleId: sample!.sampleId,
      scenarioId: "source-edit-v1",
      metrics: {
        compileMs: 5,
        rustRoundTripMs: 10,
        canvasDrawMs: 10,
        sourceChangeToFrameMs: 90
      }
    }]);
    expect(instrumentation.drainCompletedBenchmarkSamples()).toEqual([]);
  });

  it("keeps pointer and preview starts separate and shares the draw path", () => {
    const { instrumentation, frames, setTime } = harness();
    instrumentation.beginBenchmarkSample("point-drag-v1");

    setTime(10);
    const previewTiming = instrumentation.beginPreviewMutation();
    expect(instrumentation.bindElementsToActiveSample(elements, previewTiming!)).toBe(true);

    setTime(20);
    const pendingPointerEntry = instrumentation.capturePointerMoveEntry();
    expect(instrumentation.claimPointerMoveEntry(null)).toBe(false);
    setTime(30);
    const pointerEntry = instrumentation.capturePointerMoveEntry();
    expect(instrumentation.claimPointerMoveEntry(pointerEntry)).toBe(true);
    expect(instrumentation.claimPointerMoveEntry(pendingPointerEntry)).toBe(false);

    setTime(40);
    const attempt = instrumentation.beginRustRoundTrip(elements);
    const result = evaluation();
    setTime(50);
    instrumentation.finishRustRoundTrip(attempt, result);
    setTime(60);
    instrumentation.measureCanvasDraw(result, true, () => {
      setTime(65);
    });
    frames[0](100);

    expect(instrumentation.drainCompletedBenchmarkSamples()[0]?.metrics).toEqual({
      pointerMoveToFrameMs: 70,
      previewMutationToFrameMs: 90,
      rustRoundTripMs: 10,
      canvasDrawMs: 5
    });
  });

  it("uses distinct attempts and never lets stale or aborted callbacks close a new sample", () => {
    const { instrumentation, frames, now, setTime } = harness();
    instrumentation.beginBenchmarkSample("source-edit-v1");
    setTime(10);
    const sourceTiming = instrumentation.beginSourceChange();
    instrumentation.measureCompile(sourceTiming, () => undefined);
    instrumentation.bindElementsToActiveSample(elements, sourceTiming!);

    setTime(20);
    const firstAttempt = instrumentation.beginRustRoundTrip(elements);
    const firstEvaluation = evaluation();
    const secondAttempt = instrumentation.beginRustRoundTrip(elements);
    const secondEvaluation = evaluation();
    expect(firstAttempt).not.toBe(secondAttempt);
    setTime(30);
    instrumentation.finishRustRoundTrip(firstAttempt, firstEvaluation);
    instrumentation.finishRustRoundTrip(secondAttempt, secondEvaluation);
    setTime(40);
    instrumentation.measureCanvasDraw(firstEvaluation, true, () => undefined);
    expect(frames).toHaveLength(1);

    instrumentation.abortBenchmarkSample();
    instrumentation.beginBenchmarkSample("source-edit-v1");
    frames[0](100);
    expect(instrumentation.drainCompletedBenchmarkSamples()).toEqual([]);

    setTime(200);
    instrumentation.finishRustRoundTrip(firstAttempt, firstEvaluation);
    instrumentation.measureCanvasDraw(firstEvaluation, false, () => "stale");
    expect(instrumentation.drainCompletedBenchmarkSamples()).toEqual([]);
    expect(now).not.toHaveBeenCalledWith(200);
  });
});
