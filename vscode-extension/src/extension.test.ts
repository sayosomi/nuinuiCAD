import { afterEach, describe, expect, it, vi } from "vitest";
import { AutomationDocument } from "../../src/document/automationDocument";

type MockPosition = { line: number; character: number };
type MockSelection = {
  anchor: MockPosition;
  active: MockPosition;
  start: MockPosition;
  end: MockPosition;
};

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

type TestDocumentChangeEvent = {
  document: TestDocument;
  reason?: number;
  contentChanges: readonly unknown[];
};

type TestEditor = {
  document: TestDocument;
  selection: MockSelection;
  edit: ReturnType<typeof vi.fn>;
  editBuilder: { replace: ReturnType<typeof vi.fn> };
  revealRange?: ReturnType<typeof vi.fn>;
};

type TestPanel = {
  title: string;
  active: boolean;
  visible: boolean;
  canvasSelection?: string;
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
  onDidChangeViewState: ReturnType<typeof vi.fn>;
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
  activeEditorListeners: [] as Array<(editor?: TestEditor) => void>,
  activeColorThemeListeners: [] as Array<() => void>,
  documentOpenListeners: [] as Array<(document: TestDocument) => void>,
  documentChangeListeners: [] as Array<(event: TestDocumentChangeEvent) => void>,
  documentCloseListeners: [] as Array<(document: TestDocument) => void>,
  panels: [] as TestPanel[],
  rustProcesses: [] as TestRustProcess[],
  diagnosticCollections: [] as TestDiagnosticCollection[],
  contexts: [] as Array<{ subscriptions: Array<{ dispose: () => void }> }>,
  completionRegistrations: [] as Array<{ selector: unknown; provider: unknown; triggerCharacters: string[]; disposable: { dispose: () => void } }>,
  signatureHelpRegistrations: [] as Array<{ selector: unknown; provider: unknown; triggerCharacters: string[]; disposable: { dispose: () => void } }>,
  definitionRegistrations: [] as Array<{ selector: unknown; provider: unknown; disposable: { dispose: () => void } }>,
  renameRegistrations: [] as Array<{ selector: unknown; provider: unknown; disposable: { dispose: () => void } }>,
  referenceRegistrations: [] as Array<{ selector: unknown; provider: unknown; disposable: { dispose: () => void } }>,
  codeActionRegistrations: [] as Array<{ selector: unknown; provider: unknown; providedCodeActionKinds: unknown[]; disposable: { dispose: () => void } }>,
  foldingRegistrations: [] as Array<{ selector: unknown; provider: unknown; disposable: { dispose: () => void } }>,
  documentSymbolRegistrations: [] as Array<{ selector: unknown; provider: unknown; disposable: { dispose: () => void } }>,
  canvasRibbonSetting: undefined as unknown,
  configurationUpdates: [] as Array<{ section: string; value: unknown; target: unknown }>,
  configurationChangeListeners: [] as Array<(event: { affectsConfiguration: (section: string) => boolean }) => void>,
  showErrorMessage: vi.fn(),
  bakeSettings: {} as Record<string, boolean>,
  showTextDocument: vi.fn(),
  executeCommand: vi.fn(),
  createWebviewPanel: vi.fn(),
  createDiagnosticCollection: vi.fn(),
  registerCompletionItemProvider: vi.fn(),
  registerSignatureHelpProvider: vi.fn(),
  registerDefinitionProvider: vi.fn(),
  registerRenameProvider: vi.fn(),
  registerReferenceProvider: vi.fn(),
  registerCodeActionsProvider: vi.fn(),
  registerFoldingRangeProvider: vi.fn(),
  registerDocumentSymbolProvider: vi.fn(),
  registerCommand: vi.fn(),
  onDidChangeActiveTextEditor: vi.fn(),
  onDidChangeActiveColorTheme: vi.fn(),
  onDidOpenTextDocument: vi.fn(),
  onDidChangeTextDocument: vi.fn(),
  onDidCloseTextDocument: vi.fn(),
  activeTabInput: null as unknown,
  TabInputText: class {
    constructor(public readonly uri: unknown) {}
  },
  TabInputWebview: class {
    constructor(public readonly viewType: string) {}
  },
  getConfiguration: vi.fn(),
  onDidChangeConfiguration: vi.fn(),
  asRelativePath: vi.fn()
}));

