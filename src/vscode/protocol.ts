import type { BenchmarkFixtureManifestEntry } from "../performance/benchmarkFixtureManifest";
import type { BenchmarkMachine, BenchmarkRenderSurface } from "../performance/benchmarkResultSchema";

export type VscodeRustEvaluationRequest = {
  type: "rustEvaluationRequest";
  id: number;
  input: unknown;
};

export type VscodeToExtensionMessage =
  | { type: "webviewReady" }
  | VscodeRustEvaluationRequest
  | { type: "canvasCommit"; sourceText: string }
  | { type: "benchmarkResult"; result: unknown }
  | { type: "benchmarkError"; error: string };

export type VscodeBenchmarkConfig = {
  runId: string;
  fixtureId: string;
  fixtureHash: string;
  fixtureSource: string;
  fixture: BenchmarkFixtureManifestEntry;
  build: {
    gitCommit: string;
    appVersion: string;
    machine: BenchmarkMachine;
  };
  expectedRenderSurface: BenchmarkRenderSurface;
  resultPath: string;
};

export type ExtensionToVscodeMessage =
  | { type: "replaceTextDocument"; sourceText: string }
  | { type: "commitText"; sourceText: string }
  | { type: "rustEvaluationResponse"; id: number; payload: unknown }
  | { type: "rustEvaluationError"; id: number; error: string }
  | { type: "benchmarkConfig"; config: VscodeBenchmarkConfig };

export type VscodeWebviewApi = {
  postMessage: (message: VscodeToExtensionMessage) => void;
};
