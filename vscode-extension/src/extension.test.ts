import { afterEach, describe, expect, it, vi } from "vitest";

type TestDocument = {
  fileName: string;
  version: number;
  uri: { scheme: string; toString: () => string };
  getText: () => string;
  positionAt: (offset: number) => { offset: number };
  setSourceText: (text: string) => void;
};

type TestEditor = {
  document: TestDocument;
  edit: ReturnType<typeof vi.fn>;
  editBuilder: { replace: ReturnType<typeof vi.fn> };
};

type TestPanel = {
  webview: {
    cspSource: string;
    html: string;
    asWebviewUri: (uri: unknown) => unknown;
    postMessage: ReturnType<typeof vi.fn>;
    onDidReceiveMessage: ReturnType<typeof vi.fn>;
  };
  reveal: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  onDidDispose: ReturnType<typeof vi.fn>;
};

type TestRustProcess = {
  request: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
  activeTextEditor: null as TestEditor | null,
  visibleTextEditors: [] as TestEditor[],
  textDocuments: [] as TestDocument[],
  commandHandler: null as (() => void) | null,
  activeEditorListeners: [] as Array<() => void>,
  documentChangeListeners: [] as Array<(event: { document: TestDocument }) => void>,
  documentCloseListeners: [] as Array<(document: TestDocument) => void>,
  panels: [] as TestPanel[],
  rustProcesses: [] as TestRustProcess[],
  showErrorMessage: vi.fn(),
  createWebviewPanel: vi.fn(),
  registerCommand: vi.fn(),
  onDidChangeActiveTextEditor: vi.fn(),
  onDidChangeTextDocument: vi.fn(),
  onDidCloseTextDocument: vi.fn()
}));

vi.mock("vscode", () => {
  class Range {
    constructor(public readonly start: unknown, public readonly end: unknown) {}
  }
  return {
    window: {
      get activeTextEditor() {
        return mocks.activeTextEditor;
      },
      get visibleTextEditors() {
        return mocks.visibleTextEditors;
      },
      createWebviewPanel: mocks.createWebviewPanel,
      onDidChangeActiveTextEditor: mocks.onDidChangeActiveTextEditor,
      showErrorMessage: mocks.showErrorMessage
    },
    workspace: {
      get textDocuments() {
        return mocks.textDocuments;
      },
      onDidChangeTextDocument: mocks.onDidChangeTextDocument,
      onDidCloseTextDocument: mocks.onDidCloseTextDocument
    },
    commands: { registerCommand: mocks.registerCommand },
    Uri: { joinPath: vi.fn((...parts: unknown[]) => parts.join("/")) },
    ViewColumn: { Beside: 2 },
    Range
  };
// @ts-expect-error Vitest's runtime supports the virtual-module options used here.
}, { virtual: true });

vi.mock("./rustEvaluationProcess", () => ({
  RustEvaluationProcess: class {
    readonly request = vi.fn(async (input: unknown) => ({ input }));
    readonly dispose = vi.fn();

    constructor() {
      mocks.rustProcesses.push(this);
    }
  }
}));

import { activate } from "./extension";

const disposable = () => ({ dispose: vi.fn() });

const documentFor = (
  fileName = "/tmp/pattern.nui",
  uri = `file://${fileName}`,
  initialSource = "nui 4\n"
): TestDocument => {
  let sourceText = initialSource;
  const document: TestDocument = {
    fileName,
    version: 1,
    uri: { scheme: uri.startsWith("file:") ? "file" : "untitled", toString: () => uri },
    getText: () => sourceText,
    positionAt: (offset) => ({ offset }),
    setSourceText: (nextText) => { sourceText = nextText; }
  };
  return document;
};

const editorFor = (document = documentFor()): TestEditor => {
  const editBuilder = { replace: vi.fn() };
  const editor = {
    document,
    editBuilder,
    edit: vi.fn(async (callback: (builder: typeof editBuilder) => void) => {
      callback(editBuilder);
      return true;
    })
  } as TestEditor;
  return editor;
};

const contextFor = () => ({
  extensionUri: "extension",
  extensionPath: "/tmp/extension",
  subscriptions: [] as Array<{ dispose: () => void }>
});

const panelFor = (): TestPanel => {
  const panel = {
    webview: {
      cspSource: "csp",
      html: "",
      asWebviewUri: (uri: unknown) => uri,
      postMessage: vi.fn(),
      onDidReceiveMessage: vi.fn()
    },
    reveal: vi.fn(),
    dispose: vi.fn(),
    onDidDispose: vi.fn()
  } as TestPanel;
  panel.webview.onDidReceiveMessage.mockImplementation((handler: (message: unknown) => Promise<void>) => {
    (panel as TestPanel & { messageHandler: (message: unknown) => Promise<void> }).messageHandler = handler;
    return disposable();
  });
  panel.onDidDispose.mockImplementation((handler: () => void) => {
    (panel as TestPanel & { disposeHandler: () => void }).disposeHandler = handler;
    panel.dispose.mockImplementation(() => (panel as TestPanel & { disposeHandler: () => void }).disposeHandler?.());
    return disposable();
  });
  mocks.panels.push(panel);
  return panel;
};

