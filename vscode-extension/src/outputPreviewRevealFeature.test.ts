import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  showErrorMessage: vi.fn(),
  createWebviewPanel: vi.fn(),
  activeEditor: undefined as TestEditor | undefined,
  documentChangeListeners: [] as Array<(event: { document: TestDocument; contentChanges: readonly unknown[]; reason?: number }) => void>
}));

type TestDocument = {
  version: number;
  fileName: string;
  uri: { scheme: string; toString: () => string };
  getText: () => string;
};
type TestEditor = { document: TestDocument };

const disposableFor = (dispose: () => void = () => undefined) => ({ dispose });
const removeListener = <T,>(listeners: T[], listener: T) => {
  const index = listeners.indexOf(listener);
  if (index >= 0) listeners.splice(index, 1);
};

vi.mock("vscode", () => ({
  ViewColumn: { Beside: 2 },
  Disposable: {
    from: (...items: Array<{ dispose: () => void }>) => disposableFor(() => {
      for (const item of items) item.dispose();
    })
  },
  Uri: {
    joinPath: (base: unknown, ...parts: string[]) => ({ base, parts }),
    file: (path: string) => ({ scheme: "file", fsPath: path })
  },
  commands: {
    registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
      mocks.commands.set(id, handler);
      return disposableFor(() => mocks.commands.delete(id));
    },
    executeCommand: vi.fn()
  },
  window: {
    get activeTextEditor() {
      return mocks.activeEditor;
    },
    createWebviewPanel: mocks.createWebviewPanel,
    showErrorMessage: mocks.showErrorMessage
  },
  workspace: {
    onDidChangeTextDocument: (listener: (event: { document: TestDocument; contentChanges: readonly unknown[]; reason?: number }) => void) => {
      mocks.documentChangeListeners.push(listener);
      return disposableFor(() => removeListener(mocks.documentChangeListeners, listener));
    }
  }
}));

import type { VscodeOutputPreviewRevealResult } from "../../src/vscode/outputPreviewProtocol";
import { registerOutputPreviewFeature, type OutputPreviewSession } from "./outputPreviewFeature";

const source = "nui 1\nline A = segment(start: (0, 0), end: (10, 0))";

const createPanel = () => {
  const messageListeners: Array<(message: unknown) => void> = [];
  const disposeListeners: Array<() => void> = [];
  const panel = {
    active: false,
    visible: true,
    reveal: vi.fn(),
    webview: {
      html: "",
      postMessage: vi.fn(),
      onDidReceiveMessage: (listener: (message: unknown) => void) => {
        messageListeners.push(listener);
        return disposableFor(() => removeListener(messageListeners, listener));
      }
    },
    onDidDispose: (listener: () => void) => {
      disposeListeners.push(listener);
      return disposableFor(() => removeListener(disposeListeners, listener));
    }
  };
  return { panel, messageListeners, disposeListeners };
};

const flush = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

const resolvedTarget = {
  status: "resolved" as const,
  normalizedSourceOffset: 7,
  target: { kind: "output" as const, outputKind: "svg" as const, outputId: "S", sourceStatementIndex: 2 }
};

