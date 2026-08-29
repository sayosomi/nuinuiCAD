import { describe, expect, it } from "vitest";
import {
  BENCHMARK_PROTOCOL,
  BENCHMARK_SCENARIO_IDS,
  REQUIRED_METRICS_BY_SCENARIO
} from "./benchmarkContract";
import type { CompletedBenchmarkSample } from "./benchmarkInstrumentation";
import { assembleBenchmarkResult } from "./benchmarkResultAssembly";
import { isBenchmarkResult } from "./benchmarkResultSchema";

const samples = (): CompletedBenchmarkSample[] => BENCHMARK_SCENARIO_IDS.flatMap((scenarioId) =>
  Array.from({ length: BENCHMARK_PROTOCOL.trials }, (_, index) => ({
    sampleId: index + 1,
    scenarioId,
    metrics: Object.fromEntries(REQUIRED_METRICS_BY_SCENARIO[scenarioId].map((metricId) => [metricId, index + 1]))
  }))
);

const input = (overrides: Partial<Parameters<typeof assembleBenchmarkResult>[0]> = {}) => ({
  fixture: { id: "interactive-medium-v1", hash: `sha256:${"a".repeat(64)}` },
  build: { gitCommit: "a".repeat(40), appVersion: "0.0.0" },
  environment: {
    machine: { platform: "darwin", arch: "arm64", osRelease: "test", cpuModel: "test", logicalCpuCount: 8 },
    webviewUserAgent: "test-agent",
    renderSurface: { cssWidthPx: 1000, cssHeightPx: 700, backingWidthPx: 2000, backingHeightPx: 1400, devicePixelRatio: 2 }
  },
  samples: samples(),
  capturedAt: "2026-08-16T00:00:00.000Z",
  ...overrides
});

describe("benchmark result assembly", () => {
  it("assembles a schema-valid result with exactly 21 measured samples", () => {
    const result = assembleBenchmarkResult(input());
    expect(isBenchmarkResult(result)).toBe(true);
    expect(result.target).toBe("vscode");
    expect(result.protocol).toEqual(BENCHMARK_PROTOCOL);
    expect(result.scenarios["source-edit-v1"]?.metrics.compileMs.samples).toHaveLength(BENCHMARK_PROTOCOL.trials);
    expect(result.scenarios["source-edit-v1"]?.metrics.compileMs.p50).toBe(11);
    expect(result.scenarios["source-edit-v1"]?.metrics.compileMs.p95).toBe(20);
    expect(result.scenarios["source-edit-v1"]?.metrics.compileMs.max).toBe(21);
  });

  it("assembles the same schema for the VS Code target", () => {
    const result = assembleBenchmarkResult(input({ target: "vscode" }));
    expect(result.target).toBe("vscode");
    expect(result.protocol).toEqual(BENCHMARK_PROTOCOL);
    expect(Object.keys(result.scenarios)).toEqual([...BENCHMARK_SCENARIO_IDS]);
  });

  it("preserves the explicit historical Tauri target", () => {
    const result = assembleBenchmarkResult(input({ target: "tauri" }));
    expect(isBenchmarkResult(result)).toBe(true);
    expect(result.target).toBe("tauri");
  });

  it("fails closed for wrong counts, missing metrics, and invalid samples", () => {
    expect(() => assembleBenchmarkResult(input({ samples: samples().slice(1) }))).toThrow("exactly 21");
    const missing = samples().map((sample) => ({ ...sample, metrics: { ...sample.metrics } }));
    delete missing[0]!.metrics.compileMs;
    expect(() => assembleBenchmarkResult(input({ samples: missing }))).toThrow("finite nonnegative compileMs");
    const invalid = samples().map((sample) => ({ ...sample, metrics: { ...sample.metrics } }));
    invalid[0]!.metrics.compileMs = -1;
    expect(() => assembleBenchmarkResult(input({ samples: invalid }))).toThrow("finite nonnegative compileMs");
  });
});
