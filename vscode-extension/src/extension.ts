import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import * as vscode from "vscode";
import { applyLineSplices, type LineSplice } from "../../src/document/textPatch";
import { queryDslCanvasSourceTarget, type NormalizedSourceRange } from "../../src/dsl/dslNavigationQuery";
import { queryDslCanvasRevealSourceTarget } from "../../src/dsl/dslCanvasRevealQuery";
import { RustEvaluationProcess } from "./rustEvaluationProcess";
import { RustEvaluationProcessOwner } from "./rustEvaluationProcessOwner";
import {
  toCompilerDiagnostic,
  type CompilerDiagnostic,
  type CompilerDiagnosticRange
} from "./compilerDiagnostics";
import {
  createLanguageAnalysisSession,
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
import { registerNuiHoverFeature } from "./hoverFeature";
import {
  registerVscodeReferencePickFeature,
  type VscodeReferencePickCanvasEndpoint
} from "./referencePickCommandFeature";
import { registerVscodeSourceValueStepFeature } from "./sourceValueStepCommandFeature";
import type {
  ExtensionToVscodeMessage,
  VscodeCanvasCommandId,
  VscodeBenchmarkConfig,
  VscodeDocumentChangeReason,
  VscodeToExtensionMessage
} from "../../src/vscode/protocol";
import {
  vscodeWebviewSurfaceDataAttribute,
  type VscodeWebviewSurfaceKind
} from "../../src/vscode/protocol";
import {
  VscodeWebviewSessionRegistry,
  type VscodeWebviewSessionBase
} from "../../src/vscode/vscodeWebviewSession";
import {
  defaultVscodeCanvasRibbons,
  normalizeVscodeCanvasRibbons,
  patchVscodeCanvasRibbonPosition,
  VSCODE_CANVAS_RIBBON_SETTING,
  type VscodeCanvasRibbon
} from "../../src/vscode/vscodeCanvasRibbonConfig";
import { normalizedOffsetFromRaw, normalizedSourceFor, vscodeRangeForNormalized } from "./sourceOffsetAdapter";
import { presentBakeOperationResult } from "./bakeOperationPresentation";
import {
  revealInCanvasNotificationFor,
  type RevealInCanvasPresentationOutcome
} from "./revealInCanvasPresentation";
import { registerVscodeObservationFeature } from "./vscodeObservationFeature";
import type { VscodeObservationHostDocument } from "./vscodeObservationState";
import {
  registerOutputPreviewFeature,
  type OutputPreviewSession
} from "./outputPreviewFeature";

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
};

type WebviewSession = DocumentSession | OutputPreviewSession;

