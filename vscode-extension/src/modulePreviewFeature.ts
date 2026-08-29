import * as vscode from "vscode";
import type { StatementIdentity } from "../../src/document/statementIdentity";
import { queryModulePreviewTarget } from "../../src/dsl/modulePreviewTarget";
import { currentModulePreviewTargetByIdentity } from "../../src/vscode/modulePreviewLifecycle";
import type {
  ExtensionToVscodeMessage,
  VscodeModulePreviewParameterSnapshot,
  VscodeModulePreviewParametersUnavailable,
  VscodeModulePreviewParameterSetValue,
  VscodeModulePreviewParameterSetValueRequest,
  VscodeModulePreviewParameterUseDefault,
  VscodeModulePreviewParameterUseDefaultRequest,
  VscodeCanvasCommandId,
  VscodeDocumentChangeReason,
  VscodeToExtensionMessage
} from "../../src/vscode/protocol";
import type { VscodeCanvasRibbon } from "../../src/vscode/vscodeCanvasRibbonConfig";
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
  sessionId: string;
  targetDefinitionStatementId: StatementIdentity;
  webviewReady: boolean;
  authoritativeDocumentVersion: number | null;
  pendingTarget: ModulePreviewPendingTarget | null;
  disposables: vscode.Disposable[];
};

export type ModulePreviewFeature = vscode.Disposable & {
  postCanvasCommandIfActive: (commandId: VscodeCanvasCommandId) => boolean;
  attachParameterView: (webview: vscode.Webview) => vscode.Disposable;
};

export type RegisterModulePreviewFeatureOptions = {
  languageAnalysisSessionFor: (document: vscode.TextDocument) => NuiLanguageAnalysisSession;
  canvasThemeGeneration: () => number;
  webviewHtml: (panel: vscode.WebviewPanel) => string;
  canvasRibbons: () => VscodeCanvasRibbon[];
  updateCanvasRibbonPosition: (ribbonId: string, x: number, y: number) => Promise<void> | void;
  editCanvasRibbon: () => void;
  evaluateWithRust: (input: unknown) => Promise<unknown>;
};

const isSupportedNuiDocument = (document: vscode.TextDocument): boolean =>
  document.uri.scheme === "file" && document.fileName.endsWith(".nui");

const documentKey = (document: vscode.TextDocument): string => document.uri.toString();

const isModulePreviewParameterSetValueRequest = (
  message: unknown
): message is VscodeModulePreviewParameterSetValueRequest => {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Partial<VscodeModulePreviewParameterSetValueRequest>;
  return candidate.type === "modulePreviewParameterSetValue" &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.documentUri === "string" &&
    Number.isInteger(candidate.documentVersion) &&
    Number.isInteger(candidate.sourceRevision) &&
    Number.isInteger(candidate.sessionRevision) &&
    typeof candidate.targetDefinitionStatementId === "string" &&
    typeof candidate.definitionStatementId === "string" &&
    Number.isInteger(candidate.parameterIndex) &&
    typeof candidate.expression === "string";
};

const isModulePreviewParameterUseDefaultRequest = (
  message: unknown
): message is VscodeModulePreviewParameterUseDefaultRequest => {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Partial<VscodeModulePreviewParameterUseDefaultRequest>;
  return candidate.type === "modulePreviewParameterUseDefault" &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.documentUri === "string" &&
    Number.isInteger(candidate.documentVersion) &&
    Number.isInteger(candidate.sourceRevision) &&
    Number.isInteger(candidate.sessionRevision) &&
    typeof candidate.targetDefinitionStatementId === "string" &&
    typeof candidate.definitionStatementId === "string" &&
    Number.isInteger(candidate.parameterIndex);
};

const isModulePreviewParameterViewReady = (message: unknown): boolean =>
  typeof message === "object" && message !== null &&
  (message as { type?: unknown }).type === "modulePreviewParametersViewReady";

const isModulePreviewParameterSnapshot = (
  message: unknown
): message is VscodeModulePreviewParameterSnapshot => {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Partial<VscodeModulePreviewParameterSnapshot>;
  const target = candidate.target;
  return candidate.type === "modulePreviewParameterSnapshot" &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.documentUri === "string" &&
    Number.isInteger(candidate.documentVersion) &&
    Number.isInteger(candidate.sourceRevision) &&
    Number.isInteger(candidate.sessionRevision) &&
    typeof target === "object" && target !== null &&
    typeof target.definitionStatementId === "string" &&
    Number.isInteger(target.definitionStatementIndex) &&
    typeof target.name === "string" &&
    Array.isArray(candidate.ancestorContexts) &&
    typeof candidate.parameters === "object" && candidate.parameters !== null &&
    Array.isArray(candidate.parameters.parameters) &&
    Array.isArray(candidate.inputDiagnostics) &&
    (candidate.previewStatus === "current" ||
      candidate.previewStatus === "lastGood" ||
      candidate.previewStatus === "noValidPreview");
};

