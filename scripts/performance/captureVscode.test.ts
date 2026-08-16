import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BENCHMARK_PROTOCOL,
  BENCHMARK_SCENARIO_IDS,
  REQUIRED_METRICS_BY_SCENARIO
} from "../../src/performance/benchmarkContract";
import type { CompletedBenchmarkSample } from "../../src/performance/benchmarkInstrumentation";
import { assembleBenchmarkResult } from "../../src/performance/benchmarkResultAssembly";
import type { BenchmarkMachine, BenchmarkResult } from "../../src/performance/benchmarkResultSchema";
import {
  assertVscodeBaseline,
  captureVscode,
  createVscodeTempDirectory,
  launchVscode,
  parseCaptureVscodeArgs,
  type CaptureVscodeDependencies,
  type VscodeBenchmarkCaptureConfig
} from "./captureVscode";

const machine: BenchmarkMachine = {
  platform: "darwin",
  arch: "arm64",
  osRelease: "test",
  cpuModel: "test",
  logicalCpuCount: 8
};
const fixtureHash = `sha256:${"a".repeat(64)}`;
const fixtureSource = "nui 4\nconst benchOffset: number = 6\n";
const fixture = {
  id: "interactive-medium-v1",
  file: "fixture.nui",
  hash: fixtureHash,
  workload: { forGroupIterations: 1, generatedGeometryPerIteration: 1 },
  anchors: {
    sourceEdit: { bindingName: "benchOffset", from: "6", to: "7" },
    pointDrag: { elementPath: "Point", pointerDeltaCssPx: { x: 1, y: 1 } },
    bezierHandleDrag: { elementPath: "Curve", handleRole: "start", pointerDeltaCssPx: { x: 1, y: 1 } },
    dependentElementPath: "Curve"
  }
};

const samples = (): CompletedBenchmarkSample[] => BENCHMARK_SCENARIO_IDS.flatMap((scenarioId) =>
  Array.from({ length: BENCHMARK_PROTOCOL.trials }, (_, index) => ({
    sampleId: index + 1,
    scenarioId,
    metrics: Object.fromEntries(REQUIRED_METRICS_BY_SCENARIO[scenarioId].map((metricId) => [metricId, index + 1]))
  }))
);

const result = (target: "tauri" | "vscode"): BenchmarkResult => assembleBenchmarkResult({
  target,
  fixture: { id: fixture.id, hash: fixtureHash },
  build: { gitCommit: "a".repeat(40), appVersion: "0.0.0" },
  environment: {
    machine,
    webviewUserAgent: "test-agent",
    renderSurface: { cssWidthPx: 1000, cssHeightPx: 700, backingWidthPx: 2000, backingHeightPx: 1400, devicePixelRatio: 2 }
  },
  samples: samples(),
  capturedAt: "2026-08-16T00:00:00.000Z"
});

const dependenciesFor = (
  state: { result: boolean; error: boolean },
  events: string[],
  capturedResult: BenchmarkResult = result("vscode")
): CaptureVscodeDependencies => {
  const baseline = result("tauri");
  return {
    readFile: (path) => path.endsWith(".nui") ? fixtureSource : state.error ? "capture failed" : "manifest",
    fileExists: (path) => path.endsWith(".error.json") ? state.error : state.result,
    hashSource: () => fixtureHash,
    getGitCommit: () => "a".repeat(40),
    getMachine: () => machine,
    getExtensionVersion: () => "0.0.0",
    createRunId: () => "run-1",
    createTempDirectory: () => "/tmp/vscode-capture-test",
    writeFile: () => undefined,
    buildExtension: () => { events.push("build-extension"); },
    buildRust: () => { events.push("build-rust"); },
    launchVscode: () => {
      events.push("launch");
      return { exit: Promise.resolve(0), terminate: () => events.push("terminate") };
    },
    readResult: (path) => path === "baseline" ? baseline : capturedResult,
    writeResult: () => { events.push("write-result"); },
    removeTempDirectory: () => { events.push("cleanup"); }
  };
};

