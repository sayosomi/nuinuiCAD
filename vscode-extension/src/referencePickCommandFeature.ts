import * as vscode from "vscode";
import { queryDslCanvasSourceTarget } from "../../src/dsl/dslNavigationQuery";
import { queryDslCanvasRevealSourceTarget } from "../../src/dsl/dslCanvasRevealQuery";
import { queryDslReferencePickTarget } from "../../src/dsl/dslReferencePickQuery";
import type { VscodeReferencePickResult } from "../../src/vscode/referencePickProtocol";
import type { NuiLanguageAnalysisSession } from "./languageAnalysisSession";
import {
  createVscodeReferencePickSourceBridge,
  type VscodeReferencePickSourceBridge
} from "./referencePickSourceBridge";
import { normalizedOffsetFromRaw, normalizedSourceFor } from "./sourceOffsetAdapter";

export const VSCODE_REFERENCE_PICK_COMMAND_ID = "nuinuiCAD.pickReferenceFromCanvas";
export const VSCODE_REFERENCE_PICK_CONTEXT_KEY = "nuinuiCAD.referencePickSourceTarget";
export const VSCODE_REVEAL_IN_CANVAS_SOURCE_TARGET_CONTEXT_KEY = "nuinuiCAD.revealInCanvasSourceTarget";
export const VSCODE_BAKE_SOURCE_TARGET_CONTEXT_KEY = "nuinuiCAD.bakeSourceTarget";

export type VscodeReferencePickCanvasEndpoint = {
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  isAuthoritativeReady: () => boolean;
};

type ActiveReferencePick = {
  editor: vscode.TextEditor;
  normalizedSourceOffset: number;
  documentVersion: number;
  requestId: number;
  endpoint: VscodeReferencePickCanvasEndpoint;
  bridge: VscodeReferencePickSourceBridge | null;
  webviewDisposable: vscode.Disposable;
  panelDisposable: vscode.Disposable;
};

export type VscodeSourceTargetAvailability = {
  referencePickSourceOffset: number | null;
  revealInCanvas: boolean;
  bake: boolean;
};

const unavailableSourceTargets = (): VscodeSourceTargetAvailability => ({
  referencePickSourceOffset: null,
  revealInCanvas: false,
  bake: false
});

const isSupportedSourceEditor = (editor: vscode.TextEditor | undefined): editor is vscode.TextEditor =>
  Boolean(editor) &&
  editor!.document.uri.scheme === "file" &&
  editor!.document.fileName.endsWith(".nui");

const sameDocument = (left: vscode.TextDocument, right: vscode.TextDocument): boolean =>
  left === right || left.uri.toString() === right.uri.toString();

export const sourceTargetAvailabilityForEditor = (
  editor: vscode.TextEditor,
  languageAnalysisSession: NuiLanguageAnalysisSession
): VscodeSourceTargetAvailability => {
  if (!isSupportedSourceEditor(editor)) return unavailableSourceTargets();
  const rawSource = editor.document.getText();
  if (languageAnalysisSession.getSource() !== rawSource) languageAnalysisSession.replaceSource(rawSource);
  const source = {
    normalizedSource: normalizedSourceFor(rawSource),
    sourceRevision: languageAnalysisSession.getSourceRevision()
  };
  const semantic = languageAnalysisSession.definitionSemanticSnapshot(source);
  if (!semantic?.compiled) return unavailableSourceTargets();
  const normalizedSourceOffset = normalizedOffsetFromRaw(
    rawSource,
    editor.document.offsetAt(editor.selection.active)
  );
  const referencePickSourceOffset = queryDslReferencePickTarget({
    source,
    position: normalizedSourceOffset,
    semantic
  }) ? normalizedSourceOffset : null;
  const revealInCanvas = Boolean(semantic.compiled.statementMap) &&
    queryDslCanvasRevealSourceTarget({
      source,
      compiled: semantic.compiled,
      position: normalizedSourceOffset
    }).status === "resolved";
  const bake = queryDslCanvasSourceTarget({
    source,
    compiled: semantic.compiled,
    position: normalizedSourceOffset
  }) !== null;
  return { referencePickSourceOffset, revealInCanvas, bake };
};

