import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import * as vscode from "vscode";
import { applyLineSplices } from "@nuinuicad/nui-language/document";
import { queryDslCanvasSourceTarget, type NormalizedSourceRange } from "@nuinuicad/nui-language";
import { queryDslCanvasRevealSourceTarget } from "@nuinuicad/nui-language";
import { RustEvaluationProcess } from "./rustEvaluationProcess";
import { RustEvaluationProcessOwner } from "./rustEvaluationProcessOwner";
import {
  toCompilerDiagnostic,
  type CompilerDiagnostic,
  type CompilerDiagnosticRange
} from "./compilerDiagnostics";
import {
  createLanguageAnalysisSession,
  currentCompiledSemanticSnapshotFor,
  type NuiLanguageAnalysisSession
} from "./languageAnalysisSession";
import {
  createNuiCompletionProvider,
  nuiCompletionSelector,
  nuiCompletionTriggerCharacters
} from "./completionProvider";
import {
  createNuiColorProvider,
  nuiColorSelector
} from "./colorProvider";
import {
  createNuiSignatureHelpProvider,
  nuiSignatureHelpSelector,
  nuiSignatureHelpTriggerCharacters
} from "./signatureHelpProvider";
import {
  createNuiDefinitionProvider,
  nuiDefinitionSelector
} from "./definitionProvider";
import {
  createNuiRenameProvider,
  nuiRenameSelector
} from "./renameProvider";
import {
  createNuiReferenceProvider,
  nuiReferenceSelector
} from "./referenceProvider";
import {
  createNuiChoiceQuickFixApplyHandler,
  createNuiChoiceQuickFixProvider,
  nuiChoiceQuickFixSelector,
  NUI_CHOICE_QUICK_FIX_APPLY_COMMAND
} from "./choiceQuickFixProvider";
import {
  createNuiFoldingProvider,
  nuiFoldingSelector
} from "./foldingProvider";
import {
  createNuiDocumentSymbolProvider,
  nuiDocumentSymbolSelector
} from "./documentSymbolProvider";
import { registerNuiElementsTreeFeature } from "./elementsTreeFeature";
import {
  registerVscodeCoordinatePointConversionFeature,
  coordinatePointConversionCanvasTargetsFor,
  type CoordinatePointConversionCanvasEndpoint,
  type VscodeCoordinatePointConversionFeature
} from "./coordinatePointConversionCommandFeature";
import {
  registerVscodeInlineModuleCommandFeature,
  type InlineModuleCanvasEndpoint,
  type VscodeInlineModuleCommandFeature
} from "./inlineModuleCommandFeature";
import {
  registerVscodeExtractModuleCommandFeature,
  type ExtractModuleCanvasEndpoint,
  type VscodeExtractModuleCommandFeature
} from "./extractModuleCommandFeature";
import { registerNuiHoverFeature } from "./hoverFeature";
import {
  outputPreviewRevealSourceTargetForEditor,
  registerVscodeReferencePickFeature,
  type VscodeReferencePickCanvasEndpoint
} from "./referencePickCommandFeature";
import { registerVscodeGeometryReferenceRetargetFeature } from "./geometryReferenceRetargetCommandFeature";
import {
  registerVscodeCanvasQuickCreateFeature,
  type VscodeCanvasCreationEndpoint
} from "./canvasQuickCreateFeature";
import {
  registerVscodeCanvasFreePointAtPointerFeature,
  isVscodeCanvasBlankContext,
  type VscodeCanvasFreePointAtPointerEndpoint,
  type VscodeCanvasFreePointAtPointerFeature
} from "./canvasFreePointAtPointerFeature";
import { registerVscodeSourceAuthoringPositionFeature } from "./sourceAuthoringPositionFeature";
import { isVscodeCanvasPointer } from "../../src/vscode/protocol";
import type { VscodeCanvasPointer } from "../../src/vscode/protocol";
import { registerVscodeSourceValueStepFeature } from "./sourceValueStepCommandFeature";
import type {
  ExtensionToVscodeMessage,
  VscodeCanvasCommandId,
  VscodeBakeSettings,
  VscodeBenchmarkConfig,
  VscodeDocumentChangeReason,
  VscodeToExtensionMessage
} from "../../src/vscode/protocol";
import {
  vscodeWebviewSurfaceDataAttribute,
  type VscodeWebviewSurfaceKind
} from "../../src/vscode/protocol";
import { webviewPresentationFor } from "./webviewPresentationLocalization";
import {
  VscodeWebviewSessionRegistry,
  type VscodeWebviewSessionBase
} from "../../src/vscode/vscodeWebviewSession";
import {
  activeVscodeMultiDocumentHost,
  type VscodeMultiDocumentDiagnostic,
  type VscodeMultiDocumentDiagnosticSnapshot,
  type VscodeMultiDocumentDiagnosticsState
} from "./multiDocumentHost";
import type {
  DocumentQualifiedSourceLocation,
  DocumentSourceIdentity,
  MultiDocumentSourceSnapshot
} from "@nuinuicad/nui-language/workspace";
import {
  defaultVscodeCanvasRibbons,
  normalizeVscodeCanvasRibbons,
  patchVscodeCanvasRibbonPosition,
  VSCODE_CANVAS_RIBBON_SETTING,
  type VscodeCanvasRibbon
} from "../../src/vscode/vscodeCanvasRibbonConfig";
import { normalizedOffsetFromRaw, normalizedSourceFor, vscodeRangeForNormalized } from "./sourceOffsetAdapter";
import { presentBakeOperationResult } from "./bakeOperationPresentation";
import { canvasPresentationTextFor } from "./canvasPresentationLocalization";
import {
  diagnosticRelatedTextFor,
  diagnosticMessageFor
} from "./diagnosticLocalization";
import {
  revealInCanvasNotificationFor,
  type RevealInCanvasPresentationOutcome
} from "./revealInCanvasPresentation";
import { registerVscodeObservationFeature } from "./vscodeObservationFeature";
import { vscodeObservationState } from "./vscodeObservationState";
import type { VscodeObservationHostDocument } from "./vscodeObservationState";
import {
  createCanvasThemeWarningFeature,
  type CanvasThemeWarning
} from "./canvasThemeWarningFeature";
import { registerNuiSourceActivityDecorationFeature } from "./sourceActivityDecorationFeature";
import {
  registerOutputPreviewFeature,
  type OutputPreviewSession
} from "./outputPreviewFeature";
import { applySourceLineSplices, textEditForLineSplice } from "./textDocumentLineSplices";

type DocumentSession = VscodeWebviewSessionBase & {
  surfaceKind: "canvas";
  documentUri: string;
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  disposables: vscode.Disposable[];
  inFlightCanvasHistory: {
    direction: "undo" | "redo";
    expectedDocumentVersion: number;
    changeObserved: boolean;
    commandCompleted: boolean;
  } | null;
  webviewReady: boolean;
  authoritativeDocumentVersion: number | null;
  pendingCanvasNavigation: {
    requestId: number;
    documentVersion: number;
    normalizedSourceOffset: number;
  } | null;
  pendingBake: {
    requestId: number;
    documentVersion: number;
    normalizedSourceOffset: number;
    mode: "current" | "base";
    emitSkippedComments: boolean;
    includeHiddenGeometry: boolean;
    includeDisabledGeometry: boolean;
  } | null;
  inFlightCanvasNavigation: {
    requestId: number;
    documentVersion: number;
    focusSent: boolean;
  } | null;
  pendingCanvasFocus: { requestId: number } | null;
  pendingSourceDefinitionRequest: { requestId: number } | null;
  lastCanvasPointer: VscodeCanvasPointer | null;
};

type WebviewSession = DocumentSession | OutputPreviewSession;

type BakeOperationResultMessage = Extract<VscodeToExtensionMessage, { type: "bakeOperationResult" }>;

let modulePreviewBakeOperationPresenter: ((
  message: BakeOperationResultMessage
) => Promise<void>) | null = null;

export const presentModulePreviewBakeOperationResult = (
  message: BakeOperationResultMessage
): Promise<void> => modulePreviewBakeOperationPresenter?.(message) ?? Promise.resolve();

type LastBakeSurface =
  | { kind: "canvas"; session: DocumentSession }
  | { kind: "source"; document: vscode.TextDocument };

export const extensionDisplayLanguage = (): string => {
  try {
    return vscode.env?.language ?? "en";
  } catch {
    return "en";
  }
};

const sourcePositionAfterCommitIsValid = (
  document: vscode.TextDocument,
  position: { line: number; character: number } | undefined
): position is { line: number; character: number } =>
  position !== undefined &&
  Number.isInteger(position.line) &&
  position.line >= 0 &&
  position.line < document.lineCount &&
  Number.isInteger(position.character) &&
  position.character >= 0 &&
  position.character <= document.lineAt(position.line).range.end.character;

const benchmarkConfigFromEnvironment = (): VscodeBenchmarkConfig | null => {
  const raw = process.env.NUINUICAD_VSCODE_BENCHMARK_CONFIG;
  if (!raw) return null;
  return JSON.parse(raw) as VscodeBenchmarkConfig;
};

const nonce = () => randomBytes(16).toString("hex");

type CanvasRibbonConfiguration = {
  get: <T>(section: string) => T | undefined;
  update: (section: string, value: unknown, target: unknown) => Thenable<void>;
};

const canvasRibbonConfiguration = (): CanvasRibbonConfiguration | null => {
  const getConfiguration = (vscode.workspace as typeof vscode.workspace & {
    getConfiguration?: () => CanvasRibbonConfiguration;
  }).getConfiguration;
  if (typeof getConfiguration !== "function") return null;
  return getConfiguration.call(vscode.workspace);
};

const normalizedCanvasRibbonConfiguration = (): VscodeCanvasRibbon[] => {
  const configuration = canvasRibbonConfiguration();
  if (!configuration) return defaultVscodeCanvasRibbons();
  return normalizeVscodeCanvasRibbons(configuration.get<unknown>(VSCODE_CANVAS_RIBBON_SETTING));
};

const globalConfigurationTarget = (): unknown =>
  (vscode as typeof vscode & { ConfigurationTarget?: { Global: unknown } }).ConfigurationTarget?.Global ?? 1;

const postCanvasRibbonConfiguration = (
  panel: vscode.WebviewPanel,
  ribbons: VscodeCanvasRibbon[] = normalizedCanvasRibbonConfiguration()
): void => {
  void panel.webview.postMessage({
    type: "canvasRibbonConfiguration",
    ribbons
  } satisfies ExtensionToVscodeMessage);
};

const fullDocumentRange = (document: vscode.TextDocument): vscode.Range =>
  new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));

const toVscodeDiagnosticRange = (range: CompilerDiagnosticRange): vscode.Range =>
  new vscode.Range(
    new vscode.Position(range.start.line, range.start.character),
    new vscode.Position(range.end.line, range.end.character)
  );

const toVscodeDiagnostic = (
  document: vscode.TextDocument,
  diagnostic: CompilerDiagnostic,
  displayLanguage: string = extensionDisplayLanguage()
): vscode.Diagnostic => {
  const severity = diagnostic.severity === "error"
    ? vscode.DiagnosticSeverity.Error
    : vscode.DiagnosticSeverity.Warning;
  const result = new vscode.Diagnostic(
    toVscodeDiagnosticRange(diagnostic.range),
    diagnosticMessageFor(diagnostic, displayLanguage),
    severity
  );
  if (diagnostic.code !== undefined) result.code = diagnostic.code;
  result.source = diagnostic.source;
  if (diagnostic.relatedInformation && diagnostic.relatedInformation.length > 0) {
    result.relatedInformation = diagnostic.relatedInformation.map((related) =>
      new vscode.DiagnosticRelatedInformation(
        new vscode.Location(document.uri, toVscodeDiagnosticRange(related.range)),
        diagnosticRelatedTextFor(related, displayLanguage)
      )
    );
  }
  return result;
};

const toVscodeCanvasThemeWarningDiagnostic = (
  document: vscode.TextDocument,
  rawSource: string,
  warning: CanvasThemeWarning
): vscode.Diagnostic => {
  const result = new vscode.Diagnostic(
    vscodeRangeForNormalized(document, rawSource, warning.range),
    warning.message,
    vscode.DiagnosticSeverity.Warning
  );
  result.code = warning.code;
  result.source = warning.source;
  return result;
};

const presentRevealInCanvasOutcome = (outcome: RevealInCanvasPresentationOutcome): void => {
  const displayLanguage = (vscode as typeof vscode & { env?: { language?: string } }).env?.language ?? "en";
  const notification = revealInCanvasNotificationFor(outcome, displayLanguage);
  if (!notification) return;
  if (notification.severity === "warning") {
    void vscode.window.showWarningMessage(notification.message);
  } else {
    void vscode.window.showErrorMessage(notification.message);
  }
};

