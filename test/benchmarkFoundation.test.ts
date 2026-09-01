import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BENCHMARK_SCENARIO_IDS,
  BENCHMARK_PROTOCOL,
  REQUIRED_METRICS_BY_SCENARIO
} from "../src/performance/benchmarkContract";
import {
  calculateBenchmarkStatistics,
  type BenchmarkStatistics
} from "../src/performance/benchmarkStatistics";
import {
  assertBenchmarkFixtureManifest,
  parseBenchmarkFixtureManifest
} from "../src/performance/benchmarkFixtureManifest";
import {
  assertBenchmarkResult,
  validateBenchmarkResult,
  type BenchmarkResult
} from "../src/performance/benchmarkResultSchema";
import { compareBenchmarkResults } from "../src/performance/benchmarkComparison";

const samples = (scale = 1): number[] =>
  Array.from({ length: BENCHMARK_PROTOCOL.trials }, (_, index) => (index + 1) * scale);

const metric = (scale = 1): BenchmarkStatistics =>
  calculateBenchmarkStatistics(samples(scale));

const makeResult = (): BenchmarkResult => {
  const scenarios: BenchmarkResult["scenarios"] = {};
  for (const scenarioId of BENCHMARK_SCENARIO_IDS) {
    const metrics: Record<string, BenchmarkStatistics> = {};
    for (const metricId of REQUIRED_METRICS_BY_SCENARIO[scenarioId]) {
      metrics[metricId] = metric();
    }
    scenarios[scenarioId] = { metrics };
  }
  return {
    schemaVersion: 1,
    target: "tauri",
    capturedAt: "2026-08-16T12:00:00.000Z",
    build: {
      gitCommit: "0123456789abcdef0123456789abcdef01234567",
      appVersion: "0.0.0"
    },
    environment: {
      machine: {
        platform: "darwin",
        arch: "arm64",
        osRelease: "25.0.0",
        cpuModel: "Apple M-series",
        logicalCpuCount: 10
      },
      webviewUserAgent: "benchmark-test-webview",
      renderSurface: {
        cssWidthPx: 1200,
        cssHeightPx: 800,
        backingWidthPx: 2400,
        backingHeightPx: 1600,
        devicePixelRatio: 2
      }
    },
    fixture: {
      id: "interactive-medium-v1",
      hash: "sha256:5ce3d10605cd751f50eea0734e6c9a8ed869bba4454644ce0d0cd2de5234ab15"
    },
    protocol: { ...BENCHMARK_PROTOCOL },
    scenarios
  };
};

const cloneResult = (result: BenchmarkResult): BenchmarkResult =>
  JSON.parse(JSON.stringify(result)) as BenchmarkResult;

const sha256 = (source: string) =>
  `sha256:${createHash("sha256").update(source, "utf8").digest("hex")}`;

describe("benchmark foundation statistics", () => {
  it("uses nearest-rank percentiles for 1..21", () => {
    expect(calculateBenchmarkStatistics(samples())).toEqual({
      samples: samples(),
      p50: 11,
      p95: 20,
      max: 21
    });
  });

  it.each([
    ["empty", []],
    ["negative", [-1, 2]],
    ["NaN", [Number.NaN]],
    ["Infinity", [Number.POSITIVE_INFINITY]]
  ])("rejects %s samples", (_label, input) => {
    expect(() => calculateBenchmarkStatistics(input)).toThrow();
  });
});

describe("benchmark result schema", () => {
  it("accepts a valid v1 result", () => {
    expect(() => assertBenchmarkResult(makeResult())).not.toThrow();
  });

  it.each([
    ["wrong schema version", (result: BenchmarkResult) => { result.schemaVersion = 2 as never; }],
    ["invalid target", (result: BenchmarkResult) => { result.target = "other" as never; }],
    ["bad fixture hash", (result: BenchmarkResult) => { result.fixture.hash = "sha256:BAD"; }],
    ["non-finite metric", (result: BenchmarkResult) => { result.scenarios["source-edit-v1"]!.metrics.compileMs!.samples[0] = Number.NaN; }],
    ["sample count differs from trials", (result: BenchmarkResult) => { result.scenarios["source-edit-v1"]!.metrics.compileMs!.samples.pop(); }],
    ["incorrect p50", (result: BenchmarkResult) => { result.scenarios["source-edit-v1"]!.metrics.compileMs!.p50 = 12; }],
    ["incorrect p95", (result: BenchmarkResult) => { result.scenarios["source-edit-v1"]!.metrics.compileMs!.p95 = 19; }],
    ["incorrect max", (result: BenchmarkResult) => { result.scenarios["source-edit-v1"]!.metrics.compileMs!.max = 20; }]
  ])("rejects %s", (_label, mutate) => {
    const result = makeResult();
    mutate(result);
    expect(validateBenchmarkResult(result).length).toBeGreaterThan(0);
  });
});