const messageHandlerFor = (panel: TestPanel) =>
  (panel as TestPanel & { messageHandler: (message: unknown) => Promise<void> }).messageHandler;

const setup = (benchmark = false, activeEditor: TestEditor | null = editorFor()) => {
  if (benchmark) process.env.NUINUICAD_VSCODE_BENCHMARK_CONFIG = JSON.stringify({ runId: "run-1", resultPath: "/tmp/result.json" });
  else delete process.env.NUINUICAD_VSCODE_BENCHMARK_CONFIG;
  mocks.activeTextEditor = activeEditor;
  mocks.visibleTextEditors = activeEditor ? [activeEditor] : [];
  mocks.textDocuments = activeEditor ? [activeEditor.document] : [];
  mocks.registerCommand.mockImplementation((_name: string, handler: () => void) => {
    mocks.commandHandler = handler;
    return disposable();
  });
  mocks.createWebviewPanel.mockImplementation(() => panelFor());
  mocks.onDidChangeActiveTextEditor.mockImplementation((listener: () => void) => {
    mocks.activeEditorListeners.push(listener);
    return disposable();
  });
  mocks.onDidChangeTextDocument.mockImplementation((listener: (event: { document: TestDocument }) => void) => {
    mocks.documentChangeListeners.push(listener);
    return disposable();
  });
  mocks.onDidCloseTextDocument.mockImplementation((listener: (document: TestDocument) => void) => {
    mocks.documentCloseListeners.push(listener);
    return disposable();
  });
  activate(contextFor() as unknown as Parameters<typeof activate>[0]);
};

const openPanelFor = (editor = mocks.activeTextEditor!): TestPanel => {
  mocks.activeTextEditor = editor;
  mocks.visibleTextEditors = [editor];
  mocks.textDocuments = [editor.document];
  mocks.commandHandler?.();
  return mocks.panels.at(-1)!;
};

afterEach(() => {
  delete process.env.NUINUICAD_VSCODE_BENCHMARK_CONFIG;
  mocks.activeTextEditor = null;
  mocks.visibleTextEditors.length = 0;
  mocks.textDocuments.length = 0;
  mocks.commandHandler = null;
  mocks.activeEditorListeners.length = 0;
  mocks.documentChangeListeners.length = 0;
  mocks.documentCloseListeners.length = 0;
  mocks.panels.length = 0;
  mocks.rustProcesses.length = 0;
  mocks.showErrorMessage.mockReset();
  mocks.createWebviewPanel.mockReset();
  mocks.registerCommand.mockReset();
  mocks.onDidChangeActiveTextEditor.mockReset();
  mocks.onDidChangeTextDocument.mockReset();
  mocks.onDidCloseTextDocument.mockReset();
});

