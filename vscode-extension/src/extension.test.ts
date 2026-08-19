import { afterEach, describe, expect, it, vi } from "vitest";
import { AutomationDocument } from "../../src/document/automationDocument";

type TestDocument = {
  fileName: string;
  version: number;
  uri: { scheme: string; toString: () => string };
  getText: () => string;
  offsetAt: (position: { line: number; character: number }) => number;
  positionAt: (offset: number) => { line: number; character: number };
  lineAt: (line: number) => {
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  };
  setSourceText: (text: string) => void;
  onGetText?: () => void;
};

type TestEditor = {
  document: TestDocument;
  edit: ReturnType<typeof vi.fn>;
  editBuilder: { replace: ReturnType<typeof vi.fn> };
};

type TestPanel = {
  title: string;
  active: boolean;
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

type TestDiagnosticCollection = {
  name: string;
  set: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
  activeTextEditor: null as TestEditor | null,
  visibleTextEditors: [] as TestEditor[],
  textDocuments: [] as TestDocument[],
  commandHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  activeEditorListeners: [] as Array<() => void>,
  activeColorThemeListeners: [] as Array<() => void>,
  documentOpenListeners: [] as Array<(document: TestDocument) => void>,
  documentChangeListeners: [] as Array<(event: { document: TestDocument; reason?: number }) => void>,
  documentCloseListeners: [] as Array<(document: TestDocument) => void>,
  panels: [] as TestPanel[],
  rustProcesses: [] as TestRustProcess[],
  diagnosticCollections: [] as TestDiagnosticCollection[],
  contexts: [] as Array<{ subscriptions: Array<{ dispose: () => void }> }>,
  completionRegistrations: [] as Array<{ selector: unknown; provider: unknown; triggerCharacters: string[]; disposable: { dispose: () => void } }>,
  definitionRegistrations: [] as Array<{ selector: unknown; provider: unknown; disposable: { dispose: () => void } }>,
  renameRegistrations: [] as Array<{ selector: unknown; provider: unknown; disposable: { dispose: () => void } }>,
  codeActionRegistrations: [] as Array<{ selector: unknown; provider: unknown; providedCodeActionKinds: unknown[]; disposable: { dispose: () => void } }>,
  foldingRegistrations: [] as Array<{ selector: unknown; provider: unknown; disposable: { dispose: () => void } }>,
  showErrorMessage: vi.fn(),
  showTextDocument: vi.fn(),
  executeCommand: vi.fn(),
  createWebviewPanel: vi.fn(),
  createDiagnosticCollection: vi.fn(),
  registerCompletionItemProvider: vi.fn(),
  registerDefinitionProvider: vi.fn(),
  registerRenameProvider: vi.fn(),
  registerCodeActionsProvider: vi.fn(),
  registerFoldingRangeProvider: vi.fn(),
  registerCommand: vi.fn(),
  onDidChangeActiveTextEditor: vi.fn(),
  onDidChangeActiveColorTheme: vi.fn(),
  onDidOpenTextDocument: vi.fn(),
  onDidChangeTextDocument: vi.fn(),
  onDidCloseTextDocument: vi.fn(),
  asRelativePath: vi.fn()
}));

