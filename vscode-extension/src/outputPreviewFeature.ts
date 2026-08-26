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
  VscodeOutputPreviewExportRequest
} from "../../src/vscode/outputPreviewProtocol";
import type { VscodeWebviewSessionBase } from "../../src/vscode/vscodeWebviewSession";
import { normalizedOffsetFromRaw } from "./sourceOffsetAdapter";
import {
  createOutputPreviewSourceInteractionFeature
} from "./outputPreviewSourceInteractionFeature";
import {
  handoffOutputPreviewHistory,
  type OutputPreviewHistoryDirection
} from "./outputPreviewHistory";

export type OutputPreviewSession = VscodeWebviewSessionBase & {
  surfaceKind: "outputPreview";
  documentUri: string;
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  disposables: vscode.Disposable[];
  webviewReady: boolean;
  authoritativeDocumentVersion: number | null;
  pendingOpen: { normalizedSourceOffset: number | null } | null;
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
  activeCanvasDocumentForOpenCommand: () => vscode.TextDocument | null;
  isOutputPreviewTabActive: () => boolean;
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
  const activeSession = (): OutputPreviewSession | null =>
    host.registry.values().find((candidate) => candidate.panel.active) ?? null;

  const activeSessionForOpenCommand = (): OutputPreviewSession | null =>
    host.isOutputPreviewTabActive() ? activeSession() : null;

  const resyncOutputPreview = (session: OutputPreviewSession): void => {
    if (host.registry.get(session.documentUri) !== session || !host.isOpenDocument(session.document)) return;
    session.authoritativeDocumentVersion = null;
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
    if (session.inFlightExportRequestId !== null || !exportRequestIsCurrent(session, message)) {
      postExportResult(session, message.requestId, "failed");
      void vscode.window.showErrorMessage("nuinuiCAD: Output Preview changed. Review the current output and export again.");
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
          ? { "PDF document": ["pdf"] }
          : { "SVG document": ["svg"] },
        saveLabel: message.format === "pdf" ? "Export PDF" : "Export SVG"
      });
      if (!selected) {
        postExportResult(session, message.requestId, "cancelled");
        return;
      }
      if (selected.scheme !== "file") throw new Error("Output files can only be saved to a local file path.");
      if (!exportRequestIsCurrent(session, message)) {
        postExportResult(session, message.requestId, "failed");
        void vscode.window.showErrorMessage("nuinuiCAD: Output Preview changed while the save dialog was open. Export again.");
        return;
      }
      const path = ensureOutputExportExtension(selected.fsPath, message.format);
      await host.exportOutput({ path, payload: message.payload });
      postExportResult(session, message.requestId, "saved");
      void vscode.window.showInformationMessage(`nuinuiCAD: Saved ${basename(path)}.`);
    } catch (error) {
      postExportResult(session, message.requestId, "failed");
      void vscode.window.showErrorMessage(
        `nuinuiCAD: Export failed: ${error instanceof Error ? error.message : String(error)}`
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
    host.registry.delete(session.documentUri);
    for (const disposable of session.disposables.splice(0)) disposable.dispose();
  };

  const openForDocument = (
    document: vscode.TextDocument,
    normalizedSourceOffset: number | null,
    preserveFocus = false
  ): OutputPreviewSession => {
    const documentUri = host.documentKey(document);
    const existing = host.registry.get(documentUri);
    if (existing) {
      existing.pendingOpen = { normalizedSourceOffset };
      if (preserveFocus) existing.panel.reveal(vscode.ViewColumn.Beside, true);
      else existing.panel.reveal(vscode.ViewColumn.Beside);
      deliverPendingOpen(existing);
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      "nuinuiCAD.outputPreview",
      `${basename(document.fileName)} — Output Preview`,
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
      pendingOpen: { normalizedSourceOffset },
      exportAvailability: null,
      inFlightExportRequestId: null
    };
    host.registry.set(session);

    session.disposables.push(vscode.workspace.onDidChangeTextDocument((event) => {
      if (!host.sameDocument(event.document, session.document) || event.contentChanges.length === 0) return;
      session.authoritativeDocumentVersion = null;
      session.exportAvailability = null;
      host.postDocumentText(panel, event.document.getText(), event.document.version, host.documentChangeReasonFor(event.reason));
    }));
    session.disposables.push(panel.webview.onDidReceiveMessage(async (message: VscodeToExtensionMessage) => {
      if (message.type === "webviewReady") {
        session.webviewReady = true;
        session.authoritativeDocumentVersion = null;
        host.postAuthoritativeDocument(panel, session.document);
        return;
      }
      if (message.type === "webviewAuthoritativeDocumentReady") {
        if (message.documentVersion !== session.document.version) return;
        session.authoritativeDocumentVersion = message.documentVersion;
        deliverPendingOpen(session);
        return;
      }
      if (message.type === "outputPreviewFit") {
        if (session.webviewReady && session.authoritativeDocumentVersion === session.document.version) {
          void panel.webview.postMessage({ type: "outputPreviewFit" } satisfies ExtensionToVscodeMessage);
        }
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
    void vscode.window.showErrorMessage("nuinuiCAD requires an active .nui Text Editor or Canvas.");
  };

  const executeFit = (): void => {
    const session = activeSession();
    if (session?.webviewReady && session.authoritativeDocumentVersion === session.document.version) {
      void session.panel.webview.postMessage({ type: "outputPreviewFit" } satisfies ExtensionToVscodeMessage);
    }
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
      void vscode.window.showErrorMessage("nuinuiCAD: Export Current Output is only available from an active Output Preview.");
      return;
    }
    if (
      session.inFlightExportRequestId !== null ||
      session.authoritativeDocumentVersion !== session.document.version ||
      session.exportAvailability?.documentVersion !== session.document.version ||
      session.exportAvailability.outputKey === null ||
      session.exportAvailability.format === null
    ) {
      void vscode.window.showErrorMessage("nuinuiCAD: The active Output Preview has no current exportable output.");
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
