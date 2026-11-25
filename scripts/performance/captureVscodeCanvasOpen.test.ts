import { describe, expect, it, vi } from "vitest";
import {
  parseCaptureVscodeCanvasOpenArgs,
  runCanvasOpenHost,
  summarizeCanvasOpenPhases
} from "./captureVscodeCanvasOpen";
import { CANVAS_OPEN_CAPTURE_SCHEMA_VERSION, type CanvasOpenHostConfig, type CanvasOpenHostRunResult, type CanvasOpenRawSample } from "../../src/performance/canvasOpenCapture";

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
  schemaVersion: CANVAS_OPEN_CAPTURE_SCHEMA_VERSION,
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
  schemaVersion: CANVAS_OPEN_CAPTURE_SCHEMA_VERSION,
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
    hostPhases: { panelOpenToWebviewReadyMs: 10, panelOpenToAuthoritativeDocumentMs: 20, rustRequestServiceMs: 30 },
    phaseEvidence: {
      host: { clockOrigin: "extension-host", events: [] },
      webview: { clockOrigin: "webview", events: [] },
      durationsMs: {},
      completeness: {}
    }
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
  it("aggregates valid, missing, unknown, and invalid phase evidence without zero filling", () => {
    const phase = "host.panelOpenToWebviewReady";
    const withPhase = (duration: number | null, status: "complete" | "missing" | "preexisting" | "unknown" | "invalid"): CanvasOpenRawSample => ({
      ...validResult.samples[0]!,
      phaseEvidence: {
        ...validResult.samples[0]!.phaseEvidence,
        durationsMs: { [phase]: duration },
        completeness: { [phase]: status }
      }
    });
    const summary = summarizeCanvasOpenPhases("cold", [
      withPhase(10, "complete"),
      withPhase(null, "missing"),
      withPhase(null, "preexisting"),
      withPhase(null, "unknown"),
      withPhase(null, "invalid")
    ]).find((item) => item.phase === phase);
    expect(summary).toEqual({
      mode: "cold",
      phase,
      clockOrigin: "extension-host",
      sampleCount: 1,
      missingCount: 1,
      unknownCount: 1,
      preexistingCount: 1,
      invalidCount: 1,
      p50Ms: 10,
      p95Ms: 10
    });
  });

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
    let cleanupAttempts = 0;
    const removeTempDirectory = vi.fn(() => {
      cleanupAttempts += 1;
      if (cleanupAttempts === 1) throw Object.assign(new Error("directory is still in use"), { code: "ENOTEMPTY" });
    });
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
    expect(removeTempDirectory).toHaveBeenNthCalledWith(1, "/tmp/nuinui-owned-capture");
    expect(removeTempDirectory).toHaveBeenNthCalledWith(2, "/tmp/nuinui-owned-capture");
    expect(now).toBeGreaterThanOrEqual(100);
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
