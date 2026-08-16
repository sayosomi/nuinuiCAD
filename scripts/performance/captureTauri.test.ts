import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
  CAPTURE_SHUTDOWN_TIMEOUT_MS,
  launchTauri,
  parseCaptureTauriArgs,
  TauriCaptureChildProcessError,
  type CaptureTauriDependencies,
  type TauriBenchmarkCaptureConfig
} from "./captureTauri";

const manifestPath = resolve(process.cwd(), "performance/fixtures/manifest.json");
const manifestText = readFileSync(manifestPath, "utf8");
const fixtureSource = readFileSync(resolve(process.cwd(), "performance/fixtures/interactive-medium-v1.nui"), "utf8");

const validResult = (identity: {
  target?: BenchmarkResult["target"];
  fixtureId?: string;
  fixtureHash?: string;
  gitCommit?: string;
} = {}): BenchmarkResult => {
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
    target: identity.target ?? "tauri",
    capturedAt: "2026-08-16T00:00:00.000Z",
    build: { gitCommit: identity.gitCommit ?? "b".repeat(40), appVersion: "0.0.0" },
    environment: {
      machine: { platform: "test", arch: "test", osRelease: "test", cpuModel: "test", logicalCpuCount: 2 },
      webviewUserAgent: "test",
      renderSurface: { cssWidthPx: 100, cssHeightPx: 100, backingWidthPx: 200, backingHeightPx: 200, devicePixelRatio: 2 }
    },
    fixture: {
      id: identity.fixtureId ?? "interactive-medium-v1",
      hash: identity.fixtureHash ?? "sha256:5ce3d10605cd751f50eea0734e6c9a8ed869bba4454644ce0d0cd2de5234ab15"
    },
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

type FakeChild = EventEmitter & {
  pid?: number;
  kill: ReturnType<typeof vi.fn>;
};

const fakeChild = (): FakeChild => {
  const child = new EventEmitter() as FakeChild;
  child.kill = vi.fn();
  return child;
};

const defaultLaunchDeps = (child: FakeChild) => {
  const tempDirectory = mkdtempSync(join("/tmp", "nuinuicad-capture-test-"));
  let resultPath = "";
  const spawnProcess = vi.fn((_command: string, _args: readonly string[], options: { env?: Record<string, string> }) => {
    resultPath = JSON.parse(options.env!.VITE_BENCHMARK_CAPTURE_CONFIG).resultPath;
    return child;
  });
  return {
    resultPath: () => resultPath,
    dependencies: deps({
      launchTauri: (config, repositoryPath) => launchTauri(
        config,
        repositoryPath,
        spawnProcess as unknown as typeof import("node:child_process").spawn
      ),
      createTempDirectory: () => tempDirectory,
      removeTempDirectory: (path) => rmSync(path, { recursive: true, force: true })
    })
  };
};

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

  it("does not resolve when only the completion result file is detected", async () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild();
      const launch = defaultLaunchDeps(child);
      const pending = captureTauri(
        { fixtureId: "interactive-medium-v1", outputPath: "/tmp/out.json", manifestPath },
        launch.dependencies
      );
      writeFileSync(launch.resultPath(), "{}");
      let settled = false;
      void pending.finally(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(100);
      expect(settled).toBe(false);

      child.emit("exit", 0, null);
      await expect(pending).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts frontend completion after the actual child exit", async () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild();
      const launch = defaultLaunchDeps(child);
      const pending = captureTauri(
        { fixtureId: "interactive-medium-v1", outputPath: "/tmp/out.json", manifestPath },
        launch.dependencies
      );
      writeFileSync(launch.resultPath(), "{}");
      await vi.advanceTimersByTimeAsync(100);
      child.emit("exit", null, "SIGTERM");
      await expect(pending).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("terminates a child after shutdown timeout and waits for its exit", async () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild();
      const launch = defaultLaunchDeps(child);
      const pending = captureTauri(
        { fixtureId: "interactive-medium-v1", outputPath: "/tmp/out.json", manifestPath },
        launch.dependencies
      );
      writeFileSync(launch.resultPath(), "{}");
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(CAPTURE_SHUTDOWN_TIMEOUT_MS);
      expect(child.kill).toHaveBeenCalledTimes(1);

      let settled = false;
      void pending.finally(() => { settled = true; });
      await Promise.resolve();
      expect(settled).toBe(false);
      child.emit("exit", 143, "SIGTERM");
      await expect(pending).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails when the child exits abnormally without completion", async () => {
    const child = fakeChild();
    const launch = defaultLaunchDeps(child);
    const pending = captureTauri(
      { fixtureId: "interactive-medium-v1", outputPath: "/tmp/out.json", manifestPath },
      launch.dependencies
    );
    child.emit("exit", 7, null);
    await expect(pending).rejects.toBeInstanceOf(TauriCaptureChildProcessError);
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

  it.each([
    ["target", validResult({ target: "vscode" }), "target"],
    ["fixture.id", validResult({ fixtureId: "other-fixture" }), "fixture.id"],
    ["fixture.hash", validResult({ fixtureHash: "sha256:wrong" }), "fixture.hash"],
    ["build.gitCommit", validResult({ gitCommit: "c".repeat(40) }), "build.gitCommit"]
  ] as const)("rejects a temporary result with a %s identity mismatch without writing output", async (_label, result, field) => {
    const writeResult = vi.fn();
    await expect(captureTauri(
      { fixtureId: "interactive-medium-v1", outputPath: "/tmp/out.json", manifestPath },
      deps({ readResult: () => result, writeResult })
    )).rejects.toThrow(`Benchmark result ${field} mismatch`);
    expect(writeResult).not.toHaveBeenCalled();
  });
});
