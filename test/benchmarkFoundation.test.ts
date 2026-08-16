import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
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
import {
  readBenchmarkResultFile,
  writeBenchmarkResultFile
} from "../scripts/performance/benchmarkResultIo";
import { compileDslDocument } from "../src/dsl/dslDocument";
import { parseDslSnapshot } from "../src/dsl/dslParser";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

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

const resultFilePair = (): { directory: string; baselinePath: string; candidatePath: string } => {
  const directory = mkdtempSync(join(resolve(process.cwd()), "benchmark-foundation-"));
  temporaryDirectories.push(directory);
  return {
    directory,
    baselinePath: join(directory, "tauri.json"),
    candidatePath: join(directory, "vscode.json")
  };
};

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

describe("benchmark result IO", () => {
  it("writes pretty JSON with a trailing newline and round-trips it", () => {
    const { baselinePath } = resultFilePair();
    const result = makeResult();
    writeBenchmarkResultFile(baselinePath, result);
    const raw = readFileSync(baselinePath, "utf8");
    expect(raw).toContain("\n  \"schemaVersion\": 1");
    expect(raw.endsWith("\n")).toBe(true);
    expect(readBenchmarkResultFile(baselinePath)).toEqual(result);
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
    const compared = comparison.scenarios["source-edit-v1"]!.metrics.compileMs!;
    expect(compared.baseline).toEqual(metric());
    expect(compared.candidate).toEqual(metric(2));
    expect(compared.p95Ratio).toBe(2);
  });

  it.each([
    ["fixture id", (result: BenchmarkResult) => { result.fixture.id = "other"; }],
    ["fixture hash", (result: BenchmarkResult) => { result.fixture.hash = "sha256:98957b9071e741cae299c0bfc18d62be3d188690ebc8ca7b658dfddd47eb58af"; }],
    ["protocol", (result: BenchmarkResult) => { result.protocol.trials = 20; for (const scenario of Object.values(result.scenarios)) for (const item of Object.values(scenario.metrics)) { item.samples = samples(); } }],
    ["machine", (result: BenchmarkResult) => { result.environment.machine.arch = "x64"; }],
    ["render surface", (result: BenchmarkResult) => { result.environment.renderSurface.devicePixelRatio = 1; }],
    ["scenario ids", (result: BenchmarkResult) => { result.scenarios.extra = { metrics: {} }; }],
    ["metric ids", (result: BenchmarkResult) => { delete result.scenarios["source-edit-v1"]!.metrics.compileMs; }]
  ])("rejects %s mismatch", (_label, mutate) => {
    const baseline = makeResult();
    const candidate = cloneResult(baseline);
    mutate(candidate);
    expect(() => compareBenchmarkResults(baseline, candidate)).toThrow(/Incompatible|Invalid benchmark result/);
  });

  it("reports n/a when baseline p95 is zero", () => {
    const baseline = makeResult();
    const candidate = cloneResult(baseline);
    const zero = calculateBenchmarkStatistics(Array.from({ length: 21 }, () => 0));
    baseline.scenarios["source-edit-v1"]!.metrics.compileMs = zero;
    candidate.scenarios["source-edit-v1"]!.metrics.compileMs = metric(2);
    expect(compareBenchmarkResults(baseline, candidate).scenarios["source-edit-v1"]!.metrics.compileMs!.p95Ratio).toBe("n/a");
  });
});

describe("benchmark comparison CLI", () => {
  it("prints scenario, metric, p50/p95/max, and p95 ratio", () => {
    const { baselinePath, candidatePath } = resultFilePair();
    const baseline = makeResult();
    const candidate = cloneResult(baseline);
    candidate.target = "vscode";
    candidate.scenarios["source-edit-v1"]!.metrics.compileMs = metric(2);
    writeBenchmarkResultFile(baselinePath, baseline);
    writeBenchmarkResultFile(candidatePath, candidate);
    const run = spawnSync(process.execPath, [
      "node_modules/tsx/dist/cli.mjs",
      "scripts/performance/compare.ts",
      baselinePath,
      candidatePath
    ], { cwd: process.cwd(), encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("scenario source-edit-v1");
    expect(run.stdout).toContain("compileMs");
    expect(run.stdout).toContain("baseline p50=11 p95=20 max=21");
    expect(run.stdout).toContain("candidate p50=22 p95=40 max=42");
    expect(run.stdout).toContain("p95 ratio=2");
  });

  it("returns nonzero for an incompatible pair", () => {
    const { baselinePath, candidatePath } = resultFilePair();
    const baseline = makeResult();
    const candidate = cloneResult(baseline);
    candidate.fixture.id = "other";
    writeBenchmarkResultFile(baselinePath, baseline);
    writeBenchmarkResultFile(candidatePath, candidate);
    const run = spawnSync(process.execPath, [
      "node_modules/tsx/dist/cli.mjs",
      "scripts/performance/compare.ts",
      baselinePath,
      candidatePath
    ], { cwd: process.cwd(), encoding: "utf8" });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("fixture.id differs");
  });
});

describe("benchmark fixtures", () => {
  it("validates manifest hashes, anchors, and DSL compilation", () => {
    const manifestPath = resolve(process.cwd(), "performance/fixtures/manifest.json");
    const manifest = parseBenchmarkFixtureManifest(JSON.parse(readFileSync(manifestPath, "utf8")) as unknown);
    expect(() => assertBenchmarkFixtureManifest(manifest)).not.toThrow();

    for (const fixture of manifest.fixtures) {
      const fixturePath = resolve(process.cwd(), "performance/fixtures", fixture.file);
      const source = readFileSync(fixturePath, "utf8");
      const actualHash = createHash("sha256").update(source, "utf8").digest("hex");
      expect(`sha256:${actualHash}`).toBe(fixture.hash);
      expect(source).toContain("benchOffset: number");
      expect(source).toContain("Benchmark::DragPoint");
      expect(source).toContain("Benchmark::DragCurve");
      expect(source).toContain("DependentOffset");
      expect(source).toContain("point");
      expect(source).toContain("line");
      expect(source).toContain("curve");
      expect(source).toContain("offset");
      expect(source).toContain("group");
      expect(source).toContain("for i in range");

      const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 0 });
      const assignedStatementIds = new Map(
        parsed.statements.map((_, index) => [index, `benchmark:statement:${index}`] as const)
      );
      const compiled = compileDslDocument(source, { preparsed: parsed, assignedStatementIds });
      expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
      expect(compiled.document).not.toBeNull();
      const elementTypes = new Set(compiled.document!.elements.map((element) => element.type));
      for (const type of ["freePoint", "line", "bezierCurve", "offsetLine", "group", "forGroup"]) {
        expect(elementTypes).toContain(type);
      }
      const count = source.match(/for i in range\(from: 0, count: (\d+), step: 1\)/)?.[1];
      expect(Number(count)).toBe(fixture.workload.forGroupIterations);
    }
  });
});
