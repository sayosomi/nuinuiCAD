import { afterEach, describe, expect, it, vi } from "vitest";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";

const mocks = vi.hoisted(() => ({
  activeTextEditor: null as null | {
    document: TestDocument;
    selection: { active: { line: number; character: number } };
  },
  commandHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  activeEditorListeners: [] as Array<() => void>,
  selectionListeners: [] as Array<(event: { textEditor: unknown }) => void>,
  themeListeners: [] as Array<() => void>,
  documentChangeListeners: [] as Array<(event: TestDocumentChangeEvent) => void>,
  documentCloseListeners: [] as Array<(document: TestDocument) => void>,
  configurationListeners: [] as Array<(event: { affectsConfiguration: (section: string) => boolean }) => void>,
  executeCommand: vi.fn(async () => undefined),
  showErrorMessage: vi.fn(),
  createWebviewPanel: vi.fn()
}));

type TestDocument = {
  fileName: string;
  version: number;
  uri: { scheme: string; toString: () => string };
  getText: () => string;
  offsetAt: (position: { line: number; character: number }) => number;
  setSource: (source: string) => void;
};

type TestDocumentChangeEvent = {
  document: TestDocument;
  reason?: number;
  contentChanges: readonly unknown[];
};

type TestPanel = {
  title: string;
  active: boolean;
  webview: {
    html: string;
    postMessage: ReturnType<typeof vi.fn>;
    onDidReceiveMessage: ReturnType<typeof vi.fn>;
  };
  reveal: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  onDidDispose: ReturnType<typeof vi.fn>;
};

vi.mock("vscode", () => ({
  window: {
    get activeTextEditor() {
      return mocks.activeTextEditor;
    },
    createWebviewPanel: mocks.createWebviewPanel,
    showErrorMessage: mocks.showErrorMessage,
    onDidChangeActiveTextEditor: (listener: () => void) => {
      mocks.activeEditorListeners.push(listener);
      return { dispose: () => undefined };
    },
    onDidChangeTextEditorSelection: (listener: (event: { textEditor: unknown }) => void) => {
      mocks.selectionListeners.push(listener);
      return { dispose: () => undefined };
    },
    onDidChangeActiveColorTheme: (listener: () => void) => {
      mocks.themeListeners.push(listener);
      return { dispose: () => undefined };
    }
  },
  workspace: {
    onDidChangeTextDocument: (listener: (event: TestDocumentChangeEvent) => void) => {
      mocks.documentChangeListeners.push(listener);
      return { dispose: () => undefined };
    },
    onDidCloseTextDocument: (listener: (document: TestDocument) => void) => {
      mocks.documentCloseListeners.push(listener);
      return { dispose: () => undefined };
    },
    onDidChangeConfiguration: (listener: (event: { affectsConfiguration: (section: string) => boolean }) => void) => {
      mocks.configurationListeners.push(listener);
      return { dispose: () => undefined };
    }
  },
  commands: {
    registerCommand: (command: string, handler: (...args: unknown[]) => unknown) => {
      mocks.commandHandlers.set(command, handler);
      return { dispose: () => mocks.commandHandlers.delete(command) };
    },
    executeCommand: mocks.executeCommand
  },
  ViewColumn: { Beside: 2 },
  TextDocumentChangeReason: { Undo: 1, Redo: 2 }
}));

import {
  NUI_MODULE_PREVIEW_SOURCE_TARGET_CONTEXT,
  NUI_MODULE_PREVIEW_VIEW_TYPE,
  registerModulePreviewFeature
} from "./modulePreviewFeature";

const offsetAt = (source: string, position: { line: number; character: number }): number => {
  const lines = source.split("\n");
  let offset = 0;
  for (let line = 0; line < position.line; line += 1) offset += (lines[line]?.length ?? 0) + 1;
  return offset + position.character;
};

