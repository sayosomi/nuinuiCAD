import { basename } from "node:path";
import * as vscode from "vscode";
import {
  defaultOutputExportPath,
  ensureOutputExportExtension
} from "../../src/document/printExportFileName";
import type { NormalizedSourceRange } from "../../src/dsl/dslNavigationQuery";
import type {
  ExtensionToVscodeMessage,
  VscodeDocumentChangeReason,
  VscodeToExtensionMessage
} from "../../src/vscode/protocol";
import type {
  VscodeOutputPreviewExportAvailability,
  VscodeOutputPreviewExportRequest,
  VscodeOutputPreviewRevealResult
} from "../../src/vscode/outputPreviewProtocol";
import type { VscodeWebviewSessionBase } from "../../src/vscode/vscodeWebviewSession";
import type { VscodeOutputPreviewRevealSourceTargetResult } from "./referencePickCommandFeature";
import { normalizedOffsetFromRaw } from "./sourceOffsetAdapter";
import {
  createOutputPreviewSourceInteractionFeature
} from "./outputPreviewSourceInteractionFeature";
import {
  handoffOutputPreviewHistory,
  type OutputPreviewHistoryDirection
} from "./outputPreviewHistory";
import { outputPreviewTranslatorFor } from "./outputPreviewLocalization";

export type OutputPreviewSession = VscodeWebviewSessionBase & {
  surfaceKind: "outputPreview";
  documentUri: string;
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  disposables: vscode.Disposable[];
  webviewReady: boolean;
  authoritativeDocumentVersion: number | null;
  pendingOpen: { normalizedSourceOffset: number | null } | null;
  pendingReveal: {
    requestId: number;
    documentVersion: number;
    normalizedSourceOffset: number;
  } | null;
  inFlightRevealRequestId: number | null;
  latestRevealRequestId: number | null;
  exportAvailability: Omit<VscodeOutputPreviewExportAvailability, "type"> | null;
  inFlightExportRequestId: number | null;
};

type OutputPreviewRegistry = {
  get: (documentUri: string) => OutputPreviewSession | undefined;
  set: (session: OutputPreviewSession) => void;
  delete: (documentUri: string) => boolean;
  values: () => OutputPreviewSession[];
};

export type OutputPreviewFeatureHost = {
  registry: OutputPreviewRegistry;
  extensionUri: vscode.Uri;
  webviewHtml: (panel: vscode.WebviewPanel) => string;
  postAuthoritativeDocument: (panel: vscode.WebviewPanel, document: vscode.TextDocument) => void;
  postDocumentText: (
    panel: vscode.WebviewPanel,
    sourceText: string,
    documentVersion: number,
    reason: VscodeDocumentChangeReason
  ) => void;
  documentChangeReasonFor: (reason: vscode.TextDocumentChangeReason | undefined) => VscodeDocumentChangeReason;
  documentKey: (document: vscode.TextDocument) => string;
  sameDocument: (left: vscode.TextDocument, right: vscode.TextDocument) => boolean;
  isOpenDocument: (document: vscode.TextDocument) => boolean;
  visibleEditorFor: (document: vscode.TextDocument) => vscode.TextEditor | undefined;
  isNormalizedRangeSafe: (document: vscode.TextDocument, range: NormalizedSourceRange) => boolean;
  requestRustEvaluation: (
    input: Extract<VscodeToExtensionMessage, { type: "rustEvaluationRequest" }> ["input"]
  ) => Promise<unknown>;
  exportOutput: (request: {
    path: string;
    payload: VscodeOutputPreviewExportRequest["payload"];
  }) => Promise<void>;
  activeNuiTextEditorForCommand: () => vscode.TextEditor | undefined;
  outputPreviewRevealSourceTargetForEditor: (
    editor: vscode.TextEditor
  ) => VscodeOutputPreviewRevealSourceTargetResult;
  activeCanvasDocumentForOpenCommand: () => vscode.TextDocument | null;
  isOutputPreviewTabActive: () => boolean;
  displayLanguageFor?: () => string;
};

export type OutputPreviewFeature = vscode.Disposable & {
  openForDocument: (
    document: vscode.TextDocument,
    normalizedSourceOffset: number | null,
    preserveFocus?: boolean
  ) => OutputPreviewSession;
  activeSessionForOpenCommand: () => OutputPreviewSession | null;
  disposeSession: (session: OutputPreviewSession) => void;
};

/**
 * Owns the Output Preview Extension Host lifecycle, commands, and Webview
 * routing. The Extension Host composition root supplies only shared registry,
 * document, and Rust-process adapters.
 */
