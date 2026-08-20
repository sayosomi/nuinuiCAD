import type { BenchmarkFixtureManifestEntry } from "../performance/benchmarkFixtureManifest";
import type { BenchmarkMachine, BenchmarkRenderSurface } from "../performance/benchmarkResultSchema";
import type { LineSplice } from "../document/textPatch";
import type { NormalizedSourceRange } from "../dsl/dslNavigationQuery";
import type { VscodeCanvasRibbon } from "./vscodeCanvasRibbonConfig";

export type VscodeRustEvaluationRequest = {
  type: "rustEvaluationRequest";
  id: number;
  input: unknown;
};

export type VscodeDocumentChangeReason = "edit" | "undo" | "redo";

export type VscodeToExtensionMessage =
  | { type: "webviewReady" }
  | { type: "canvasRibbonPositionCommit"; ribbonId: string; x: number; y: number }
  | { type: "editCanvasRibbon" }
  | { type: "webviewAuthoritativeDocumentReady"; documentVersion: number }
  | { type: "canvasSourceDefinitionResult"; requestId: number; documentVersion: number | null; range: NormalizedSourceRange | null }
  | { type: "canvasNavigationResult"; requestId: number; status: "ready" | "no-target" | "stale" | "focused" }
  | VscodeRustEvaluationRequest
  | {
      type: "canvasCommit";
      sourceText: string;
      expectedDocumentVersion: number;
      mutationKind: "model-patch" | "reset";
      splices?: readonly LineSplice[];
    }
  | {
      type: "canvasHistoryRequest";
      direction: "undo" | "redo";
      expectedDocumentVersion: number;
    }
  | { type: "benchmarkResult"; result: unknown }
  | { type: "benchmarkError"; error: string };

export type VscodeCanvasCommandId =
  | "undo"
  | "redo"
  | "clearCanvasSelection"
  | "resetCanvasView"
  | "fitDrawing"
  | "toggleCanvasElementNames"
  | "toggleCanvasPoints";

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
  | { type: "replaceTextDocument"; sourceText: string; documentVersion: number }
  | { type: "commitText"; sourceText: string; documentVersion: number; reason: VscodeDocumentChangeReason }
  | { type: "canvasSourceDefinitionRequest"; requestId: number }
  | { type: "canvasNavigationRequest"; requestId: number; documentVersion: number; normalizedSourceOffset: number }
  | { type: "focusCanvas"; requestId: number }
  | {
      type: "canvasHistoryResult";
      direction: "undo" | "redo";
      status: "completed" | "resynced" | "failed";
      documentVersion: number;
    }
  | { type: "canvasThemeChanged" }
  | { type: "canvasRibbonConfiguration"; ribbons: VscodeCanvasRibbon[] }
  | { type: "canvasCommand"; commandId: VscodeCanvasCommandId }
  | { type: "rustEvaluationResponse"; id: number; payload: unknown }
  | { type: "rustEvaluationError"; id: number; error: string }
  | { type: "benchmarkConfig"; config: VscodeBenchmarkConfig };

export type VscodeWebviewApi = {
  postMessage: (message: VscodeToExtensionMessage) => void;
};
