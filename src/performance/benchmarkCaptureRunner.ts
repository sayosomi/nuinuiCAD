import {
  BENCHMARK_PROTOCOL,
  BENCHMARK_SCENARIO_IDS,
  type BenchmarkScenarioId
} from "./benchmarkContract";
import type {
  BenchmarkSampleHandle,
  CompletedBenchmarkSample
} from "./benchmarkInstrumentation";

export type BenchmarkRunPhase = "warmup" | "measured";

export type BenchmarkRunContext = {
  scenarioId: BenchmarkScenarioId;
  phase: BenchmarkRunPhase;
  iteration: number;
  runIndex: number;
};

export type BenchmarkCaptureHost<Setup = unknown> = {
  reset: (context: BenchmarkRunContext) => Promise<void> | void;
  settle: (context: BenchmarkRunContext) => Promise<void> | void;
  setupScenario: (
    scenarioId: BenchmarkScenarioId,
    context: BenchmarkRunContext
  ) => Promise<Setup> | Setup;
  beginSample: (scenarioId: BenchmarkScenarioId) => BenchmarkSampleHandle | null;
  performAction: (
    scenarioId: BenchmarkScenarioId,
    setup: Setup,
    context: BenchmarkRunContext
  ) => Promise<void> | void;
  awaitCompletedSample: (
    handle: BenchmarkSampleHandle,
    context: BenchmarkRunContext
  ) => Promise<CompletedBenchmarkSample>;
  teardownScenario: (
    scenarioId: BenchmarkScenarioId,
    setup: Setup,
    context: BenchmarkRunContext
  ) => Promise<void> | void;
  abortBenchmarkSample: () => void;
};

const assertMatchingCompletion = (
  expected: BenchmarkSampleHandle,
  completed: CompletedBenchmarkSample
): CompletedBenchmarkSample => {
  if (completed.sampleId !== expected.sampleId || completed.scenarioId !== expected.scenarioId) {
    throw new Error(
      `Benchmark sample completion mismatch: expected ${expected.scenarioId}#${expected.sampleId}, ` +
      `received ${completed.scenarioId}#${completed.sampleId}`
    );
  }
  return completed;
};

/** Execute the frozen benchmark protocol without importing any host or UI state. */
export const runBenchmarkCapture = async <Setup = unknown>(
  host: BenchmarkCaptureHost<Setup>
): Promise<CompletedBenchmarkSample[]> => {
  const measuredSamples: CompletedBenchmarkSample[] = [];
  let runIndex = 0;

  for (const scenarioId of BENCHMARK_SCENARIO_IDS) {
    for (const phase of ["warmup", "measured"] as const) {
      const runCount = phase === "warmup"
        ? BENCHMARK_PROTOCOL.warmupRuns
        : BENCHMARK_PROTOCOL.trials;

      for (let iteration = 0; iteration < runCount; iteration += 1) {
        const context: BenchmarkRunContext = {
          scenarioId,
          phase,
          iteration,
          runIndex
        };
        runIndex += 1;

        let setupStarted = false;
        let setup: Setup | undefined;
        let activeSample: BenchmarkSampleHandle | null = null;
        let failure: unknown = null;

        try {
          await host.reset(context);
          await host.settle(context);
          setupStarted = true;
          setup = await host.setupScenario(scenarioId, context);

          activeSample = host.beginSample(scenarioId);
          if (!activeSample) {
            throw new Error(`Unable to begin benchmark sample for ${scenarioId}`);
          }

          await host.performAction(scenarioId, setup, context);
          const completed = await host.awaitCompletedSample(activeSample, context);
          assertMatchingCompletion(activeSample, completed);
          if (phase === "measured") measuredSamples.push(completed);
        } catch (error) {
          failure = error;
          if (activeSample) host.abortBenchmarkSample();
        } finally {
          if (setupStarted && setup !== undefined) {
            try {
              await host.teardownScenario(scenarioId, setup, context);
            } catch (error) {
              if (failure === null) failure = error;
            }
          }
        }

        if (failure !== null) throw failure;
      }
    }
  }

  return measuredSamples;
};