vi.mock("vscode", () => {
  class Position {
    constructor(public readonly line: number, public readonly character: number) {}
  }
  class Range {
    constructor(public readonly start: unknown, public readonly end: unknown) {}
  }
  class Diagnostic {
    code?: string | number;
    source?: string;

    constructor(
      public readonly range: unknown,
      public readonly message: string,
      public readonly severity: number
    ) {}
  }
  class CompletionItem {
    detail?: string;
    range?: unknown;
    insertText?: unknown;

    constructor(public readonly label: string, public readonly kind: number) {}
  }
  class SnippetString {
    constructor(public readonly value: string) {}
  }
  class FoldingRange {
    constructor(
      public readonly start: number,
      public readonly end: number,
      public readonly kind?: unknown
    ) {}
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
      onDidChangeActiveColorTheme: mocks.onDidChangeActiveColorTheme,
      showErrorMessage: mocks.showErrorMessage,
      showTextDocument: mocks.showTextDocument
    },
    workspace: {
      get textDocuments() {
        return mocks.textDocuments;
      },
      onDidOpenTextDocument: mocks.onDidOpenTextDocument,
      onDidChangeTextDocument: mocks.onDidChangeTextDocument,
      onDidCloseTextDocument: mocks.onDidCloseTextDocument,
      asRelativePath: mocks.asRelativePath
    },
    commands: { registerCommand: mocks.registerCommand, executeCommand: mocks.executeCommand },
    languages: {
      createDiagnosticCollection: mocks.createDiagnosticCollection,
      registerCompletionItemProvider: mocks.registerCompletionItemProvider,
      registerDefinitionProvider: mocks.registerDefinitionProvider,
      registerRenameProvider: mocks.registerRenameProvider,
      registerCodeActionsProvider: mocks.registerCodeActionsProvider,
      registerFoldingRangeProvider: mocks.registerFoldingRangeProvider
    },
    Uri: { joinPath: vi.fn((...parts: unknown[]) => parts.join("/")) },
    ViewColumn: { Beside: 2 },
    DiagnosticSeverity: { Error: 0, Warning: 1 },
    CompletionItemKind: {
      Keyword: 1,
      Function: 2,
      Property: 3,
      Variable: 4,
      Reference: 5,
      Module: 6,
      Value: 7,
      Operator: 8
    },
    CodeActionKind: { QuickFix: "quickfix" },
    FoldingRangeKind: { Comment: "comment" },
    TextDocumentChangeReason: { Undo: 1, Redo: 2 },
    Position,
    Range,
    Diagnostic,
    CompletionItem,
    SnippetString,
    FoldingRange
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
  const lineStartsFor = (): number[] => {
    const starts = [0];
    for (let index = 0; index < sourceText.length; index += 1) {
      if (sourceText[index] === "\n") starts.push(index + 1);
    }
    return starts;
  };
  const lineBoundsFor = (line: number): { line: number; start: number; end: number } => {
    const starts = lineStartsFor();
    const boundedLine = Math.min(Math.max(line, 0), starts.length - 1);
    const start = starts[boundedLine]!;
    let end = boundedLine + 1 < starts.length ? starts[boundedLine + 1]! : sourceText.length;
    if (sourceText[end - 1] === "\n") end -= 1;
    if (sourceText[end - 1] === "\r") end -= 1;
    return { line: boundedLine, start, end };
  };
  const document: TestDocument = {
    fileName,
    version: 1,
    uri: { scheme: uri.startsWith("file:") ? "file" : "untitled", toString: () => uri },
    getText: () => {
      document.onGetText?.();
      return sourceText;
    },
    offsetAt: (position) => {
      const bounds = lineBoundsFor(position.line);
      const character = Math.min(Math.max(position.character, 0), bounds.end - bounds.start);
      return bounds.start + character;
    },
    positionAt: (offset) => {
      const starts = lineStartsFor();
      const clampedOffset = Math.min(Math.max(offset, 0), sourceText.length);
      let line = 0;
      while (line + 1 < starts.length && starts[line + 1]! <= clampedOffset) line += 1;
      return { line, character: clampedOffset - starts[line]! };
    },
    lineAt: (line) => {
      const bounds = lineBoundsFor(line);
      return {
        range: {
          start: { line: bounds.line, character: 0 },
          end: { line: bounds.line, character: bounds.end - bounds.start }
        }
      };
    },
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
    title: "",
    active: true,
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

const commandHandlerFor = (command: string): (() => void) | undefined => {
  const handler = mocks.commandHandlers.get(command);
  return handler as (() => void) | undefined;
};

const setup = (
  benchmark = false,
  activeEditor: TestEditor | null = editorFor(),
  openDocuments?: TestDocument[]
) => {
  if (benchmark) process.env.NUINUICAD_VSCODE_BENCHMARK_CONFIG = JSON.stringify({ runId: "run-1", resultPath: "/tmp/result.json" });
  else delete process.env.NUINUICAD_VSCODE_BENCHMARK_CONFIG;
  mocks.activeTextEditor = activeEditor;
  mocks.visibleTextEditors = activeEditor ? [activeEditor] : [];
  mocks.textDocuments = openDocuments ?? (activeEditor ? [activeEditor.document] : []);
  const context = contextFor();
  mocks.contexts.push(context);
  mocks.registerCommand.mockImplementation((name: string, handler: (...args: unknown[]) => unknown) => {
    mocks.commandHandlers.set(name, handler);
    return disposable();
  });
  mocks.createWebviewPanel.mockImplementation(() => panelFor());
  mocks.onDidChangeActiveTextEditor.mockImplementation((listener: () => void) => {
    mocks.activeEditorListeners.push(listener);
    return disposable();
  });
  mocks.onDidChangeActiveColorTheme.mockImplementation((listener: () => void) => {
    mocks.activeColorThemeListeners.push(listener);
    return disposable();
  });
  mocks.createDiagnosticCollection.mockImplementation((name: string) => {
    const collection: TestDiagnosticCollection = {
      name,
      set: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
      dispose: vi.fn()
    };
    mocks.diagnosticCollections.push(collection);
    return collection;
  });
  mocks.registerCompletionItemProvider.mockImplementation((selector: unknown, provider: unknown, ...triggerCharacters: string[]) => {
    const registration = disposable();
    mocks.completionRegistrations.push({ selector, provider, triggerCharacters, disposable: registration });
    return registration;
  });
  mocks.registerDefinitionProvider.mockImplementation((selector: unknown, provider: unknown) => {
    const registration = disposable();
    mocks.definitionRegistrations.push({ selector, provider, disposable: registration });
    return registration;
  });
  mocks.registerRenameProvider.mockImplementation((selector: unknown, provider: unknown) => {
    const registration = disposable();
    mocks.renameRegistrations.push({ selector, provider, disposable: registration });
    return registration;
  });
  mocks.registerCodeActionsProvider.mockImplementation((
    selector: unknown,
    provider: unknown,
    options: { providedCodeActionKinds: unknown[] }
  ) => {
    const registration = disposable();
    mocks.codeActionRegistrations.push({
      selector,
      provider,
      providedCodeActionKinds: options.providedCodeActionKinds,
      disposable: registration
    });
    return registration;
  });
  mocks.registerFoldingRangeProvider.mockImplementation((selector: unknown, provider: unknown) => {
    const registration = disposable();
    mocks.foldingRegistrations.push({ selector, provider, disposable: registration });
    return registration;
  });
  mocks.onDidOpenTextDocument.mockImplementation((listener: (document: TestDocument) => void) => {
    mocks.documentOpenListeners.push(listener);
    return disposable();
  });
  mocks.onDidChangeTextDocument.mockImplementation((listener: (event: { document: TestDocument; reason?: number }) => void) => {
    mocks.documentChangeListeners.push(listener);
    return disposable();
  });
  mocks.onDidCloseTextDocument.mockImplementation((listener: (document: TestDocument) => void) => {
    mocks.documentCloseListeners.push(listener);
    return disposable();
  });
  activate(context as unknown as Parameters<typeof activate>[0]);
  return context;
};

const emitDocumentChange = (document: TestDocument, reason?: number): void => {
  for (const listener of mocks.documentChangeListeners) listener({ document, reason });
};

const emitDocumentOpen = (document: TestDocument): void => {
  for (const listener of mocks.documentOpenListeners) listener(document);
};

const emitDocumentClose = (document: TestDocument): void => {
  for (const listener of mocks.documentCloseListeners) listener(document);
};

const openPanelFor = (editor = mocks.activeTextEditor!): TestPanel => {
  mocks.activeTextEditor = editor;
  mocks.visibleTextEditors = [editor];
  mocks.textDocuments = [editor.document];
  commandHandlerFor("nuinuiCAD.openCanvas")?.();
  return mocks.panels.at(-1)!;
};

afterEach(() => {
  delete process.env.NUINUICAD_VSCODE_BENCHMARK_CONFIG;
  mocks.activeTextEditor = null;
  mocks.visibleTextEditors.length = 0;
  mocks.textDocuments.length = 0;
  mocks.commandHandlers.clear();
  mocks.activeEditorListeners.length = 0;
  mocks.activeColorThemeListeners.length = 0;
  mocks.documentOpenListeners.length = 0;
  mocks.documentChangeListeners.length = 0;
  mocks.documentCloseListeners.length = 0;
  mocks.panels.length = 0;
  mocks.rustProcesses.length = 0;
  mocks.diagnosticCollections.length = 0;
  mocks.contexts.length = 0;
  mocks.completionRegistrations.length = 0;
  mocks.definitionRegistrations.length = 0;
  mocks.renameRegistrations.length = 0;
  mocks.codeActionRegistrations.length = 0;
  mocks.foldingRegistrations.length = 0;
  mocks.showErrorMessage.mockReset();
  mocks.showTextDocument.mockReset();
  mocks.executeCommand.mockReset();
  mocks.createWebviewPanel.mockReset();
  mocks.createDiagnosticCollection.mockReset();
  mocks.registerCompletionItemProvider.mockReset();
  mocks.registerDefinitionProvider.mockReset();
  mocks.registerRenameProvider.mockReset();
  mocks.registerCodeActionsProvider.mockReset();
  mocks.registerFoldingRangeProvider.mockReset();
  mocks.registerCommand.mockReset();
  mocks.onDidChangeActiveTextEditor.mockReset();
  mocks.onDidChangeActiveColorTheme.mockReset();
  mocks.onDidOpenTextDocument.mockReset();
  mocks.onDidChangeTextDocument.mockReset();
  mocks.onDidCloseTextDocument.mockReset();
  mocks.asRelativePath.mockReset();
});

describe("VS Code production document lifecycle", () => {
  it("does not create a panel during normal startup, then uses the command path", () => {
    setup();

    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();
    expect(mocks.registerCommand).toHaveBeenCalledWith("nuinuiCAD.openCanvas", expect.any(Function));
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it("uses the production canvas view type and a unique document title", () => {
    const document = documentFor("/tmp/front.nui", "file:///tmp/front.nui");
    setup(false, editorFor(document));
    const panel = openPanelFor();

    expect(mocks.createWebviewPanel.mock.calls[0]?.[0]).toBe("nuinuiCAD.canvas");
    expect(panel.title).toBe("front.nui — nuinuiCAD");
  });

  it("marks the Canvas Webview body with its host-specific layout class", () => {
    setup();
    const panel = openPanelFor();

    expect(panel.webview.html).toContain('<body class="vscode-canvas-webview">');
  });

  it("reuses and reveals the existing panel when the same document command runs twice", () => {
    setup();
    const panel = openPanelFor();
    commandHandlerFor("nuinuiCAD.openCanvas")?.();

    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(panel.reveal).toHaveBeenCalledWith(2);
  });

  it("routes Canvas command palette commands to the active Canvas webview", () => {
    setup();
    const panel = openPanelFor();

    for (const command of [
      "nuinuiCAD.clearCanvasSelection",
      "nuinuiCAD.resetCanvasView",
      "nuinuiCAD.fitDrawing",
      "nuinuiCAD.toggleCanvasElementNames",
      "nuinuiCAD.toggleCanvasPoints"
    ]) {
      commandHandlerFor(command)?.();
    }

    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "clearCanvasSelection" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "resetCanvasView" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "fitDrawing" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "toggleCanvasElementNames" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "toggleCanvasPoints" });
  });

  it("routes Canvas Undo/Redo to the active Canvas webview", () => {
    setup();
    const panel = openPanelFor();

    commandHandlerFor("nuinuiCAD.canvasUndo")?.();
    commandHandlerFor("nuinuiCAD.canvasRedo")?.();

    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "undo" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "redo" });
  });

  it.each(["undo", "redo"] as const)("uses the requested Canvas history direction when the native change has no explicit reason (%s)", async (direction) => {
    const document = documentFor("/tmp/history.nui", "file:///tmp/history.nui");
    const editor = editorFor(document);
    setup(false, editor);
    const panel = openPanelFor(editor);
    mocks.showTextDocument.mockResolvedValue(editor);
    mocks.executeCommand.mockImplementation(async (command: string) => {
      expect(command).toBe(direction);
      document.version = 2;
      document.setSourceText(`nui 4\n// native ${direction}\n`);
      emitDocumentChange(document);
    });

    await messageHandlerFor(panel)({
      type: "canvasHistoryRequest",
      direction,
      expectedDocumentVersion: 1
    });

    expect(mocks.showTextDocument).toHaveBeenCalledWith(document, expect.objectContaining({
      preserveFocus: false,
      preview: false
    }));
    expect(mocks.executeCommand).toHaveBeenCalledWith(direction);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "commitText",
      documentVersion: 2,
      reason: direction
    }));
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasHistoryResult",
      direction,
      status: "completed",
      documentVersion: 2
    });
    expect(panel.reveal).toHaveBeenCalledWith(2, false);
  });

  it.each(["undo", "redo"] as const)("waits for a delayed native Canvas %s change event before completing history", async (direction) => {
    const document = documentFor("/tmp/history.nui", "file:///tmp/history.nui");
    const editor = editorFor(document);
    setup(false, editor);
    const panel = openPanelFor(editor);
    mocks.showTextDocument.mockResolvedValue(editor);
    mocks.executeCommand.mockImplementation(async (command: string) => {
      expect(command).toBe(direction);
      document.version = 2;
      document.setSourceText(`nui 4\n// native ${direction}\n`);
    });

    await messageHandlerFor(panel)({
      type: "canvasHistoryRequest",
      direction,
      expectedDocumentVersion: 1
    });

    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "canvasHistoryResult" }));
    expect(panel.reveal).not.toHaveBeenCalled();

    emitDocumentChange(document);

    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "commitText",
      documentVersion: 2,
      reason: direction
    }));
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasHistoryResult",
      direction,
      status: "completed",
      documentVersion: 2
    });
    expect(panel.reveal).toHaveBeenCalledWith(2, false);
  });

  it.each(["undo", "redo"] as const)("treats native Canvas %s with no document version change as a completed no-op", async (direction) => {
    const document = documentFor("/tmp/history.nui", "file:///tmp/history.nui");
    const editor = editorFor(document);
    setup(false, editor);
    const panel = openPanelFor(editor);
    mocks.showTextDocument.mockResolvedValue(editor);

    await messageHandlerFor(panel)({
      type: "canvasHistoryRequest",
      direction,
      expectedDocumentVersion: 1
    });

    expect(mocks.executeCommand).toHaveBeenCalledWith(direction);
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "replaceTextDocument" }));
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasHistoryResult",
      direction,
      status: "completed",
      documentVersion: 1
    });
    expect(panel.reveal).toHaveBeenCalledWith(2, false);
  });

  it("restores the Canvas panel when native history fails after source focus is transferred", async () => {
    const document = documentFor("/tmp/history.nui", "file:///tmp/history.nui");
    const editor = editorFor(document);
    setup(false, editor);
    const panel = openPanelFor(editor);
    mocks.showTextDocument.mockResolvedValue(editor);
    mocks.executeCommand.mockRejectedValue(new Error("native history failed"));

    await messageHandlerFor(panel)({
      type: "canvasHistoryRequest",
      direction: "undo",
      expectedDocumentVersion: 1
    });

    expect(panel.reveal).toHaveBeenCalledWith(2, false);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "replaceTextDocument" }));
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasHistoryResult",
      direction: "undo",
      status: "failed",
      documentVersion: 1
    });
  });

  it("resyncs and never executes native history for a stale Canvas document version", async () => {
    setup();
    const panel = openPanelFor();

    await messageHandlerFor(panel)({
      type: "canvasHistoryRequest",
      direction: "redo",
      expectedDocumentVersion: 99
    });

    expect(mocks.executeCommand).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "replaceTextDocument",
      documentVersion: 1
    }));
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasHistoryResult",
      direction: "redo",
      status: "resynced",
      documentVersion: 1
    });
  });

  it("fails safely when no Canvas webview is active", () => {
    setup();
    const panel = openPanelFor();
    panel.active = false;

    commandHandlerFor("nuinuiCAD.fitDrawing")?.();

    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "nuinuiCAD: アクティブなCanvasがありません。Canvasを開いてから実行してください。"
    );
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "canvasCommand" }));
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
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    const panelB = mocks.panels[1]!;

    expect(panelA.title).toBe("a.nui — nuinuiCAD");
    expect(panelB.title).toBe("b.nui — nuinuiCAD");

    documentA.version = 2;
    documentA.setSourceText("nui 4\nA changed\n");
    emitDocumentChange(documentA);

    expect(mocks.panels).toHaveLength(2);
    expect(panelA.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "commitText", documentVersion: 2 }));
    expect(panelB.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "commitText" }));
  });

  it("invalidates every open Canvas session when the active VS Code theme changes", () => {
    const documentA = documentFor("/tmp/a.nui", "file:///tmp/a.nui");
    const documentB = documentFor("/tmp/b.nui", "file:///tmp/b.nui");
    const editorA = editorFor(documentA);
    const editorB = editorFor(documentB);
    setup(false, editorA);
    const panelA = openPanelFor(editorA);
    mocks.activeTextEditor = editorB;
    mocks.visibleTextEditors = [editorB];
    mocks.textDocuments = [documentA, documentB];
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    const panelB = mocks.panels[1]!;

    expect(mocks.activeColorThemeListeners).toHaveLength(1);
    mocks.activeColorThemeListeners[0]!();

    expect(panelA.webview.postMessage).toHaveBeenCalledWith({ type: "canvasThemeChanged" });
    expect(panelB.webview.postMessage).toHaveBeenCalledWith({ type: "canvasThemeChanged" });
    expect(panelA.webview.postMessage).toHaveBeenCalledTimes(1);
    expect(panelB.webview.postMessage).toHaveBeenCalledTimes(1);
  });

  it("adds directory context to all sessions when basenames collide", () => {
    const documentA = documentFor("/workspace/patterns/front.nui", "file:///workspace/patterns/front.nui");
    const documentB = documentFor("/workspace/archive/front.nui", "file:///workspace/archive/front.nui");
    const editorA = editorFor(documentA);
    const editorB = editorFor(documentB);
    mocks.asRelativePath.mockImplementation((uri: { toString: () => string }) =>
      uri.toString().replace("file:///workspace/", "")
    );
    setup(false, editorA);
    const panelA = openPanelFor(editorA);
    mocks.activeTextEditor = editorB;
    mocks.visibleTextEditors = [editorA, editorB];
    mocks.textDocuments = [documentA, documentB];
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    const panelB = mocks.panels[1]!;

    expect(panelA.title).toBe("patterns/front.nui — nuinuiCAD");
    expect(panelB.title).toBe("archive/front.nui — nuinuiCAD");
    expect(mocks.asRelativePath).toHaveBeenCalledWith(documentA.uri, true);
    expect(mocks.asRelativePath).toHaveBeenCalledWith(documentB.uri, true);
  });

  it("returns the remaining session to its basename title after a collision is disposed", () => {
    const documentA = documentFor("/workspace/patterns/front.nui", "file:///workspace/patterns/front.nui");
    const documentB = documentFor("/workspace/archive/front.nui", "file:///workspace/archive/front.nui");
    const editorA = editorFor(documentA);
    const editorB = editorFor(documentB);
    mocks.asRelativePath.mockImplementation((uri: { toString: () => string }) =>
      uri.toString().replace("file:///workspace/", "")
    );
    setup(false, editorA);
    const panelA = openPanelFor(editorA);
    mocks.activeTextEditor = editorB;
    mocks.visibleTextEditors = [editorA, editorB];
    mocks.textDocuments = [documentA, documentB];
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    const panelB = mocks.panels[1]!;

    (panelA.dispose as unknown as () => void)();

    expect(panelB.title).toBe("front.nui — nuinuiCAD");
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
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    const panelB = mocks.panels[1]!;

    (panelA.dispose as unknown as () => void)();
    expect(panelA.dispose).toHaveBeenCalledTimes(1);
    expect(panelB.dispose).not.toHaveBeenCalled();

    documentB.version = 2;
    documentB.setSourceText("nui 4\n// panel B change\n");
    for (const listener of mocks.documentChangeListeners) listener({ document: documentB });

    expect(panelB.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "commitText",
      sourceText: "nui 4\n// panel B change\n",
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
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    const panelB = mocks.panels[1]!;

    await messageHandlerFor(panelA)({ type: "rustEvaluationRequest", id: 1, input: { request: "first" } });
    expect(mocks.rustProcesses).toHaveLength(1);
    const sharedProcess = mocks.rustProcesses[0]!;

    (panelA.dispose as unknown as () => void)();
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
      sourceText: "nui 4\n// webview change\n",
      expectedDocumentVersion: 1,
      mutationKind: "reset"
    });

    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "commitText" }));
    expect(mocks.onDidChangeTextDocument).toHaveBeenCalledTimes(1);
    expect(mocks.activeTextEditor!.edit).not.toHaveBeenCalled();
  });

  it("hydrates from the current authoritative document and ignores unrelated changes", async () => {
    setup();
    const panel = openPanelFor();
    const document = mocks.activeTextEditor!.document;
    await messageHandlerFor(panel)({ type: "webviewReady" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "replaceTextDocument", documentVersion: 1 }));

    document.version = 2;
    document.setSourceText("nui 4\n// changed\n");
    emitDocumentChange(document);
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
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    const panelB = mocks.panels[1]!;

    emitDocumentClose(documentA);
    expect(panelA.dispose).toHaveBeenCalledTimes(1);
    expect(panelB.dispose).not.toHaveBeenCalled();

    documentA.version = 4;
    documentA.setSourceText("nui 4\n// reopened\n");
    mocks.activeTextEditor = editorA;
    mocks.visibleTextEditors = [editorA];
    mocks.textDocuments = [documentA, documentB];
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    const reopened = mocks.panels[2]!;
    await messageHandlerFor(reopened)({ type: "webviewReady" });
    expect(reopened).not.toBe(panelA);
    expect(reopened.webview.postMessage).toHaveBeenCalledWith({
      type: "replaceTextDocument",
      sourceText: "nui 4\n// reopened\n",
      documentVersion: 4
    });
  });

  it("reopens a fresh panel after panel-only disposal and hydrates current document text and version", async () => {
    setup();
    const editor = mocks.activeTextEditor!;
    const panelA = openPanelFor(editor);

    (panelA.dispose as unknown as () => void)();
    editor.document.version = 6;
    editor.document.setSourceText("nui 4\n// panel reopened\n");
    const panelB = openPanelFor(editor);
    await messageHandlerFor(panelB)({ type: "webviewReady" });

    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(2);
    expect(panelB).not.toBe(panelA);
    expect(panelB.webview.postMessage).toHaveBeenCalledWith({
      type: "replaceTextDocument",
      sourceText: "nui 4\n// panel reopened\n",
      documentVersion: 6
    });
  });

  it("fails closed and resyncs when the expected document version is stale", async () => {
    setup();
    const panel = openPanelFor();
    const document = mocks.activeTextEditor!.document;
    document.version = 2;
    document.setSourceText("nui 4\n// authoritative\n");
    await messageHandlerFor(panel)({
      type: "canvasCommit",
      sourceText: "nui 4\n// stale\n",
      expectedDocumentVersion: 1,
      mutationKind: "reset"
    });

    expect(mocks.activeTextEditor!.edit).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "replaceTextDocument",
      sourceText: "nui 4\n// authoritative\n",
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
      sourceText: "nui 4\n// reset\n",
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
      sourceText: "nui 4\n// reset\n",
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
      sourceText: "nui 4\n// committed\n",
      expectedDocumentVersion: 1,
      mutationKind: "reset"
    });
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "commitText" }));

    editor.document.version = 2;
    editor.document.setSourceText("nui 4\n// committed\n");
    emitDocumentChange(editor.document);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "commitText", documentVersion: 2 }));
  });
});

