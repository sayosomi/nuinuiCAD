import type { BakeOperationSummary } from "../commands/bakeOperationResult";
import type { BenchmarkFixtureManifestEntry } from "../performance/benchmarkFixtureManifest";
import type { BenchmarkMachine, BenchmarkRenderSurface } from "../performance/benchmarkResultSchema";
import type { LineSplice } from "../document/textPatch";
import type { NormalizedSourceRange } from "../dsl/dslNavigationQuery";
import type { DslCanvasRevealDegradation, DslCanvasRevealFailureReason } from "../dsl/dslCanvasRevealQuery";
import type { VscodeCanvasRibbon } from "./vscodeCanvasRibbonConfig";
import type { VscodeCanvasObservationToExtensionMessage } from "./canvasObservationProtocol";
import type { VscodeCanvasThemeToExtensionMessage } from "./vscodeCanvasThemeProtocol";
import type { VscodeMultiDocumentGraphPublication } from "./multiDocumentGraphTransport";
import type {
  VscodeExtensionToModulePreviewMessage,
  VscodeModulePreviewParameterSnapshot,
  VscodeModulePreviewParametersUnavailable,
  VscodeModulePreviewParameterViewMessage
} from "./modulePreviewProtocol";
import type {
  VscodeExtensionToOutputPreviewMessage,
  VscodeOutputPreviewToExtensionMessage
} from "./outputPreviewProtocol";
import type {
  VscodeExtensionToReferencePickMessage,
  VscodeReferencePickToExtensionMessage
} from "./referencePickProtocol";
import type { VscodeRuntimeDiagnosticsToExtensionMessage } from "./runtimeDiagnosticsProtocol";
import type { VscodeCanvasCreationCommandId } from "./vscodeCanvasCreationCommands";

export type {
  VscodeCanvasObservationElementSource,
  VscodeCanvasObservationIssueSummary,
  VscodeCanvasObservationPublication,
  VscodeCanvasObservationSelectionSubject,
  VscodeCanvasObservationSnapshot,
  VscodeCanvasObservationToExtensionMessage
} from "./canvasObservationProtocol";
export type { VscodeCanvasThemePublication } from "./vscodeCanvasThemeProtocol";
export type {
  VscodeExtensionToModulePreviewMessage,
  VscodeModulePreviewParameter,
  VscodeModulePreviewParameterDiagnostic,
  VscodeModulePreviewParameterGroup,
  VscodeModulePreviewParameterSetValue,
  VscodeModulePreviewParameterSetValueRequest,
  VscodeModulePreviewParameterSnapshot,
  VscodeModulePreviewParameterValueBlur,
  VscodeModulePreviewParameterValueFocus,
  VscodeModulePreviewParameterValueSelectionRestore,
  VscodeModulePreviewParameterUseDefault,
  VscodeModulePreviewParameterUseDefaultRequest,
  VscodeModulePreviewParametersUnavailable,
  VscodeModulePreviewParameterViewMessage,
  VscodeModulePreviewSession,
  VscodeModulePreviewTarget,
  VscodeModulePreviewTargetUnavailable
} from "./modulePreviewProtocol";
export type {
  VscodeExtensionToOutputPreviewMessage,
  VscodeOutputPreviewExportAvailability,
  VscodeOutputPreviewExportFormat,
  VscodeOutputPreviewExportRequest,
  VscodeOutputPreviewExportResult,
  VscodeOutputPreviewPlaceCommit,
  VscodeOutputPreviewPlaceCoordinatePatch,
  VscodeOutputPreviewToExtensionMessage
} from "./outputPreviewProtocol";
export type {
  VscodeExtensionToReferencePickMessage,
  VscodeReferencePickCancelRequest,
  VscodeReferencePickConfirmedResult,
  VscodeReferencePickResult,
  VscodeReferencePickStartedResult,
  VscodeReferencePickStartRequest,
  VscodeReferencePickTargetProof,
  VscodeReferencePickTerminalResult,
  VscodeReferencePickToExtensionMessage
} from "./referencePickProtocol";
export type {
  VscodeRuntimeDiagnosticsPublication,
  VscodeRuntimeDiagnosticsToExtensionMessage
} from "./runtimeDiagnosticsProtocol";
export type {
  VscodeMultiDocumentGraphPublication,
  VscodeMultiDocumentGraphSnapshot,
  VscodeMultiDocumentSemanticIdentity,
  VscodeMultiDocumentSourceLocation,
  VscodeMultiDocumentSourceSnapshot
} from "./multiDocumentGraphTransport";
export type { VscodeCanvasCreationCommandId } from "./vscodeCanvasCreationCommands";

export const vscodeWebviewSurfaceKinds = [
  "canvas",
  "outputPreview",
  "modulePreview",
  "modulePreviewParameters",
  "explorerMock"
] as const;
export type VscodeWebviewSurfaceKind = (typeof vscodeWebviewSurfaceKinds)[number];

export const vscodeWebviewSurfaceDataAttribute = "data-nuinui-surface";

export type VscodeCanvasContextMenuKind = "blank" | "element" | "ribbon";

export type VscodeCanvasPointer = { x: number; y: number };

export const vscodeCanvasPointerContextKeys = {
  x: "nuinuiCAD.canvasPointerWorldX",
  y: "nuinuiCAD.canvasPointerWorldY"
} as const;

export const isVscodeCanvasPointer = (value: unknown): value is VscodeCanvasPointer => {
  if (typeof value !== "object" || value === null) return false;
  const pointer = value as Partial<VscodeCanvasPointer>;
  return Number.isFinite(pointer.x) && Number.isFinite(pointer.y);
};

