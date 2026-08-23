import * as vscode from "vscode";
import type { StatementIdentity } from "../../src/document/statementIdentity";
import { queryModulePreviewTarget } from "../../src/dsl/modulePreviewTarget";
import { currentModulePreviewTargetByIdentity } from "../../src/vscode/modulePreviewLifecycle";
import type {
  ExtensionToVscodeMessage,
  VscodeCanvasCommandId,
  VscodeCanvasRibbon,
  VscodeDocumentChangeReason,
  VscodeToExtensionMessage
} from "../../src/vscode/protocol";
import type { NuiLanguageAnalysisSession } from "./languageAnalysisSession";
import { normalizedOffsetFromRaw, normalizedSourceFor } from "./sourceOffsetAdapter";

export const NUI_MODULE_PREVIEW_VIEW_TYPE = "nuinuiCAD.modulePreview";
export const NUI_MODULE_PREVIEW_SOURCE_TARGET_CONTEXT = "nuinuiCAD.modulePreviewSourceTarget";

const nonWritingCanvasCommands = new Set<VscodeCanvasCommandId>([
  "clearCanvasSelection",
  "resetCanvasView",
  "fitDrawing",
  "toggleCanvasPointNames",
  "toggleCanvasGeometryNames",
  "toggleCanvasElementNames",
  "toggleCanvasPoints"
]);

type ModulePreviewPendingTarget =
  | { kind: "target"; documentVersion: number; normalizedSourceOffset: number }
  | { kind: "unavailable"; documentVersion: number };

type ModulePreviewSession = {
  documentUri: string;
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  targetDefinitionStatementId: StatementIdentity;
  webviewReady: boolean;
  authoritativeDocumentVersion: number | null;
  pendingTarget: ModulePreviewPendingTarget | null;
  disposables: vscode.Disposable[];
};

export type ModulePreviewFeature = vscode.Disposable & {
  postCanvasCommandIfActive: (commandId: VscodeCanvasCommandId) => boolean;
};

export type RegisterModulePreviewFeatureOptions = {
  languageAnalysisSessionFor: (document: vscode.TextDocument) => NuiLanguageAnalysisSession;
  webviewHtml: (panel: vscode.WebviewPanel) => string;
  canvasRibbons: () => VscodeCanvasRibbon[];
  updateCanvasRibbonPosition: (ribbonId: string, x: number, y: number) => Promise<void> | void;
  editCanvasRibbon: () => void;
  evaluateWithRust: (input: unknown) => Promise<unknown>;
};

const isSupportedNuiDocument = (document: vscode.TextDocument): boolean =>
  document.uri.scheme === "file" && document.fileName.endsWith(".nui");

const documentKey = (document: vscode.TextDocument): string => document.uri.toString();

const sameDocument = (left: vscode.TextDocument, right: vscode.TextDocument): boolean =>
  left === right || documentKey(left) === documentKey(right);

const documentChangeReasonFor = (
  reason: vscode.TextDocumentChangeReason | undefined
): VscodeDocumentChangeReason => reason === vscode.TextDocumentChangeReason.Undo
  ? "undo"
  : reason === vscode.TextDocumentChangeReason.Redo
    ? "redo"
    : "edit";

const exactTargetAtEditor = (
  editor: vscode.TextEditor,
  languageAnalysisSessionFor: RegisterModulePreviewFeatureOptions["languageAnalysisSessionFor"]
) => {
  if (!isSupportedNuiDocument(editor.document)) return null;
  const document = editor.document;
  const rawSource = document.getText();
  const analysis = languageAnalysisSessionFor(document);
  if (analysis.getSource() !== rawSource) analysis.replaceSource(rawSource);
  const source = {
    normalizedSource: normalizedSourceFor(rawSource),
    sourceRevision: analysis.getSourceRevision()
  };
  const semantic = analysis.definitionSemanticSnapshot(source);
  if (!semantic?.compiled) return null;
  const normalizedSourceOffset = normalizedOffsetFromRaw(
    rawSource,
    document.offsetAt(editor.selection.active)
  );
  const target = queryModulePreviewTarget({ source, position: normalizedSourceOffset, semantic });
  return target ? { target, normalizedSourceOffset } : null;
};