const webviewHtml = (
  panel: vscode.WebviewPanel,
  context: vscode.ExtensionContext,
  surfaceKind: VscodeWebviewSurfaceKind
): string => {
  const presentation = webviewPresentationFor(extensionDisplayLanguage());
  const script = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview.js"));
  const style = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview.css"));
  const contentNonce = nonce();
  return `<!doctype html>
<html lang="${presentation.locale}" ${vscodeWebviewSurfaceDataAttribute}="${surfaceKind}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${style}" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src 'nonce-${contentNonce}';" />
  </head>
  <body class="vscode-canvas-webview">
    <div id="root"></div>
    <script nonce="${contentNonce}" src="${script}"></script>
  </body>
</html>`;
};

const postWebviewPresentation = (panel: vscode.WebviewPanel): void => {
  void panel.webview.postMessage({
    type: "webviewPresentation",
    presentation: webviewPresentationFor(extensionDisplayLanguage())
  } satisfies ExtensionToVscodeMessage);
};

const rustBinaryPath = (context: vscode.ExtensionContext): string =>
  process.env.NUINUICAD_RUST_EVALUATION_BINARY ?? resolve(context.extensionPath, "..", "rust-evaluator", "target", "debug", "evaluation_stdio");

const postDocumentText = (
  panel: vscode.WebviewPanel,
  sourceText: string,
  documentVersion: number,
  reason: VscodeDocumentChangeReason
): void => {
  void panel.webview.postMessage({
    type: "commitText",
    sourceText,
    documentVersion,
    reason
  } satisfies ExtensionToVscodeMessage);
};

const documentChangeReasonFor = (reason: vscode.TextDocumentChangeReason | undefined): VscodeDocumentChangeReason =>
  reason === vscode.TextDocumentChangeReason.Undo
    ? "undo"
    : reason === vscode.TextDocumentChangeReason.Redo
      ? "redo"
      : "edit";

const postAuthoritativeDocument = (panel: vscode.WebviewPanel, document: vscode.TextDocument): void => {
  void panel.webview.postMessage({
    type: "replaceTextDocument",
    sourceText: document.getText(),
    documentVersion: document.version
  } satisfies ExtensionToVscodeMessage);
};

const postCanvasThemeGeneration = (panel: vscode.WebviewPanel, generation: number): void => {
  void panel.webview.postMessage({
    type: "canvasThemeChanged",
    generation
  } satisfies ExtensionToVscodeMessage);
};

const documentKey = (document: vscode.TextDocument): string => document.uri.toString();

const sameDocument = (left: vscode.TextDocument, right: vscode.TextDocument): boolean =>
  left === right || documentKey(left) === documentKey(right);

const isSupportedNuiDocument = (document: vscode.TextDocument): boolean =>
  document.uri.scheme === "file" && document.fileName.endsWith(".nui");

const activeNuiEditor = (): vscode.TextEditor | undefined => {
  const editor = vscode.window.activeTextEditor;
  return editor && isSupportedNuiDocument(editor.document) ? editor : undefined;
};

const activeEditorTabInput = (): vscode.Tab["input"] | undefined =>
  vscode.window.tabGroups.activeTabGroup.activeTab?.input;

const nuiCanvasViewType = "nuinuiCAD.canvas";
const dynamicNuiCanvasViewType = `mainThreadWebview-${nuiCanvasViewType}`;
const nuiOutputPreviewViewType = "nuinuiCAD.outputPreview";
const dynamicNuiOutputPreviewViewType = `mainThreadWebview-${nuiOutputPreviewViewType}`;

const providerViewTypeForTabInput = (viewType: string): string =>
  viewType === dynamicNuiCanvasViewType
    ? nuiCanvasViewType
    : viewType === dynamicNuiOutputPreviewViewType
      ? nuiOutputPreviewViewType
      : viewType;

const isNuiCanvasTab = (input: vscode.Tab["input"] | undefined): input is vscode.TabInputWebview =>
  input instanceof vscode.TabInputWebview && providerViewTypeForTabInput(input.viewType) === nuiCanvasViewType;

const isNuiOutputPreviewTab = (input: vscode.Tab["input"] | undefined): input is vscode.TabInputWebview =>
  input instanceof vscode.TabInputWebview && providerViewTypeForTabInput(input.viewType) === nuiOutputPreviewViewType;

const activeNuiTextEditorForCommand = (): vscode.TextEditor | undefined => {
  const input = activeEditorTabInput();
  if (!(input instanceof vscode.TabInputText)) return undefined;
  const editor = activeNuiEditor();
  return editor && editor.document.uri.toString() === input.uri.toString() ? editor : undefined;
};

const isOpenDocument = (document: vscode.TextDocument): boolean =>
  vscode.workspace.textDocuments.some((candidate) => sameDocument(candidate, document));

const visibleEditorFor = (document: vscode.TextDocument): vscode.TextEditor | undefined =>
  vscode.window.visibleTextEditors.find((editor) => sameDocument(editor.document, document));

const disposeSessionListeners = (session: WebviewSession): void => {
  for (const disposable of session.disposables.splice(0)) disposable.dispose();
};

let activeCanvasThemeGeneration = 0;

export const currentCanvasThemeGeneration = (): number => activeCanvasThemeGeneration;

type ModulePreviewHistoryDirection = "undo" | "redo";
type ModulePreviewHistoryFallback = (direction: ModulePreviewHistoryDirection) => boolean;

type ModulePreviewBakeMode = "current" | "base";
type ModulePreviewBakeFallback = (mode: ModulePreviewBakeMode, settings: VscodeBakeSettings) => boolean;

let modulePreviewHistoryFallback: ModulePreviewHistoryFallback | null = null;
let modulePreviewBakeFallback: ModulePreviewBakeFallback | null = null;

export const registerModulePreviewHistoryFallback = (
  fallback: ModulePreviewHistoryFallback
): vscode.Disposable => {
  const previous = modulePreviewHistoryFallback;
  modulePreviewHistoryFallback = fallback;
  return {
    dispose: () => {
      if (modulePreviewHistoryFallback === fallback) modulePreviewHistoryFallback = previous;
    }
  };
};

export const registerModulePreviewBakeFallback = (
  fallback: ModulePreviewBakeFallback
): vscode.Disposable => {
  const previous = modulePreviewBakeFallback;
  modulePreviewBakeFallback = fallback;
  return {
    dispose: () => {
      if (modulePreviewBakeFallback === fallback) modulePreviewBakeFallback = previous;
    }
  };
};

