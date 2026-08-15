import { assertBenchmarkResult, type BenchmarkResult } from "./benchmarkResultSchema";
import type { BenchmarkStatistics } from "./benchmarkStatistics";

export type BenchmarkMetricComparison = {
  baseline: BenchmarkStatistics;
  candidate: BenchmarkStatistics;
  p95Ratio: number | "n/a";
};

export type BenchmarkScenarioComparison = {
  metrics: Record<string, BenchmarkMetricComparison>;
};

export type BenchmarkComparison = {
  schemaVersion: BenchmarkResult["schemaVersion"];
  fixture: BenchmarkResult["fixture"];
  protocol: BenchmarkResult["protocol"];
  environment: {
    machine: BenchmarkResult["environment"]["machine"];
    renderSurface: BenchmarkResult["environment"]["renderSurface"];
  };
  scenarios: Record<string, BenchmarkScenarioComparison>;
};

const sameValue = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => sameValue(item, right[index]));
  }
  if (typeof left !== "object" || typeof right !== "object") return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    sameValue(leftKeys, rightKeys) &&
    leftKeys.every((key) => sameValue(leftRecord[key], rightRecord[key]))
  );
};

const sortedKeys = (value: Record<string, unknown>): string[] => Object.keys(value).sort();

const requireCompatible = (
  baseline: BenchmarkResult,
  candidate: BenchmarkResult
): void => {
  if (baseline.schemaVersion !== candidate.schemaVersion) {
    throw new Error("Incompatible benchmark results: schemaVersion differs");
  }
  if (baseline.fixture.id !== candidate.fixture.id) {
    throw new Error("Incompatible benchmark results: fixture.id differs");
  }
  if (baseline.fixture.hash !== candidate.fixture.hash) {
    throw new Error("Incompatible benchmark results: fixture.hash differs");
  }
  if (!sameValue(baseline.protocol, candidate.protocol)) {
    throw new Error("Incompatible benchmark results: protocol differs");
  }
  if (!sameValue(baseline.environment.machine, candidate.environment.machine)) {
    throw new Error("Incompatible benchmark results: environment.machine differs");
  }
  if (!sameValue(baseline.environment.renderSurface, candidate.environment.renderSurface)) {
    throw new Error("Incompatible benchmark results: environment.renderSurface differs");
  }

  const baselineScenarioIds = sortedKeys(baseline.scenarios);
  const candidateScenarioIds = sortedKeys(candidate.scenarios);
  if (!sameValue(baselineScenarioIds, candidateScenarioIds)) {
    throw new Error("Incompatible benchmark results: scenario ids differ");
  }
  for (const scenarioId of baselineScenarioIds) {
    const baselineMetricIds = sortedKeys(baseline.scenarios[scenarioId]!.metrics);
    const candidateMetricIds = sortedKeys(candidate.scenarios[scenarioId]!.metrics);
    if (!sameValue(baselineMetricIds, candidateMetricIds)) {
      throw new Error(`Incompatible benchmark results: metric ids differ for ${scenarioId}`);
    }
  }
};

export const compareBenchmarkResults = (
  baselineInput: unknown,
  candidateInput: unknown
): BenchmarkComparison => {
  assertBenchmarkResult(baselineInput);
  assertBenchmarkResult(candidateInput);
  const baseline = baselineInput;
  const candidate = candidateInput;
  requireCompatible(baseline, candidate);

  const scenarios: Record<string, BenchmarkScenarioComparison> = {};
  for (const scenarioId of sortedKeys(baseline.scenarios)) {
    const metrics: Record<string, BenchmarkMetricComparison> = {};
    for (const metricId of sortedKeys(baseline.scenarios[scenarioId]!.metrics)) {
      const baselineMetric = baseline.scenarios[scenarioId]!.metrics[metricId]!;
      const candidateMetric = candidate.scenarios[scenarioId]!.metrics[metricId]!;
      metrics[metricId] = {
        baseline: baselineMetric,
        candidate: candidateMetric,
        p95Ratio: baselineMetric.p95 === 0 ? "n/a" : candidateMetric.p95 / baselineMetric.p95
      };
    }
    scenarios[scenarioId] = { metrics };
  }

  return {
    schemaVersion: baseline.schemaVersion,
    fixture: baseline.fixture,
    protocol: baseline.protocol,
    environment: {
      machine: baseline.environment.machine,
      renderSurface: baseline.environment.renderSurface
    },
    scenarios
  };
};
