import { afterEach, describe, expect, it, vi } from "vitest";

type TestDocument = {
  fileName: string;
  version: number;
  uri: { toString: () => string };
  getText: () => string;
  positionAt: (offset: number) => number;
  setSourceText: (text: string) => void;
};

type TestEditor = { document: TestDocument };

type TestPanel = {
  webview: {
    cspSource: string;
    html: string;
    asWebviewUri: (uri: unknown) => unknown;
    postMessage: ReturnType<typeof vi.fn>;
    onDidReceiveMessage: ReturnType<typeof vi.fn>;
  };
  onDidDispose: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
  activeTextEditor: null as TestEditor | null,
  commandHandler: null as (() => void) | null,
  activeEditorListeners: [] as Array<() => void>,
  documentChangeListeners: [] as Array<(event: { document: TestDocument }) => void>,
  panels: [] as TestPanel[],
  applyEdit: vi.fn(),
  showErrorMessage: vi.fn(),
  createWebviewPanel: vi.fn(),
  registerCommand: vi.fn(),
  onDidChangeActiveTextEditor: vi.fn(),
  onDidChangeTextDocument: vi.fn()
}));

vi.mock("vscode", () => {
  class Range {
    constructor(public readonly start: unknown, public readonly end: unknown) {}
  }
  class WorkspaceEdit {
    replace = vi.fn();
  }
  return {
    window: {
      get activeTextEditor() {
        return mocks.activeTextEditor;
      },
      createWebviewPanel: mocks.createWebviewPanel,
      onDidChangeActiveTextEditor: mocks.onDidChangeActiveTextEditor,
      showErrorMessage: mocks.showErrorMessage
    },
    workspace: {
      applyEdit: mocks.applyEdit,
      onDidChangeTextDocument: mocks.onDidChangeTextDocument
    },
    commands: { registerCommand: mocks.registerCommand },
    Uri: { joinPath: vi.fn((...parts: unknown[]) => parts.join("/")) },
    ViewColumn: { Beside: 2 },
    Range,
    WorkspaceEdit
  };
}, { virtual: true });

import { activate } from "./extension";

const disposable = () => ({ dispose: vi.fn() });

const documentFor = (fileName = "/tmp/pattern.nui"): TestDocument => {
  let sourceText = "nui 4\n";
  const document: TestDocument = {
    fileName,
    version: 1,
    uri: { toString: () => "file:///tmp/pattern.nui" },
    getText: () => sourceText,
    positionAt: (offset) => offset,
    setSourceText: (nextText) => { sourceText = nextText; }
  };
  return document;
};

const editorFor = (fileName?: string): TestEditor => ({ document: documentFor(fileName) });

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
    onDidDispose: vi.fn()
  } as TestPanel;
  panel.webview.onDidReceiveMessage.mockImplementation((handler: (message: unknown) => Promise<void>) => {
    (panel as TestPanel & { messageHandler: (message: unknown) => Promise<void> }).messageHandler = handler;
    return disposable();
  });
  panel.onDidDispose.mockImplementation((handler: () => void) => {
    (panel as TestPanel & { disposeHandler: () => void }).disposeHandler = handler;
    return disposable();
  });
  mocks.panels.push(panel);
  return panel;
};

const setup = (benchmark = false, activeEditor: TestEditor | null = editorFor()) => {
  if (benchmark) process.env.NUINUICAD_VSCODE_BENCHMARK_CONFIG = JSON.stringify({ runId: "run-1", resultPath: "/tmp/result.json" });
  else delete process.env.NUINUICAD_VSCODE_BENCHMARK_CONFIG;
  mocks.activeTextEditor = activeEditor;
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
  activate(contextFor());
};

afterEach(() => {
  delete process.env.NUINUICAD_VSCODE_BENCHMARK_CONFIG;
  mocks.activeTextEditor = null;
  mocks.commandHandler = null;
  mocks.activeEditorListeners.length = 0;
  mocks.documentChangeListeners.length = 0;
  mocks.panels.length = 0;
  mocks.applyEdit.mockReset();
  mocks.showErrorMessage.mockReset();
  mocks.createWebviewPanel.mockReset();
  mocks.registerCommand.mockReset();
  mocks.onDidChangeActiveTextEditor.mockReset();
  mocks.onDidChangeTextDocument.mockReset();
});

describe("VS Code Performance PoC extension lifecycle", () => {
  it("does not create a panel during normal startup, then uses the command path", () => {
    setup();

    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();
    expect(mocks.commandHandler).not.toBeNull();
    mocks.commandHandler?.();
    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it("auto-starts once when benchmark config exists and the active .nui editor becomes ready", () => {
    setup(true, null);

    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();
    expect(mocks.activeEditorListeners).toHaveLength(1);

    mocks.activeTextEditor = editorFor();
    mocks.activeEditorListeners[0]?.();
    mocks.activeEditorListeners[0]?.();
    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it("does not sync document changes or apply canvas commits in benchmark mode", async () => {
    setup(true);
    const panel = mocks.panels[0]!;
    const document = mocks.activeTextEditor!.document;
    document.version = 2;
    document.setSourceText("nui 4\n# host change\n");
    await (panel as TestPanel & { messageHandler: (message: unknown) => Promise<void> }).messageHandler({
      type: "canvasCommit",
      sourceText: "nui 4\n# webview change\n",
      expectedDocumentVersion: 1
    });

    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "commitText" }));
    expect(mocks.onDidChangeTextDocument).not.toHaveBeenCalled();
    expect(mocks.applyEdit).not.toHaveBeenCalled();
  });

  it("includes documentVersion in interactive document messages", () => {
    setup();
    const panel = mocks.panels[0] ?? (() => {
      mocks.commandHandler?.();
      return mocks.panels[0]!;
    })();
    const document = mocks.activeTextEditor!.document;
    const messageHandler = (panel as TestPanel & { messageHandler: (message: unknown) => Promise<void> }).messageHandler;
    void messageHandler({ type: "webviewReady" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "replaceTextDocument", documentVersion: 1 }));

    document.version = 2;
    document.setSourceText("nui 4\n# changed\n");
    mocks.documentChangeListeners[0]?.({ document });
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "commitText", documentVersion: 2 }));
  });

  it("applies one interactive canvas edit only when the document version matches", async () => {
    setup();
    const panel = mocks.panels[0] ?? (() => {
      mocks.commandHandler?.();
      return mocks.panels[0]!;
    })();
    const document = mocks.activeTextEditor!.document;
    const messageHandler = (panel as TestPanel & { messageHandler: (message: unknown) => Promise<void> }).messageHandler;

    await messageHandler({ type: "canvasCommit", sourceText: "nui 4\n# canvas\n", expectedDocumentVersion: 1 });
    expect(mocks.applyEdit).toHaveBeenCalledTimes(1);

    document.version = 2;
    document.setSourceText("nui 4\n# authoritative\n");
    await messageHandler({ type: "canvasCommit", sourceText: "nui 4\n# stale\n", expectedDocumentVersion: 1 });
    expect(mocks.applyEdit).toHaveBeenCalledTimes(1);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "replaceTextDocument",
      sourceText: "nui 4\n# authoritative\n",
      documentVersion: 2
    });
  });
});
