import {
  BENCHMARK_PROTOCOL,
  BENCHMARK_SCHEMA_VERSION,
  BENCHMARK_SCENARIO_IDS,
  REQUIRED_METRICS_BY_SCENARIO,
  type BenchmarkScenarioId
} from "./benchmarkContract";
import type { CompletedBenchmarkSample } from "./benchmarkInstrumentation";
import {
  assertBenchmarkResult,
  type BenchmarkMachine,
  type BenchmarkRenderSurface,
  type BenchmarkResult
} from "./benchmarkResultSchema";
import { calculateBenchmarkStatistics } from "./benchmarkStatistics";

export type BenchmarkResultTarget = "tauri" | "vscode";

export type BenchmarkResultAssemblyInput = {
  target?: BenchmarkResultTarget;
  fixture: { id: string; hash: string };
  build: { gitCommit: string; appVersion: string };
  environment: {
    machine: BenchmarkMachine;
    webviewUserAgent: string;
    renderSurface: BenchmarkRenderSurface;
  };
  samples: readonly CompletedBenchmarkSample[];
  capturedAt?: string;
};

const isFiniteNonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const samplesForScenario = (
  samples: readonly CompletedBenchmarkSample[],
  scenarioId: BenchmarkScenarioId
) => samples.filter((sample) => sample.scenarioId === scenarioId);

export const assembleBenchmarkResult = ({
  target = "tauri",
  fixture,
  build,
  environment,
  samples,
  capturedAt = new Date().toISOString()
}: BenchmarkResultAssemblyInput): BenchmarkResult => {
  const scenarios = {} as BenchmarkResult["scenarios"];

  for (const scenarioId of BENCHMARK_SCENARIO_IDS) {
    const scenarioSamples = samplesForScenario(samples, scenarioId);
    if (scenarioSamples.length !== BENCHMARK_PROTOCOL.trials) {
      throw new Error(
        `${scenarioId} requires exactly ${BENCHMARK_PROTOCOL.trials} measured samples; ` +
        `received ${scenarioSamples.length}`
      );
    }

    const metrics: Record<string, ReturnType<typeof calculateBenchmarkStatistics>> = {};
    for (const metricId of REQUIRED_METRICS_BY_SCENARIO[scenarioId]) {
      const metricSamples = scenarioSamples.map((sample, index) => {
        const value = sample.metrics[metricId];
        if (!isFiniteNonnegative(value)) {
          throw new Error(
            `${scenarioId} sample ${index + 1} is missing a finite nonnegative ${metricId}`
          );
        }
        return value;
      });
      metrics[metricId] = calculateBenchmarkStatistics(metricSamples);
    }
    scenarios[scenarioId] = { metrics };
  }

  const result: BenchmarkResult = {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    target,
    capturedAt,
    build,
    environment,
    fixture,
    protocol: BENCHMARK_PROTOCOL,
    scenarios
  };
  assertBenchmarkResult(result);
  return result;
};