describe("captureVscode", () => {
  it("uses a short /tmp-based temporary root on macOS", () => {
    const tempRoot = createVscodeTempDirectory("darwin");

    try {
      expect(tempRoot).toMatch(/^\/tmp\/nvc-[A-Za-z0-9]{6}$/);
      expect(tempRoot.length).toBeLessThan(40);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("launches VS Code with benchmark startup UI suppressed", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "nuinuicad-vscode-launch-test-"));
    const child = { once: vi.fn(), kill: vi.fn() };
    const spawnProcess = vi.fn((command: string, args: string[], options: object) => {
      void command;
      void args;
      void options;
      return child;
    });
    const config = {
      runId: "run-1",
      fixtureId: fixture.id,
      fixtureHash,
      fixtureSource,
      fixture,
      resultPath: join(tempRoot, "result.json"),
      build: {
        gitCommit: "a".repeat(40),
        appVersion: "0.0.0",
        machine
      },
      expectedRenderSurface: {
        cssWidthPx: 1000,
        cssHeightPx: 700,
        backingWidthPx: 2000,
        backingHeightPx: 1400,
        devicePixelRatio: 2
      }
    } satisfies VscodeBenchmarkCaptureConfig;

    try {
      launchVscode(
        config,
        "/repository",
        "/extension",
        "/fixture.nui",
        "/evaluation_stdio",
        spawnProcess as unknown as typeof import("node:child_process").spawn
      );

      const args = spawnProcess.mock.calls[0]?.[1];
      expect(args).toEqual([
        "--new-window",
        "--user-data-dir", join(tempRoot, "user-data"),
        "--extensions-dir", join(tempRoot, "extensions"),
        "--extensionDevelopmentPath=/extension",
        "--skip-welcome",
        "--skip-sessions-welcome",
        "--skip-release-notes",
        "--disable-workspace-trust",
        "/fixture.nui"
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("parses the required CLI contract", () => {
    expect(parseCaptureVscodeArgs([
      "--fixture", "interactive-medium-v1", "--baseline", "tauri-result.json", "--output", "vscode-result.json"
    ])).toEqual({ fixtureId: "interactive-medium-v1", baselinePath: "tauri-result.json", outputPath: "vscode-result.json" });
  });

  it("rejects non-Tauri baselines and machine mismatches", () => {
    expect(() => assertVscodeBaseline(result("vscode"), fixture.id, fixtureHash, machine)).toThrow("target");
    expect(() => assertVscodeBaseline(result("tauri"), fixture.id, fixtureHash, { ...machine, arch: "x64" })).toThrow("machine");
  });

  it("rejects a fixture hash mismatch before launching", async () => {
    const launch = vi.fn();
    await expect(captureVscode({ fixtureId: fixture.id, baselinePath: "baseline", outputPath: "output", manifestPath: "manifest" }, {
      ...dependenciesFor({ result: false, error: false }, []),
      readFile: (path) => path === "manifest" ? JSON.stringify({ schemaVersion: 1, fixtures: [fixture] }) : fixtureSource,
      hashSource: () => `sha256:${"b".repeat(64)}`,
      launchVscode: launch
    })).rejects.toThrow("Fixture hash mismatch");
    expect(launch).not.toHaveBeenCalled();
  });

  it("builds, launches, validates, writes, and cleans up a result", async () => {
    const events: string[] = [];
    await captureVscode({ fixtureId: fixture.id, baselinePath: "baseline", outputPath: "output", manifestPath: "manifest" }, {
      ...dependenciesFor({ result: true, error: false }, events),
      readFile: (path) => path === "manifest" ? JSON.stringify({ schemaVersion: 1, fixtures: [fixture] }) : fixtureSource
    });
    expect(events).toEqual(["build-extension", "build-rust", "launch", "terminate", "write-result", "cleanup"]);
  });

  it("writes no final result when the extension reports an error", async () => {
    const events: string[] = [];
    await expect(captureVscode({ fixtureId: fixture.id, baselinePath: "baseline", outputPath: "output", manifestPath: "manifest" }, {
      ...dependenciesFor({ result: false, error: true }, events),
      readFile: (path) => path === "manifest" ? JSON.stringify({ schemaVersion: 1, fixtures: [fixture] }) : "capture failed"
    })).rejects.toThrow("capture failed");
    expect(events).toContain("cleanup");
    expect(events).not.toContain("write-result");
  });
});