describe("VS Code production document lifecycle", () => {
  it("does not create a panel during normal startup, then uses the command path", () => {
    setup();

    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();
    mocks.commandHandler?.();
    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it("reuses and reveals the existing panel when the same document command runs twice", () => {
    setup();
    const panel = openPanelFor();
    mocks.commandHandler?.();

    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(panel.reveal).toHaveBeenCalledWith(2);
  });

  it("keeps two document sessions independent", () => {
    const documentA = documentFor("/tmp/a.nui", "file:///tmp/a.nui");
    const documentB = documentFor("/tmp/b.nui", "file:///tmp/b.nui");
    const editorA = editorFor(documentA);
    const editorB = editorFor(documentB);
    setup(false, editorA);
    const panelA = openPanelFor(editorA);
    mocks.activeTextEditor = editorB;
    mocks.visibleTextEditors = [editorB];
    mocks.textDocuments = [documentA, documentB];
    mocks.commandHandler?.();
    const panelB = mocks.panels[1]!;

    documentA.version = 2;
    documentA.setSourceText("nui 4\nA changed\n");
    mocks.documentChangeListeners[0]?.({ document: documentA });

    expect(mocks.panels).toHaveLength(2);
    expect(panelA.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "commitText", documentVersion: 2 }));
    expect(panelB.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "commitText" }));
  });

  it("disposing panel A leaves panel B alive and syncing its document", () => {
    const documentA = documentFor("/tmp/a.nui", "file:///tmp/a.nui");
    const documentB = documentFor("/tmp/b.nui", "file:///tmp/b.nui");
    const editorA = editorFor(documentA);
    const editorB = editorFor(documentB);
    setup(false, editorA);
    const panelA = openPanelFor(editorA);
    mocks.activeTextEditor = editorB;
    mocks.visibleTextEditors = [editorA, editorB];
    mocks.textDocuments = [documentA, documentB];
    mocks.commandHandler?.();
    const panelB = mocks.panels[1]!;

    panelA.dispose();
    expect(panelA.dispose).toHaveBeenCalledTimes(1);
    expect(panelB.dispose).not.toHaveBeenCalled();

    documentB.version = 2;
    documentB.setSourceText("nui 4\n# panel B change\n");
    for (const listener of mocks.documentChangeListeners) listener({ document: documentB });

    expect(panelB.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "commitText",
      sourceText: "nui 4\n# panel B change\n",
      documentVersion: 2
    }));
  });

  it("panel disposal does not dispose the shared Rust process used by another panel", async () => {
    const documentA = documentFor("/tmp/a.nui", "file:///tmp/a.nui");
    const documentB = documentFor("/tmp/b.nui", "file:///tmp/b.nui");
    const editorA = editorFor(documentA);
    const editorB = editorFor(documentB);
    setup(false, editorA);
    const panelA = openPanelFor(editorA);
    mocks.activeTextEditor = editorB;
    mocks.visibleTextEditors = [editorA, editorB];
    mocks.textDocuments = [documentA, documentB];
    mocks.commandHandler?.();
    const panelB = mocks.panels[1]!;

    await messageHandlerFor(panelA)({ type: "rustEvaluationRequest", id: 1, input: { request: "first" } });
    expect(mocks.rustProcesses).toHaveLength(1);
    const sharedProcess = mocks.rustProcesses[0]!;

    panelA.dispose();
    expect(sharedProcess.dispose).not.toHaveBeenCalled();

    await messageHandlerFor(panelB)({ type: "rustEvaluationRequest", id: 2, input: { request: "second" } });
    expect(mocks.rustProcesses).toHaveLength(1);
    expect(sharedProcess.request).toHaveBeenCalledTimes(2);
    expect(sharedProcess.dispose).not.toHaveBeenCalled();
  });

  it("auto-starts once when benchmark config exists and an active .nui editor becomes ready", () => {
    setup(true, null);

    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();
    mocks.activeTextEditor = editorFor();
    mocks.visibleTextEditors = [mocks.activeTextEditor];
    mocks.textDocuments = [mocks.activeTextEditor.document];
    mocks.activeEditorListeners[0]?.();
    mocks.activeEditorListeners[0]?.();
    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it("keeps benchmark lifecycle behavior without document sync or canvas edits", async () => {
    setup(true);
    const panel = mocks.panels[0]!;
    await messageHandlerFor(panel)({
      type: "canvasCommit",
      sourceText: "nui 4\n# webview change\n",
      expectedDocumentVersion: 1,
      mutationKind: "reset"
    });

    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "commitText" }));
    expect(mocks.onDidChangeTextDocument).not.toHaveBeenCalled();
    expect(mocks.activeTextEditor!.edit).not.toHaveBeenCalled();
  });

  it("hydrates from the current authoritative document and ignores unrelated changes", async () => {
    setup();
    const panel = openPanelFor();
    const document = mocks.activeTextEditor!.document;
    await messageHandlerFor(panel)({ type: "webviewReady" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "replaceTextDocument", documentVersion: 1 }));

    document.version = 2;
    document.setSourceText("nui 4\n# changed\n");
    mocks.documentChangeListeners[0]?.({ document });
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "commitText", documentVersion: 2 }));
  });

  it("disposes only the matching panel when a document closes and creates a fresh session on reopen", async () => {
    const documentA = documentFor("/tmp/a.nui", "file:///tmp/a.nui");
    const documentB = documentFor("/tmp/b.nui", "file:///tmp/b.nui");
    const editorA = editorFor(documentA);
    const editorB = editorFor(documentB);
    setup(false, editorA);
    const panelA = openPanelFor(editorA);
    mocks.activeTextEditor = editorB;
    mocks.visibleTextEditors = [editorB];
    mocks.textDocuments = [documentA, documentB];
    mocks.commandHandler?.();
    const panelB = mocks.panels[1]!;

    mocks.documentCloseListeners[0]?.(documentA);
    expect(panelA.dispose).toHaveBeenCalledTimes(1);
    expect(panelB.dispose).not.toHaveBeenCalled();

    documentA.version = 4;
    documentA.setSourceText("nui 4\n# reopened\n");
    mocks.activeTextEditor = editorA;
    mocks.visibleTextEditors = [editorA];
    mocks.textDocuments = [documentA, documentB];
    mocks.commandHandler?.();
    const reopened = mocks.panels[2]!;
    await messageHandlerFor(reopened)({ type: "webviewReady" });
    expect(reopened).not.toBe(panelA);
    expect(reopened.webview.postMessage).toHaveBeenCalledWith({
      type: "replaceTextDocument",
      sourceText: "nui 4\n# reopened\n",
      documentVersion: 4
    });
  });

  it("reopens a fresh panel after panel-only disposal and hydrates current document text and version", async () => {
    setup();
    const editor = mocks.activeTextEditor!;
    const panelA = openPanelFor(editor);

    panelA.dispose();
    editor.document.version = 6;
    editor.document.setSourceText("nui 4\n# panel reopened\n");
    const panelB = openPanelFor(editor);
    await messageHandlerFor(panelB)({ type: "webviewReady" });

    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(2);
    expect(panelB).not.toBe(panelA);
    expect(panelB.webview.postMessage).toHaveBeenCalledWith({
      type: "replaceTextDocument",
      sourceText: "nui 4\n# panel reopened\n",
      documentVersion: 6
    });
  });

  it("fails closed and resyncs when the expected document version is stale", async () => {
    setup();
    const panel = openPanelFor();
    const document = mocks.activeTextEditor!.document;
    document.version = 2;
    document.setSourceText("nui 4\n# authoritative\n");
    await messageHandlerFor(panel)({
      type: "canvasCommit",
      sourceText: "nui 4\n# stale\n",
      expectedDocumentVersion: 1,
      mutationKind: "reset"
    });

    expect(mocks.activeTextEditor!.edit).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "replaceTextDocument",
      sourceText: "nui 4\n# authoritative\n",
      documentVersion: 2
    });
  });

  it("applies a valid model patch as one snapshot-coordinate edit transaction", async () => {
    const source = "nui 4\nA\nB\n";
    const document = documentFor("/tmp/pattern.nui", "file:///tmp/pattern.nui", source);
    const editor = editorFor(document);
    setup(false, editor);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({
      type: "canvasCommit",
      sourceText: "nui 4\nA changed\nB\n",
      expectedDocumentVersion: 1,
      mutationKind: "model-patch",
      splices: [{ startLine: 2, endLine: 2, replacementLines: ["A changed"] }]
    });

    expect(editor.edit).toHaveBeenCalledTimes(1);
    expect(editor.edit).toHaveBeenCalledWith(expect.any(Function), { undoStopBefore: true, undoStopAfter: true });
    expect(editor.editBuilder.replace).toHaveBeenCalledTimes(1);
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "commitText" }));
  });

  it("fails closed when a model patch source does not match its LineSplices", async () => {
    const document = documentFor("/tmp/pattern.nui", "file:///tmp/pattern.nui", "nui 4\nA\n");
    const editor = editorFor(document);
    setup(false, editor);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({
      type: "canvasCommit",
      sourceText: "nui 4\nnot the patch result\n",
      expectedDocumentVersion: 1,
      mutationKind: "model-patch",
      splices: [{ startLine: 2, endLine: 2, replacementLines: ["A changed"] }]
    });

    expect(editor.edit).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "replaceTextDocument", documentVersion: 1 }));
  });

  it("resyncs when TextEditor.edit returns false", async () => {
    setup();
    const editor = mocks.activeTextEditor!;
    editor.edit.mockImplementationOnce(async () => false);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({
      type: "canvasCommit",
      sourceText: "nui 4\n# reset\n",
      expectedDocumentVersion: 1,
      mutationKind: "reset"
    });

    expect(editor.edit).toHaveBeenCalledTimes(1);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "replaceTextDocument", documentVersion: 1 }));
  });

  it("uses whole-document replacement only for reset mutations", async () => {
    setup();
    const editor = mocks.activeTextEditor!;
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({
      type: "canvasCommit",
      sourceText: "nui 4\n# reset\n",
      expectedDocumentVersion: 1,
      mutationKind: "reset"
    });

    expect(editor.editBuilder.replace).toHaveBeenCalledTimes(1);
  });

  it("uses the normal document change echo as the only successful commit acknowledgement", async () => {
    setup();
    const editor = mocks.activeTextEditor!;
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({
      type: "canvasCommit",
      sourceText: "nui 4\n# committed\n",
      expectedDocumentVersion: 1,
      mutationKind: "reset"
    });
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "commitText" }));

    editor.document.version = 2;
    editor.document.setSourceText("nui 4\n# committed\n");
    mocks.documentChangeListeners[0]?.({ document: editor.document });
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "commitText", documentVersion: 2 }));
  });
});