describe("VS Code compiler diagnostics lifecycle", () => {
  const invalidSource = "nui 4\npoint A = coordinate(x: 0, y: )\n";

  const collectionFor = (): TestDiagnosticCollection => mocks.diagnosticCollections[0]!;

  it("bootstraps already-open supported documents without opening Canvas", () => {
    const document = documentFor("/tmp/bootstrap.nui", "file:///tmp/bootstrap.nui", invalidSource);
    const context = setup(false, null, [document]);
    const collection = collectionFor();

    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();
    expect(mocks.createDiagnosticCollection).toHaveBeenCalledWith("nuinuiCAD");
    expect(collection.set).toHaveBeenCalledWith(document.uri, [
      expect.objectContaining({
        message: "引数「y」の値がありません。",
        code: "missing-attribute-value",
        source: "nuinuiCAD",
        severity: 0
      })
    ]);
    expect(context.subscriptions).toContain(collection);
  });

  it("creates diagnostics for documents opened after activation", () => {
    setup(false, null, []);
    const document = documentFor("/tmp/opened.nui", "file:///tmp/opened.nui", invalidSource);
    mocks.textDocuments.push(document);

    emitDocumentOpen(document);

    expect(collectionFor().set).toHaveBeenCalledWith(document.uri, expect.any(Array));
  });

  it("recompiles unsaved current text on change and publishes binding issues", () => {
    const document = documentFor(
      "/tmp/changed.nui",
      "file:///tmp/changed.nui",
      "nui 4\nconst x: number = 1\nconst x: number = 2\n"
    );
    setup(false, null, [document]);
    const collection = collectionFor();
    const initialCallCount = collection.set.mock.calls.length;

    document.version = 2;
    document.setSourceText("nui 4\npoint A = coordinate(x: 0, y: 1)\n");
    emitDocumentChange(document);

    expect(initialCallCount).toBe(1);
    expect(collection.set).toHaveBeenLastCalledWith(document.uri, []);
  });

  it("keeps document diagnostics isolated when another URI closes", () => {
    const documentA = documentFor("/tmp/a.nui", "file:///tmp/a.nui", invalidSource);
    const documentB = documentFor("/tmp/b.nui", "file:///tmp/b.nui", invalidSource);
    setup(false, null, [documentA, documentB]);
    const collection = collectionFor();

    emitDocumentClose(documentA);
    expect(collection.delete).toHaveBeenCalledWith(documentA.uri);
    expect(collection.delete).not.toHaveBeenCalledWith(documentB.uri);

    documentB.version = 2;
    documentB.setSourceText("nui 4\npoint B = coordinate(x: 0, y: 1)\n");
    emitDocumentChange(documentB);
    expect(collection.set).toHaveBeenLastCalledWith(documentB.uri, []);
  });

  it("ignores untitled and non-nui documents", () => {
    const untitled = documentFor("/tmp/untitled.nui", "untitled:/tmp/untitled.nui", invalidSource);
    const textFile = documentFor("/tmp/pattern.txt", "file:///tmp/pattern.txt", invalidSource);
    setup(false, null, [untitled, textFile]);
    const collection = collectionFor();

    emitDocumentOpen(untitled);
    emitDocumentOpen(textFile);
    emitDocumentChange(untitled);
    emitDocumentChange(textFile);

    expect(collection.set).not.toHaveBeenCalled();
    expect(collection.delete).not.toHaveBeenCalled();
  });

  it("does not publish when the document version changes during compilation", () => {
    const document = documentFor("/tmp/stale.nui", "file:///tmp/stale.nui", "nui 4\n");
    setup(false, null, [document]);
    const collection = collectionFor();
    const initialCallCount = collection.set.mock.calls.length;

    document.version = 2;
    document.setSourceText(invalidSource);
    document.onGetText = () => { document.version = 3; };
    emitDocumentChange(document);

    expect(collection.set.mock.calls).toHaveLength(initialCallCount);
  });

  it("does not publish an old session after close and same-URI reopen", () => {
    const document = documentFor("/tmp/reopen.nui", "file:///tmp/reopen.nui", "nui 4\n");
    setup(false, null, [document]);
    const collection = collectionFor();
    const reopened = documentFor("/tmp/reopen.nui", "file:///tmp/reopen.nui", invalidSource);

    document.version = 2;
    document.setSourceText(invalidSource);
    document.onGetText = () => {
      mocks.textDocuments = [reopened];
      emitDocumentClose(document);
      emitDocumentOpen(reopened);
    };
    emitDocumentChange(document);

    expect(collection.set).toHaveBeenCalledTimes(2);
    expect(collection.set).toHaveBeenLastCalledWith(reopened.uri, expect.any(Array));
  });
});