export const registerModulePreviewFeature = ({
  languageAnalysisSessionFor,
  webviewHtml,
  canvasRibbons,
  updateCanvasRibbonPosition,
  editCanvasRibbon,
  evaluateWithRust
}: RegisterModulePreviewFeatureOptions): ModulePreviewFeature => {
  const sessions = new Map<string, ModulePreviewSession>();
  const disposables: vscode.Disposable[] = [];
  let contextUpdate: Promise<void> = Promise.resolve();

  const setSourceTargetContext = (enabled: boolean): void => {
    contextUpdate = contextUpdate
      .catch(() => undefined)
      .then(() => vscode.commands.executeCommand(
        "setContext",
        NUI_MODULE_PREVIEW_SOURCE_TARGET_CONTEXT,
        enabled
      ))
      .then(() => undefined);
  };

  const refreshSourceTargetContext = (): void => {
    const editor = vscode.window.activeTextEditor;
    setSourceTargetContext(Boolean(editor && exactTargetAtEditor(editor, languageAnalysisSessionFor)));
  };

  const deliverPendingTarget = (session: ModulePreviewSession): void => {
    const pending = session.pendingTarget;
    if (
      !pending ||
      !session.webviewReady ||
      session.authoritativeDocumentVersion !== session.document.version ||
      pending.documentVersion !== session.document.version
    ) return;
    session.pendingTarget = null;
    const message: ExtensionToVscodeMessage = pending.kind === "target"
      ? {
          type: "modulePreviewTarget",
          documentVersion: pending.documentVersion,
          normalizedSourceOffset: pending.normalizedSourceOffset
        }
      : {
          type: "modulePreviewTargetUnavailable",
          documentVersion: pending.documentVersion
        };
    void session.panel.webview.postMessage(message);
  };

  const postAuthoritativeDocument = (session: ModulePreviewSession): void => {
    session.authoritativeDocumentVersion = null;
    void session.panel.webview.postMessage({
      type: "replaceTextDocument",
      sourceText: session.document.getText(),
      documentVersion: session.document.version
    } satisfies ExtensionToVscodeMessage);
  };

  const refreshExistingTarget = (session: ModulePreviewSession): void => {
    const rawSource = session.document.getText();
    const analysis = languageAnalysisSessionFor(session.document);
    if (analysis.getSource() !== rawSource) analysis.replaceSource(rawSource);
    const source = {
      normalizedSource: normalizedSourceFor(rawSource),
      sourceRevision: analysis.getSourceRevision()
    };
    const semantic = analysis.definitionSemanticSnapshot(source);
    const refreshed = currentModulePreviewTargetByIdentity({
      source,
      semantic,
      definitionStatementId: session.targetDefinitionStatementId
    });
    session.pendingTarget = refreshed
      ? {
          kind: "target",
          documentVersion: session.document.version,
          normalizedSourceOffset: refreshed.normalizedSourceOffset
        }
      : { kind: "unavailable", documentVersion: session.document.version };
  };

  const disposeSession = (session: ModulePreviewSession): void => {
    if (sessions.get(session.documentUri) !== session) return;
    sessions.delete(session.documentUri);
    for (const disposable of session.disposables.splice(0)) disposable.dispose();
  };

  const createOrRetargetPanel = (
    editor: vscode.TextEditor,
    target: NonNullable<ReturnType<typeof exactTargetAtEditor>>
  ): ModulePreviewSession => {
    const document = editor.document;
    const key = documentKey(document);
    const existing = sessions.get(key);
    if (existing) {
      existing.targetDefinitionStatementId = target.target.definitionStatementId;
      existing.pendingTarget = {
        kind: "target",
        documentVersion: document.version,
        normalizedSourceOffset: target.normalizedSourceOffset
      };
      existing.panel.reveal(vscode.ViewColumn.Beside);
      deliverPendingTarget(existing);
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      NUI_MODULE_PREVIEW_VIEW_TYPE,
      "Module Preview",
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );
    panel.webview.html = webviewHtml(panel);
    const session: ModulePreviewSession = {
      documentUri: key,
      document,
      panel,
      targetDefinitionStatementId: target.target.definitionStatementId,
      webviewReady: false,
      authoritativeDocumentVersion: null,
      pendingTarget: {
        kind: "target",
        documentVersion: document.version,
        normalizedSourceOffset: target.normalizedSourceOffset
      },
      disposables: []
    };
    sessions.set(key, session);

    session.disposables.push(vscode.workspace.onDidChangeTextDocument((event) => {
      if (!sameDocument(event.document, session.document) || event.contentChanges.length === 0) return;
      refreshExistingTarget(session);
      session.authoritativeDocumentVersion = null;
      void panel.webview.postMessage({
        type: "commitText",
        sourceText: event.document.getText(),
        documentVersion: event.document.version,
        reason: documentChangeReasonFor(event.reason)
      } satisfies ExtensionToVscodeMessage);
    }));

    session.disposables.push(panel.webview.onDidReceiveMessage(async (message: VscodeToExtensionMessage) => {
      if (message.type === "webviewReady") {
        session.webviewReady = true;
        postAuthoritativeDocument(session);
        void panel.webview.postMessage({
          type: "canvasRibbonConfiguration",
          ribbons: canvasRibbons()
        } satisfies ExtensionToVscodeMessage);
        return;
      }
      if (message.type === "webviewAuthoritativeDocumentReady") {
        if (message.documentVersion !== session.document.version) return;
        session.authoritativeDocumentVersion = message.documentVersion;
        deliverPendingTarget(session);
        return;
      }
      if (message.type === "canvasRibbonPositionCommit") {
        if (!message.ribbonId || !Number.isFinite(message.x) || !Number.isFinite(message.y)) return;
        await updateCanvasRibbonPosition(message.ribbonId, message.x, message.y);
        return;
      }
      if (message.type === "editCanvasRibbon") {
        editCanvasRibbon();
        return;
      }
      if (message.type === "rustEvaluationRequest") {
        try {
          const payload = await evaluateWithRust(message.input);
          void panel.webview.postMessage({
            type: "rustEvaluationResponse",
            id: message.id,
            payload
          } satisfies ExtensionToVscodeMessage);
        } catch (error) {
          void panel.webview.postMessage({
            type: "rustEvaluationError",
            id: message.id,
            error: error instanceof Error ? error.message : String(error)
          } satisfies ExtensionToVscodeMessage);
        }
      }
    }));
    session.disposables.push(panel.onDidDispose(() => disposeSession(session)));
    return session;
  };

  disposables.push(vscode.commands.registerCommand("nuinuiCAD.openModulePreview", () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isSupportedNuiDocument(editor.document)) {
      void vscode.window.showErrorMessage("nuinuiCAD: Open Module Preview requires an active .nui Source Editor.");
      return;
    }
    const target = exactTargetAtEditor(editor, languageAnalysisSessionFor);
    if (!target) {
      void vscode.window.showErrorMessage("nuinuiCAD: Place the Source Editor caret inside a current Module definition.");
      return;
    }
    createOrRetargetPanel(editor, target);
  }));

  disposables.push(vscode.window.onDidChangeActiveTextEditor(() => refreshSourceTargetContext()));
  disposables.push(vscode.window.onDidChangeTextEditorSelection((event) => {
    if (event.textEditor === vscode.window.activeTextEditor) refreshSourceTargetContext();
  }));
  disposables.push(vscode.workspace.onDidChangeTextDocument((event) => {
    if (vscode.window.activeTextEditor && sameDocument(event.document, vscode.window.activeTextEditor.document)) {
      refreshSourceTargetContext();
    }
  }));
  disposables.push(vscode.workspace.onDidCloseTextDocument((document) => {
    const session = sessions.get(documentKey(document));
    if (session) session.panel.dispose();
    refreshSourceTargetContext();
  }));
  disposables.push(vscode.window.onDidChangeActiveColorTheme(() => {
    for (const session of sessions.values()) {
      void session.panel.webview.postMessage({ type: "canvasThemeChanged" } satisfies ExtensionToVscodeMessage);
    }
  }));
  const configurationListener = vscode.workspace.onDidChangeConfiguration?.((event) => {
    if (!event.affectsConfiguration("nuinuiCAD.canvasRibbon.ribbons")) return;
    const ribbons = canvasRibbons();
    for (const session of sessions.values()) {
      void session.panel.webview.postMessage({
        type: "canvasRibbonConfiguration",
        ribbons
      } satisfies ExtensionToVscodeMessage);
    }
  });
  if (configurationListener) disposables.push(configurationListener);
  refreshSourceTargetContext();

  return {
    postCanvasCommandIfActive: (commandId) => {
      if (!nonWritingCanvasCommands.has(commandId)) return false;
      const session = [...sessions.values()].find((candidate) => candidate.panel.active);
      if (!session) return false;
      void session.panel.webview.postMessage({ type: "canvasCommand", commandId } satisfies ExtensionToVscodeMessage);
      return true;
    },
    dispose: () => {
      setSourceTargetContext(false);
      for (const session of [...sessions.values()]) session.panel.dispose();
      for (const disposable of disposables.splice(0)) disposable.dispose();
      sessions.clear();
    }
  };
};