const register = (displayLanguage = "en") => {
  let currentSource = source;
  const document: TestDocument = {
    version: 4,
    fileName: "/tmp/reveal.nui",
    uri: { scheme: "file", toString: () => "file:///tmp/reveal.nui" },
    getText: () => currentSource
  };
  const editor: TestEditor = { document };
  mocks.activeEditor = editor;
  const { panel, messageListeners, disposeListeners } = createPanel();
  mocks.createWebviewPanel.mockReturnValue(panel);
  const sessions = new Map<string, OutputPreviewSession>();
  const feature = registerOutputPreviewFeature({
    registry: {
      get: (key) => sessions.get(key),
      set: (session) => sessions.set(session.documentUri, session),
      delete: (key) => sessions.delete(key),
      values: () => [...sessions.values()]
    },
    extensionUri: {},
    webviewHtml: () => "<html />",
    postAuthoritativeDocument: (targetPanel, targetDocument) => {
      void targetPanel.webview.postMessage({
        type: "replaceTextDocument",
        sourceText: targetDocument.getText(),
        documentVersion: targetDocument.version
      });
    },
    postDocumentText: (targetPanel, sourceText, documentVersion) => {
      void targetPanel.webview.postMessage({ type: "commitText", sourceText, documentVersion, reason: "edit" });
    },
    documentChangeReasonFor: () => "edit",
    documentKey: (targetDocument) => targetDocument.uri.toString(),
    sameDocument: (left, right) => left.uri.toString() === right.uri.toString(),
    isOpenDocument: () => true,
    visibleEditorFor: () => editor,
    isNormalizedRangeSafe: () => true,
    requestRustEvaluation: async () => ({}),
    exportOutput: async () => undefined,
    activeNuiTextEditorForCommand: () => editor,
    outputPreviewRevealSourceTargetForEditor: () => resolvedTarget,
    activeCanvasDocumentForOpenCommand: () => null,
    isOutputPreviewTabActive: () => false,
    displayLanguageFor: () => displayLanguage
  });
  return {
    document,
    editor,
    panel,
    messageListeners,
    disposeListeners,
    sessions,
    feature,
    setSource: (nextSource: string, nextVersion: number) => {
      currentSource = nextSource;
      document.version = nextVersion;
    }
  };
};

const commandFor = (id: string) => {
  const command = mocks.commands.get(id);
  if (!command) throw new Error(`missing command ${id}`);
  return command;
};

const sendToHost = async (state: ReturnType<typeof register>, message: unknown) => {
  for (const listener of [...state.messageListeners]) await listener(message);
  await flush();
};

const revealMessagesFor = (panel: ReturnType<typeof createPanel>["panel"]) =>
  vi.mocked(panel.webview.postMessage).mock.calls
    .map(([message]) => message)
    .filter((message): message is { type: "outputPreviewReveal"; requestId: number } =>
      typeof message === "object" && message !== null && (message as { type?: string }).type === "outputPreviewReveal"
    );