describe("VS Code native completion lifecycle", () => {
  it("registers the provider with the requested selector, triggers, and lifecycle disposable", () => {
    const context = setup(false, null, []);
    const registration = mocks.completionRegistrations[0]!;

    expect(registration.selector).toEqual({ language: "nui", scheme: "file" });
    expect(registration.triggerCharacters).toEqual(["@", ".", ":", "=", "(", ",", "[", "{"]);
    expect(context.subscriptions).toContain(registration.disposable);
  });

  it("shares the URI-scoped analysis session and does not start Rust for completion", () => {
    const document = documentFor(
      "/tmp/completion.nui",
      "file:///tmp/completion.nui",
      "nui 4\nconst value: number = ab"
    );
    const fromSource = vi.spyOn(AutomationDocument, "fromSource");
    setup(false, null, [document]);
    const registration = mocks.completionRegistrations[0]!;
    const provider = registration.provider as {
      provideCompletionItems: (document: TestDocument, position: { line: number; character: number }, token: unknown, context: unknown) => unknown;
    };

    const items = provider.provideCompletionItems(document, { line: 1, character: "const value: number = ab".length }, undefined, undefined) as Array<{ label: string }>;

    expect(fromSource).toHaveBeenCalledTimes(1);
    expect(items.map((item) => item.label)).toContain("abs");
    expect(mocks.rustProcesses).toHaveLength(0);
    fromSource.mockRestore();
  });

  it("works for an open document without creating Canvas", () => {
    const document = documentFor("/tmp/no-canvas.nui", "file:///tmp/no-canvas.nui", "nui 4\npoint P = co");
    setup(false, null, [document]);
    const registration = mocks.completionRegistrations[0]!;
    const provider = registration.provider as {
      provideCompletionItems: (document: TestDocument, position: { line: number; character: number }, token: unknown, context: unknown) => unknown;
    };

    const items = provider.provideCompletionItems(document, { line: 1, character: "point P = co".length }, undefined, undefined) as Array<{ label: string }>;

    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();
    expect(items.map((item) => item.label)).toContain("coordinate");
  });
});