export const activate = (context: vscode.ExtensionContext): void => {
  activeCanvasThemeGeneration = 0;
  const sessions = new VscodeWebviewSessionRegistry<WebviewSession>();
  const languageAnalysisSessions = new Map<string, NuiLanguageAnalysisSession>();
  const compilerDiagnosticCollection = vscode.languages.createDiagnosticCollection("nuinuiCAD");
  let bakeOutputChannel: vscode.OutputChannel | null = null;
  const rustProcessOwner = new RustEvaluationProcessOwner((onTerminated) => new RustEvaluationProcess(rustBinaryPath(context), { onTerminated }));
  const benchmarkConfig = benchmarkConfigFromEnvironment();
  let benchmarkStarted = false;
  let benchmarkEditorListener: vscode.Disposable | null = null;
  const canvasHistoryHandoffContextKey = "nuinuiCAD.canvasHistoryHandoff";
  let canvasHistoryHandoffSession: DocumentSession | null = null;
  let lastActiveCanvasSession: DocumentSession | null = null;
  let lastBakeSurface: LastBakeSurface | null = null;
  const surfaceDiagnosticsByUri = new Map<string, vscode.Diagnostic[]>();
  const multiDocumentDiagnosticsByRoot = new Map<string, Map<string, vscode.Diagnostic[]>>();
  const sourceBakeRequestsWithStructuredSkips = new Set<number>();
  let canvasHistoryHandoffContextUpdate: Promise<void> = Promise.resolve();
  let nextNavigationRequestId = 1;
  let nextBakeRequestId = 1;
  let refreshNativeColorProvider: () => void = () => undefined;
  let canvasFreePointAtPointerFeature: VscodeCanvasFreePointAtPointerFeature | null = null;
  let coordinatePointConversionExplorerContextValueFor: (node: import("./elementsTreeProvider").NuiElementsTreeNode) => string | undefined = () => undefined;
  let refreshElementsTree = (): void => undefined;
  let coordinatePointConversionOutputChannel: vscode.OutputChannel | null = null;
  let handleCoordinatePointConversionCommitStart: (
    document: vscode.TextDocument,
    requestId: number,
    operationId: number
  ) => void = () => undefined;
  let handleCoordinatePointConversionDocumentChange = (_document: vscode.TextDocument): void => { void _document; };
  let handleCoordinatePointConversionDocumentClose = (_document: vscode.TextDocument): void => { void _document; };
  let handleInlineModuleCanvasTargetsPublication: VscodeInlineModuleCommandFeature["handleCanvasTargetsPublication"] = () => undefined;
  let handleInlineModuleCanvasAuthoritativeDocumentReady: VscodeInlineModuleCommandFeature["handleCanvasAuthoritativeDocumentReady"] = () => undefined;
  let handleInlineModuleDocumentChange: VscodeInlineModuleCommandFeature["handleDocumentChange"] = () => undefined;
  let handleInlineModuleDocumentClose: VscodeInlineModuleCommandFeature["handleDocumentClose"] = () => undefined;
  let handleExtractModuleCanvasAuthoritativeDocumentReady: VscodeExtractModuleCommandFeature["handleCanvasAuthoritativeDocumentReady"] = () => undefined;
  let handleExtractModuleCanvasObservationPublication: VscodeExtractModuleCommandFeature["handleCanvasObservationPublication"] = () => undefined;
  let handleExtractModuleDocumentChange: VscodeExtractModuleCommandFeature["handleDocumentChange"] = () => undefined;
  let handleExtractModuleDocumentClose: VscodeExtractModuleCommandFeature["handleDocumentClose"] = () => undefined;
  const sourceAuthoringPositionFeature = registerVscodeSourceAuthoringPositionFeature({
    onDocumentInvalidated: (document) => {
      canvasFreePointAtPointerFeature?.handleSourceDocumentInvalidated(document);
    }
  });

  const bakeOutputChannelFor = (): vscode.OutputChannel => {
    if (bakeOutputChannel) return bakeOutputChannel;
    bakeOutputChannel = vscode.window.createOutputChannel("nuinuiCAD Bake");
    context.subscriptions.push(bakeOutputChannel);
    return bakeOutputChannel;
  };

  const presentBakeOperationResultFor = async (message: BakeOperationResultMessage): Promise<void> => {
    await presentBakeOperationResult(message, bakeOutputChannelFor(), {
      showWarningMessage: (notification, action) => vscode.window.showWarningMessage(notification, action),
      showErrorMessage: (notification, action) => vscode.window.showErrorMessage(notification, action)
    }, extensionDisplayLanguage());
  };
  modulePreviewBakeOperationPresenter = presentBakeOperationResultFor;

  const coordinatePointConversionOutputChannelFor = (): vscode.OutputChannel => {
    if (coordinatePointConversionOutputChannel) return coordinatePointConversionOutputChannel;
    coordinatePointConversionOutputChannel = vscode.window.createOutputChannel("nuinuiCAD Coordinate Conversion");
    context.subscriptions.push(coordinatePointConversionOutputChannel);
    return coordinatePointConversionOutputChannel;
  };

  const handleRustEvaluationRequest = async (
    session: WebviewSession,
    message: Extract<VscodeToExtensionMessage, { type: "rustEvaluationRequest" }>
  ): Promise<void> => {
    try {
      const payload = await rustProcessOwner.get().request(message.input);
      void session.panel.webview.postMessage({ type: "rustEvaluationResponse", id: message.id, payload } satisfies ExtensionToVscodeMessage);
    } catch (error) {
      void session.panel.webview.postMessage({
        type: "rustEvaluationError",
        id: message.id,
        error: error instanceof Error ? error.message : String(error)
      } satisfies ExtensionToVscodeMessage);
    }
  };

  const editCanvasRibbon = (): void => {
    void vscode.commands.executeCommand("workbench.action.openSettings", VSCODE_CANVAS_RIBBON_SETTING);
  };

  const broadcastCanvasRibbonConfiguration = (): void => {
    const ribbons = normalizedCanvasRibbonConfiguration();
    for (const session of sessions.valuesForSurface("canvas")) postCanvasRibbonConfiguration(session.panel, ribbons);
  };

  const setCanvasHistoryHandoffContext = (enabled: boolean): Promise<void> => {
    canvasHistoryHandoffContextUpdate = canvasHistoryHandoffContextUpdate
      .catch(() => undefined)
      .then(() => vscode.commands.executeCommand("setContext", canvasHistoryHandoffContextKey, enabled))
      .then(() => undefined);
    return canvasHistoryHandoffContextUpdate;
  };

  const clearCanvasHistoryHandoff = (session: DocumentSession): void => {
    if (canvasHistoryHandoffSession !== session) return;
    canvasHistoryHandoffSession = null;
    void setCanvasHistoryHandoffContext(false).catch(() => undefined);
  };

  const clearCanvasHistoryHandoffIfReady = (session: DocumentSession): void => {
    if (session.panel.active && session.inFlightCanvasHistory === null) clearCanvasHistoryHandoff(session);
  };

  const canvasSessionForCommand = (): DocumentSession | null => {
    if (!isNuiCanvasTab(activeEditorTabInput())) return null;
    const activeSession = sessions.valuesForSurface("canvas").find((candidate) => candidate.panel.active);
    if (activeSession) {
      lastActiveCanvasSession = activeSession;
      return activeSession;
    }
    const remembered = lastActiveCanvasSession;
    return remembered && sessions.get(remembered.documentUri, "canvas") === remembered && remembered.panel.visible
      ? remembered
      : null;
  };

  const canvasSessionForFreePointCommand = (context?: unknown): DocumentSession | null => {
    const activeSession = canvasSessionForCommand();
    if (activeSession || !isVscodeCanvasBlankContext(context)) return activeSession;
    const remembered = lastActiveCanvasSession;
    return remembered && sessions.get(remembered.documentUri, "canvas") === remembered && remembered.panel.visible
      ? remembered
      : null;
  };

  const activeCanvasSessionForOpenCommand = (): DocumentSession | null => {
    if (!isNuiCanvasTab(activeEditorTabInput())) return null;
    return sessions.valuesForSurface("canvas").find((candidate) => candidate.panel.active) ?? null;
  };

  const normalizedRangeIsSafe = (
    document: vscode.TextDocument,
    range: NormalizedSourceRange
  ): boolean => {
    const normalizedSource = normalizedSourceFor(document.getText());
    return Number.isInteger(range.from) &&
      Number.isInteger(range.to) &&
      range.from >= 0 &&
      range.to > range.from &&
      range.to <= normalizedSource.length;
  };

  const outputPreviewFeature = registerOutputPreviewFeature({
    registry: {
      get: (documentUri) => sessions.get(documentUri, "outputPreview"),
      set: (session) => sessions.set(session),
      delete: (documentUri) => sessions.delete(documentUri, "outputPreview"),
      values: () => sessions.valuesForSurface("outputPreview")
    },
    extensionUri: context.extensionUri,
    webviewHtml: (panel) => webviewHtml(panel, context, "outputPreview"),
    postAuthoritativeDocument,
    postDocumentText,
    documentChangeReasonFor,
    documentKey,
    sameDocument,
    isOpenDocument,
    visibleEditorFor,
    isNormalizedRangeSafe: normalizedRangeIsSafe,
    requestRustEvaluation: (input) => rustProcessOwner.get().request(input),
    exportOutput: async (request) => {
      await rustProcessOwner.get().exportOutput(request);
    },
    activeNuiTextEditorForCommand,
    outputPreviewRevealSourceTargetForEditor: (editor) => outputPreviewRevealSourceTargetForEditor(
      editor,
      languageAnalysisSessionFor(editor.document)
    ),
    activeCanvasDocumentForOpenCommand: () => activeCanvasSessionForOpenCommand()?.document ?? null,
    isOutputPreviewTabActive: () => isNuiOutputPreviewTab(activeEditorTabInput())
  });

  const activeOutputPreviewSessionForOpenCommand = (): OutputPreviewSession | null =>
    outputPreviewFeature.activeSessionForOpenCommand();

  const rememberBakeCanvas = (session: DocumentSession): void => {
    lastBakeSurface = { kind: "canvas", session };
  };

  const rememberBakeSource = (document: vscode.TextDocument): void => {
    if (isSupportedNuiDocument(document)) lastBakeSurface = { kind: "source", document };
  };

  const activeCanvasSessionForBake = (): DocumentSession | null => {
    const activeSession = sessions.valuesForSurface("canvas").find((candidate) => candidate.panel.active);
    if (!activeSession) return null;
    lastActiveCanvasSession = activeSession;
    rememberBakeCanvas(activeSession);
    return activeSession;
  };

  const sourceEditorForBakeDocument = (document: vscode.TextDocument): vscode.TextEditor | undefined => {
    const visibleEditor = visibleEditorFor(document);
    if (visibleEditor && isSupportedNuiDocument(visibleEditor.document)) return visibleEditor;
    const activeEditor = activeNuiEditor();
    return activeEditor && sameDocument(activeEditor.document, document) ? activeEditor : undefined;
  };

  const bakeSurfaceForCommand = (options: { skipActiveCanvas?: boolean } = {}):
    | { kind: "canvas"; session: DocumentSession }
    | { kind: "source"; editor: vscode.TextEditor }
    | null => {
    if (!options.skipActiveCanvas) {
      const activeCanvas = activeCanvasSessionForBake();
      if (activeCanvas) return { kind: "canvas", session: activeCanvas };
    }

    const activeSource = activeNuiTextEditorForCommand();
    if (activeSource) {
      rememberBakeSource(activeSource.document);
      return { kind: "source", editor: activeSource };
    }

    if (lastBakeSurface?.kind === "canvas") {
      const session = lastBakeSurface.session;
      if (sessions.get(session.documentUri, "canvas") === session && session.panel.visible) return { kind: "canvas", session };
      lastBakeSurface = null;
    } else if (lastBakeSurface?.kind === "source") {
      const document = lastBakeSurface.document;
      if (isOpenDocument(document)) {
        const editor = sourceEditorForBakeDocument(document);
        if (editor) return { kind: "source", editor };
      } else {
        lastBakeSurface = null;
      }
    }

    return null;
  };

  const sourceIdentityKeyFor = (source: DocumentSourceIdentity): string => source.kind === "root-current"
    ? JSON.stringify([source.kind, String(source.documentId), source.sourceRevision])
    : JSON.stringify([source.kind, String(source.documentId), String(source.savedSourceFingerprint)]);

  const sourceSnapshotFor = (
    snapshot: VscodeMultiDocumentDiagnosticSnapshot,
    location: DocumentQualifiedSourceLocation
  ): MultiDocumentSourceSnapshot | null => {
    const source = snapshot.graph.nodes.get(location.source.documentId)?.artifact.source;
    return source && sourceIdentityKeyFor(source) === sourceIdentityKeyFor(location.source) ? source : null;
  };

  const normalizedPositionAt = (source: string, offset: number): vscode.Position => {
    const clamped = Math.max(0, Math.min(offset, source.length));
    let line = 0;
    let lineStart = 0;
    for (let index = 0; index < clamped; index += 1) {
      if (source[index] === "\n") {
        line += 1;
        lineStart = index + 1;
      }
    }
    return new vscode.Position(line, clamped - lineStart);
  };

  const normalizedRangeFor = (
    source: string,
    range: { from: number; to: number }
  ): vscode.Range => new vscode.Range(
    normalizedPositionAt(source, range.from),
    normalizedPositionAt(source, range.to)
  );

  const targetDocumentFor = (documentId: string): vscode.TextDocument | undefined =>
    vscode.workspace.textDocuments.find((candidate) => documentKey(candidate) === documentId);

  const currentDiagnosticSourceFor = (
    snapshot: VscodeMultiDocumentDiagnosticSnapshot,
    source: MultiDocumentSourceSnapshot,
    document: vscode.TextDocument | undefined
  ): boolean => {
    if (document && normalizedSourceFor(document.getText()) !== source.normalizedSource) return false;
    if (document && source.kind === "dependency-saved" && document.isDirty) return false;
    if (document && source.kind === "root-current" && document.version !== snapshot.documentVersion) return false;
    return true;
  };

  const toVscodeMultiDocumentDiagnostic = (
    snapshot: VscodeMultiDocumentDiagnosticSnapshot,
    diagnostic: VscodeMultiDocumentDiagnostic
  ): { key: string; diagnostic: vscode.Diagnostic } | null => {
    const source = sourceSnapshotFor(snapshot, diagnostic.location);
    if (!source || !currentDiagnosticSourceFor(snapshot, source, targetDocumentFor(String(source.documentId)))) return null;
    const targetDocument = targetDocumentFor(String(source.documentId));
    const targetKey = targetDocument?.uri.toString() ?? String(source.documentId);
    const result = new vscode.Diagnostic(
      normalizedRangeFor(source.normalizedSource, diagnostic.location.range),
      diagnosticMessageFor(diagnostic, extensionDisplayLanguage()),
      diagnostic.severity === "error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
    );
    if (diagnostic.code !== undefined) result.code = diagnostic.code;
    result.source = "nuinuiCAD";
    if (diagnostic.relatedInformation && diagnostic.relatedInformation.length > 0) {
      result.relatedInformation = diagnostic.relatedInformation.flatMap((related) => {
        const relatedSource = sourceSnapshotFor(snapshot, related.location);
        const relatedDocument = relatedSource
          ? targetDocumentFor(String(relatedSource.documentId))
          : undefined;
        if (!relatedSource || !currentDiagnosticSourceFor(snapshot, relatedSource, relatedDocument)) return [];
        const relatedUri = relatedDocument?.uri ?? vscode.Uri.parse(String(relatedSource.documentId));
        return [new vscode.DiagnosticRelatedInformation(
          new vscode.Location(relatedUri, normalizedRangeFor(relatedSource.normalizedSource, related.location.range)),
          diagnosticRelatedTextFor(related, extensionDisplayLanguage())
        )];
      });
    }
    return { key: targetKey, diagnostic: result };
  };

  const diagnosticUriForKey = (key: string): vscode.Uri =>
    targetDocumentFor(key)?.uri ?? vscode.Uri.parse(key);

  const refreshDiagnosticCollectionFor = (keys: ReadonlySet<string>): void => {
    for (const key of keys) {
      const multiDocumentDiagnostics = [...multiDocumentDiagnosticsByRoot.values()]
        .flatMap((byUri) => byUri.get(key) ?? []);
      const surfaceDiagnostics = surfaceDiagnosticsByUri.get(key) ?? [];
      compilerDiagnosticCollection.set(diagnosticUriForKey(key), [
        ...surfaceDiagnostics,
        ...multiDocumentDiagnostics
      ]);
    }
  };

  const sameDiagnosticsState = (
    left: VscodeMultiDocumentDiagnosticsState | null,
    right: VscodeMultiDocumentDiagnosticsState | null
  ): boolean => {
    if (!left || !right) return left === right;
    if (left.status !== right.status || left.rootGeneration !== right.rootGeneration) return false;
    if (left.status !== "current" || right.status !== "current") return true;
    if (left.owner !== right.owner || left.documentVersion !== right.documentVersion) return false;
    if (left.owner !== "multi-document" || right.owner !== "multi-document") return true;
    return left.snapshot.graphRevision === right.snapshot.graphRevision &&
      left.snapshot.rootGeneration === right.snapshot.rootGeneration;
  };

  const publishCurrentDiagnostics = (
    document: vscode.TextDocument,
    session: NuiLanguageAnalysisSession
  ): void => {
    const key = documentKey(document);
    const sourceText = document.getText();
    const multiDocumentHost = activeVscodeMultiDocumentHost();
    const capturedState = multiDocumentHost?.diagnosticsStateFor(document) ?? null;
    if (
      !isOpenDocument(document) ||
      languageAnalysisSessions.get(key) !== session ||
      session.getSource() !== sourceText
    ) return;

    const runtimeDiagnostics = session
      .runtimeDiagnosticsSnapshotFor(document.version)
      ?.diagnostics ?? [];
    const projectedRuntimeDiagnostics = runtimeDiagnostics
      .map((diagnostic) => toCompilerDiagnostic(sourceText, diagnostic))
      .filter((diagnostic): diagnostic is CompilerDiagnostic => diagnostic !== null)
      .map((diagnostic) => toVscodeDiagnostic(document, diagnostic));
    const canvasSession = sessions.get(key, "canvas");
    const canvasThemeWarnings = canvasSession
      ? canvasThemeWarningFeature.warningsFor({
          sessionToken: canvasSession,
          documentUri: key,
          documentVersion: document.version,
          fixedColors: session.fixedColors()
        })
      : [];

    const localCompilerDiagnostics = !capturedState ||
      (capturedState.status === "current" && capturedState.owner === "local")
      ? session.getDiagnostics().map((diagnostic) => toVscodeDiagnostic(document, diagnostic))
      : [];
    const surfaceDiagnostics = [
      ...localCompilerDiagnostics,
      ...projectedRuntimeDiagnostics,
      ...canvasThemeWarnings.map((warning) =>
        toVscodeCanvasThemeWarningDiagnostic(document, sourceText, warning)
      )
    ];
    const previousMultiDocumentDiagnostics = multiDocumentDiagnosticsByRoot.get(key);
    const affectedUris = new Set<string>([
      key,
      ...(previousMultiDocumentDiagnostics?.keys() ?? [])
    ]);
    let nextMultiDocumentDiagnostics: Map<string, vscode.Diagnostic[]> | undefined;

    if (capturedState?.status === "current" && capturedState.owner === "multi-document") {
      const projectedByUri = new Map<string, vscode.Diagnostic[]>();
      for (const diagnostic of capturedState.snapshot.diagnostics) {
        const projected = toVscodeMultiDocumentDiagnostic(capturedState.snapshot, diagnostic);
        if (!projected) continue;
        const bucket = projectedByUri.get(projected.key) ?? [];
        bucket.push(projected.diagnostic);
        projectedByUri.set(projected.key, bucket);
        affectedUris.add(projected.key);
      }
      nextMultiDocumentDiagnostics = projectedByUri;
    }

    if (
      documentKey(document) !== key ||
      !isOpenDocument(document) ||
      document.version !== capturedState?.documentVersion && capturedState?.status === "current" ||
      languageAnalysisSessions.get(key) !== session ||
      session.getSource() !== sourceText ||
      !sameDiagnosticsState(capturedState, multiDocumentHost?.diagnosticsStateFor(document) ?? null)
    ) return;
    multiDocumentDiagnosticsByRoot.delete(key);
    if (nextMultiDocumentDiagnostics) multiDocumentDiagnosticsByRoot.set(key, nextMultiDocumentDiagnostics);
    surfaceDiagnosticsByUri.set(key, surfaceDiagnostics);
    refreshDiagnosticCollectionFor(affectedUris);
  };

  const publishCompilerDiagnostics = (document: vscode.TextDocument): void => {
    if (!isSupportedNuiDocument(document)) return;

    const key = documentKey(document);
    const capturedUri = key;
    const capturedVersion = document.version;
    let session = languageAnalysisSessions.get(key);
    const sourceText = document.getText();
    if (session) {
      session.replaceSource(sourceText);
    } else {
      session = languageAnalysisSessions.get(key) ?? createLanguageAnalysisSession(sourceText);
      if (!languageAnalysisSessions.has(key)) languageAnalysisSessions.set(key, session);
    }

    if (
      documentKey(document) !== capturedUri ||
      languageAnalysisSessions.get(key) !== session ||
      !isOpenDocument(document) ||
      document.version !== capturedVersion
    ) return;
    publishCurrentDiagnostics(document, session);
  };

  const multiDocumentDiagnosticsHost = activeVscodeMultiDocumentHost();
  const multiDocumentDiagnosticsListener = multiDocumentDiagnosticsHost?.onDiagnosticsChanged((documentUri) => {
    const document = vscode.workspace.textDocuments.find((candidate) => documentKey(candidate) === documentUri);
    if (document) publishCompilerDiagnostics(document);
  });

  const canvasThemeWarningFeature = createCanvasThemeWarningFeature({
    currentThemeGeneration: currentCanvasThemeGeneration,
    displayLanguageFor: extensionDisplayLanguage,
    onPreviewThemeChanged: () => refreshNativeColorProvider(),
    onDiagnosticsChanged: (documentUri) => {
      const document = vscode.workspace.textDocuments.find((candidate) => documentKey(candidate) === documentUri);
      const session = languageAnalysisSessions.get(documentUri);
      if (document && session) publishCurrentDiagnostics(document, session);
    }
  });

  const languageAnalysisSessionFor = (document: vscode.TextDocument): NuiLanguageAnalysisSession => {
    const key = documentKey(document);
    const existing = languageAnalysisSessions.get(key);
    if (existing) return existing;
    const session = createLanguageAnalysisSession(document.getText());
    languageAnalysisSessions.set(key, session);
    return session;
  };

  const sourcePositionForCommittedElement = (
    document: vscode.TextDocument,
    elementId: string
  ): { line: number; character: number } | null => {
    const analysis = languageAnalysisSessionFor(document);
    const sourceText = document.getText();
    if (analysis.getSource() !== sourceText) analysis.replaceSource(sourceText);
    const normalizedSource = normalizedSourceFor(sourceText);
    const source = {
      normalizedSource,
      sourceRevision: analysis.getSourceRevision()
    };
    const semantic = currentCompiledSemanticSnapshotFor(analysis, source);
    const info = semantic?.compiled.statementMap?.byElementId.get(elementId);
    if (!info || info.line < 1) return null;
    const line = Math.max(info.range.endLine, info.endLine) - 1;
    if (line >= document.lineCount) return null;
    return { line, character: document.lineAt(line).range.end.character };
  };

  const acceptRuntimeDiagnosticsPublication = (
    session: DocumentSession,
    message: Extract<VscodeToExtensionMessage, { type: "runtimeDiagnosticsPublication" }>
  ): void => {
    if (
      sessions.get(session.documentUri, "canvas") !== session ||
      !isOpenDocument(session.document) ||
      session.authoritativeDocumentVersion !== message.documentVersion ||
      session.document.version !== message.documentVersion
    ) return;

    const analysis = languageAnalysisSessions.get(session.documentUri);
    if (!analysis || analysis.getSource() !== session.document.getText()) return;
    if (!analysis.acceptRuntimeDiagnostics(session.document.version, message)) return;
    publishCurrentDiagnostics(session.document, analysis);
  };

  const hoverFeature = registerNuiHoverFeature({
    rustProcessOwner,
    sessionFor: languageAnalysisSessionFor
  });
  const sourceActivityDecorationFeature = registerNuiSourceActivityDecorationFeature({
    rustProcessOwner,
    sessionFor: languageAnalysisSessionFor
  });

  const observationHostDocuments = (): VscodeObservationHostDocument[] => {
    const activeSourceEditor = activeNuiTextEditorForCommand();
    const activeCanvasSession = activeCanvasSessionForOpenCommand();
    const activeOutputPreviewSession = activeOutputPreviewSessionForOpenCommand();

    return vscode.workspace.textDocuments
      .filter(isSupportedNuiDocument)
      .map((document) => {
        const documentUri = documentKey(document);
        const analysis = languageAnalysisSessions.get(documentUri);
        const sourceText = document.getText();
        const sourceEditorIsActive = activeSourceEditor !== undefined && sameDocument(activeSourceEditor.document, document);
        const canvasIsActive = activeCanvasSession !== null && sameDocument(activeCanvasSession.document, document);
        const outputPreviewIsActive = activeOutputPreviewSession !== null && sameDocument(activeOutputPreviewSession.document, document);
        const selection = sourceEditorIsActive ? activeSourceEditor.selection : null;

        return {
          documentUri,
          documentPath: document.fileName,
          documentVersion: document.version,
          isDirty: document.isDirty,
          activeSurface: sourceEditorIsActive
            ? "source"
            : canvasIsActive
              ? "canvas"
              : outputPreviewIsActive
                ? "outputPreview"
                : "none",
          sourceSelection: selection
            ? {
                anchor: { line: selection.anchor.line, character: selection.anchor.character },
                active: { line: selection.active.line, character: selection.active.character },
                start: { line: selection.start.line, character: selection.start.character },
                end: { line: selection.end.line, character: selection.end.character },
                isEmpty: selection.anchor.line === selection.active.line &&
                  selection.anchor.character === selection.active.character
              }
            : null,
          diagnostics: analysis?.getSource() === sourceText ? analysis.getDiagnostics() : [],
          canvasSessionPresent: sessions.get(documentUri, "canvas") !== undefined,
          outputPreviewSessionPresent: sessions.get(documentUri, "outputPreview") !== undefined
        } satisfies VscodeObservationHostDocument;
      });
  };

  const observationFeature = registerVscodeObservationFeature({
    hostDocuments: observationHostDocuments
  });

  const compilerDiagnosticOpenListener = vscode.workspace.onDidOpenTextDocument((document) => {
    publishCompilerDiagnostics(document);
  });
  const compilerDiagnosticChangeListener = vscode.workspace.onDidChangeTextDocument((event) => {
    if (isSupportedNuiDocument(event.document) && event.contentChanges.length > 0) {
      const key = documentKey(event.document);
      languageAnalysisSessions.get(key)?.clearRuntimeDiagnostics();
      observationFeature.invalidateDocumentRuntime(key);
      handleCoordinatePointConversionDocumentChange(event.document);
      handleInlineModuleDocumentChange(event.document);
      handleExtractModuleDocumentChange(event.document);
    }
    publishCompilerDiagnostics(event.document);
  });
  const compilerDiagnosticCloseListener = vscode.workspace.onDidCloseTextDocument((document) => {
    if (!isSupportedNuiDocument(document)) return;
    handleInlineModuleDocumentClose(document);
    handleExtractModuleDocumentClose(document);
    const key = documentKey(document);
    const previousMultiDocumentDiagnostics = multiDocumentDiagnosticsByRoot.get(key);
    const affectedUris = new Set<string>([
      key,
      ...(previousMultiDocumentDiagnostics?.keys() ?? [])
    ]);
    multiDocumentDiagnosticsByRoot.delete(key);
    surfaceDiagnosticsByUri.delete(key);
    languageAnalysisSessions.delete(key);
    compilerDiagnosticCollection.delete(document.uri);
    affectedUris.delete(key);
    if ([...multiDocumentDiagnosticsByRoot.values()].some((byUri) => byUri.has(key))) {
      affectedUris.add(key);
    }
    refreshDiagnosticCollectionFor(affectedUris);
    observationFeature.removeDocument(key);
    handleCoordinatePointConversionDocumentClose(document);
  });
  const disposeCompilerDiagnosticSessions = {
    dispose: () => languageAnalysisSessions.clear()
  };
  const completionProvider = vscode.languages.registerCompletionItemProvider(
    nuiCompletionSelector,
    createNuiCompletionProvider(languageAnalysisSessionFor),
    ...nuiCompletionTriggerCharacters
  );
  const signatureHelpProvider = vscode.languages.registerSignatureHelpProvider(
    nuiSignatureHelpSelector,
    createNuiSignatureHelpProvider(languageAnalysisSessionFor),
    ...nuiSignatureHelpTriggerCharacters
  );
  const definitionProvider = vscode.languages.registerDefinitionProvider(
    nuiDefinitionSelector,
    createNuiDefinitionProvider(languageAnalysisSessionFor)
  );
  const renameProvider = vscode.languages.registerRenameProvider(
    nuiRenameSelector,
    createNuiRenameProvider(languageAnalysisSessionFor)
  );
  const referenceProvider = vscode.languages.registerReferenceProvider(
    nuiReferenceSelector,
    createNuiReferenceProvider(languageAnalysisSessionFor)
  );
  const choiceQuickFixProvider = vscode.languages.registerCodeActionsProvider(
    nuiChoiceQuickFixSelector,
    createNuiChoiceQuickFixProvider(languageAnalysisSessionFor),
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
  );
  const foldingProvider = vscode.languages.registerFoldingRangeProvider(
    nuiFoldingSelector,
    createNuiFoldingProvider(languageAnalysisSessionFor)
  );
  const documentSymbolProvider = vscode.languages.registerDocumentSymbolProvider(
    nuiDocumentSymbolSelector,
    createNuiDocumentSymbolProvider(languageAnalysisSessionFor)
  );
  let colorProviderRegistration: vscode.Disposable | null = null;
  const refreshColorProvider = (): void => {
    colorProviderRegistration?.dispose();
    colorProviderRegistration = vscode.languages.registerColorProvider(
      nuiColorSelector,
      createNuiColorProvider(
        languageAnalysisSessionFor,
        canvasThemeWarningFeature.currentCanvasTheme
      )
    );
  };
  refreshNativeColorProvider = refreshColorProvider;
  const colorProviderLifecycle: vscode.Disposable = {
    dispose: () => {
      colorProviderRegistration?.dispose();
      colorProviderRegistration = null;
    }
  };
  refreshColorProvider();
  const elementsTreeFeature = registerNuiElementsTreeFeature({
    activeNuiDocument: () => activeNuiEditor()?.document,
    languageAnalysisSessionFor,
    treeItemContextValueFor: (node) => coordinatePointConversionExplorerContextValueFor(node),
    onProviderReady: (provider) => {
      refreshElementsTree = () => provider.refresh();
    }
  });
  context.subscriptions.push(
    compilerDiagnosticCollection,
    observationFeature,
    canvasThemeWarningFeature,
    compilerDiagnosticOpenListener,
    compilerDiagnosticChangeListener,
    compilerDiagnosticCloseListener,
    ...(multiDocumentDiagnosticsListener ? [multiDocumentDiagnosticsListener] : []),
    disposeCompilerDiagnosticSessions,
    hoverFeature,
    sourceActivityDecorationFeature,
    completionProvider,
    colorProviderLifecycle,
    signatureHelpProvider,
    definitionProvider,
    renameProvider,
    referenceProvider,
    choiceQuickFixProvider,
    foldingProvider,
    documentSymbolProvider,
    elementsTreeFeature
  );
  for (const document of vscode.workspace.textDocuments) publishCompilerDiagnostics(document);

  const resync = (session: DocumentSession): void => {
    session.pendingCanvasFocus = null;
    if (sessions.get(session.documentUri, "canvas") !== session || !isOpenDocument(session.document)) return;
    session.authoritativeDocumentVersion = null;
    canvasThemeWarningFeature.invalidateCanvasSession({
      sessionToken: session,
      sessionDocumentUri: session.documentUri
    });
    postAuthoritativeDocument(session.panel, session.document);
  };

  const deliverPendingCanvasNavigation = (session: DocumentSession): void => {
    const pending = session.pendingCanvasNavigation;
    if (
      !pending ||
      !session.webviewReady ||
      session.authoritativeDocumentVersion !== session.document.version ||
      session.inFlightCanvasHistory !== null ||
      canvasHistoryHandoffSession !== null
    ) return;
    session.pendingCanvasNavigation = null;
    session.pendingCanvasFocus = null;
    session.inFlightCanvasNavigation = {
      requestId: pending.requestId,
      documentVersion: pending.documentVersion,
      focusSent: false
    };
    void session.panel.webview.postMessage({
      type: "canvasNavigationRequest",
      requestId: pending.requestId,
      documentVersion: pending.documentVersion,
      normalizedSourceOffset: pending.normalizedSourceOffset
    } satisfies ExtensionToVscodeMessage);
  };

  const deliverPendingBake = (session: DocumentSession): void => {
    const pending = session.pendingBake;
    if (
      !pending ||
      !session.webviewReady ||
      session.authoritativeDocumentVersion !== session.document.version ||
      session.inFlightCanvasHistory !== null ||
      canvasHistoryHandoffSession !== null
    ) return;
    void session.panel.webview.postMessage({
      type: "bakeSourceRequest",
      ...pending
    } satisfies ExtensionToVscodeMessage);
  };

  const handleCanvasSourceDefinitionResult = async (
    session: DocumentSession,
    message: Extract<VscodeToExtensionMessage, { type: "canvasSourceDefinitionResult" }>
  ): Promise<void> => {
    if (
      session.pendingSourceDefinitionRequest?.requestId !== message.requestId ||
      !session.panel.active ||
      session.inFlightCanvasHistory !== null ||
      canvasHistoryHandoffSession !== null
    ) return;
    session.pendingSourceDefinitionRequest = null;
    if (
      message.documentVersion === null ||
      session.document.version !== message.documentVersion
    ) return;

    const activeHost = activeVscodeMultiDocumentHost();
    if (activeHost) {
      if (!message.runtimeElementId) return;
      const resolved = await activeHost.canvasSourceDefinitionFor(
        session.document,
        message.runtimeElementId
      );
      if (!resolved.handled || !resolved.value) return;
      const target = resolved.value;
      let targetDocument: vscode.TextDocument;
      try {
        targetDocument = await vscode.workspace.openTextDocument(target.targetUri);
      } catch {
        return;
      }
      if (
        normalizedSourceFor(targetDocument.getText()) !== target.normalizedSource ||
        (target.sourceIdentity.kind === "dependency-saved" && targetDocument.isDirty) ||
        !normalizedRangeIsSafe(targetDocument, target.range)
      ) return;
      const targetRange = vscodeRangeForNormalized(
        targetDocument,
        targetDocument.getText(),
        target.range
      );
      const visibleEditor = visibleEditorFor(session.document);
      let editor: vscode.TextEditor | undefined;
      try {
        editor = await vscode.window.showTextDocument(targetDocument, {
          viewColumn: visibleEditor?.viewColumn ?? vscode.ViewColumn.Beside,
          preserveFocus: false,
          preview: false,
          selection: new vscode.Range(targetRange.start, targetRange.start)
        });
      } catch {
        return;
      }
      if (
        !editor ||
        normalizedSourceFor(targetDocument.getText()) !== target.normalizedSource ||
        (target.sourceIdentity.kind === "dependency-saved" && targetDocument.isDirty)
      ) return;
      try {
        await vscode.commands.executeCommand("editor.unfold");
      } catch {
        return;
      }
      canvasFreePointAtPointerFeature?.setExplicitSourceAuthoringPosition(targetDocument, {
        documentVersion: targetDocument.version,
        line: targetRange.start.line,
        character: targetRange.start.character
      });
      editor.revealRange(targetRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      clearCanvasHistoryHandoff(session);
      return;
    }

    if (!message.range || !normalizedRangeIsSafe(session.document, message.range)) return;
    const visibleEditor = visibleEditorFor(session.document);
    const range = vscodeRangeForNormalized(session.document, session.document.getText(), message.range);
    let editor: vscode.TextEditor | undefined;
    try {
      editor = await vscode.window.showTextDocument(session.document, {
        viewColumn: visibleEditor?.viewColumn ?? vscode.ViewColumn.Beside,
        preserveFocus: false,
        preview: false,
        selection: new vscode.Range(range.start, range.start)
      });
    } catch {
      return;
    }
    if (!editor || session.document.version !== message.documentVersion) return;
    try {
      await vscode.commands.executeCommand("editor.unfold");
    } catch {
      return;
    }
    if (session.document.version !== message.documentVersion) return;
    canvasFreePointAtPointerFeature?.setExplicitSourceAuthoringPosition(session.document, {
      documentVersion: message.documentVersion,
      line: range.start.line,
      character: range.start.character
    });
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    clearCanvasHistoryHandoff(session);
  };

  const flushPendingCanvasFocus = (session: DocumentSession): void => {
    const pending = session.pendingCanvasFocus;
    const inFlight = session.inFlightCanvasNavigation;
    if (!pending) return;
    if (!inFlight || inFlight.requestId !== pending.requestId) {
      session.pendingCanvasFocus = null;
      return;
    }
    if (!session.panel.active) return;
    if (inFlight.focusSent) {
      session.pendingCanvasFocus = null;
      return;
    }
    session.pendingCanvasFocus = null;
    inFlight.focusSent = true;
    void session.panel.webview.postMessage({ type: "focusCanvas", requestId: pending.requestId } satisfies ExtensionToVscodeMessage);
  };

  const handleCanvasNavigationResult = (
    session: DocumentSession,
    message: Extract<VscodeToExtensionMessage, { type: "canvasNavigationResult" }>
  ): void => {
    const inFlight = session.inFlightCanvasNavigation;
    if (!inFlight || inFlight.requestId !== message.requestId) return;
    if (message.status === "resolved") {
      if (
        session.document.version !== inFlight.documentVersion ||
        session.inFlightCanvasHistory !== null ||
        canvasHistoryHandoffSession !== null
      ) {
        session.pendingCanvasFocus = null;
        session.inFlightCanvasNavigation = null;
        return;
      }
      presentRevealInCanvasOutcome({ status: "resolved", degradations: message.degradations });
      if (inFlight.focusSent) return;
      session.pendingCanvasFocus = { requestId: message.requestId };
      session.panel.reveal(vscode.ViewColumn.Beside, false);
      flushPendingCanvasFocus(session);
      return;
    }
    if (message.status === "focused") {
      session.pendingCanvasFocus = null;
      session.inFlightCanvasNavigation = null;
      return;
    }
    session.pendingCanvasFocus = null;
    session.inFlightCanvasNavigation = null;
    presentRevealInCanvasOutcome({ status: "failed", reason: message.reason });
    deliverPendingCanvasNavigation(session);
  };

  const completeCanvasHistory = (session: DocumentSession): void => {
    const inFlightHistory = session.inFlightCanvasHistory;
    if (!inFlightHistory) return;
    if (!inFlightHistory.commandCompleted) return;
    if (
      inFlightHistory.changeObserved &&
      session.authoritativeDocumentVersion !== session.document.version
    ) return;
    session.inFlightCanvasHistory = null;
    session.panel.reveal(vscode.ViewColumn.Beside, false);
    void session.panel.webview.postMessage({
      type: "canvasHistoryResult",
      direction: inFlightHistory.direction,
      status: "completed",
      documentVersion: session.document.version
    } satisfies ExtensionToVscodeMessage);
  };

  const activeColorThemeListener = vscode.window.onDidChangeActiveColorTheme(() => {
    activeCanvasThemeGeneration += 1;
    canvasThemeWarningFeature.invalidateCanvasThemeGeneration(activeCanvasThemeGeneration);
    const canvasSessions = sessions.valuesForSurface("canvas");
    for (const session of canvasSessions) {
      postCanvasThemeGeneration(session.panel, activeCanvasThemeGeneration);
    }
    for (const session of sessions.valuesForSurface("outputPreview")) {
      postCanvasThemeGeneration(session.panel, activeCanvasThemeGeneration);
    }
  });
  context.subscriptions.push(activeColorThemeListener);

  const canvasRibbonConfigurationListener = vscode.workspace.onDidChangeConfiguration?.((event) => {
    if (event.affectsConfiguration(VSCODE_CANVAS_RIBBON_SETTING)) {
      broadcastCanvasRibbonConfiguration();
    }
  });
  if (canvasRibbonConfigurationListener) context.subscriptions.push(canvasRibbonConfigurationListener);

  const postCanvasCommitResult = (
    session: DocumentSession,
    message: Extract<VscodeToExtensionMessage, { type: "canvasCommit" }>,
    status: "accepted" | "rejected"
  ): void => {
    if (message.operationId === undefined) return;
    void session.panel.webview.postMessage({
      type: "canvasCommitResult",
      operationId: message.operationId,
      status,
      documentVersion: session.document.version
    } satisfies ExtensionToVscodeMessage);
  };

  const applyCanvasCommit = async (
    session: DocumentSession,
    message: Extract<VscodeToExtensionMessage, { type: "canvasCommit" }>
  ): Promise<void> => {
    const matchingDocumentAvailable = isOpenDocument(session.document);

    if (!matchingDocumentAvailable || session.document.version !== message.expectedDocumentVersion) {
      resync(session);
      postCanvasCommitResult(session, message, "rejected");
      return;
    }

    const editor = visibleEditorFor(session.document);
    if (!editor) {
      resync(session);
      postCanvasCommitResult(session, message, "rejected");
      return;
    }

    const sourceText = session.document.getText();
    const lineEdits: Array<{ range: vscode.Range; replacement: string }> = [];
    if (message.mutationKind === "model-patch") {
      if (!message.splices) {
        resync(session);
        postCanvasCommitResult(session, message, "rejected");
        return;
      }
      try {
        const patchedText = applyLineSplices(sourceText, message.splices);
        if (patchedText !== message.sourceText) {
          resync(session);
          postCanvasCommitResult(session, message, "rejected");
          return;
        }
        lineEdits.push(...message.splices.map((splice) => textEditForLineSplice(session.document, sourceText, splice)));
      } catch {
        resync(session);
        postCanvasCommitResult(session, message, "rejected");
        return;
      }
    }
    if (message.sourceCreation && message.operationId === message.sourceCreation.requestId) {
      sourceAuthoringPositionFeature.markCommandOwnedEdit(message.operationId);
    } else if (message.operationId !== undefined && message.coordinatePointConversionRequestId === undefined) {
      canvasFreePointAtPointerFeature?.markCanvasEdit(message.operationId);
    }
    if (message.coordinatePointConversionRequestId !== undefined && message.operationId !== undefined) {
      handleCoordinatePointConversionCommitStart(
        session.document,
        message.coordinatePointConversionRequestId,
        message.operationId,
        normalizedSourceFor(message.sourceText)
      );
    }
    let editResult: Thenable<boolean>;
    try {
      editResult = editor.edit((editBuilder) => {
        if (message.mutationKind === "model-patch") {
          for (const edit of lineEdits) editBuilder.replace(edit.range, edit.replacement);
          return;
        }
        editBuilder.replace(fullDocumentRange(session.document), message.sourceText);
      }, { undoStopBefore: true, undoStopAfter: true });
    } catch {
      if (message.sourceCreation) sourceAuthoringPositionFeature.rejectCommandOwnedEdit(message.sourceCreation.requestId);
      resync(session);
      postCanvasCommitResult(session, message, "rejected");
      return;
    }

    try {
      const editCompleted = await editResult;
      if (!editCompleted) {
        if (message.sourceCreation) sourceAuthoringPositionFeature.rejectCommandOwnedEdit(message.sourceCreation.requestId);
        resync(session);
        postCanvasCommitResult(session, message, "rejected");
        return;
      }
      if (message.sourceCreation) {
        const committedElementPosition = message.sourceCreation.insertedElementId
          ? sourcePositionForCommittedElement(session.document, message.sourceCreation.insertedElementId)
          : null;
        // The Webview owns the live element identity. New statements normally
        // have a generated runtime id that is not serialized into Source, so
        // prefer the Webview's statement-map position and use the host lookup
        // only for explicitly persisted ids.
        const postPosition = message.sourceCreation.nextSourcePosition ?? committedElementPosition ?? undefined;
        if (!sourcePositionAfterCommitIsValid(session.document, postPosition) || !sourceAuthoringPositionFeature.completeCommandOwnedEdit({
          requestId: message.sourceCreation.requestId,
          document: session.document,
          documentVersion: session.document.version,
          postPosition
        })) {
          sourceAuthoringPositionFeature.rejectCommandOwnedEdit(message.sourceCreation.requestId);
          resync(session);
          postCanvasCommitResult(session, message, "rejected");
          return;
        }
      }
      postCanvasCommitResult(session, message, "accepted");
    } catch {
      if (message.sourceCreation) sourceAuthoringPositionFeature.rejectCommandOwnedEdit(message.sourceCreation.requestId);
      resync(session);
      postCanvasCommitResult(session, message, "rejected");
    }
  };

  const applyCanvasHistory = async (
    session: DocumentSession,
    message: Extract<VscodeToExtensionMessage, { type: "canvasHistoryRequest" }>
  ): Promise<void> => {
    session.pendingCanvasFocus = null;
    const postResult = (status: "completed" | "resynced" | "failed") => {
      void session.panel.webview.postMessage({
        type: "canvasHistoryResult",
        direction: message.direction,
        status,
        documentVersion: session.document.version
      } satisfies ExtensionToVscodeMessage);
    };
    let sourceEditorActivated = false;
    const failClosed = (status: "resynced" | "failed") => {
      session.pendingCanvasFocus = null;
      session.inFlightCanvasHistory = null;
      resync(session);
      postResult(status);
      if (sourceEditorActivated) {
        session.panel.reveal(vscode.ViewColumn.Beside, false);
        return;
      }
      clearCanvasHistoryHandoffIfReady(session);
    };

    if (!session.panel.active) {
      failClosed("resynced");
      return;
    }
    if (!isOpenDocument(session.document)) {
      failClosed("resynced");
      return;
    }
    if (session.document.version !== message.expectedDocumentVersion) {
      failClosed("resynced");
      return;
    }

    const editor = visibleEditorFor(session.document);
    if (!editor) {
      failClosed("resynced");
      return;
    }

    const expectedVersion = session.document.version;
    session.inFlightCanvasHistory = {
      direction: message.direction,
      expectedDocumentVersion: expectedVersion,
      changeObserved: false,
      commandCompleted: false
    };
    session.pendingCanvasFocus = null;
    canvasHistoryHandoffSession = session;
    try {
      await setCanvasHistoryHandoffContext(true);
      if (canvasHistoryHandoffSession !== session || sessions.get(session.documentUri, "canvas") !== session) return;
      await vscode.window.showTextDocument(session.document, {
        viewColumn: editor.viewColumn,
        preserveFocus: false,
        preview: false
      });
      sourceEditorActivated = true;
      const nativeHistoryCommand = message.direction === "undo" ? "undo" : "redo";
      await vscode.commands.executeCommand(nativeHistoryCommand);
    } catch {
      failClosed("failed");
      return;
    }

    const inFlightHistory = session.inFlightCanvasHistory;
    if (!inFlightHistory) return;
    inFlightHistory.commandCompleted = true;

    if (!isOpenDocument(session.document)) {
      failClosed("resynced");
      return;
    }

    if (inFlightHistory.changeObserved || session.document.version === inFlightHistory.expectedDocumentVersion) {
      completeCanvasHistory(session);
      canvasFreePointAtPointerFeature?.handleAuthoritativeDocumentReady(
        session,
        session.document,
        session.document.version
      );
    }
  };

  const disposeCanvasSession = (session: DocumentSession): void => {
    if (sessions.get(session.documentUri, "canvas") !== session) return;
    sourceAuthoringPositionFeature.disposeSession(session, session.document);
    canvasFreePointAtPointerFeature?.disposeSession(session, session.document);
    if (lastActiveCanvasSession === session) lastActiveCanvasSession = null;
    if (lastBakeSurface?.kind === "canvas" && lastBakeSurface.session === session) lastBakeSurface = null;
    session.inFlightCanvasHistory = null;
    session.pendingCanvasFocus = null;
    clearCanvasHistoryHandoff(session);
    sessions.delete(session.documentUri, "canvas");
    canvasThemeWarningFeature.removeCanvasSession({
      sessionToken: session,
      sessionDocumentUri: session.documentUri
    });
    observationFeature.removeCanvasSession(session.documentUri);
    disposeSessionListeners(session);
    updatePanelTitles();
  };

  const disposeSession = (session: WebviewSession): void => {
    if (session.surfaceKind === "canvas") disposeCanvasSession(session);
    else outputPreviewFeature.disposeSession(session);
  };

  const updatePanelTitles = (): void => {
    const sessionsByBasename = new Map<string, DocumentSession[]>();
    for (const session of sessions.valuesForSurface("canvas")) {
      const name = basename(session.document.fileName);
      const group = sessionsByBasename.get(name) ?? [];
      group.push(session);
      sessionsByBasename.set(name, group);
    }

    for (const [name, matchingSessions] of sessionsByBasename) {
      for (const session of matchingSessions) {
        const documentName = matchingSessions.length === 1
          ? name
          : vscode.workspace.asRelativePath(session.document.uri, true);
        session.panel.title = `${documentName} — nuinuiCAD`;
      }
    }
  };

  const createCanvasPanel = (
    document: vscode.TextDocument,
    preserveFocus = false
  ): DocumentSession | undefined => {
    const documentUri = documentKey(document);
    const existing = sessions.get(documentUri, "canvas");
    if (existing) {
      if (preserveFocus) existing.panel.reveal(vscode.ViewColumn.Beside, true);
      else existing.panel.reveal(vscode.ViewColumn.Beside);
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      "nuinuiCAD.canvas",
      `${basename(document.fileName)} — nuinuiCAD`,
      preserveFocus
        ? { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }
        : vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")]
      }
    );
    panel.webview.html = webviewHtml(panel, context, "canvas");
    const session: DocumentSession = {
      documentUri,
      surfaceKind: "canvas",
      document,
      panel,
      disposables: [],
      inFlightCanvasHistory: null,
      webviewReady: false,
      authoritativeDocumentVersion: null,
      pendingCanvasNavigation: null,
      pendingBake: null,
      inFlightCanvasNavigation: null,
      pendingCanvasFocus: null,
      pendingSourceDefinitionRequest: null,
      lastCanvasPointer: null
    };
    sessions.set(session);
    if (panel.active) rememberBakeCanvas(session);
    updatePanelTitles();

    const post = (message: ExtensionToVscodeMessage) => void panel.webview.postMessage(message);
    if (!benchmarkConfig) {
      session.disposables.push(vscode.workspace.onDidChangeTextDocument((event) => {
        if (sameDocument(event.document, session.document)) {
          if (event.contentChanges.length === 0) return;

          session.authoritativeDocumentVersion = null;
          canvasThemeWarningFeature.invalidateCanvasSession({
            sessionToken: session,
            sessionDocumentUri: session.documentUri
          });
          session.pendingCanvasNavigation = null;
          session.pendingBake = null;
          session.pendingCanvasFocus = null;
          session.inFlightCanvasNavigation = null;
          session.pendingSourceDefinitionRequest = null;
          observationFeature.invalidateDocumentRuntime(session.documentUri);

          const inFlightHistory = session.inFlightCanvasHistory;
          const documentChangedDuringCanvasHistory = inFlightHistory !== null
            && !inFlightHistory.changeObserved
            && event.document.version !== inFlightHistory.expectedDocumentVersion;
          if (documentChangedDuringCanvasHistory) {
            inFlightHistory.changeObserved = true;
          }
          const sourceText = event.document.getText();
          const effectiveReason = documentChangedDuringCanvasHistory
            ? inFlightHistory.direction
            : documentChangeReasonFor(event.reason);
          postDocumentText(
            panel,
            sourceText,
            event.document.version,
            effectiveReason
          );
          if (documentChangedDuringCanvasHistory && inFlightHistory.commandCompleted) {
            completeCanvasHistory(session);
          }
        }
      }));
    }

    session.disposables.push(panel.onDidChangeViewState(() => {
      if (panel.active) {
        lastActiveCanvasSession = session;
        rememberBakeCanvas(session);
      }
      if (panel.active && session.inFlightCanvasHistory === null) clearCanvasHistoryHandoff(session);
      flushPendingCanvasFocus(session);
    }));

    session.disposables.push(panel.webview.onDidReceiveMessage(async (message: VscodeToExtensionMessage) => {
      if (message.type === "webviewReady") {
        session.webviewReady = true;
        session.authoritativeDocumentVersion = null;
        session.pendingCanvasFocus = null;
        postCanvasThemeGeneration(panel, activeCanvasThemeGeneration);
        postWebviewPresentation(panel);
        postAuthoritativeDocument(panel, session.document);
        postCanvasRibbonConfiguration(panel);
        if (benchmarkConfig) post({ type: "benchmarkConfig", config: benchmarkConfig });
        return;
      }
      if (message.type === "canvasPointerPublication") {
        if (
          !isVscodeCanvasPointer(message.pointer) ||
          !session.webviewReady ||
          sessions.get(session.documentUri, "canvas") !== session ||
          !isOpenDocument(session.document) ||
          session.authoritativeDocumentVersion !== message.documentVersion ||
          session.document.version !== message.documentVersion
        ) return;
        session.lastCanvasPointer = message.pointer;
        return;
      }
      if (message.type === "canvasFreePointAtPointerResult") {
        canvasFreePointAtPointerFeature?.handleResult(session, session.document, message);
        return;
      }
      if (message.type === "runtimeDiagnosticsPublication") {
        acceptRuntimeDiagnosticsPublication(session, message);
        return;
      }
      if (message.type === "canvasThemePublication") {
        canvasThemeWarningFeature.acceptCanvasThemePublication({
          ...message,
          sessionToken: session,
          sessionDocumentUri: session.documentUri,
          sessionIsCurrent: sessions.get(session.documentUri, "canvas") === session &&
            isOpenDocument(session.document) &&
            session.authoritativeDocumentVersion === message.documentVersion,
          currentDocumentVersion: session.document.version
        });
        return;
      }
      if (message.type === "canvasObservationPublication") {
        observationFeature.acceptCanvasPublication({
          sessionDocumentUri: session.documentUri,
          sessionSurfaceKind: session.surfaceKind,
          sessionIsCurrent: sessions.get(session.documentUri, "canvas") === session && isOpenDocument(session.document),
          currentDocumentVersion: session.document.version,
          snapshot: message.snapshot
        });
        handleExtractModuleCanvasObservationPublication(session.document);
        return;
      }
      if (message.type === "inlineModuleCanvasTargetsPublication") {
        if (
          !session.webviewReady ||
          !isOpenDocument(session.document) ||
          sessions.get(session.documentUri, "canvas") !== session ||
          session.authoritativeDocumentVersion !== message.documentVersion ||
          session.document.version !== message.documentVersion
        ) return;
        handleInlineModuleCanvasTargetsPublication(session.document, message);
        return;
      }
      if (message.type === "canvasRibbonPositionCommit") {
        if (!message.ribbonId || !Number.isFinite(message.x) || !Number.isFinite(message.y)) return;
        const configuration = canvasRibbonConfiguration();
        if (!configuration) return;
        const current = configuration.get<unknown>(VSCODE_CANVAS_RIBBON_SETTING);
        const patched = patchVscodeCanvasRibbonPosition(
          current,
          message.ribbonId,
          message.x,
          message.y
        );
        if (!patched) return;
        await configuration.update(
          VSCODE_CANVAS_RIBBON_SETTING,
          patched,
          globalConfigurationTarget()
        );
        return;
      }
      if (message.type === "editCanvasRibbon") {
        editCanvasRibbon();
        return;
      }
      if (message.type === "webviewAuthoritativeDocumentReady") {
        if (
          message.documentVersion !== session.document.version ||
          sessions.get(session.documentUri, "canvas") !== session ||
          !isOpenDocument(session.document)
        ) return;
        session.authoritativeDocumentVersion = message.documentVersion;
        completeCanvasHistory(session);
        canvasFreePointAtPointerFeature?.handleAuthoritativeDocumentReady(
          session,
          session.document,
          message.documentVersion
        );
        handleInlineModuleCanvasAuthoritativeDocumentReady(session.document, message.documentVersion);
        handleExtractModuleCanvasAuthoritativeDocumentReady(session.document, message.documentVersion);
        deliverPendingCanvasNavigation(session);
        deliverPendingBake(session);
        sessions.replayLatestMultiDocumentGraphPublication(session);
        return;
      }
      if (message.type === "canvasSourceDefinitionResult") {
        await handleCanvasSourceDefinitionResult(session, message);
        return;
      }
      if (message.type === "canvasNavigationResult") {
        handleCanvasNavigationResult(session, message);
        return;
      }
      if (message.type === "bakeOperationResult") {
        if (message.surface === "source") {
          if (!session.pendingBake || session.pendingBake.requestId !== message.requestId) return;
          if (message.summary.skippedTargetCount > 0) sourceBakeRequestsWithStructuredSkips.add(message.requestId);
          else sourceBakeRequestsWithStructuredSkips.delete(message.requestId);
        }
        await presentBakeOperationResultFor(message);
        return;
      }
      if (message.type === "bakeSourceResult") {
        if (!session.pendingBake || session.pendingBake.requestId !== message.requestId) return;
        session.pendingBake = null;
        const hasStructuredSkips = sourceBakeRequestsWithStructuredSkips.delete(message.requestId);
        if (message.status === "nothing" && !hasStructuredSkips) {
          void vscode.window.showErrorMessage(canvasPresentationTextFor("canvas.noBakeTarget", extensionDisplayLanguage()));
        }
        if (message.status === "stale") resync(session);
        return;
      }
      if (message.type === "canvasCommit") {
        if (benchmarkConfig) return;
        await applyCanvasCommit(session, message);
        return;
      }
      if (message.type === "canvasHistoryRequest") {
        if (benchmarkConfig) return;
        await applyCanvasHistory(session, message);
        return;
      }
      if (message.type === "rustEvaluationRequest") {
        await handleRustEvaluationRequest(session, message);
        return;
      }
      if (message.type === "benchmarkResult") {
        if (!benchmarkConfig) return;
        mkdirSync(resolve(benchmarkConfig.resultPath, ".."), { recursive: true });
        writeFileSync(benchmarkConfig.resultPath, `${JSON.stringify(message.result, null, 2)}\n`, "utf8");
        return;
      }
      if (message.type === "benchmarkError") {
        if (!benchmarkConfig) return;
        writeFileSync(`${benchmarkConfig.resultPath}.error.json`, JSON.stringify({ runId: benchmarkConfig.runId, error: message.error }, null, 2), "utf8");
      }
    }));

    panel.onDidDispose(() => {
      disposeSession(session);
      if (benchmarkConfig && !existsSync(benchmarkConfig.resultPath) && !existsSync(`${benchmarkConfig.resultPath}.error.json`)) {
        writeFileSync(`${benchmarkConfig.resultPath}.error.json`, JSON.stringify({ runId: benchmarkConfig.runId, error: "Performance PoC panel closed before completion" }, null, 2), "utf8");
      }
    });
    return session;
  };

  const inlineModuleFeature: VscodeInlineModuleCommandFeature = registerVscodeInlineModuleCommandFeature({
    languageAnalysisSessionFor,
    activeSourceEditor: activeNuiTextEditorForCommand,
    sourceEditorForDocument: visibleEditorFor,
    activeCanvasEndpoint: (): InlineModuleCanvasEndpoint | null => {
      const session = canvasSessionForCommand();
      if (
        !session ||
        !session.webviewReady ||
        !isOpenDocument(session.document) ||
        sessions.get(session.documentUri, "canvas") !== session ||
        canvasHistoryHandoffSession !== null ||
        session.inFlightCanvasHistory !== null
      ) return null;
      return {
        document: session.document,
        panel: session.panel,
        isAuthoritativeReady: () =>
          canvasHistoryHandoffSession === null &&
          sessions.get(session.documentUri, "canvas") === session &&
          session.webviewReady &&
          session.authoritativeDocumentVersion === session.document.version &&
          session.inFlightCanvasHistory === null
      };
    },
    applySourceLineSplices
  });
  handleInlineModuleCanvasTargetsPublication = inlineModuleFeature.handleCanvasTargetsPublication;
  handleInlineModuleCanvasAuthoritativeDocumentReady = inlineModuleFeature.handleCanvasAuthoritativeDocumentReady;
  handleInlineModuleDocumentChange = inlineModuleFeature.handleDocumentChange;
  handleInlineModuleDocumentClose = inlineModuleFeature.handleDocumentClose;

  const extractModuleFeature: VscodeExtractModuleCommandFeature = registerVscodeExtractModuleCommandFeature({
    languageAnalysisSessionFor,
    activeSourceEditor: activeNuiTextEditorForCommand,
    sourceEditorForDocument: visibleEditorFor,
    activeCanvasEndpoint: (): ExtractModuleCanvasEndpoint | null => {
      const session = canvasSessionForCommand();
      if (
        !session ||
        !session.webviewReady ||
        !isOpenDocument(session.document) ||
        sessions.get(session.documentUri, "canvas") !== session ||
        canvasHistoryHandoffSession !== null ||
        session.inFlightCanvasHistory !== null
      ) return null;
      return {
        document: session.document,
        panel: session.panel,
        isAuthoritativeReady: () =>
          canvasHistoryHandoffSession === null &&
          sessions.get(session.documentUri, "canvas") === session &&
          session.webviewReady &&
          session.authoritativeDocumentVersion === session.document.version &&
          session.inFlightCanvasHistory === null,
        observation: () => {
          const snapshot = vscodeObservationState.snapshot();
          return snapshot.documents.find((document) =>
            document.documentUri === session.documentUri && document.activeSurface === "canvas"
          )?.canvas ?? null;
        }
      };
    },
    navigateCanvasToSourceOffset: (endpoint, normalizedSourceOffset) => {
      const session = sessions.get(documentKey(endpoint.document), "canvas");
      if (
        !session ||
        session.panel !== endpoint.panel ||
        canvasSessionForCommand() !== session ||
        session.inFlightCanvasHistory !== null ||
        canvasHistoryHandoffSession !== null ||
        !isOpenDocument(session.document)
      ) return false;
      const requestId = nextNavigationRequestId++;
      session.pendingCanvasNavigation = {
        requestId,
        documentVersion: session.document.version,
        normalizedSourceOffset
      };
      session.pendingCanvasFocus = null;
      session.panel.reveal(vscode.ViewColumn.Beside, true);
      deliverPendingCanvasNavigation(session);
      return true;
    },
    applySourceLineSplices
  });
  handleExtractModuleCanvasAuthoritativeDocumentReady = extractModuleFeature.handleCanvasAuthoritativeDocumentReady;
  handleExtractModuleCanvasObservationPublication = extractModuleFeature.handleCanvasObservationPublication;
  handleExtractModuleDocumentChange = extractModuleFeature.handleDocumentChange;
  handleExtractModuleDocumentClose = extractModuleFeature.handleDocumentClose;

  const coordinatePointConversionFeature: VscodeCoordinatePointConversionFeature = registerVscodeCoordinatePointConversionFeature({
    languageAnalysisSessionFor,
    rustProcessOwner,
    ensureCanvas: (document): CoordinatePointConversionCanvasEndpoint | null => {
      const key = documentKey(document);
      let session = sessions.get(key, "canvas");
      if (canvasHistoryHandoffSession !== null || (session && session.inFlightCanvasHistory !== null)) return null;
      if (!session) session = createCanvasPanel(document, true);
      if (!session || !sameDocument(session.document, document)) return null;
      const matchingSession = session;
      return {
        document: matchingSession.document,
        panel: matchingSession.panel,
        isAuthoritativeReady: () =>
          canvasHistoryHandoffSession === null &&
          sessions.get(key, "canvas") === matchingSession &&
          matchingSession.webviewReady &&
          matchingSession.authoritativeDocumentVersion === matchingSession.document.version &&
          matchingSession.inFlightCanvasHistory === null,
        targetSources: () => []
      };
    },
    activeCanvasEndpoint: (): CoordinatePointConversionCanvasEndpoint | null => {
      const session = canvasSessionForCommand();
      if (!session || !session.webviewReady || !isOpenDocument(session.document) ||
          sessions.get(session.documentUri, "canvas") !== session) return null;
      return {
        document: session.document,
        panel: session.panel,
        isAuthoritativeReady: () =>
          sessions.get(session.documentUri, "canvas") === session &&
          session.webviewReady &&
          session.authoritativeDocumentVersion === session.document.version &&
          session.inFlightCanvasHistory === null,
        targetSources: () => {
          const observation = vscodeObservationState.cachedSnapshot();
          const document = observation.documents.find((candidate) => candidate.documentUri === session.documentUri);
          return coordinatePointConversionCanvasTargetsFor(document?.canvas);
        }
      };
    },
    applySourceLineSplices,
    activeExplorerDocument: () => activeNuiEditor()?.document,
    isSourceEditorActive: () => activeNuiTextEditorForCommand() !== undefined,
    refreshElementsTree: () => refreshElementsTree(),
    output: () => coordinatePointConversionOutputChannelFor()
  });
  coordinatePointConversionExplorerContextValueFor = coordinatePointConversionFeature.explorerContextValueFor;
  handleCoordinatePointConversionCommitStart = coordinatePointConversionFeature.handleCommitStart;
  handleCoordinatePointConversionDocumentChange = coordinatePointConversionFeature.handleDocumentChange;
  handleCoordinatePointConversionDocumentClose = coordinatePointConversionFeature.handleDocumentClose;

  const referencePickFeature = registerVscodeReferencePickFeature({
    languageAnalysisSessionFor,
    ensureCanvas: (document): VscodeReferencePickCanvasEndpoint | null => {
      const key = documentKey(document);
      let session = sessions.get(key, "canvas");
      if (canvasHistoryHandoffSession !== null || (session && session.inFlightCanvasHistory !== null)) return null;
      if (!session) session = createCanvasPanel(document, true);
      if (!session || !sameDocument(session.document, document)) return null;
      const matchingSession = session;
      return {
        document: matchingSession.document,
        panel: matchingSession.panel,
        isAuthoritativeReady: () =>
          canvasHistoryHandoffSession === null &&
          sessions.get(key, "canvas") === matchingSession &&
          matchingSession.webviewReady &&
          matchingSession.authoritativeDocumentVersion === matchingSession.document.version &&
          matchingSession.inFlightCanvasHistory === null
      };
    }
  });
  const geometryReferenceRetargetFeature = registerVscodeGeometryReferenceRetargetFeature({
    languageAnalysisSessionFor
  });
  const sourceValueStepFeature = registerVscodeSourceValueStepFeature({
    languageAnalysisSessionFor
  });
  const canvasQuickCreateFeature = registerVscodeCanvasQuickCreateFeature({
    activeCanvasEndpoint: (): VscodeCanvasCreationEndpoint | null => {
      const session = canvasSessionForCommand();
      if (
        !session ||
        !session.webviewReady ||
        session.authoritativeDocumentVersion !== session.document.version ||
        !isOpenDocument(session.document) ||
        sessions.get(session.documentUri, "canvas") !== session
      ) return null;
      const documentVersion = session.document.version;
      const isCurrent = (): boolean =>
        canvasSessionForCommand() === session &&
        sessions.get(session.documentUri, "canvas") === session &&
        isOpenDocument(session.document) &&
        session.webviewReady &&
        session.authoritativeDocumentVersion === documentVersion &&
        session.document.version === documentVersion;
      return {
        sessionToken: session,
        isCurrent,
        postCreationCommand: (commandId) => {
          if (!isCurrent()) return;
          const retained = sourceAuthoringPositionFeature.sourceAuthoringPositionFor(session.document);
          if (!retained) {
            void vscode.window.showErrorMessage(canvasPresentationTextFor("canvas.sourceAnchor", extensionDisplayLanguage()));
            return;
          }
          if (retained.documentVersion !== session.document.version) {
            void vscode.window.showErrorMessage(canvasPresentationTextFor("canvas.staleSourceAnchor", extensionDisplayLanguage()));
            return;
          }
          const request = sourceAuthoringPositionFeature.beginCanvasCreation(session, session.document);
          if (!request) {
            void vscode.window.showErrorMessage(canvasPresentationTextFor("canvas.staleSourceAnchor", extensionDisplayLanguage()));
            return;
          }
          void session.panel.webview.postMessage({
            type: "canvasCreationCommand",
            commandId,
            requestId: request.requestId,
            documentVersion: request.documentVersion,
            sourcePosition: {
              line: request.sourcePosition.line,
              character: request.sourcePosition.character
            }
          } satisfies ExtensionToVscodeMessage);
        }
      };
    }
  });
  canvasFreePointAtPointerFeature = registerVscodeCanvasFreePointAtPointerFeature({
    sourceAuthoringPosition: sourceAuthoringPositionFeature,
    activeCanvasEndpoint: (context?: unknown): VscodeCanvasFreePointAtPointerEndpoint | null => {
      const session = canvasSessionForFreePointCommand(context);
      if (
        !session ||
        !session.webviewReady ||
        !isOpenDocument(session.document) ||
        sessions.get(session.documentUri, "canvas") !== session
      ) return null;
      const isCurrent = (): boolean =>
        sessions.get(session.documentUri, "canvas") === session &&
        isOpenDocument(session.document) &&
        session.webviewReady;
      return {
        sessionToken: session,
        document: session.document,
        isCurrent,
        isAuthoritativeReady: () =>
          isCurrent() &&
          session.inFlightCanvasHistory === null &&
          session.authoritativeDocumentVersion === session.document.version,
        lastCanvasPointer: () => session.lastCanvasPointer,
        postFreePointAtPointer: (request) => {
          if (!isCurrent()) return;
          void session.panel.webview.postMessage({
            type: "canvasFreePointAtPointer",
            ...request
          } satisfies ExtensionToVscodeMessage);
        }
      };
    }
  });

  const executeCanvasCommand = (commandId: VscodeCanvasCommandId): void => {
    const activeSession = canvasSessionForCommand();
    const session = activeSession ?? (
      commandId === "undo" || commandId === "redo"
        ? canvasHistoryHandoffSession
        : null
    );
    if (!session) {
      if (
        (commandId === "undo" || commandId === "redo") &&
        modulePreviewHistoryFallback?.(commandId)
      ) return;
      void vscode.window.showErrorMessage(canvasPresentationTextFor("canvas.noActiveCanvas", extensionDisplayLanguage()));
      return;
    }
    void session.panel.webview.postMessage({ type: "canvasCommand", commandId } satisfies ExtensionToVscodeMessage);
  };

  const bakeSettings = () => {
    const configuration = vscode.workspace.getConfiguration("nuinuiCAD");
    return {
      emitSkippedComments: configuration.get<boolean>("bake.emitSkippedComments", true),
      includeHiddenGeometry: configuration.get<boolean>("bake.includeHiddenGeometry", false),
      includeDisabledGeometry: configuration.get<boolean>("bake.includeDisabledGeometry", false)
    };
  };

  const executeBakeCommand = (mode: "current" | "base"): void => {
    const settings = bakeSettings();
    const activeCanvas = activeCanvasSessionForBake();
    if (activeCanvas) {
      void activeCanvas.panel.webview.postMessage({
        type: "canvasCommand",
        commandId: mode === "current" ? "bakeCurrentShape" : "bakeBaseShape",
        ...settings
      } satisfies ExtensionToVscodeMessage);
      return;
    }
    if (modulePreviewBakeFallback?.(mode, settings)) return;
    const surface = bakeSurfaceForCommand({ skipActiveCanvas: true });
    if (surface?.kind === "canvas") {
      const canvasSession = surface.session;
      void canvasSession.panel.webview.postMessage({
        type: "canvasCommand",
        commandId: mode === "current" ? "bakeCurrentShape" : "bakeBaseShape",
        ...settings
      } satisfies ExtensionToVscodeMessage);
      return;
    }
    if (surface?.kind !== "source") {
      void vscode.window.showErrorMessage(canvasPresentationTextFor("canvas.sourceOrCanvasRequired", extensionDisplayLanguage()));
      return;
    }
    const editor = surface.editor;
    const document = editor.document;
    const analysis = languageAnalysisSessionFor(document);
    const rawSource = document.getText();
    if (analysis.getSource() !== rawSource) analysis.replaceSource(rawSource);
    const source = {
      normalizedSource: normalizedSourceFor(rawSource),
      sourceRevision: analysis.getSourceRevision()
    };
    const normalizedSourceOffset = normalizedOffsetFromRaw(rawSource, document.offsetAt(editor.selection.active));
    const semantic = currentCompiledSemanticSnapshotFor(analysis, source);
    const target = semantic?.compiled
      ? queryDslCanvasSourceTarget({
          source,
          compiled: semantic.compiled,
          position: normalizedSourceOffset
        })
      : null;
    if (!target) {
      void vscode.window.showErrorMessage(canvasPresentationTextFor("canvas.noBakeTarget", extensionDisplayLanguage()));
      return;
    }
    const key = documentKey(document);
    let session = sessions.get(key, "canvas");
    if (canvasHistoryHandoffSession !== null || (session !== undefined && session.inFlightCanvasHistory !== null)) return;
    if (!session) session = createCanvasPanel(editor.document, true);
    if (!session) return;
    session.pendingBake = {
      requestId: nextBakeRequestId++,
      documentVersion: document.version,
      normalizedSourceOffset,
      mode,
      ...settings
    };
    session.panel.reveal(vscode.ViewColumn.Beside, true);
    deliverPendingBake(session);
  };

  const goToSourceDefinition = (): void => {
    const session = canvasSessionForCommand();
    if (
      !session ||
      session.inFlightCanvasHistory !== null ||
      canvasHistoryHandoffSession !== null
    ) return;
    const requestId = nextNavigationRequestId++;
    session.pendingSourceDefinitionRequest = { requestId };
    void session.panel.webview.postMessage({
      type: "canvasSourceDefinitionRequest",
      requestId
    } satisfies ExtensionToVscodeMessage);
  };

  const revealInCanvas = (): void => {
    const editor = activeNuiEditor();
    if (!editor) return;
    const document = editor.document;
    const rawSource = document.getText();
    const sessionForDocument = languageAnalysisSessionFor(document);
    if (sessionForDocument.getSource() !== rawSource) sessionForDocument.replaceSource(rawSource);
    const source = {
      normalizedSource: normalizedSourceFor(rawSource),
      sourceRevision: sessionForDocument.getSourceRevision()
    };
    const semantic = currentCompiledSemanticSnapshotFor(sessionForDocument, source);
    if (!semantic?.compiled?.statementMap) {
      presentRevealInCanvasOutcome({ status: "failed", reason: "analysis-unavailable" });
      return;
    }
    const normalizedSourceOffset = normalizedOffsetFromRaw(rawSource, document.offsetAt(editor.selection.active));
    const sourceTarget = queryDslCanvasRevealSourceTarget({
      source,
      compiled: semantic.compiled,
      position: normalizedSourceOffset
    });
    if (sourceTarget.status === "failed") {
      presentRevealInCanvasOutcome({ status: "failed", reason: sourceTarget.reason });
      return;
    }

    const key = documentKey(document);
    let session = sessions.get(key, "canvas");
    if (canvasHistoryHandoffSession !== null || (session !== undefined && session.inFlightCanvasHistory !== null)) {
      presentRevealInCanvasOutcome({ status: "failed", reason: "canvas-history-busy" });
      return;
    }
    if (!session) session = createCanvasPanel(editor.document, true);
    if (!session) return;

    const requestId = nextNavigationRequestId++;
    session.pendingCanvasNavigation = {
      requestId,
      documentVersion: document.version,
      normalizedSourceOffset
    };
    session.pendingCanvasFocus = null;
    session.panel.reveal(vscode.ViewColumn.Beside, true);
    deliverPendingCanvasNavigation(session);
  };

  const startBenchmark = (editor: vscode.TextEditor): void => {
    if (!benchmarkConfig || benchmarkStarted) return;
    benchmarkStarted = true;
    benchmarkEditorListener?.dispose();
    benchmarkEditorListener = null;
    createCanvasPanel(editor.document);
  };

  const command = vscode.commands.registerCommand("nuinuiCAD.openCanvas", () => {
    const outputPreviewSession = activeOutputPreviewSessionForOpenCommand();
    if (outputPreviewSession) {
      createCanvasPanel(outputPreviewSession.document);
      return;
    }

    if (isNuiOutputPreviewTab(activeEditorTabInput())) {
      void vscode.window.showErrorMessage(canvasPresentationTextFor("canvas.matchingOutputPreview", extensionDisplayLanguage()));
      return;
    }

    const editor = activeNuiTextEditorForCommand();
    if (editor) {
      if (benchmarkConfig) {
        startBenchmark(editor);
        return;
      }
      createCanvasPanel(editor.document);
      return;
    }

    void vscode.window.showErrorMessage(canvasPresentationTextFor("canvas.sourceOrOutputPreview", extensionDisplayLanguage()));
  });
  const goToSourceDefinitionCommand = vscode.commands.registerCommand(
    "nuinuiCAD.goToSourceDefinition",
    goToSourceDefinition
  );
  const revealInCanvasCommand = vscode.commands.registerCommand(
    "nuinuiCAD.revealInCanvas",
    revealInCanvas
  );
  const choiceQuickFixApplyCommand = vscode.commands.registerCommand(
    NUI_CHOICE_QUICK_FIX_APPLY_COMMAND,
    createNuiChoiceQuickFixApplyHandler(languageAnalysisSessionFor)
  );
  const editCanvasRibbonCommand = vscode.commands.registerCommand(
    "nuinuiCAD.editCanvasRibbon",
    editCanvasRibbon
  );
  const canvasCommandDisposables = [
    ["nuinuiCAD.canvasUndo", "undo"],
    ["nuinuiCAD.canvasRedo", "redo"],
    ["nuinuiCAD.clearCanvasSelection", "clearCanvasSelection"],
    ["nuinuiCAD.selectParentGroup", "selectParentGroup"],
    ["nuinuiCAD.selectInstance", "selectInstance"],
    ["nuinuiCAD.resetCanvasView", "resetCanvasView"],
    ["nuinuiCAD.fitDrawing", "fitDrawing"],
    ["nuinuiCAD.toggleCanvasPointNames", "toggleCanvasPointNames"],
    ["nuinuiCAD.toggleCanvasGeometryNames", "toggleCanvasGeometryNames"],
    ["nuinuiCAD.toggleCanvasElementNames", "toggleCanvasElementNames"],
    ["nuinuiCAD.toggleCanvasPoints", "toggleCanvasPoints"]
  ].map(([command, commandId]) => vscode.commands.registerCommand(command, () => {
    executeCanvasCommand(commandId as VscodeCanvasCommandId);
  }));
  const bakeCurrentShapeCommand = vscode.commands.registerCommand(
    "nuinuiCAD.bakeCurrentShape",
    () => executeBakeCommand("current")
  );
  const bakeBaseShapeCommand = vscode.commands.registerCommand(
    "nuinuiCAD.bakeBaseShape",
    () => executeBakeCommand("base")
  );

  const closeDocumentListener = vscode.workspace.onDidCloseTextDocument((document) => {
    if (lastBakeSurface?.kind === "source" && sameDocument(lastBakeSurface.document, document)) {
      lastBakeSurface = null;
    }
    observationFeature.removeDocument(documentKey(document));
    for (const session of sessions.forDocument(documentKey(document))) {
      if (sameDocument(session.document, document)) session.panel.dispose();
    }
  });
  const disposeAllSessions = {
    dispose: () => {
      for (const session of [...sessions.values()]) disposeSession(session);
      sessions.clear();
      sourceBakeRequestsWithStructuredSkips.clear();
      lastBakeSurface = null;
    }
  };
  const disposeRustProcess = {
    dispose: () => rustProcessOwner.dispose()
  };
  context.subscriptions.push(
    command,
    outputPreviewFeature,
    coordinatePointConversionFeature,
    inlineModuleFeature,
    extractModuleFeature,
    goToSourceDefinitionCommand,
    revealInCanvasCommand,
    referencePickFeature,
    geometryReferenceRetargetFeature,
    sourceValueStepFeature,
    canvasQuickCreateFeature,
    canvasFreePointAtPointerFeature,
    sourceAuthoringPositionFeature,
    choiceQuickFixApplyCommand,
    editCanvasRibbonCommand,
    ...canvasCommandDisposables,
    bakeCurrentShapeCommand,
    bakeBaseShapeCommand,
    closeDocumentListener,
    disposeAllSessions,
    disposeRustProcess
  );

  if (benchmarkConfig) {
    const startWhenEditorIsReady = () => {
      const editor = activeNuiEditor();
      if (editor) startBenchmark(editor);
    };
    if (activeNuiEditor()) {
      startWhenEditorIsReady();
    } else {
      benchmarkEditorListener = vscode.window.onDidChangeActiveTextEditor(startWhenEditorIsReady);
      context.subscriptions.push(benchmarkEditorListener);
    }
  }

  const activeBakeSourceListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (!editor || !isSupportedNuiDocument(editor.document)) return;
    rememberBakeSource(editor.document);
  });
  context.subscriptions.push(activeBakeSourceListener);
};

export const deactivate = (): void => {
  modulePreviewBakeOperationPresenter = null;
};