describe("VS Code Output Preview Reveal lifecycle", () => {
  beforeEach(() => {
    mocks.commands.clear();
    mocks.showErrorMessage.mockReset();
    mocks.createWebviewPanel.mockReset();
    mocks.activeEditor = undefined;
    mocks.documentChangeListeners = [];
  });

  it("waits for cold authoritative hydration and focuses only after a resolved result", async () => {
    const state = register();
    await commandFor("nuinuiCAD.revealInOutputPreview")();

    expect(mocks.createWebviewPanel).toHaveBeenCalledWith(
      "nuinuiCAD.outputPreview",
      "reveal.nui — Output Preview",
      { viewColumn: 2, preserveFocus: true },
      expect.any(Object)
    );
    expect(revealMessagesFor(state.panel)).toHaveLength(0);

    await sendToHost(state, { type: "webviewReady" });
    expect(revealMessagesFor(state.panel)).toHaveLength(0);
    await sendToHost(state, { type: "webviewAuthoritativeDocumentReady", documentVersion: 4 });
    expect(revealMessagesFor(state.panel)).toEqual([{
      type: "outputPreviewReveal",
      requestId: 1,
      documentVersion: 4,
      normalizedSourceOffset: 7
    }]);
    expect(state.panel.reveal).toHaveBeenCalledTimes(0);

    const result: VscodeOutputPreviewRevealResult = {
      type: "outputPreviewRevealResult",
      requestId: 1,
      documentVersion: 4,
      status: "resolved",
      outputKey: "svg:S"
    };
    await sendToHost(state, result);
    expect(state.panel.reveal).toHaveBeenLastCalledWith(2, false);
    expect(state.panel.reveal).toHaveBeenCalledTimes(1);
    state.feature.dispose();
  });

  it("replaces older warm requests and ignores their late results", async () => {
    const state = register();
    await commandFor("nuinuiCAD.revealInOutputPreview")();
    await sendToHost(state, { type: "webviewReady" });
    await sendToHost(state, { type: "webviewAuthoritativeDocumentReady", documentVersion: 4 });
    await commandFor("nuinuiCAD.revealInOutputPreview")();
    await commandFor("nuinuiCAD.revealInOutputPreview")();

    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(revealMessagesFor(state.panel).map(({ requestId }) => requestId)).toEqual([1, 2, 3]);
    await sendToHost(state, {
      type: "outputPreviewRevealResult",
      requestId: 2,
      documentVersion: 4,
      status: "resolved",
      outputKey: "svg:S"
    });
    expect(state.panel.reveal).toHaveBeenCalledTimes(2);
    await sendToHost(state, {
      type: "outputPreviewRevealResult",
      requestId: 3,
      documentVersion: 4,
      status: "failed",
      reason: "no-containing-output"
    });
    expect(state.panel.reveal).toHaveBeenCalledTimes(2);
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "nuinuiCAD: No current Output Preview output contains the Source target."
    );
    state.feature.dispose();
  });

  it("localizes a structured reveal failure from the current display language", async () => {
    const state = register("ja-JP");
    await commandFor("nuinuiCAD.revealInOutputPreview")();
    await sendToHost(state, { type: "webviewReady" });
    await sendToHost(state, { type: "webviewAuthoritativeDocumentReady", documentVersion: 4 });
    await sendToHost(state, {
      type: "outputPreviewRevealResult",
      requestId: 1,
      documentVersion: 4,
      status: "failed",
      reason: "no-containing-output"
    });

    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "nuinuiCAD: 現在の Output Preview に Source 対象を含む出力がありません。"
    );
    state.feature.dispose();
  });

  it("invalidates pending and in-flight requests when the session is disposed", async () => {
    const state = register();
    await commandFor("nuinuiCAD.revealInOutputPreview")();
    const session = [...state.sessions.values()][0];
    if (!session) throw new Error("missing Output Preview session");
    expect(session.pendingReveal).toEqual({
      requestId: 1,
      documentVersion: 4,
      normalizedSourceOffset: 7
    });

    await sendToHost(state, { type: "webviewReady" });
    await sendToHost(state, { type: "webviewAuthoritativeDocumentReady", documentVersion: 4 });
    expect(session.pendingReveal).toBeNull();
    expect(session.inFlightRevealRequestId).toBe(1);
    const lateResultListener = state.messageListeners[0];
    if (!lateResultListener) throw new Error("missing message listener");

    state.disposeListeners[0]?.();
    expect(session.pendingReveal).toBeNull();
    expect(session.inFlightRevealRequestId).toBeNull();
    expect(session.latestRevealRequestId).toBeNull();
    await lateResultListener({
      type: "outputPreviewRevealResult",
      requestId: 1,
      documentVersion: 4,
      status: "resolved",
      outputKey: "svg:S"
    });
    expect(state.panel.reveal).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
    state.feature.dispose();
  });

  it("invalidates pending and in-flight requests when the document changes", async () => {
    const state = register();
    await commandFor("nuinuiCAD.revealInOutputPreview")();
    await sendToHost(state, { type: "webviewReady" });
    await sendToHost(state, { type: "webviewAuthoritativeDocumentReady", documentVersion: 4 });
    state.setSource("nui 1\n// changed", 5);
    for (const listener of [...mocks.documentChangeListeners]) {
      listener({ document: state.document, contentChanges: [{}] });
    }
    await sendToHost(state, {
      type: "outputPreviewRevealResult",
      requestId: 1,
      documentVersion: 4,
      status: "resolved",
      outputKey: "svg:S"
    });
    expect(state.panel.reveal).toHaveBeenCalledTimes(0);
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
    state.feature.dispose();
  });
});