const isModulePreviewParametersUnavailable = (
  message: unknown
): message is VscodeModulePreviewParametersUnavailable => {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Partial<VscodeModulePreviewParametersUnavailable>;
  return candidate.type === "modulePreviewParametersUnavailable" &&
    (candidate.sessionId === null || typeof candidate.sessionId === "string") &&
    (candidate.documentUri === null || typeof candidate.documentUri === "string") &&
    (candidate.documentVersion === null || Number.isInteger(candidate.documentVersion)) &&
    (candidate.sourceRevision === null || Number.isInteger(candidate.sourceRevision)) &&
    Number.isInteger(candidate.sessionRevision) &&
    (candidate.targetDefinitionStatementId === null || typeof candidate.targetDefinitionStatementId === "string") &&
    (candidate.reason === "no-session" || candidate.reason === "not-ready" ||
      candidate.reason === "source-stale" || candidate.reason === "target-unavailable" ||
      candidate.reason === "disposed");
};

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
  const caretOffset = normalizedOffsetFromRaw(
    rawSource,
    document.offsetAt(editor.selection.active)
  );
  const target = queryModulePreviewTarget({ source, position: caretOffset, semantic });
  if (!target) return null;
  const targetStatement = semantic.compiled.statements[target.definitionStatementIndex];
  if (!targetStatement || targetStatement.kind !== "moduleDefinition") return null;
  return { target, normalizedSourceOffset: targetStatement.documentRange.from };
};