describe("VS Code native structural folding lifecycle", () => {
  it("registers one nui/file folding provider in the extension lifecycle", () => {
    const context = setup(false, null, []);
    const registration = mocks.foldingRegistrations[0]!;

    expect(mocks.foldingRegistrations).toHaveLength(1);
    expect(registration.selector).toEqual({ language: "nui", scheme: "file" });
    expect(registration.provider).toEqual(expect.objectContaining({ provideFoldingRanges: expect.any(Function) }));
    expect(context.subscriptions).toContain(registration.disposable);
  });

  it("reuses URI-scoped sessions while isolating documents across close and reopen", () => {
    const sourceA = [
      "group A {",
      "  point P = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n");
    const sourceB = "// one\n// two\n";
    const documentA = documentFor("/tmp/folding-a.nui", "file:///tmp/folding-a.nui", sourceA);
    const documentB = documentFor("/tmp/folding-b.nui", "file:///tmp/folding-b.nui", sourceB);
    const fromSource = vi.spyOn(AutomationDocument, "fromSource");
    setup(false, null, [documentA, documentB]);
    const provider = mocks.foldingRegistrations[0]!.provider as {
      provideFoldingRanges: (document: TestDocument) => Array<{ start: number; end: number; kind?: unknown }>;
    };

    expect(provider.provideFoldingRanges(documentA)).toEqual([
      expect.objectContaining({ start: 0, end: 2 })
    ]);
    expect(provider.provideFoldingRanges(documentB)).toEqual([
      expect.objectContaining({ start: 0, end: 1, kind: "comment" })
    ]);

    emitDocumentClose(documentA);
    const reopened = documentFor(
      "/tmp/folding-a.nui",
      "file:///tmp/folding-a.nui",
      "// reopened\n// document\n"
    );
    mocks.textDocuments = [documentB, reopened];
    emitDocumentOpen(reopened);
    expect(provider.provideFoldingRanges(reopened)).toEqual([
      expect.objectContaining({ start: 0, end: 1, kind: "comment" })
    ]);
    expect(provider.provideFoldingRanges(documentB)).toEqual([
      expect.objectContaining({ start: 0, end: 1, kind: "comment" })
    ]);
    expect(fromSource).toHaveBeenCalledTimes(3);
    fromSource.mockRestore();
  });
});