export const referencePickSourceOffsetForEditor = (
  editor: vscode.TextEditor,
  languageAnalysisSession: NuiLanguageAnalysisSession
): number | null => {
  if (!isSupportedSourceEditor(editor)) return null;
  const rawSource = editor.document.getText();
  if (languageAnalysisSession.getSource() !== rawSource) languageAnalysisSession.replaceSource(rawSource);
  const source = {
    normalizedSource: normalizedSourceFor(rawSource),
    sourceRevision: languageAnalysisSession.getSourceRevision()
  };
  const semantic = languageAnalysisSession.definitionSemanticSnapshot(source);
  if (!semantic?.compiled) return null;
  const normalizedSourceOffset = normalizedOffsetFromRaw(
    rawSource,
    editor.document.offsetAt(editor.selection.active)
  );
  return queryDslReferencePickTarget({
    source,
    position: normalizedSourceOffset,
    semantic
  }) ? normalizedSourceOffset : null;
};

export const registerVscodeReferencePickFeature = ({
  languageAnalysisSessionFor,
  ensureCanvas
}: {
  languageAnalysisSessionFor: (document: vscode.TextDocument) => NuiLanguageAnalysisSession;
  ensureCanvas: (
    document: vscode.TextDocument
  ) => VscodeReferencePickCanvasEndpoint | null | Promise<VscodeReferencePickCanvasEndpoint | null>;
}): vscode.Disposable => {
  let nextRequestId = 1;
  let active: ActiveReferencePick | null = null;
  let contextUpdate: Promise<void> = Promise.resolve();

  const setSourceTargetContexts = (availability: VscodeSourceTargetAvailability): void => {
    contextUpdate = contextUpdate
      .catch(() => undefined)
      .then(() => Promise.all([
        vscode.commands.executeCommand(
          "setContext",
          VSCODE_REVEAL_IN_CANVAS_SOURCE_TARGET_CONTEXT_KEY,
          availability.revealInCanvas
        ),
        vscode.commands.executeCommand(
          "setContext",
          VSCODE_BAKE_SOURCE_TARGET_CONTEXT_KEY,
          availability.bake
        ),
        vscode.commands.executeCommand(
          "setContext",
          VSCODE_REFERENCE_PICK_CONTEXT_KEY,
          availability.referencePickSourceOffset !== null
        )
      ]))
      .then(() => undefined);
  };

  const refreshContext = (editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor): void => {
    if (!isSupportedSourceEditor(editor)) {
      setSourceTargetContexts(unavailableSourceTargets());
      return;
    }
    setSourceTargetContexts(sourceTargetAvailabilityForEditor(
      editor,
      languageAnalysisSessionFor(editor.document)
    ));
  };

  const clearActive = (disposeBridge: boolean): void => {
    const current = active;
    if (!current) return;
    active = null;
    current.webviewDisposable.dispose();
    current.panelDisposable.dispose();
    if (disposeBridge) current.bridge?.dispose();
  };

  const cancelActive = (): void => {
    const current = active;
    if (!current) return;
    current.bridge?.cancel();
    clearActive(false);
  };

  const tryStartActive = (): void => {
    const current = active;
    if (!current || current.bridge || !current.endpoint.isAuthoritativeReady()) return;
    if (
      current.editor.document.version !== current.documentVersion ||
      !sameDocument(current.editor.document, current.endpoint.document)
    ) {
      clearActive(false);
      return;
    }
    const freshOffset = referencePickSourceOffsetForEditor(
      current.editor,
      languageAnalysisSessionFor(current.editor.document)
    );
    if (freshOffset !== current.normalizedSourceOffset) {
      clearActive(false);
      refreshContext(current.editor);
      return;
    }

    const bridge = createVscodeReferencePickSourceBridge({
      editor: current.editor,
      languageAnalysisSession: languageAnalysisSessionFor(current.editor.document),
      requestId: current.requestId,
      normalizedSourceOffset: current.normalizedSourceOffset,
      postMessage: (message) => current.endpoint.panel.webview.postMessage(message)
    });
    current.bridge = bridge;
    if (!bridge.start()) {
      clearActive(true);
      refreshContext(current.editor);
    }
  };

  const handleReferencePickResult = async (result: VscodeReferencePickResult): Promise<void> => {
    const current = active;
    const bridge = current?.bridge;
    if (!current || !bridge) return;
    const outcome = await bridge.handleResult(result);
    if (active !== current) return;
    if (outcome === "started") {
      current.endpoint.panel.reveal(vscode.ViewColumn.Beside, false);
      return;
    }
    if (outcome === "ignored") return;
    clearActive(false);
    refreshContext(vscode.window.activeTextEditor);
  };

  const command = vscode.commands.registerCommand(VSCODE_REFERENCE_PICK_COMMAND_ID, async () => {
    const editor = vscode.window.activeTextEditor;
    if (!isSupportedSourceEditor(editor)) return;
    const normalizedSourceOffset = referencePickSourceOffsetForEditor(
      editor,
      languageAnalysisSessionFor(editor.document)
    );
    if (normalizedSourceOffset === null) {
      refreshContext(editor);
      void vscode.window.showErrorMessage(
        "nuinuiCAD: Source Editorのカーソル位置にCanvasから選択できる参照先がありません。"
      );
      return;
    }

    cancelActive();
    const documentVersion = editor.document.version;
    const sourceSelection = editor.selection;
    const endpoint = await ensureCanvas(editor.document);
    if (
      !endpoint ||
      editor.document.version !== documentVersion ||
      !sameDocument(editor.document, endpoint.document)
    ) return;

    try {
      await vscode.window.showTextDocument(editor.document, {
        viewColumn: editor.viewColumn,
        preserveFocus: false,
        preview: false,
        selection: sourceSelection
      });
    } catch {
      return;
    }
    endpoint.panel.reveal(vscode.ViewColumn.Beside, true);

    const current: ActiveReferencePick = {
      editor,
      normalizedSourceOffset,
      documentVersion,
      requestId: nextRequestId++,
      endpoint,
      bridge: null,
      webviewDisposable: { dispose: () => undefined },
      panelDisposable: { dispose: () => undefined }
    };
    active = current;
    current.webviewDisposable = endpoint.panel.webview.onDidReceiveMessage((message: unknown) => {
      if (active !== current || typeof message !== "object" || message === null || !("type" in message)) return;
      const typed = message as { type: string };
      if (typed.type === "webviewAuthoritativeDocumentReady") {
        tryStartActive();
        return;
      }
      if (typed.type === "referencePickResult") {
        void handleReferencePickResult(message as VscodeReferencePickResult);
      }
    });
    current.panelDisposable = endpoint.panel.onDidDispose(() => {
      if (active === current) clearActive(true);
    });
    tryStartActive();
  });

  const activeEditorListener = vscode.window.onDidChangeActiveTextEditor((editor) => refreshContext(editor));
  const selectionListener = vscode.window.onDidChangeTextEditorSelection((event) => {
    if (event.textEditor === vscode.window.activeTextEditor) refreshContext(event.textEditor);
  });
  const documentChangeListener = vscode.workspace.onDidChangeTextDocument((event) => {
    if (
      active &&
      sameDocument(event.document, active.editor.document) &&
      event.contentChanges.length > 0
    ) {
      cancelActive();
    }
    const editor = vscode.window.activeTextEditor;
    if (editor && sameDocument(editor.document, event.document)) refreshContext(editor);
  });
  const closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
    if (active && sameDocument(document, active.editor.document)) cancelActive();
    refreshContext(vscode.window.activeTextEditor);
  });

  refreshContext();

  return vscode.Disposable.from(
    command,
    activeEditorListener,
    selectionListener,
    documentChangeListener,
    closeListener,
    {
      dispose: () => {
        cancelActive();
        setSourceTargetContexts(unavailableSourceTargets());
      }
    }
  );
};