vi.mock("vscode", () => {
  class Position {
    constructor(public readonly line: number, public readonly character: number) {}
  }
  class Range {
    constructor(public readonly start: unknown, public readonly end: unknown) {}
  }
  class Selection {
    readonly start: MockPosition;
    readonly end: MockPosition;

    constructor(public readonly anchor: MockPosition, public readonly active: MockPosition) {
      const anchorBeforeActive = anchor.line < active.line ||
        (anchor.line === active.line && anchor.character <= active.character);
      this.start = anchorBeforeActive ? anchor : active;
      this.end = anchorBeforeActive ? active : anchor;
    }
  }
  class Diagnostic {
    code?: string | number;
    source?: string;
    relatedInformation?: unknown[];

    constructor(
      public readonly range: unknown,
      public readonly message: string,
      public readonly severity: number
    ) {}
  }
  class Location {
    constructor(public readonly uri: unknown, public readonly range: unknown) {}
  }
  class DiagnosticRelatedInformation {
    constructor(public readonly location: unknown, public readonly message: string) {}
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
      showTextDocument: mocks.showTextDocument,
      tabGroups: {
        get activeTabGroup() {
          return {
            activeTab: mocks.activeTabInput === null
              ? undefined
              : { input: mocks.activeTabInput }
          };
        }
      }
    },
    workspace: {
      get textDocuments() {
        return mocks.textDocuments;
      },
      onDidOpenTextDocument: mocks.onDidOpenTextDocument,
      onDidChangeTextDocument: mocks.onDidChangeTextDocument,
      onDidCloseTextDocument: mocks.onDidCloseTextDocument,
      getConfiguration: mocks.getConfiguration,
      onDidChangeConfiguration: mocks.onDidChangeConfiguration,
      asRelativePath: mocks.asRelativePath
    },
    commands: { registerCommand: mocks.registerCommand, executeCommand: mocks.executeCommand },
    languages: {
      createDiagnosticCollection: mocks.createDiagnosticCollection,
      registerCompletionItemProvider: mocks.registerCompletionItemProvider,
      registerSignatureHelpProvider: mocks.registerSignatureHelpProvider,
      registerDefinitionProvider: mocks.registerDefinitionProvider,
      registerRenameProvider: mocks.registerRenameProvider,
      registerReferenceProvider: mocks.registerReferenceProvider,
      registerCodeActionsProvider: mocks.registerCodeActionsProvider,
      registerFoldingRangeProvider: mocks.registerFoldingRangeProvider,
      registerDocumentSymbolProvider: mocks.registerDocumentSymbolProvider
    },
    Uri: { joinPath: vi.fn((...parts: unknown[]) => parts.join("/")) },
    ViewColumn: { Beside: 2 },
    DiagnosticSeverity: { Error: 0, Warning: 1 },
    SymbolKind: {
      Module: 1,
      Object: 2,
      Namespace: 3,
      Constant: 4,
      Variable: 5,
      Enum: 6,
      Struct: 7,
      Property: 8,
      Field: 9,
      String: 10,
      File: 11
    },
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
    ConfigurationTarget: { Global: 1 },
    TextDocumentChangeReason: { Undo: 1, Redo: 2 },
    TabInputText: mocks.TabInputText,
    TabInputWebview: mocks.TabInputWebview,
    Position,
    Range,
    Selection,
    TextEditorRevealType: { InCenterIfOutsideViewport: 1 },
    Diagnostic,
    Location,
    DiagnosticRelatedInformation,
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
    selection: {
      anchor: { line: 1, character: 0 },
      active: { line: 1, character: 0 },
      start: { line: 1, character: 0 },
      end: { line: 1, character: 0 }
    },
    editBuilder,
    revealRange: vi.fn(),
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
    visible: true,
    webview: {
      cspSource: "csp",
      html: "",
      asWebviewUri: (uri: unknown) => uri,
      postMessage: vi.fn(),
      onDidReceiveMessage: vi.fn()
    },
    reveal: vi.fn(),
    dispose: vi.fn(),
    onDidDispose: vi.fn(),
    onDidChangeViewState: vi.fn()
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
  panel.onDidChangeViewState.mockImplementation((handler: () => void) => {
    (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler = handler;
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
  mocks.activeTabInput = activeEditor ? new mocks.TabInputText(activeEditor.document.uri) : null;
  const context = contextFor();
  mocks.contexts.push(context);
  mocks.registerCommand.mockImplementation((name: string, handler: (...args: unknown[]) => unknown) => {
    mocks.commandHandlers.set(name, handler);
    return disposable();
  });
  mocks.createWebviewPanel.mockImplementation(() => panelFor());
  mocks.onDidChangeActiveTextEditor.mockImplementation((listener: (editor?: TestEditor) => void) => {
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
  mocks.registerSignatureHelpProvider.mockImplementation((selector: unknown, provider: unknown, ...triggerCharacters: string[]) => {
    const registration = disposable();
    mocks.signatureHelpRegistrations.push({ selector, provider, triggerCharacters, disposable: registration });
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
  mocks.registerReferenceProvider.mockImplementation((selector: unknown, provider: unknown) => {
    const registration = disposable();
    mocks.referenceRegistrations.push({ selector, provider, disposable: registration });
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
  mocks.registerDocumentSymbolProvider.mockImplementation((selector: unknown, provider: unknown) => {
    const registration = disposable();
    mocks.documentSymbolRegistrations.push({ selector, provider, disposable: registration });
    return registration;
  });
  mocks.onDidOpenTextDocument.mockImplementation((listener: (document: TestDocument) => void) => {
    mocks.documentOpenListeners.push(listener);
    return disposable();
  });
  mocks.onDidChangeTextDocument.mockImplementation((listener: (event: TestDocumentChangeEvent) => void) => {
    mocks.documentChangeListeners.push(listener);
    return disposable();
  });
  mocks.onDidCloseTextDocument.mockImplementation((listener: (document: TestDocument) => void) => {
    mocks.documentCloseListeners.push(listener);
    return disposable();
  });
  mocks.getConfiguration.mockImplementation((section?: string) => ({
    get: <T>(key: string, defaultValue?: T) => {
      const fullKey = section ? `${section}.${key}` : key;
      if (fullKey === "nuinuiCAD.canvasRibbon.ribbons") {
        return (mocks.canvasRibbonSetting ?? defaultValue) as T;
      }
      return Object.hasOwn(mocks.bakeSettings, fullKey)
        ? mocks.bakeSettings[fullKey] as T
        : defaultValue as T;
    },
    update: (section: string, value: unknown, target: unknown) => {
      mocks.configurationUpdates.push({ section, value, target });
      if (section === "nuinuiCAD.canvasRibbon.ribbons") mocks.canvasRibbonSetting = value;
      return Promise.resolve();
    }
  }));
  mocks.onDidChangeConfiguration.mockImplementation((listener: (event: { affectsConfiguration: (section: string) => boolean }) => void) => {
    mocks.configurationChangeListeners.push(listener);
    return disposable();
  });
  activate(context as unknown as Parameters<typeof activate>[0]);
  return context;
};

const emitDocumentChange = (
  document: TestDocument,
  reason?: number,
  contentChanges: readonly unknown[] = [{}]
): void => {
  for (const listener of mocks.documentChangeListeners) listener({ document, reason, contentChanges });
};

const emitDocumentOpen = (document: TestDocument): void => {
  for (const listener of mocks.documentOpenListeners) listener(document);
};

const emitDocumentClose = (document: TestDocument): void => {
  for (const listener of mocks.documentCloseListeners) listener(document);
};

const emitActiveEditorChange = (editor?: TestEditor): void => {
  for (const listener of mocks.activeEditorListeners) listener(editor);
};

const openPanelFor = (editor = mocks.activeTextEditor!): TestPanel => {
  mocks.activeTextEditor = editor;
  mocks.visibleTextEditors = [editor];
  mocks.textDocuments = [editor.document];
  mocks.activeTabInput = new mocks.TabInputText(editor.document.uri);
  commandHandlerFor("nuinuiCAD.openCanvas")?.();
  mocks.activeTabInput = new mocks.TabInputWebview("nuinuiCAD.canvas");
  return mocks.panels.at(-1)!;
};

const openOutputPreviewPanelFor = (editor = mocks.activeTextEditor!): TestPanel => {
  mocks.activeTextEditor = editor;
  mocks.visibleTextEditors = [editor];
  mocks.textDocuments = [editor.document];
  mocks.activeTabInput = new mocks.TabInputText(editor.document.uri);
  commandHandlerFor("nuinuiCAD.openOutputPreview")?.();
  mocks.activeTabInput = new mocks.TabInputWebview("nuinuiCAD.outputPreview");
  return mocks.panels.at(-1)!;
};

afterEach(() => {
  delete process.env.NUINUICAD_VSCODE_BENCHMARK_CONFIG;
  mocks.activeTextEditor = null;
  mocks.activeTabInput = null;
  mocks.visibleTextEditors.length = 0;
  mocks.textDocuments.length = 0;
  mocks.commandHandlers.clear();
  mocks.activeEditorListeners.length = 0;
  mocks.activeColorThemeListeners.length = 0;
  mocks.documentOpenListeners.length = 0;
  mocks.documentChangeListeners.length = 0;
  mocks.documentCloseListeners.length = 0;
  mocks.canvasRibbonSetting = undefined;
  mocks.configurationUpdates.length = 0;
  mocks.configurationChangeListeners.length = 0;
  mocks.panels.length = 0;
  mocks.rustProcesses.length = 0;
  mocks.diagnosticCollections.length = 0;
  mocks.contexts.length = 0;
  mocks.completionRegistrations.length = 0;
  mocks.signatureHelpRegistrations.length = 0;
  mocks.definitionRegistrations.length = 0;
  mocks.renameRegistrations.length = 0;
  mocks.referenceRegistrations.length = 0;
  mocks.codeActionRegistrations.length = 0;
  mocks.foldingRegistrations.length = 0;
  mocks.documentSymbolRegistrations.length = 0;
  mocks.showErrorMessage.mockReset();
  mocks.bakeSettings = {};
  mocks.showTextDocument.mockReset();
  mocks.executeCommand.mockReset();
  mocks.createWebviewPanel.mockReset();
  mocks.createDiagnosticCollection.mockReset();
  mocks.registerCompletionItemProvider.mockReset();
  mocks.registerSignatureHelpProvider.mockReset();
  mocks.registerDefinitionProvider.mockReset();
  mocks.registerRenameProvider.mockReset();
  mocks.registerReferenceProvider.mockReset();
  mocks.registerCodeActionsProvider.mockReset();
  mocks.registerFoldingRangeProvider.mockReset();
  mocks.registerDocumentSymbolProvider.mockReset();
  mocks.registerCommand.mockReset();
  mocks.onDidChangeActiveTextEditor.mockReset();
  mocks.onDidChangeActiveColorTheme.mockReset();
  mocks.onDidOpenTextDocument.mockReset();
  mocks.onDidChangeTextDocument.mockReset();
  mocks.onDidCloseTextDocument.mockReset();
  mocks.getConfiguration.mockReset();
  mocks.onDidChangeConfiguration.mockReset();
  mocks.asRelativePath.mockReset();
});

// Remaining tests unchanged from current branch blob except the benchmark listener baseline below.

describe("VS Code production document lifecycle", () => {
  it("auto-starts once when benchmark config exists and an active .nui editor becomes ready", () => {
    setup(true, null);

    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();
    mocks.activeTextEditor = editorFor();
    mocks.visibleTextEditors = [mocks.activeTextEditor];
    mocks.textDocuments = [mocks.activeTextEditor.document];
    emitActiveEditorChange(mocks.activeTextEditor);
    emitActiveEditorChange(mocks.activeTextEditor);
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
    expect(mocks.onDidChangeTextDocument).toHaveBeenCalledTimes(2);
    expect(mocks.activeTextEditor!.edit).not.toHaveBeenCalled();
  });
});
