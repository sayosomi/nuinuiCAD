import { act, render } from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import type { BenchmarkRenderSurface } from "../performance/benchmarkResultSchema";
import type { EvaluationResult } from "../types/geometry";
import type { VscodeBenchmarkConfig } from "./protocol";
import { VSCodeBenchmarkCaptureRunner } from "./VSCodeBenchmarkCaptureRunner";

const mocks = vi.hoisted(() => ({
  runBrowserBenchmarkCapture: vi.fn()
}));

vi.mock("../performance/browserBenchmarkCapture", () => ({
  browserBenchmarkDefaultInstrumentation: () => ({}),
  runBrowserBenchmarkCapture: mocks.runBrowserBenchmarkCapture
}));

const liveSurface: BenchmarkRenderSurface = {
  cssWidthPx: 100,
  cssHeightPx: 50,
  backingWidthPx: 100,
  backingHeightPx: 50,
  devicePixelRatio: 1
};

let nextRunId = 1;

const fixture = {
  id: "interactive-medium-v1",
  file: "fixture.nui",
  hash: `sha256:${"a".repeat(64)}`,
  workload: { forGroupIterations: 1, generatedGeometryPerIteration: 1 },
  anchors: {
    sourceEdit: { bindingName: "benchOffset", from: "6", to: "7" },
    pointDrag: { elementPath: "Point", pointerDeltaCssPx: { x: 1, y: 1 } },
    bezierHandleDrag: { elementPath: "Curve", handleRole: "start", pointerDeltaCssPx: { x: 1, y: 1 } },
    dependentElementPath: "Curve"
  }
};

const configFor = (expectedRenderSurface?: BenchmarkRenderSurface): VscodeBenchmarkConfig => ({
  runId: `run-${nextRunId++}`,
  fixtureId: fixture.id,
  fixtureHash: fixture.hash,
  fixtureSource: "nui 1\n",
  fixture,
  build: {
    gitCommit: "a".repeat(40),
    appVersion: "0.0.0",
    machine: { platform: "test", arch: "test", osRelease: "test", cpuModel: "test", logicalCpuCount: 1 }
  },
  ...(expectedRenderSurface ? { expectedRenderSurface } : {}),
  resultPath: "/tmp/benchmark-result.json"
});

const renderRunner = (
  config: VscodeBenchmarkConfig,
  evaluationState: EvaluationEngineState = {} as EvaluationEngineState
) => {
  const viewport = document.createElement("div");
  const canvas = document.createElement("canvas");
  Object.defineProperty(viewport, "clientWidth", { configurable: true, value: liveSurface.cssWidthPx });
  Object.defineProperty(viewport, "clientHeight", { configurable: true, value: liveSurface.cssHeightPx });
  canvas.width = liveSurface.backingWidthPx;
  canvas.height = liveSurface.backingHeightPx;
  viewport.append(canvas);

  const canvasFocusRef = { current: viewport } as RefObject<HTMLDivElement | null>;
  const api = { postMessage: vi.fn() };
  render(
    <VSCodeBenchmarkCaptureRunner
      config={config}
      evaluation={{} as EvaluationResult}
      evaluationState={evaluationState}
      compiledDocumentRevision={1}
      canvasFocusRef={canvasFocusRef}
      api={api}
    />
  );
  return { api };
};

afterEach(() => {
  mocks.runBrowserBenchmarkCapture.mockReset();
});

describe("VSCode benchmark capture runner render surface", () => {
  it("uses the current live surface when no external surface is supplied", async () => {
    mocks.runBrowserBenchmarkCapture.mockResolvedValue(undefined);
    renderRunner(configFor());
    await act(async () => undefined);

    const capture = mocks.runBrowserBenchmarkCapture.mock.calls[0]?.[0];
    expect(capture).toBeDefined();
    expect(capture.dependencies.getRenderSurface()).toEqual(liveSurface);
  });

  it("enforces a supplied external surface exactly", async () => {
    mocks.runBrowserBenchmarkCapture.mockResolvedValue(undefined);
    renderRunner(configFor({ ...liveSurface, devicePixelRatio: 2 }));
    await act(async () => undefined);

    const capture = mocks.runBrowserBenchmarkCapture.mock.calls[0]?.[0];
    expect(capture).toBeDefined();
    expect(() => capture.dependencies.getRenderSurface()).toThrow("VS Code render surface mismatch");
  });
});

describe("VSCode benchmark capture runner evaluation failures", () => {
  it("preserves the concrete error from a current failed Rust evaluation", async () => {
    const error = new Error("evaluation_stdio is not available");
    mocks.runBrowserBenchmarkCapture.mockImplementation(async ({ dependencies }: {
      dependencies: { waitForRustEvaluation: (revision: number) => Promise<void> };
    }) => {
      await dependencies.waitForRustEvaluation(1);
      throw new Error("unreachable");
    });

    const { api } = renderRunner(configFor(), {
      evaluation: {} as EvaluationResult,
      evaluationRevision: 1,
      evaluationRequestRevision: 1,
      mode: "rust",
      source: "fallback",
      status: "failed",
      rustEligible: true,
      isStale: false,
      error
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.postMessage).toHaveBeenCalledWith({
      type: "benchmarkError",
      error: "VS Code benchmark Rust evaluation failed: evaluation_stdio is not available"
    });
  });
});