export const vscodeWebviewContextDataFor = (
  section: string,
  values: Readonly<Record<string, string | number | boolean>> = {}
): string => JSON.stringify({
  webviewSection: section,
  ...values,
  preventDefaultContextMenuItems: true
});

export const vscodeCanvasContextDataFor = (
  kind: VscodeCanvasContextMenuKind,
  hasSelection: boolean,
  pointer?: VscodeCanvasPointer,
  canSelectInstance = false
): string => vscodeWebviewContextDataFor(kind, {
  "nuinuiCAD.canvasHasSelection": hasSelection,
  "nuinuiCAD.canvasCanSelectInstance": canSelectInstance,
  ...(kind === "blank" && pointer && isVscodeCanvasPointer(pointer)
    ? {
        [vscodeCanvasPointerContextKeys.x]: pointer.x,
        [vscodeCanvasPointerContextKeys.y]: pointer.y
      }
    : {})
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

export type VscodeCanvasNavigationResult =
  | { type: "canvasNavigationResult"; requestId: number; status: "resolved"; degradations: readonly DslCanvasRevealDegradation[] }
  | { type: "canvasNavigationResult"; requestId: number; status: "failed"; reason: DslCanvasRevealFailureReason }
  | { type: "canvasNavigationResult"; requestId: number; status: "focused" };

export type VscodeToExtensionMessage =
  | { type: "webviewReady" }
  | { type: "canvasRibbonPositionCommit"; ribbonId: string; x: number; y: number }
  | { type: "editCanvasRibbon" }
  | { type: "webviewAuthoritativeDocumentReady"; documentVersion: number }
  | VscodeRuntimeDiagnosticsToExtensionMessage
  | VscodeCanvasObservationToExtensionMessage
  | VscodeCanvasThemeToExtensionMessage
  | VscodeReferencePickToExtensionMessage
  | VscodeModulePreviewParameterViewMessage
  | VscodeModulePreviewParameterSnapshot
  | VscodeModulePreviewParametersUnavailable
  | { type: "canvasSourceDefinitionResult"; requestId: number; documentVersion: number | null; range: NormalizedSourceRange | null }
  | VscodeCanvasNavigationResult
  | { type: "bakeSourceResult"; requestId: number; status: "applied" | "nothing" | "stale" | "rejected" }
  | ({ type: "bakeOperationResult"; surface: "source"; requestId: number; mode: "current" | "base" } & VscodeBakeOperationResult)
  | ({ type: "bakeOperationResult"; surface: "canvas"; mode: "current" | "base" } & VscodeBakeOperationResult)
  | VscodeRustEvaluationRequest
  | {
      type: "canvasPointerPublication";
      documentVersion: number;
      pointer: VscodeCanvasPointer;
    }
  | {
      type: "canvasFreePointAtPointerResult";
      requestId: number;
      status: "applied" | "rejected";
      documentVersion: number;
      nextSourcePosition?: { line: number; character: number };
    }
  | {
      type: "canvasCommit";
      sourceText: string;
      expectedDocumentVersion: number;
      mutationKind: "model-patch" | "reset";
      splices?: readonly LineSplice[];
      operationId?: number;
    }
  | {
      type: "canvasHistoryRequest";
      direction: "undo" | "redo";
      expectedDocumentVersion: number;
    }
  | { type: "benchmarkResult"; result: unknown }
  | { type: "benchmarkError"; error: string }
  | VscodeOutputPreviewToExtensionMessage;

export type VscodeCanvasCommandId =
  | "undo"
  | "redo"
  | "clearCanvasSelection"
  | "selectParentGroup"
  | "selectInstance"
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
  expectedRenderSurface?: BenchmarkRenderSurface;
  resultPath: string;
};

export type ExtensionToVscodeMessage =
  | { type: "replaceTextDocument"; sourceText: string; documentVersion: number }
  | { type: "commitText"; sourceText: string; documentVersion: number; reason: VscodeDocumentChangeReason }
  | VscodeMultiDocumentGraphPublication
  | VscodeExtensionToReferencePickMessage
  | { type: "canvasSourceDefinitionRequest"; requestId: number }
  | { type: "canvasNavigationRequest"; requestId: number; documentVersion: number; normalizedSourceOffset: number }
  | { type: "focusCanvas"; requestId: number }
  | {
      type: "canvasHistoryResult";
      direction: "undo" | "redo";
      status: "completed" | "resynced" | "failed";
      documentVersion: number;
    }
  | { type: "canvasThemeChanged"; generation: number }
  | { type: "canvasRibbonConfiguration"; ribbons: VscodeCanvasRibbon[] }
  | {
      type: "canvasFreePointAtPointer";
      requestId: number;
      documentVersion: number;
      pointer: VscodeCanvasPointer;
      sourcePosition: { line: number; character: number };
    }
  | {
      type: "canvasCommitResult";
      operationId: number;
      status: "accepted" | "rejected";
      documentVersion: number;
    }
  | {
      type: "canvasCommand";
      commandId: VscodeCanvasCommandId;
      emitSkippedComments?: boolean;
      includeHiddenGeometry?: boolean;
      includeDisabledGeometry?: boolean;
    }
  | { type: "canvasCreationCommand"; commandId: VscodeCanvasCreationCommandId }
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
  | VscodeExtensionToOutputPreviewMessage
  | VscodeExtensionToModulePreviewMessage;

export type VscodeWebviewApi = {
  postMessage: (message: VscodeToExtensionMessage) => void;
};
