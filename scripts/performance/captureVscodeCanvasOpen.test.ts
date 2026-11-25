import { describe, expect, it, vi } from "vitest";
import {
  parseCaptureVscodeCanvasOpenArgs,
  runCanvasOpenHost
} from "./captureVscodeCanvasOpen";
import type { CanvasOpenHostConfig, CanvasOpenHostRunResult } from "../../src/performance/canvasOpenCapture";

const fixture = {
  id: "single-root",
  hash: `sha256:${"a".repeat(64)}`,
  rootSourceSha256: "b".repeat(64),
  kind: "single-root" as const,
  expectedDependencyCount: 0,
  minimumRuntimeElementCount: 100,
  minimumComputedGeometryCount: 100,
  minimumDrawablePrimitiveCount: 50
};

const config: CanvasOpenHostConfig = {
  schemaVersion: 1,
  runId: "run-1",
  resultPath: "/tmp/result.json",
  statusPath: "/tmp/status.json",
  mode: "warm",
  warmupCount: 3,
  measuredSampleCount: 21,
  panelTimeoutMs: 1000,
  hostTimeoutMs: 2000,
  fixture
};

const validResult: CanvasOpenHostRunResult = {
  schemaVersion: 1,
  runId: "run-1",
  mode: "warm",
  status: "complete",
  hostPid: 42,
  fixtureId: fixture.id,
  fixtureHash: fixture.hash,
  warmupCount: 3,
  measuredSampleCount: 21,
  samples: Array.from({ length: 21 }, (_, sampleIndex) => ({
    mode: "warm" as const,
    sampleIndex,
    hostElapsedMs: sampleIndex + 1,
    hostPid: 42,
    identity: { documentVersion: 1, sourceRevision: 2, graphRevision: 3, rustEvaluationRequestId: sampleIndex + 1 },
    fixtureId: fixture.id,
    fixtureHash: fixture.hash,
    runtimeElementCount: 100,
    computedGeometryCount: 100,
    drawablePrimitiveCount: 50,
    webviewElapsedMs: sampleIndex + 1,
    webviewUserAgent: "test-webview",
    renderSurface: { cssWidthPx: 800, cssHeightPx: 600, backingWidthPx: 1600, backingHeightPx: 1200, devicePixelRatio: 2 },
    hostPhases: { panelOpenToWebviewReadyMs: 10, panelOpenToAuthoritativeDocumentMs: 20, rustRequestServiceMs: 30 }
  }))
};

const hostInput = {
  config,
  repositoryPath: "/repo",
  extensionPath: "/repo/vscode-extension",
  workspaceRoot: "/tmp/workspace",
  rootFilePath: "/tmp/workspace/root.nui",
  rustBinaryPath: "/repo/evaluation_stdio",
  userDataPath: "/tmp/user-data",
  extensionsPath: "/tmp/extensions"
};

describe("Canvas-open VS Code capture CLI", () => {
  it("parses smoke and explicit fixture/output arguments", () => {
    expect(parseCaptureVscodeCanvasOpenArgs([
      "--fixture", "imported", "--smoke", "--output", "/tmp/canvas-open.json"
    ])).toEqual({ fixtureId: "imported", smoke: true, outputPath: "/tmp/canvas-open.json" });
  });

  it("requires at least 21 measured warm samples for repeatable runs", () => {
    expect(() => parseCaptureVscodeCanvasOpenArgs([
      "--fixture", "single-root", "--output", "/tmp/canvas-open.json", "--warm-samples", "20"
    ])).toThrow("at least 21");
  });

  it("accepts a complete result and shuts down and cleans only its isolated capture resources", async () => {
    const terminate = vi.fn();
    const removeTempDirectory = vi.fn();
    let now = 0;
    const launchHost = vi.fn(() => ({ exit: Promise.resolve(0), terminate }));
    const result = await runCanvasOpenHost(hostInput, {
      launchHost,
      fileExists: (path) => path === config.resultPath,
      readFile: () => JSON.stringify(validResult),
      now: () => now,
      delay: async (ms) => { now += ms; },
      removeTempDirectory,
      cleanupPath: "/tmp/nuinui-owned-capture"
    });

    expect(result).toEqual(validResult);
    expect(launchHost).toHaveBeenCalledWith(hostInput);
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(removeTempDirectory).toHaveBeenCalledWith("/tmp/nuinui-owned-capture");
  });

  it("bounds host readiness and includes the latest Webview status in timeout diagnostics", async () => {
    const terminate = vi.fn();
    const removeTempDirectory = vi.fn();
    let now = 0;
    await expect(runCanvasOpenHost(hostInput, {
      launchHost: () => ({ exit: new Promise<number>(() => undefined), terminate }),
      fileExists: (path) => path === config.statusPath,
      readFile: () => "{\"status\":\"waiting-for-current-frame\",\"latestFrameStatus\":{\"reason\":\"graphless\"}}",
      now: () => now,
      delay: async (ms) => { now += ms; },
      removeTempDirectory,
      cleanupPath: "/tmp/nuinui-owned-capture"
    })).rejects.toThrow("timed out after 2000 ms; latest status: {\"status\":\"waiting-for-current-frame\",\"latestFrameStatus\":{\"reason\":\"graphless\"}}");
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(removeTempDirectory).toHaveBeenCalledWith("/tmp/nuinui-owned-capture");
  });
});
