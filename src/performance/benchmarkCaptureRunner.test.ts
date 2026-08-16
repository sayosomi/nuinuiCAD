import { describe, expect, it } from "vitest";
import {
  BENCHMARK_PROTOCOL,
  BENCHMARK_SCENARIO_IDS
} from "./benchmarkContract";
import { runBenchmarkCapture } from "./benchmarkCaptureRunner";
import type { CompletedBenchmarkSample } from "./benchmarkInstrumentation";

const completed = (sampleId: number, scenarioId: CompletedBenchmarkSample["scenarioId"]): CompletedBenchmarkSample => ({
  sampleId,
  scenarioId,
  metrics: { compileMs: 1 }
});

describe("benchmark capture runner", () => {
  it("runs warmups and measured trials in scenario order and discards warmups", async () => {
    const events: string[] = [];
    let nextSampleId = 1;
    const samples: CompletedBenchmarkSample[] = [];
    const result = await runBenchmarkCapture({
      reset: ({ scenarioId, phase, iteration }) => { events.push(`reset:${scenarioId}:${phase}:${iteration}`); },
      settle: ({ scenarioId }) => { events.push(`settle:${scenarioId}`); },
      setupScenario: (scenarioId) => {
        events.push(`setup:${scenarioId}`);
        return { scenarioId };
      },
      beginSample: (scenarioId) => {
        const handle = { sampleId: nextSampleId, scenarioId };
        nextSampleId += 1;
        events.push(`begin:${scenarioId}`);
        return handle;
      },
      performAction: (scenarioId) => { events.push(`action:${scenarioId}`); },
      awaitCompletedSample: async (handle) => {
        events.push(`completion:${handle.scenarioId}`);
        const sample = completed(handle.sampleId, handle.scenarioId);
        samples.push(sample);
        return sample;
      },
      teardownScenario: (scenarioId) => { events.push(`teardown:${scenarioId}`); },
      abortBenchmarkSample: () => events.push("abort")
    });

    expect(result).toHaveLength(BENCHMARK_SCENARIO_IDS.length * BENCHMARK_PROTOCOL.trials);
    expect(samples).toHaveLength(BENCHMARK_SCENARIO_IDS.length * (BENCHMARK_PROTOCOL.warmupRuns + BENCHMARK_PROTOCOL.trials));
    for (const scenarioId of BENCHMARK_SCENARIO_IDS) {
      expect(result.filter((sample) => sample.scenarioId === scenarioId)).toHaveLength(BENCHMARK_PROTOCOL.trials);
    }
    expect(events.slice(0, 7)).toEqual([
      "reset:source-edit-v1:warmup:0",
      "settle:source-edit-v1",
      "setup:source-edit-v1",
      "begin:source-edit-v1",
      "action:source-edit-v1",
      "completion:source-edit-v1",
      "teardown:source-edit-v1"
    ]);
    expect(events.findIndex((event) => event.startsWith("reset:point-drag-v1"))).toBeGreaterThan(0);
    expect(events.findIndex((event) => event.startsWith("reset:bezier-handle-drag-v1"))).toBeGreaterThan(
      events.findIndex((event) => event.startsWith("reset:point-drag-v1"))
    );
  });

  it("accepts only the exact sample completion", async () => {
    let nextSampleId = 1;
    await expect(runBenchmarkCapture({
      reset: () => undefined,
      settle: () => undefined,
      setupScenario: () => undefined,
      beginSample: (scenarioId) => ({ sampleId: nextSampleId++, scenarioId }),
      performAction: () => undefined,
      awaitCompletedSample: async (handle) => completed(handle.sampleId + 1, handle.scenarioId),
      teardownScenario: () => undefined,
      abortBenchmarkSample: () => undefined
    })).rejects.toThrow("completion mismatch");
  });

  it("aborts the active sample and stops after a failed action", async () => {
    let resets = 0;
    let aborts = 0;
    await expect(runBenchmarkCapture({
      reset: () => { resets += 1; },
      settle: () => undefined,
      setupScenario: () => undefined,
      beginSample: (scenarioId) => ({ sampleId: 1, scenarioId }),
      performAction: () => { throw new Error("action failed"); },
      awaitCompletedSample: async () => { throw new Error("must not wait"); },
      teardownScenario: () => undefined,
      abortBenchmarkSample: () => { aborts += 1; }
    })).rejects.toThrow("action failed");
    expect(resets).toBe(1);
    expect(aborts).toBe(1);
  });
});