type LastBakeSurface =
  | { kind: "canvas"; session: DocumentSession }
  | { kind: "source"; document: vscode.TextDocument };

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
  diagnostic: CompilerDiagnostic
): vscode.Diagnostic => {
  const severity = diagnostic.severity === "error"
    ? vscode.DiagnosticSeverity.Error
    : vscode.DiagnosticSeverity.Warning;
  const result = new vscode.Diagnostic(
    toVscodeDiagnosticRange(diagnostic.range),
    diagnostic.message,
    severity
  );
  if (diagnostic.code !== undefined) result.code = diagnostic.code;
  result.source = diagnostic.source;
  if (diagnostic.relatedInformation && diagnostic.relatedInformation.length > 0) {
    result.relatedInformation = diagnostic.relatedInformation.map((related) =>
      new vscode.DiagnosticRelatedInformation(
        new vscode.Location(document.uri, toVscodeDiagnosticRange(related.range)),
        related.message
      )
    );
  }
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
  const script = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview.js"));
  const style = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview.css"));
  const contentNonce = nonce();
  return `<!doctype html>
<html lang="ja" ${vscodeWebviewSurfaceDataAttribute}="${surfaceKind}">
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

const sourceNewline = (sourceText: string): string => {
  const separators = [...sourceText.matchAll(/\r?\n/g)].map((match) => match[0]);
  return separators.length > 0 && separators.every((value) => value === "\r\n") ? "\r\n" : "\n";
};

const lineStartsFor = (sourceText: string): { starts: number[]; separatorLengths: number[]; lineCount: number } => {
  const starts = [0];
  const separatorLengths: number[] = [];
  for (const match of sourceText.matchAll(/\r?\n/g)) {
    starts.push((match.index ?? 0) + match[0].length);
    separatorLengths.push(match[0].length);
  }
  return { starts, separatorLengths, lineCount: sourceText.split(/\r?\n/).length };
};

const textEditForLineSplice = (
  document: vscode.TextDocument,
  sourceText: string,
  splice: LineSplice
): { range: vscode.Range; replacement: string } => {
  const { starts, separatorLengths, lineCount } = lineStartsFor(sourceText);
  const startIndex = splice.startLine - 1;
  const deletesLines = splice.endLine >= splice.startLine;
  const newline = sourceNewline(sourceText);
  const replacement = splice.replacementLines.join(newline);
  let from: number;
  let to: number;
  let insert: string;

  if (!deletesLines) {
    from = startIndex < lineCount ? starts[startIndex] : sourceText.length;
    to = from;
    insert = splice.replacementLines.length > 0
      ? startIndex < lineCount
        ? `${replacement}${newline}`
        : `${lineCount > 0 ? newline : ""}${replacement}`
      : "";
  } else if (splice.endLine < lineCount) {
    from = starts[startIndex];
    to = starts[splice.endLine];
    insert = splice.replacementLines.length > 0 ? `${replacement}${newline}` : "";
  } else if (startIndex === 0) {
    from = 0;
    to = sourceText.length;
    insert = replacement;
  } else {
    from = starts[startIndex] - separatorLengths[startIndex - 1];
    to = sourceText.length;
    insert = splice.replacementLines.length > 0 ? `${newline}${replacement}` : "";
  }

  return {
    range: new vscode.Range(document.positionAt(from), document.positionAt(to)),
    replacement: insert
  };
};

const disposeSessionListeners = (session: WebviewSession): void => {
  for (const disposable of session.disposables.splice(0)) disposable.dispose();
};

export const activate = (context: vscode.ExtensionContext): void => {
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
  const sourceBakeRequestsWithStructuredSkips = new Set<number>();
  let canvasHistoryHandoffContextUpdate: Promise<void> = Promise.resolve();
  let nextNavigationRequestId = 1;
  let nextBakeRequestId = 1;

  const bakeOutputChannelFor = (): vscode.OutputChannel => {
    if (bakeOutputChannel) return bakeOutputChannel;
    bakeOutputChannel = vscode.window.createOutputChannel("nuinuiCAD Bake");
    context.subscriptions.push(bakeOutputChannel);
    return bakeOutputChannel;
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

  const bakeSurfaceForCommand = ():
    | { kind: "canvas"; session: DocumentSession }
    | { kind: "source"; editor: vscode.TextEditor }
    | null => {
    const activeCanvas = activeCanvasSessionForBake();
    if (activeCanvas) return { kind: "canvas", session: activeCanvas };

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

  const publishCurrentDiagnostics = (
    document: vscode.TextDocument,
    session: NuiLanguageAnalysisSession
  ): void => {
    const key = documentKey(document);
    const sourceText = document.getText();
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
      .filter((diagnostic): diagnostic is CompilerDiagnostic => diagnostic !== null);
    const diagnostics = [
      ...session.getDiagnostics(),
      ...projectedRuntimeDiagnostics
    ].map((diagnostic) => toVscodeDiagnostic(document, diagnostic));
    compilerDiagnosticCollection.set(document.uri, diagnostics);
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

  const languageAnalysisSessionFor = (document: vscode.TextDocument): NuiLanguageAnalysisSession => {
    const key = documentKey(document);
    const existing = languageAnalysisSessions.get(key);
    if (existing) return existing;
    const session = createLanguageAnalysisSession(document.getText());
    languageAnalysisSessions.set(key, session);
    return session;
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
    }
    publishCompilerDiagnostics(event.document);
  });
  const compilerDiagnosticCloseListener = vscode.workspace.onDidCloseTextDocument((document) => {
    if (!isSupportedNuiDocument(document)) return;
    const key = documentKey(document);
    languageAnalysisSessions.delete(key);
    compilerDiagnosticCollection.delete(document.uri);
    observationFeature.removeDocument(key);
  });
  const disposeCompilerDiagnosticSessions = {
    dispose: () => languageAnalysisSessions.clear()
  };
  const completionProvider = vscode.languages.registerCompletionItemProvider(
    nuiCompletionSelector,
    createNuiCompletionProvider(languageAnalysisSessionFor),
    ...nuiCompletionTriggerCharacters
  );
  const colorProvider = vscode.languages.registerColorProvider(
    nuiColorSelector,
    createNuiColorProvider(languageAnalysisSessionFor)
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
  const elementsTreeFeature = registerNuiElementsTreeFeature({
    activeNuiDocument: () => activeNuiEditor()?.document,
    languageAnalysisSessionFor
  });
  context.subscriptions.push(
    compilerDiagnosticCollection,
    observationFeature,
    compilerDiagnosticOpenListener,
    compilerDiagnosticChangeListener,
    compilerDiagnosticCloseListener,
    disposeCompilerDiagnosticSessions,
    hoverFeature,
    completionProvider,
    colorProvider,
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
      session.document.version !== message.documentVersion ||
      !message.range ||
      !normalizedRangeIsSafe(session.document, message.range)
    ) return;

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
    const visualSessions = [
      ...sessions.valuesForSurface("canvas"),
      ...sessions.valuesForSurface("outputPreview")
    ];
    for (const session of visualSessions) {
      void session.panel.webview.postMessage({ type: "canvasThemeChanged" } satisfies ExtensionToVscodeMessage);
    }
  });
  context.subscriptions.push(activeColorThemeListener);

  const canvasRibbonConfigurationListener = vscode.workspace.onDidChangeConfiguration?.((event) => {
    if (event.affectsConfiguration(VSCODE_CANVAS_RIBBON_SETTING)) {
      broadcastCanvasRibbonConfiguration();
    }
  });
  if (canvasRibbonConfigurationListener) context.subscriptions.push(canvasRibbonConfigurationListener);

  const applyCanvasCommit = async (
    session: DocumentSession,
    message: Extract<VscodeToExtensionMessage, { type: "canvasCommit" }>
  ): Promise<void> => {
    const matchingDocumentAvailable = isOpenDocument(session.document);

    if (!matchingDocumentAvailable || session.document.version !== message.expectedDocumentVersion) {
      resync(session);
      return;
    }

    const editor = visibleEditorFor(session.document);
    if (!editor) {
      resync(session);
      return;
    }

    const sourceText = session.document.getText();
    const lineEdits: Array<{ range: vscode.Range; replacement: string }> = [];
    if (message.mutationKind === "model-patch") {
      if (!message.splices) {
        resync(session);
        return;
      }
      try {
        const patchedText = applyLineSplices(sourceText, message.splices);
        if (patchedText !== message.sourceText) {
          resync(session);
          return;
        }
        lineEdits.push(...message.splices.map((splice) => textEditForLineSplice(session.document, sourceText, splice)));
      } catch {
        resync(session);
        return;
      }
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
      resync(session);
      return;
    }

    try {
      const editCompleted = await editResult;
      if (!editCompleted) {
        resync(session);
      }
    } catch {
      resync(session);
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
    }
  };

  const disposeCanvasSession = (session: DocumentSession): void => {
    if (sessions.get(session.documentUri, "canvas") !== session) return;
    if (lastActiveCanvasSession === session) lastActiveCanvasSession = null;
    if (lastBakeSurface?.kind === "canvas" && lastBakeSurface.session === session) lastBakeSurface = null;
    session.inFlightCanvasHistory = null;
    session.pendingCanvasFocus = null;
    clearCanvasHistoryHandoff(session);
    sessions.delete(session.documentUri, "canvas");
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
      pendingSourceDefinitionRequest: null
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
        postAuthoritativeDocument(panel, session.document);
        postCanvasRibbonConfiguration(panel);
        if (benchmarkConfig) post({ type: "benchmarkConfig", config: benchmarkConfig });
        return;
      }
      if (message.type === "runtimeDiagnosticsPublication") {
        acceptRuntimeDiagnosticsPublication(session, message);
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
        if (message.documentVersion !== session.document.version) return;
        session.authoritativeDocumentVersion = message.documentVersion;
        deliverPendingCanvasNavigation(session);
        deliverPendingBake(session);
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
        await presentBakeOperationResult(message, bakeOutputChannelFor(), {
          showWarningMessage: (notification, action) => vscode.window.showWarningMessage(notification, action),
          showErrorMessage: (notification, action) => vscode.window.showErrorMessage(notification, action)
        });
        return;
      }
      if (message.type === "bakeSourceResult") {
        if (!session.pendingBake || session.pendingBake.requestId !== message.requestId) return;
        session.pendingBake = null;
        const hasStructuredSkips = sourceBakeRequestsWithStructuredSkips.delete(message.requestId);
        if (message.status === "nothing" && !hasStructuredSkips) {
          void vscode.window.showErrorMessage("nuinuiCAD: Bakeできるジオメトリがありません。");
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
  const sourceValueStepFeature = registerVscodeSourceValueStepFeature({
    languageAnalysisSessionFor
  });

  const executeCanvasCommand = (commandId: VscodeCanvasCommandId): void => {
    const activeSession = canvasSessionForCommand();
    const session = activeSession ?? (
      commandId === "undo" || commandId === "redo"
        ? canvasHistoryHandoffSession
        : null
    );
    if (!session) {
      void vscode.window.showErrorMessage("nuinuiCAD: アクティブなCanvasがありません。Canvasを開いてから実行してください。");
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
    const surface = bakeSurfaceForCommand();
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
      void vscode.window.showErrorMessage("nuinuiCAD: .nuiのSource EditorまたはCanvasをアクティブにしてください。");
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
    const semantic = analysis.definitionSemanticSnapshot(source);
    const target = semantic?.compiled
      ? queryDslCanvasSourceTarget({
          source,
          compiled: semantic.compiled,
          position: normalizedSourceOffset
        })
      : null;
    if (!target) {
      void vscode.window.showErrorMessage("nuinuiCAD: Source Editorのカーソル位置にBake対象がありません。");
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
    const semantic = sessionForDocument.definitionSemanticSnapshot(source);
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
      void vscode.window.showErrorMessage("nuinuiCAD requires a matching active Output Preview session.");
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

    void vscode.window.showErrorMessage("nuinuiCAD requires an active .nui Text Editor or Output Preview.");
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
    goToSourceDefinitionCommand,
    revealInCanvasCommand,
    referencePickFeature,
    sourceValueStepFeature,
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

export const deactivate = (): void => undefined;