const positionAt = (source: string, offset: number): { line: number; character: number } => {
  const before = source.slice(0, offset).split("\n");
  return { line: before.length - 1, character: before.at(-1)?.length ?? 0 };
};

const createDocument = (initialSource: string): TestDocument => {
  let source = initialSource;
  const document: TestDocument = {
    fileName: "/workspace/pattern.nui",
    version: 1,
    uri: { scheme: "file", toString: () => "file:///workspace/pattern.nui" },
    getText: () => source,
    offsetAt: (position) => offsetAt(source, position),
    setSource: (nextSource) => {
      source = nextSource;
      document.version += 1;
    }
  };
  return document;
};

const createPanel = (): TestPanel & {
  receive: (message: unknown) => Promise<void>;
  fireDispose: () => void;
} => {
  let receiveHandler: ((message: unknown) => unknown) | null = null;
  let disposeHandler: (() => void) | null = null;
  const panel = {
    title: "",
    active: true,
    webview: {
      html: "",
      postMessage: vi.fn(async () => true),
      onDidReceiveMessage: vi.fn((handler: (message: unknown) => unknown) => {
        receiveHandler = handler;
        return { dispose: () => undefined };
      })
    },
    reveal: vi.fn(),
    dispose: vi.fn(),
    onDidDispose: vi.fn((handler: () => void) => {
      disposeHandler = handler;
      return { dispose: () => undefined };
    }),
    receive: async (message: unknown) => {
      await receiveHandler?.(message);
    },
    fireDispose: () => disposeHandler?.()
  } satisfies TestPanel & {
    receive: (message: unknown) => Promise<void>;
    fireDispose: () => void;
  };
  return panel;
};

const flushContext = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

afterEach(() => {
  mocks.activeTextEditor = null;
  mocks.commandHandlers.clear();
  mocks.activeEditorListeners.length = 0;
  mocks.selectionListeners.length = 0;
  mocks.themeListeners.length = 0;
  mocks.documentChangeListeners.length = 0;
  mocks.documentCloseListeners.length = 0;
  mocks.configurationListeners.length = 0;
  mocks.executeCommand.mockClear();
  mocks.showErrorMessage.mockClear();
  mocks.createWebviewPanel.mockReset();
});