export const registerOutputPreviewFeature = (host: OutputPreviewFeatureHost): OutputPreviewFeature => {
  type OutputPreviewViewportAction = "outputPreviewFit" | "outputPreviewResetView";
  let nextRevealRequestId = 1;

  const displayLanguage = (): string => {
    if (host.displayLanguageFor) return host.displayLanguageFor();
    try {
      return vscode.env?.language ?? "en";
    } catch {
      return "en";
    }
  };

  const activeSession = (): OutputPreviewSession | null =>
    host.registry.values().find((candidate) => candidate.panel.active) ?? null;

  const activeSessionForOpenCommand = (): OutputPreviewSession | null =>
    host.isOutputPreviewTabActive() ? activeSession() : null;

  const resyncOutputPreview = (session: OutputPreviewSession): void => {
    if (host.registry.get(session.documentUri) !== session || !host.isOpenDocument(session.document)) return;
    session.authoritativeDocumentVersion = null;
    session.pendingReveal = null;
    session.inFlightRevealRequestId = null;
    session.latestRevealRequestId = null;
    host.postAuthoritativeDocument(session.panel, session.document);
  };

  const sourceInteraction = createOutputPreviewSourceInteractionFeature({
    isOpenDocument: host.isOpenDocument,
    isNormalizedRangeSafe: host.isNormalizedRangeSafe,
    visibleEditorFor: host.visibleEditorFor,
    resyncOutputPreview: (session) => {
      const current = host.registry.get(host.documentKey(session.document));
      if (current?.panel === session.panel) resyncOutputPreview(current);
    }
  });

  const deliverPendingOpen = (session: OutputPreviewSession): void => {
    const pending = session.pendingOpen;
    if (
      !pending ||
      !session.webviewReady ||
      session.authoritativeDocumentVersion !== session.document.version
    ) return;
    session.pendingOpen = null;
    void session.panel.webview.postMessage({
      type: "outputPreviewOpen",
      documentVersion: session.document.version,
      normalizedSourceOffset: pending.normalizedSourceOffset
    } satisfies ExtensionToVscodeMessage);
  };

  const deliverPendingReveal = (session: OutputPreviewSession): void => {
    const pending = session.pendingReveal;
    if (!pending || !session.webviewReady || session.authoritativeDocumentVersion !== session.document.version) return;
    if (
      host.registry.get(session.documentUri) !== session ||
      !host.isOpenDocument(session.document) ||
      pending.documentVersion !== session.document.version ||
      session.latestRevealRequestId !== pending.requestId
    ) {
      session.pendingReveal = null;
      session.inFlightRevealRequestId = null;
      return;
    }
    session.pendingReveal = null;
    session.inFlightRevealRequestId = pending.requestId;
    void session.panel.webview.postMessage({
      type: "outputPreviewReveal",
      requestId: pending.requestId,
      documentVersion: pending.documentVersion,
      normalizedSourceOffset: pending.normalizedSourceOffset
    } satisfies ExtensionToVscodeMessage);
  };

  const revealFailureMessageFor = (
    reason: Exclude<VscodeOutputPreviewRevealResult, { status: "resolved" }> ["reason"],
    currentDisplayLanguage: string
  ): string => {
    const translator = outputPreviewTranslatorFor(currentDisplayLanguage);
    if (reason === "no-containing-output") {
      return translator("outputPreview.reveal.no-containing-output");
    }
    if (reason === "evaluation-failed") {
      return translator("outputPreview.reveal.evaluation-failed");
    }
    return translator("outputPreview.reveal.target-unavailable");
  };

  const invalidateReveal = (session: OutputPreviewSession): void => {
    session.pendingReveal = null;
    session.inFlightRevealRequestId = null;
    session.latestRevealRequestId = null;
  };

  const handleRevealResult = (
    session: OutputPreviewSession,
    message: VscodeOutputPreviewRevealResult
  ): void => {
    if (
      session.inFlightRevealRequestId !== message.requestId ||
      session.latestRevealRequestId !== message.requestId
    ) return;
    session.inFlightRevealRequestId = null;
    if (
      host.registry.get(session.documentUri) !== session ||
      !host.isOpenDocument(session.document) ||
      message.documentVersion !== session.document.version
    ) return;
    if (message.status === "failed") {
      if (message.reason !== "stale") {
        void vscode.window.showErrorMessage(revealFailureMessageFor(message.reason, displayLanguage()));
      }
      return;
    }
    session.panel.reveal(vscode.ViewColumn.Beside, false);
  };

  const postExportResult = (
    session: OutputPreviewSession,
    requestId: number,
    status: "saved" | "cancelled" | "failed"
  ): void => {
    void session.panel.webview.postMessage({
      type: "outputPreviewExportResult",
      requestId,
      status
    } satisfies ExtensionToVscodeMessage);
  };

  const postViewportAction = (session: OutputPreviewSession, action: OutputPreviewViewportAction): void => {
    if (!session.webviewReady) return;
    if (action === "outputPreviewFit" && session.authoritativeDocumentVersion !== session.document.version) return;
    void session.panel.webview.postMessage({ type: action } satisfies ExtensionToVscodeMessage);
  };

  const exportRequestIsCurrent = (
    session: OutputPreviewSession,
    message: VscodeOutputPreviewExportRequest
  ): boolean => {
    const availability = session.exportAvailability;
    const payloadMatchesFormat = message.format === "pdf"
      ? message.payload.kind === "print"
      : message.payload.kind === "svg";
    return host.registry.get(session.documentUri) === session
      && payloadMatchesFormat
      && session.panel.active
      && host.isOpenDocument(session.document)
      && session.webviewReady
      && session.authoritativeDocumentVersion === session.document.version
      && session.document.version === message.documentVersion
      && availability?.documentVersion === message.documentVersion
      && availability.outputKey === message.outputKey
      && availability.format === message.format;
  };

  const handleExport = async (
    session: OutputPreviewSession,
    message: VscodeOutputPreviewExportRequest
  ): Promise<void> => {
    const translator = outputPreviewTranslatorFor(displayLanguage());
    if (session.inFlightExportRequestId !== null || !exportRequestIsCurrent(session, message)) {
      postExportResult(session, message.requestId, "failed");
      void vscode.window.showErrorMessage(translator("outputPreview.changed"));
      return;
    }
    session.inFlightExportRequestId = message.requestId;
    const defaultPath = defaultOutputExportPath({
      outputName: message.outputName,
      documentPath: session.document.fileName,
      extension: message.format
    });
    try {
      const selected = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(defaultPath),
        filters: message.format === "pdf"
          ? { [translator("outputPreview.pdfDocument")]: ["pdf"] }
          : { [translator("outputPreview.svgDocument")]: ["svg"] },
        saveLabel: message.format === "pdf"
          ? translator("outputPreview.exportPdf")
          : translator("outputPreview.exportSvg")
      });
      if (!selected) {
        postExportResult(session, message.requestId, "cancelled");
        return;
      }
      if (selected.scheme !== "file") throw new Error(translator("outputPreview.localFileOnly"));
      if (!exportRequestIsCurrent(session, message)) {
        postExportResult(session, message.requestId, "failed");
        void vscode.window.showErrorMessage(translator("outputPreview.changedWhileSaving"));
        return;
      }
      const path = ensureOutputExportExtension(selected.fsPath, message.format);
      await host.exportOutput({ path, payload: message.payload });
      postExportResult(session, message.requestId, "saved");
      void vscode.window.showInformationMessage(translator("outputPreview.saved", { fileName: basename(path) }));
    } catch (error) {
      postExportResult(session, message.requestId, "failed");
      void vscode.window.showErrorMessage(
        translator("outputPreview.exportFailed", {
          error: error instanceof Error ? error.message : String(error)
        })
      );
    } finally {
      if (session.inFlightExportRequestId === message.requestId) session.inFlightExportRequestId = null;
    }
  };

  const handleRustEvaluationRequest = async (
    session: OutputPreviewSession,
    message: Extract<VscodeToExtensionMessage, { type: "rustEvaluationRequest" }>
  ): Promise<void> => {
    try {
      const payload = await host.requestRustEvaluation(message.input);
      void session.panel.webview.postMessage({ type: "rustEvaluationResponse", id: message.id, payload } satisfies ExtensionToVscodeMessage);
    } catch (error) {
      void session.panel.webview.postMessage({
        type: "rustEvaluationError",
        id: message.id,
        error: error instanceof Error ? error.message : String(error)
      } satisfies ExtensionToVscodeMessage);
    }
  };

  const disposeSession = (session: OutputPreviewSession): void => {
    if (host.registry.get(session.documentUri) !== session) return;
    session.pendingOpen = null;
    invalidateReveal(session);
    host.registry.delete(session.documentUri);
    for (const disposable of session.disposables.splice(0)) disposable.dispose();
  };

  const getOrCreateSession = (
    document: vscode.TextDocument,
    preserveFocus: boolean
  ): OutputPreviewSession => {
    const documentUri = host.documentKey(document);
    const existing = host.registry.get(documentUri);
    if (existing) {
      if (preserveFocus) existing.panel.reveal(vscode.ViewColumn.Beside, true);
      else existing.panel.reveal(vscode.ViewColumn.Beside);
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      "nuinuiCAD.outputPreview",
      outputPreviewTranslatorFor(displayLanguage())("outputPreview.panelTitle", {
        document: basename(document.fileName)
      }),
      preserveFocus
        ? { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }
        : vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(host.extensionUri, "dist")]
      }
    );
    panel.webview.html = host.webviewHtml(panel);
    const session: OutputPreviewSession = {
      documentUri,
      surfaceKind: "outputPreview",
      document,
      panel,
      disposables: [],
      webviewReady: false,
      authoritativeDocumentVersion: null,
      pendingOpen: null,
      pendingReveal: null,
      inFlightRevealRequestId: null,
      latestRevealRequestId: null,
      exportAvailability: null,
      inFlightExportRequestId: null
    };
    host.registry.set(session);

    session.disposables.push(vscode.workspace.onDidChangeTextDocument((event) => {
      if (!host.sameDocument(event.document, session.document) || event.contentChanges.length === 0) return;
      session.authoritativeDocumentVersion = null;
      session.exportAvailability = null;
      invalidateReveal(session);
      host.postDocumentText(panel, event.document.getText(), event.document.version, host.documentChangeReasonFor(event.reason));
    }));
    session.disposables.push(panel.webview.onDidReceiveMessage(async (message: VscodeToExtensionMessage) => {
      if (message.type === "webviewReady") {
        session.webviewReady = true;
        session.authoritativeDocumentVersion = null;
        if (session.pendingReveal) session.inFlightRevealRequestId = null;
        else invalidateReveal(session);
        host.postAuthoritativeDocument(panel, session.document);
        return;
      }
      if (message.type === "webviewAuthoritativeDocumentReady") {
        if (message.documentVersion !== session.document.version) return;
        session.authoritativeDocumentVersion = message.documentVersion;
        deliverPendingOpen(session);
        deliverPendingReveal(session);
        return;
      }
      if (message.type === "outputPreviewFit" || message.type === "outputPreviewResetView") {
        postViewportAction(session, message.type);
        return;
      }
      if (message.type === "outputPreviewExportAvailability") {
        if (
          message.documentVersion !== session.document.version ||
          session.authoritativeDocumentVersion !== session.document.version
        ) {
          session.exportAvailability = null;
          return;
        }
        session.exportAvailability = {
          documentVersion: message.documentVersion,
          outputKey: message.outputKey,
          format: message.format
        };
        return;
      }
      if (message.type === "outputPreviewExportRequest") {
        await handleExport(session, message);
        return;
      }
      if (message.type === "outputPreviewRevealResult") {
        handleRevealResult(session, message);
        return;
      }
      if (message.type === "outputPreviewSourceNavigation") {
        await sourceInteraction.handleSourceNavigation(session, message);
        return;
      }
      if (message.type === "outputPreviewPlaceCommit") {
        await sourceInteraction.applyPlaceCommit(session, message);
        return;
      }
      if (message.type === "rustEvaluationRequest") await handleRustEvaluationRequest(session, message);
    }));
    panel.onDidDispose(() => disposeSession(session));
    return session;
  };

  const openForDocument = (
    document: vscode.TextDocument,
    normalizedSourceOffset: number | null,
    preserveFocus = false
  ): OutputPreviewSession => {
    const session = getOrCreateSession(document, preserveFocus);
    invalidateReveal(session);
    session.pendingOpen = { normalizedSourceOffset };
    deliverPendingOpen(session);
    return session;
  };

  const executeOpen = (): void => {
    const editor = host.activeNuiTextEditorForCommand();
    if (editor) {
      const offset = normalizedOffsetFromRaw(editor.document.getText(), editor.document.offsetAt(editor.selection.active));
      openForDocument(editor.document, offset);
      return;
    }
    const canvasDocument = host.activeCanvasDocumentForOpenCommand();
    if (canvasDocument) {
      openForDocument(canvasDocument, null);
      return;
    }
    void vscode.window.showErrorMessage(
      outputPreviewTranslatorFor(displayLanguage())("outputPreview.requiresSourceOrCanvas")
    );
  };

  const executeRevealInOutputPreview = (): void => {
    const translator = outputPreviewTranslatorFor(displayLanguage());
    const editor = host.activeNuiTextEditorForCommand();
    if (!editor) return;
    const target = host.outputPreviewRevealSourceTargetForEditor(editor);
    if (target.status === "failed") {
      const message = target.reason === "analysis-unavailable"
        ? translator("outputPreview.sourceReveal.analysis-unavailable")
        : target.reason === "source-mismatch"
          ? translator("outputPreview.sourceReveal.source-mismatch")
          : target.reason === "invalid-position"
            ? translator("outputPreview.sourceReveal.invalid-position")
            : translator("outputPreview.sourceReveal.no-target");
      void vscode.window.showErrorMessage(message);
      return;
    }

    const documentVersion = editor.document.version;
    if (!host.isOpenDocument(editor.document)) return;
    const session = getOrCreateSession(editor.document, true);
    if (
      editor.document.version !== documentVersion ||
      host.registry.get(session.documentUri) !== session ||
      !host.isOpenDocument(session.document)
    ) return;

    const requestId = nextRevealRequestId++;
    session.pendingOpen = null;
    session.pendingReveal = {
      requestId,
      documentVersion,
      normalizedSourceOffset: target.normalizedSourceOffset
    };
    session.latestRevealRequestId = requestId;
    deliverPendingReveal(session);
  };

  const executeFit = (): void => {
    const session = activeSession();
    if (session) postViewportAction(session, "outputPreviewFit");
  };

  const executeResetView = (): void => {
    const session = activeSession();
    if (session) postViewportAction(session, "outputPreviewResetView");
  };

  const executeClearFocus = (): void => {
    const session = activeSession();
    if (session?.webviewReady && session.authoritativeDocumentVersion === session.document.version) {
      void session.panel.webview.postMessage({ type: "outputPreviewClearFocus" } satisfies ExtensionToVscodeMessage);
    }
  };

  const executeExportCurrent = (): void => {
    const session = activeSessionForOpenCommand();
    if (!session) {
      void vscode.window.showErrorMessage(
        outputPreviewTranslatorFor(displayLanguage())("outputPreview.exportOnlyActive")
      );
      return;
    }
    if (
      session.inFlightExportRequestId !== null ||
      session.authoritativeDocumentVersion !== session.document.version ||
      session.exportAvailability?.documentVersion !== session.document.version ||
      session.exportAvailability.outputKey === null ||
      session.exportAvailability.format === null
    ) {
      void vscode.window.showErrorMessage(
        outputPreviewTranslatorFor(displayLanguage())("outputPreview.noExportableOutput")
      );
      return;
    }
    void session.panel.webview.postMessage({ type: "outputPreviewExport" } satisfies ExtensionToVscodeMessage);
  };

  const executeHistory = async (direction: OutputPreviewHistoryDirection): Promise<void> => {
    const session = activeSessionForOpenCommand();
    if (!session) return;
    await handoffOutputPreviewHistory(direction, {
      isSessionCurrent: () => host.registry.get(session.documentUri) === session,
      isPanelActive: () => session.panel.active,
      isDocumentOpen: () => host.isOpenDocument(session.document),
      documentVersion: () => session.document.version,
      activateMatchingSource: async () => {
        const editor = host.visibleEditorFor(session.document);
        if (!editor) return false;
        try {
          const activatedEditor = await vscode.window.showTextDocument(session.document, {
            viewColumn: editor.viewColumn,
            preserveFocus: false,
            preview: false
          });
          return host.sameDocument(activatedEditor.document, session.document);
        } catch {
          return false;
        }
      },
      executeNativeHistory: async (nativeDirection) => {
        await vscode.commands.executeCommand(nativeDirection);
      },
      restorePreviewFocus: () => session.panel.reveal(undefined, false)
    });
  };

  const commandDisposables = [
    vscode.commands.registerCommand("nuinuiCAD.openOutputPreview", executeOpen),
    vscode.commands.registerCommand("nuinuiCAD.revealInOutputPreview", executeRevealInOutputPreview),
    vscode.commands.registerCommand("nuinuiCAD.resetOutputPreviewView", executeResetView),
    vscode.commands.registerCommand("nuinuiCAD.fitOutputPreview", executeFit),
    vscode.commands.registerCommand("nuinuiCAD.clearOutputPreviewFocus", executeClearFocus),
    vscode.commands.registerCommand("nuinuiCAD.exportCurrentOutput", executeExportCurrent),
    vscode.commands.registerCommand("nuinuiCAD.outputPreviewUndo", () => executeHistory("undo")),
    vscode.commands.registerCommand("nuinuiCAD.outputPreviewRedo", () => executeHistory("redo"))
  ];

  return {
    activeSessionForOpenCommand,
    openForDocument,
    disposeSession,
    dispose: () => {
      for (const disposable of commandDisposables) disposable.dispose();
    }
  };
};