describe("benchmark comparison", () => {
  it("compares compatible results and reports candidate/baseline p95 ratio", () => {
    const baseline = makeResult();
    const candidate = cloneResult(baseline);
    candidate.target = "vscode";
    candidate.capturedAt = "2026-08-16T12:01:00.000Z";
    candidate.build.gitCommit = "fedcba9876543210fedcba9876543210fedcba98";
    candidate.environment.webviewUserAgent = "different-webview";
    candidate.scenarios["source-edit-v1"]!.metrics.compileMs = metric(2);
    const comparison = compareBenchmarkResults(baseline, candidate);
    expect(comparison.scenarios["source-edit-v1"]!.metrics.compileMs!.p95Ratio).toBe(2);
  });

  it("rejects incompatible fixture identities", () => {
    const baseline = makeResult();
    const candidate = cloneResult(baseline);
    candidate.fixture.id = "other";
    expect(() => compareBenchmarkResults(baseline, candidate)).toThrow(/Incompatible|Invalid benchmark result/);
  });

  it("reports n/a when baseline p95 is zero", () => {
    const baseline = makeResult();
    const candidate = cloneResult(baseline);
    baseline.scenarios["source-edit-v1"]!.metrics.compileMs =
      calculateBenchmarkStatistics(Array.from({ length: BENCHMARK_PROTOCOL.trials }, () => 0));
    candidate.scenarios["source-edit-v1"]!.metrics.compileMs = metric(2);
    expect(compareBenchmarkResults(baseline, candidate).scenarios["source-edit-v1"]!.metrics.compileMs!.p95Ratio).toBe("n/a");
  });
});

describe("benchmark fixture metadata", () => {
  it("validates manifest, hashes, anchors, and workload metadata without compiling the benchmark corpus", () => {
    const fixtureRoot = resolve(process.cwd(), "performance/fixtures");
    const manifest = parseBenchmarkFixtureManifest(
      JSON.parse(readFileSync(resolve(fixtureRoot, "manifest.json"), "utf8")) as unknown
    );
    expect(() => assertBenchmarkFixtureManifest(manifest)).not.toThrow();
    expect(manifest.fixtures.map((fixture) => fixture.id)).toEqual([
      "interactive-medium-v2",
      "interactive-large-v2",
      "dependency-chain-250-v1",
      "dependency-chain-1000-v1"
    ]);

    for (const fixture of manifest.fixtures) {
      const source = readFileSync(resolve(fixtureRoot, fixture.file), "utf8");
      expect(sha256(source)).toBe(fixture.hash);
      expect(fixture.anchors.sourceEdit).toEqual({
        bindingName: "benchOffset",
        from: "6",
        to: "7"
      });
      expect(fixture.anchors.pointDrag).toEqual({
        elementPath: "Benchmark::DragPoint",
        pointerDeltaCssPx: { x: 12, y: 8 }
      });
      expect(fixture.anchors.bezierHandleDrag).toEqual({
        elementPath: "Benchmark::DragCurve",
        handleRole: "start",
        pointerDeltaCssPx: { x: 12, y: -8 }
      });
      expect(source).toContain("benchOffset: number");
      expect(source).toContain("Benchmark::DragPoint");
      expect(source).toContain("Benchmark::DragCurve");
      const count = source.match(/for i in range\(from: 0, count: (\d+), step: 1\)/)?.[1];
      expect(Number(count)).toBe(fixture.workload.forGroupIterations);
    }

    expect(manifest.fixtures.find((fixture) => fixture.id === "interactive-medium-v2")?.anchors.dependentElementPath)
      .toBe("Benchmark::DependentOffset");
    expect(manifest.fixtures.find((fixture) => fixture.id === "interactive-large-v2")?.anchors.dependentElementPath)
      .toBe("Benchmark::DependentOffset");
    expect(manifest.fixtures.find((fixture) => fixture.id === "dependency-chain-250-v1")?.anchors.dependentElementPath)
      .toBe("P0249");
    expect(manifest.fixtures.find((fixture) => fixture.id === "dependency-chain-1000-v1")?.anchors.dependentElementPath)
      .toBe("P0999");
  });

  it("preserves historical interactive v1 fixture identities", () => {
    const fixtureRoot = resolve(process.cwd(), "performance/fixtures");
    expect(sha256(readFileSync(resolve(fixtureRoot, "interactive-medium-v1.nui"), "utf8")))
      .toBe("sha256:211bcda72d6791791c306a4b147b712982ceaa2a91786f58067711351d4ae37e");
    expect(sha256(readFileSync(resolve(fixtureRoot, "interactive-large-v1.nui"), "utf8")))
      .toBe("sha256:f23a755ba77d813704a8b5dceb4a0e442a0a806f9b51c53e0c0e5550cdca2b39");
  });
});