describe("registerModulePreviewFeature", () => {
  it("keeps one panel per document and retargets it to the innermost current Module", async () => {
    const source = [
      "nui 4",
      "module Outer() {",
      "  point A = coordinate(x: 0, y: 0)",
      "  module Inner() {",
      "    point B = coordinate(x: 1, y: 0)",
      "  }",
      "}"
    ].join("\n");
    const document = createDocument(source);
    const panel = createPanel();
    mocks.createWebviewPanel.mockImplementation((viewType: string, title: string) => {
      expect(viewType).toBe(NUI_MODULE_PREVIEW_VIEW_TYPE);
      expect(title).toBe("Module Preview");
      panel.title = title;
      return panel;
    });
    const sessions = new Map<string, ReturnType<typeof createLanguageAnalysisSession>>();
    const sessionFor = (candidate: TestDocument) => {
      const key = candidate.uri.toString();
      const existing = sessions.get(key);
      if (existing) return existing;
      const created = createLanguageAnalysisSession(candidate.getText());
      sessions.set(key, created);
      return created;
    };
    const evaluateWithRust = vi.fn(async () => ({ ok: true }));
    const outerPoint = positionAt(source, source.indexOf("point A"));
    mocks.activeTextEditor = { document, selection: { active: outerPoint } };

    const feature = registerModulePreviewFeature({
      languageAnalysisSessionFor: sessionFor as never,
      webviewHtml: () => "<html>preview</html>",
      canvasRibbons: () => [],
      updateCanvasRibbonPosition: () => undefined,
      editCanvasRibbon: () => undefined,
      evaluateWithRust
    });
    const open = mocks.commandHandlers.get("nuinuiCAD.openModulePreview");
    expect(open).toBeDefined();
    open!();

    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(panel.webview.html).toBe("<html>preview</html>");
    await panel.receive({ type: "webviewReady" });
    await panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewTarget",
      documentVersion: 1,
      normalizedSourceOffset: source.indexOf("module Outer")
    }));

    mocks.activeTextEditor.selection.active = positionAt(source, source.indexOf("point B"));
    open!();
    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(panel.reveal).toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewTarget",
      documentVersion: 1,
      normalizedSourceOffset: source.indexOf("  module Inner")
    }));

    await panel.receive({ type: "rustEvaluationRequest", id: 7, input: { document: "preview" } });
    expect(evaluateWithRust).toHaveBeenCalledTimes(1);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "rustEvaluationResponse",
      id: 7,
      payload: { ok: true }
    });

    feature.dispose();
  });

  it("fails closed when the open target identity disappears instead of rebinding to its ancestor", async () => {
    const source = [
      "nui 4",
      "module Outer() {",
      "  module Inner() {",
      "    point B = coordinate(x: 1, y: 0)",
      "  }",
      "}"
    ].join("\n");
    const document = createDocument(source);
    const panel = createPanel();
    mocks.createWebviewPanel.mockReturnValue(panel);
    const analysis = createLanguageAnalysisSession(source);
    mocks.activeTextEditor = {
      document,
      selection: { active: positionAt(source, source.indexOf("point B")) }
    };
    const feature = registerModulePreviewFeature({
      languageAnalysisSessionFor: (() => analysis) as never,
      webviewHtml: () => "<html />",
      canvasRibbons: () => [],
      updateCanvasRibbonPosition: () => undefined,
      editCanvasRibbon: () => undefined,
      evaluateWithRust: async () => ({})
    });
    mocks.commandHandlers.get("nuinuiCAD.openModulePreview")!();
    await panel.receive({ type: "webviewReady" });
    await panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    panel.webview.postMessage.mockClear();

    const nextSource = [
      "nui 4",
      "module Outer() {",
      "  point A = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n");
    document.setSource(nextSource);
    for (const listener of mocks.documentChangeListeners) {
      listener({ document, contentChanges: [{}] });
    }
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "commitText",
      documentVersion: 2
    }));
    await panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 2 });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "modulePreviewTargetUnavailable",
      documentVersion: 2
    });
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewTarget",
      documentVersion: 2,
      normalizedSourceOffset: nextSource.indexOf("module Outer")
    }));

    feature.dispose();
  });

  it("uses an exact-current context key only for the Source context menu", async () => {
    const source = [
      "nui 4",
      "module Pocket() {",
      "  point P = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n");
    const document = createDocument(source);
    const analysis = createLanguageAnalysisSession(source);
    mocks.activeTextEditor = {
      document,
      selection: { active: positionAt(source, source.indexOf("point P")) }
    };
    const feature = registerModulePreviewFeature({
      languageAnalysisSessionFor: (() => analysis) as never,
      webviewHtml: () => "<html />",
      canvasRibbons: () => [],
      updateCanvasRibbonPosition: () => undefined,
      editCanvasRibbon: () => undefined,
      evaluateWithRust: async () => ({})
    });
    await flushContext();
    expect(mocks.executeCommand).toHaveBeenCalledWith(
      "setContext",
      NUI_MODULE_PREVIEW_SOURCE_TARGET_CONTEXT,
      true
    );

    mocks.executeCommand.mockClear();
    mocks.activeTextEditor.selection.active = positionAt(source, 0);
    for (const listener of mocks.selectionListeners) listener({ textEditor: mocks.activeTextEditor });
    await flushContext();
    expect(mocks.executeCommand).toHaveBeenCalledWith(
      "setContext",
      NUI_MODULE_PREVIEW_SOURCE_TARGET_CONTEXT,
      false
    );

    feature.dispose();
  });
});
