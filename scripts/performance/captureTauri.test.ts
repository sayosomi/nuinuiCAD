import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BENCHMARK_PROTOCOL,
  BENCHMARK_SCHEMA_VERSION,
  BENCHMARK_SCENARIO_IDS,
  REQUIRED_METRICS_BY_SCENARIO
} from "../../src/performance/benchmarkContract";
import type { BenchmarkResult } from "../../src/performance/benchmarkResultSchema";
import {
  captureTauri,
  parseCaptureTauriArgs,
  TauriCaptureChildProcessError,
  type CaptureTauriDependencies,
  type TauriBenchmarkCaptureConfig
} from "./captureTauri";

const manifestPath = resolve(process.cwd(), "performance/fixtures/manifest.json");
const manifestText = readFileSync(manifestPath, "utf8");
const fixtureSource = readFileSync(resolve(process.cwd(), "performance/fixtures/interactive-medium-v1.nui"), "utf8");

const validResult = (): BenchmarkResult => {
  const scenarios = Object.fromEntries(BENCHMARK_SCENARIO_IDS.map((scenarioId) => [scenarioId, {
    metrics: Object.fromEntries(REQUIRED_METRICS_BY_SCENARIO[scenarioId].map((metricId) => [metricId, {
      samples: Array.from({ length: BENCHMARK_PROTOCOL.trials }, (_, index) => index + 1),
      p50: 11,
      p95: 20,
      max: 21
    }]))
  }]));
  return {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    target: "tauri",
    capturedAt: "2026-08-16T00:00:00.000Z",
    build: { gitCommit: "a".repeat(40), appVersion: "0.0.0" },
    environment: {
      machine: { platform: "test", arch: "test", osRelease: "test", cpuModel: "test", logicalCpuCount: 2 },
      webviewUserAgent: "test",
      renderSurface: { cssWidthPx: 100, cssHeightPx: 100, backingWidthPx: 200, backingHeightPx: 200, devicePixelRatio: 2 }
    },
    fixture: { id: "interactive-medium-v1", hash: `sha256:${"a".repeat(64)}` },
    protocol: BENCHMARK_PROTOCOL,
    scenarios
  };
};

const deps = (overrides: Partial<CaptureTauriDependencies> = {}): CaptureTauriDependencies => ({
  readFile: (path) => path === manifestPath ? manifestText : fixtureSource,
  fileExists: (path) => !path.endsWith(".error.json"),
  hashSource: () => "sha256:5ce3d10605cd751f50eea0734e6c9a8ed869bba4454644ce0d0cd2de5234ab15",
  getGitCommit: () => "b".repeat(40),
  getMachine: () => ({ platform: "darwin", arch: "arm64", osRelease: "test", cpuModel: "M", logicalCpuCount: 10 }),
  createRunId: () => "run-id",
  createTempDirectory: () => "/tmp/nuinui-capture-test",
  launchTauri: async () => 0,
  readResult: () => validResult(),
  writeResult: vi.fn(),
  removeTempDirectory: vi.fn(),
  ...overrides
});

describe("captureTauri", () => {
  it("parses required CLI options and rejects a missing fixture before launch", async () => {
    expect(parseCaptureTauriArgs(["--fixture", "interactive-medium-v1", "--output", "/tmp/out.json"])).toEqual({
      fixtureId: "interactive-medium-v1", outputPath: "/tmp/out.json"
    });
    const launchTauri = vi.fn(async () => 0);
    await expect(captureTauri({ fixtureId: "missing", outputPath: "/tmp/out.json", manifestPath }, { launchTauri })).rejects.toThrow("Unknown benchmark fixture");
    expect(launchTauri).not.toHaveBeenCalled();
  });

  it("checks fixture hash before launching Tauri", async () => {
    const launchTauri = vi.fn(async () => 0);
    const readFile = (path: string) => path === manifestPath ? manifestText : "changed fixture";
    await expect(captureTauri(
      { fixtureId: "interactive-medium-v1", outputPath: "/tmp/out.json", manifestPath },
      deps({ readFile, hashSource: () => `sha256:${"0".repeat(64)}`, launchTauri })
    )).rejects.toThrow("hash mismatch");
    expect(launchTauri).not.toHaveBeenCalled();
  });

  it("assembles launcher metadata, validates the temporary result, and writes through result IO", async () => {
    const launchTauri = vi.fn(async (config: TauriBenchmarkCaptureConfig) => {
      expect(config.fixtureId).toBe("interactive-medium-v1");
      expect(config.fixtureSource).toBe(fixtureSource);
      expect(config.build.gitCommit).toBe("b".repeat(40));
      expect(config.build.machine.logicalCpuCount).toBe(10);
      return 0;
    });
    const writeResult = vi.fn();
    const removeTempDirectory = vi.fn();
    await captureTauri(
      { fixtureId: "interactive-medium-v1", outputPath: "/tmp/out.json", manifestPath },
      deps({ launchTauri, writeResult, removeTempDirectory })
    );
    expect(writeResult).toHaveBeenCalledWith("/tmp/out.json", expect.anything());
    expect(removeTempDirectory).toHaveBeenCalledWith("/tmp/nuinui-capture-test");
  });

  it("propagates child failure and rejects malformed/schema-invalid temporary results", async () => {
    await expect(captureTauri(
      { fixtureId: "interactive-medium-v1", outputPath: "/tmp/out.json", manifestPath },
      deps({ launchTauri: async () => 7 })
    )).rejects.toBeInstanceOf(TauriCaptureChildProcessError);

    const removeTempDirectory = vi.fn();
    await expect(captureTauri(
      { fixtureId: "interactive-medium-v1", outputPath: "/tmp/out.json", manifestPath },
      deps({ readResult: () => { throw new Error("Invalid benchmark result"); }, removeTempDirectory })
    )).rejects.toThrow("Invalid benchmark result");
    expect(removeTempDirectory).toHaveBeenCalled();
  });
});
