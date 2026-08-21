import type { BakeOperationSummary } from "../commands/bakeOperationResult";
import type { BenchmarkFixtureManifestEntry } from "../performance/benchmarkFixtureManifest";
import type { BenchmarkMachine, BenchmarkRenderSurface } from "../performance/benchmarkResultSchema";
import type { LineSplice } from "../document/textPatch";
import type { NormalizedSourceRange } from "../dsl/dslNavigationQuery";
import type { VscodeCanvasRibbon } from "./vscodeCanvasRibbonConfig";

export const vscodeWebviewSurfaceKinds = ["canvas", "outputPreview"] as const;
export type VscodeWebviewSurfaceKind = (typeof vscodeWebviewSurfaceKinds)[number];

export const vscodeWebviewSurfaceDataAttribute = "data-nuinui-surface";

export type VscodeCanvasContextMenuKind = "blank" | "element" | "ribbon";

export const vscodeCanvasContextDataFor = (
  kind: VscodeCanvasContextMenuKind,
  hasSelection: boolean
): string => JSON.stringify({
  webviewSection: kind,
  "nuinuiCAD.canvasHasSelection": hasSelection,
  preventDefaultContextMenuItems: true
});

export const vscodeCanvasRibbonContextData = vscodeCanvasContextDataFor("ribbon", false);

export const isVscodeWebviewSurfaceKind = (value: unknown): value is VscodeWebviewSurfaceKind =>
  typeof value === "string" &&
  (vscodeWebviewSurfaceKinds as readonly string[]).includes(value);

export const parseVscodeWebviewSurfaceKind = (value: unknown): VscodeWebviewSurfaceKind | null =>
  isVscodeWebviewSurfaceKind(value) ? value : null;

export type VscodeRustEvaluationRequest = {
  type: "rustEvaluationRequest";
  id: number;
  input: unknown;
};

export type VscodeDocumentChangeReason = "edit" | "undo" | "redo";

export type VscodeBakeOperationResult = {
  status: "applied" | "nothing";
  summary: BakeOperationSummary;
};

export type VscodeToExtensionMessage =
  | { type: "webviewReady" }
  | { type: "canvasRibbonPositionCommit"; ribbonId: string; x: number; y: number }
  | { type: "editCanvasRibbon" }
  | { type: "webviewAuthoritativeDocumentReady"; documentVersion: number }
  | { type: "canvasSourceDefinitionResult"; requestId: number; documentVersion: number | null; range: NormalizedSourceRange | null }
  | { type: "canvasNavigationResult"; requestId: number; status: "ready" | "no-target" | "stale" | "focused" }
  | { type: "bakeSourceResult"; requestId: number; status: "applied" | "nothing" | "stale" | "rejected" }
  | ({ type: "bakeOperationResult"; surface: "source"; requestId: number; mode: "current" | "base" } & VscodeBakeOperationResult)
  | ({ type: "bakeOperationResult"; surface: "canvas"; mode: "current" | "base" } & VscodeBakeOperationResult)
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
  | { type: "benchmarkError"; error: string }
  | { type: "outputPreviewFit" }
  | {
      type: "outputPreviewSourceNavigation";
      documentVersion: number;
      range: NormalizedSourceRange;
    };

export type VscodeCanvasCommandId =
  | "undo"
  | "redo"
  | "clearCanvasSelection"
  | "resetCanvasView"
  | "fitDrawing"
  | "toggleCanvasPointNames"
  | "toggleCanvasGeometryNames"
  /** @deprecated Compatibility alias for Point Names. */
  | "toggleCanvasElementNames"
  | "toggleCanvasPoints"
  | "bakeCurrentShape"
  | "bakeBaseShape";

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
  | {
      type: "canvasCommand";
      commandId: VscodeCanvasCommandId;
      emitSkippedComments?: boolean;
      includeHiddenGeometry?: boolean;
      includeDisabledGeometry?: boolean;
    }
  | {
      type: "bakeSourceRequest";
      requestId: number;
      documentVersion: number;
      normalizedSourceOffset: number;
      mode: "current" | "base";
      emitSkippedComments: boolean;
      includeHiddenGeometry: boolean;
      includeDisabledGeometry: boolean;
    }
  | { type: "rustEvaluationResponse"; id: number; payload: unknown }
  | { type: "rustEvaluationError"; id: number; error: string }
  | { type: "benchmarkConfig"; config: VscodeBenchmarkConfig }
  | { type: "outputPreviewOpen"; documentVersion: number; normalizedSourceOffset: number | null }
  | { type: "outputPreviewFit" };

export type VscodeWebviewApi = {
  postMessage: (message: VscodeToExtensionMessage) => void;
};