describe("VS Code native definition lifecycle", () => {
  it("registers the provider with the requested selector and lifecycle disposable", () => {
    const context = setup(false, null, []);
    const registration = mocks.definitionRegistrations[0]!;

    expect(registration.selector).toEqual({ language: "nui", scheme: "file" });
    expect(context.subscriptions).toContain(registration.disposable);
  });

  it("shares the diagnostic session for definition lookup without Canvas or Rust", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: @A, dx: 1, dy: 0)"
    ].join("\n");
    const document = documentFor("/tmp/definition.nui", "file:///tmp/definition.nui", source);
    const fromSource = vi.spyOn(AutomationDocument, "fromSource");
    setup(false, null, [document]);
    const registration = mocks.definitionRegistrations[0]!;
    const provider = registration.provider as {
      provideDefinition: (
        document: TestDocument,
        position: { line: number; character: number },
        token: unknown
      ) => unknown;
    };
    const referenceLine = source.split("\n")[2]!;
    const links = provider.provideDefinition(
      document,
      { line: 2, character: referenceLine.indexOf("@A") + "@A".length },
      undefined
    ) as Array<{ targetSelectionRange: { start: { line: number; character: number } } }> | undefined;

    expect(fromSource).toHaveBeenCalledTimes(1);
    expect(links).toHaveLength(1);
    expect(links?.[0]?.targetSelectionRange.start).toEqual({ line: 1, character: "point ".length });
    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();
    expect(mocks.rustProcesses).toHaveLength(0);
    fromSource.mockRestore();
  });
});