export const registerModulePreviewFeature = ({
  languageAnalysisSessionFor,
  canvasThemeGeneration,
  webviewHtml,
  canvasRibbons,
  updateCanvasRibbonPosition,
  editCanvasRibbon,
  evaluateWithRust
}: RegisterModulePreviewFeatureOptions): ModulePreviewFeature => {
  const sessions = new Map<string, ModulePreviewSession>();
  const disposables: vscode.Disposable[] = [];
  let contextUpdate: Promise<void> = Promise.resolve();
  let nextSessionGeneration = 1;
  let parameterWebview: vscode.Webview | null = null;
  let parameterWebviewDisposable: vscode.Disposable | null = null;
  let boundParameterSession: ModulePreviewSession | null = null;
  let latestParameterMessage: VscodeModulePreviewParameterSnapshot | VscodeModulePreviewParametersUnavailable | null = null;

  const nextSessionId = (): string => {
    const sessionId = `module-preview-session:${nextSessionGeneration}`;
    nextSessionGeneration += 1;
    return sessionId;
  };

  const postParameterMessage = (
    message: VscodeModulePreviewParameterSnapshot | VscodeModulePreviewParametersUnavailable
  ): void => {
    latestParameterMessage = message;
    if (parameterWebview) void parameterWebview.postMessage(message);
  };

  const sourceContextFor = (session: ModulePreviewSession) => {
    const rawSource = session.document.getText();
    const analysis = languageAnalysisSessionFor(session.document);
    if (analysis.getSource() !== rawSource) analysis.replaceSource(rawSource);
    const source = {
      normalizedSource: normalizedSourceFor(rawSource),
      sourceRevision: analysis.getSourceRevision()
    };
    return {
      source,
      semantic: analysis.definitionSemanticSnapshot(source)
    };
  };

  const currentTargetFor = (session: ModulePreviewSession) => {
    const { source, semantic } = sourceContextFor(session);
    return {
      sourceRevision: source.sourceRevision,
      target: currentModulePreviewTargetByIdentity({
        source,
        semantic,
        definitionStatementId: session.targetDefinitionStatementId
      })?.target ?? null
    };
  };

  const parameterUnavailableFor = (
    session: ModulePreviewSession,
    reason: VscodeModulePreviewParametersUnavailable["reason"]
  ): VscodeModulePreviewParametersUnavailable => ({
    type: "modulePreviewParametersUnavailable",
    sessionId: session.sessionId,
    documentUri: session.documentUri,
    documentVersion: session.document.version,
    sourceRevision: currentTargetFor(session).sourceRevision,
    sessionRevision: latestParameterMessage?.sessionId === session.sessionId
      ? latestParameterMessage.sessionRevision
      : 0,
    targetDefinitionStatementId: session.targetDefinitionStatementId,
    reason
  });

  const publishParameterUnavailable = (
    session: ModulePreviewSession,
    reason: Exclude<VscodeModulePreviewParametersUnavailable["reason"], "no-session">
  ): void => {
    if (boundParameterSession !== session) return;
    postParameterMessage(parameterUnavailableFor(session, reason));
  };

  const clearParameterBinding = (): void => {
    boundParameterSession = null;
    postParameterMessage({
      type: "modulePreviewParametersUnavailable",
      sessionId: null,
      documentUri: null,
      documentVersion: null,
      sourceRevision: null,
      sessionRevision: 0,
      targetDefinitionStatementId: null,
      reason: "no-session"
    });
  };

  const bindParameterSession = (session: ModulePreviewSession): void => {
    boundParameterSession = session;
    postParameterMessage(parameterUnavailableFor(session, "not-ready"));
  };

  const postSessionIdentity = (session: ModulePreviewSession): void => {
    void session.panel.webview.postMessage({
      type: "modulePreviewSession",
      sessionId: session.sessionId,
      documentUri: session.documentUri
    } satisfies ExtensionToVscodeMessage);
  };

  const parameterRowFor = (
    snapshot: VscodeModulePreviewParameterSnapshot,
    definitionStatementId: StatementIdentity,
    parameterIndex: number
  ) => [
    ...snapshot.ancestorContexts.flatMap((group) => group.parameters),
    ...snapshot.parameters.parameters
  ].find((parameter) =>
    parameter.definitionStatementId === definitionStatementId &&
    parameter.parameterIndex === parameterIndex
  );

  const currentParameterSnapshot = (): VscodeModulePreviewParameterSnapshot | null =>
    latestParameterMessage?.type === "modulePreviewParameterSnapshot"
      ? latestParameterMessage
      : null;

  const acceptsParameterSnapshot = (message: VscodeModulePreviewParameterSnapshot): boolean => {
    const session = boundParameterSession;
    if (!session || !session.webviewReady || session.authoritativeDocumentVersion !== session.document.version) return false;
    if (
      message.sessionId !== session.sessionId ||
      message.documentUri !== session.documentUri ||
      message.documentVersion !== session.document.version ||
      !Number.isInteger(message.sessionRevision)
    ) return false;
    const current = currentTargetFor(session);
    if (
      !current.target ||
      current.sourceRevision !== message.sourceRevision ||
      message.target.definitionStatementId !== session.targetDefinitionStatementId ||
      message.target.definitionStatementId !== current.target.definitionStatementId ||
      message.target.definitionStatementIndex !== current.target.definitionStatementIndex ||
      message.target.name !== current.target.name
    ) return false;
    const latest = latestParameterMessage;
    if (latest && latest.sessionId === message.sessionId && message.sessionRevision <= latest.sessionRevision) return false;
    return true;
  };

  const acceptsParameterUnavailable = (message: VscodeModulePreviewParametersUnavailable): boolean => {
    const session = boundParameterSession;
    if (!session || message.sessionId !== session.sessionId || message.documentUri !== session.documentUri) return false;
    if (message.documentVersion !== session.document.version) return false;
    const current = currentTargetFor(session);
    if (message.sourceRevision !== current.sourceRevision) return false;
    if (
      message.targetDefinitionStatementId !== null &&
      message.targetDefinitionStatementId !== session.targetDefinitionStatementId
    ) return false;
    const latest = latestParameterMessage;
    if (latest && latest.sessionId === message.sessionId && message.sessionRevision <= latest.sessionRevision) return false;
    postParameterMessage(message);
    return true;
  };

  const forwardParameterAction = (
    message: VscodeModulePreviewParameterSetValueRequest | VscodeModulePreviewParameterUseDefaultRequest
  ): boolean => {
    const session = boundParameterSession;
    const snapshot = currentParameterSnapshot();
    if (!session || !snapshot) return false;
    if (
      message.sessionId !== session.sessionId ||
      message.documentUri !== session.documentUri ||
      message.documentVersion !== session.document.version ||
      message.sourceRevision !== snapshot.sourceRevision ||
      message.sessionRevision !== snapshot.sessionRevision ||
      message.targetDefinitionStatementId !== snapshot.target.definitionStatementId ||
      session.authoritativeDocumentVersion !== session.document.version
    ) return false;
    const current = currentTargetFor(session);
    if (
      !current.target ||
      current.sourceRevision !== message.sourceRevision ||
      current.target.definitionStatementId !== message.targetDefinitionStatementId ||
      current.target.definitionStatementIndex !== snapshot.target.definitionStatementIndex ||
      current.target.name !== snapshot.target.name
    ) return false;
    const row = parameterRowFor(snapshot, message.definitionStatementId, message.parameterIndex);
    if (!row || (message.type === "modulePreviewParameterUseDefault" && row.defaultSourceText === null)) return false;
    const forwarded: VscodeModulePreviewParameterSetValue | VscodeModulePreviewParameterUseDefault = message.type === "modulePreviewParameterSetValue"
      ? {
          type: "modulePreviewSetValue",
          sessionId: message.sessionId,
          documentUri: message.documentUri,
          documentVersion: message.documentVersion,
          sourceRevision: message.sourceRevision,
          sessionRevision: message.sessionRevision,
          targetDefinitionStatementId: message.targetDefinitionStatementId,
          definitionStatementId: message.definitionStatementId,
          parameterIndex: message.parameterIndex,
          expression: message.expression
        }
      : {
          type: "modulePreviewUseDefault",
          sessionId: message.sessionId,
          documentUri: message.documentUri,
          documentVersion: message.documentVersion,
          sourceRevision: message.sourceRevision,
          sessionRevision: message.sessionRevision,
          targetDefinitionStatementId: message.targetDefinitionStatementId,
          definitionStatementId: message.definitionStatementId,
          parameterIndex: message.parameterIndex
        };
    void session.panel.webview.postMessage(forwarded satisfies ExtensionToVscodeMessage);
    return true;
  };

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
    if (pending.kind === "unavailable") publishParameterUnavailable(session, "target-unavailable");
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
    if (boundParameterSession === session) clearParameterBinding();
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
      existing.sessionId = nextSessionId();
      existing.targetDefinitionStatementId = target.target.definitionStatementId;
      existing.pendingTarget = {
        kind: "target",
        documentVersion: document.version,
        normalizedSourceOffset: target.normalizedSourceOffset
      };
      bindParameterSession(existing);
      existing.panel.reveal(vscode.ViewColumn.Beside);
      if (existing.webviewReady) postSessionIdentity(existing);
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
      sessionId: nextSessionId(),
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
    bindParameterSession(session);

    session.disposables.push(vscode.workspace.onDidChangeTextDocument((event) => {
      if (!sameDocument(event.document, session.document) || event.contentChanges.length === 0) return;
      refreshExistingTarget(session);
      session.authoritativeDocumentVersion = null;
      publishParameterUnavailable(session, "source-stale");
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
        postSessionIdentity(session);
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
      if (message.type === "modulePreviewParameterSnapshot" && isModulePreviewParameterSnapshot(message)) {
        if (acceptsParameterSnapshot(message)) postParameterMessage(message);
        return;
      }
      if (message.type === "modulePreviewParametersUnavailable" && isModulePreviewParametersUnavailable(message)) {
        acceptsParameterUnavailable(message);
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
    if (session) {
      session.panel.dispose();
      disposeSession(session);
    }
    refreshSourceTargetContext();
  }));
  disposables.push(vscode.window.onDidChangeActiveColorTheme(() => {
    for (const session of sessions.values()) {
      void session.panel.webview.postMessage({
        type: "canvasThemeChanged",
        generation: canvasThemeGeneration()
      } satisfies ExtensionToVscodeMessage);
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
    attachParameterView: (webview) => {
      parameterWebviewDisposable?.dispose();
      parameterWebview = webview;
      if (latestParameterMessage) void webview.postMessage(latestParameterMessage);
      const messageDisposable = webview.onDidReceiveMessage((message: unknown) => {
        if (isModulePreviewParameterViewReady(message)) {
          if (latestParameterMessage) void webview.postMessage(latestParameterMessage);
          return;
        }
        if (isModulePreviewParameterSetValueRequest(message) || isModulePreviewParameterUseDefaultRequest(message)) {
          forwardParameterAction(message);
        }
      });
      const attached = {
        dispose: () => {
          messageDisposable.dispose();
          if (parameterWebview === webview) parameterWebview = null;
          if (parameterWebviewDisposable === attached) parameterWebviewDisposable = null;
        }
      } satisfies vscode.Disposable;
      parameterWebviewDisposable = attached;
      return attached;
    },
    dispose: () => {
      setSourceTargetContext(false);
      for (const session of [...sessions.values()]) session.panel.dispose();
      if (boundParameterSession) clearParameterBinding();
      parameterWebviewDisposable?.dispose();
      for (const disposable of disposables.splice(0)) disposable.dispose();
      sessions.clear();
    }
  };
};