describe("VS Code native rename lifecycle", () => {
  it("registers the provider with the requested selector and lifecycle disposable", () => {
    const context = setup(false, null, []);
    const registration = mocks.renameRegistrations[0]!;

    expect(registration.selector).toEqual({ language: "nui", scheme: "file" });
    expect(context.subscriptions).toContain(registration.disposable);
  });

  it("shares the URI-scoped analysis session without Canvas or Rust", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: @A, dx: 1, dy: 0)"
    ].join("\n");
    const document = documentFor("/tmp/rename.nui", "file:///tmp/rename.nui", source);
    const fromSource = vi.spyOn(AutomationDocument, "fromSource");
    setup(false, null, [document]);
    const registration = mocks.renameRegistrations[0]!;
    const provider = registration.provider as {
      prepareRename: (
        document: TestDocument,
        position: { line: number; character: number },
        token: unknown
      ) => unknown;
    };
    const referenceLine = source.split("\n")[2]!;
    const result = provider.prepareRename(
      document,
      { line: 2, character: referenceLine.indexOf("@A") + 1 },
      undefined
    );

    expect(fromSource).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ placeholder: "A" });
    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();
    expect(mocks.rustProcesses).toHaveLength(0);
    fromSource.mockRestore();
  });
});

describe("VS Code native choice Quick Fix lifecycle", () => {
  it("registers only QuickFix CodeActions and the internal apply command", () => {
    const context = setup(false, null, []);
    const registration = mocks.codeActionRegistrations[0]!;

    expect(registration.selector).toEqual({ language: "nui", scheme: "file" });
    expect(registration.providedCodeActionKinds).toEqual(["quickfix"]);
    expect(context.subscriptions).toContain(registration.disposable);
    expect(mocks.registerCommand).toHaveBeenCalledWith(
      "nuinuiCAD.applyChoiceQuickFix",
      expect.any(Function)
    );
    expect(commandHandlerFor("nuinuiCAD.applyChoiceQuickFix")).toEqual(expect.any(Function));
    expect(commandHandlerFor("nuinuiCAD.openCanvas")).toEqual(expect.any(Function));
  });
});
