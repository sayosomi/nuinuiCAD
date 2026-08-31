import { afterEach, describe, expect, it, vi } from "vitest";
import { AutomationDocument } from "../../src/document/automationDocument";
import { LEGACY_CANVAS_THEME } from "../../src/components/canvasTheme";
import { vscodeCanvasPointerContextKeys, type VscodeCanvasObservationSnapshot } from "../../src/vscode/protocol";
import { vscodeObservationState } from "./vscodeObservationState";

type MockPosition = { line: number; character: number };
type MockSelection = {
  anchor: MockPosition;
  active: MockPosition;
  start: MockPosition;
  end: MockPosition;
};

type TestDocument = {
  fileName: string;
  languageId?: string;
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
  selections: MockSelection[];
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
  exportOutput: ReturnType<typeof vi.fn>;
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
  selectionChangeListeners: [] as Array<(event: { textEditor: TestEditor; kind?: number }) => void>,
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
  colorRegistrations: [] as Array<{ selector: unknown; provider: unknown; disposable: { dispose: () => void } }>,
  canvasRibbonSetting: undefined as unknown,
  configurationUpdates: [] as Array<{ section: string; value: unknown; target: unknown }>,
  configurationChangeListeners: [] as Array<(event: { affectsConfiguration: (section: string) => boolean }) => void>,
  showErrorMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  showSaveDialog: vi.fn(),
  createOutputChannel: vi.fn(),
  bakeSettings: {} as Record<string, boolean>,
  showTextDocument: vi.fn(),
  applyEdit: vi.fn(),
  workspaceEdits: [] as Array<{ replacements: Array<{ uri: unknown; range: unknown; replacement: string }> }>,
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
  registerColorProvider: vi.fn(),
  registerElementsTreeFeature: vi.fn(),
  elementsTreeFeatures: [] as Array<{ dispose: () => void }>,
  registerCommand: vi.fn(),
  onDidChangeActiveTextEditor: vi.fn(),
  onDidChangeTextEditorSelection: vi.fn(),
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
  class WorkspaceEdit {
    readonly replacements: Array<{ uri: unknown; range: unknown; replacement: string }> = [];

    constructor() {
      mocks.workspaceEdits.push(this);
    }

    replace(uri: unknown, range: unknown, replacement: string): void {
      this.replacements.push({ uri, range, replacement });
    }
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
    env: { language: "en" },
    window: {
      get activeTextEditor() {
        return mocks.activeTextEditor;
      },
      get visibleTextEditors() {
        return mocks.visibleTextEditors;
      },
      createWebviewPanel: mocks.createWebviewPanel,
      onDidChangeActiveTextEditor: mocks.onDidChangeActiveTextEditor,
      onDidChangeTextEditorSelection: mocks.onDidChangeTextEditorSelection,
      onDidChangeActiveColorTheme: mocks.onDidChangeActiveColorTheme,
      showErrorMessage: mocks.showErrorMessage,
      showWarningMessage: mocks.showWarningMessage,
      showInformationMessage: mocks.showInformationMessage,
      showSaveDialog: mocks.showSaveDialog,
      createOutputChannel: mocks.createOutputChannel,
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
      fs: {
        isWritableFileSystem: () => true
      },
      onDidOpenTextDocument: mocks.onDidOpenTextDocument,
      onDidChangeTextDocument: mocks.onDidChangeTextDocument,
      onDidCloseTextDocument: mocks.onDidCloseTextDocument,
      applyEdit: mocks.applyEdit,
      getConfiguration: mocks.getConfiguration,
      onDidChangeConfiguration: mocks.onDidChangeConfiguration,
      asRelativePath: mocks.asRelativePath
    },
    commands: { registerCommand: mocks.registerCommand, executeCommand: mocks.executeCommand },
    Disposable: {
      from: (...items: Array<{ dispose: () => void }>) => ({
        dispose: () => {
          for (const item of items) item.dispose();
        }
      })
    },
    languages: {
      createDiagnosticCollection: mocks.createDiagnosticCollection,
      registerCompletionItemProvider: mocks.registerCompletionItemProvider,
      registerSignatureHelpProvider: mocks.registerSignatureHelpProvider,
      registerDefinitionProvider: mocks.registerDefinitionProvider,
      registerRenameProvider: mocks.registerRenameProvider,
      registerReferenceProvider: mocks.registerReferenceProvider,
      registerCodeActionsProvider: mocks.registerCodeActionsProvider,
      registerFoldingRangeProvider: mocks.registerFoldingRangeProvider,
      registerDocumentSymbolProvider: mocks.registerDocumentSymbolProvider,
      registerColorProvider: mocks.registerColorProvider
    },
    Uri: {
      joinPath: vi.fn((...parts: unknown[]) => parts.join("/")),
      file: vi.fn((fsPath: string) => ({ scheme: "file", fsPath, toString: () => `file://${fsPath}` }))
    },
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
    TextEditorSelectionChangeKind: { Keyboard: 1, Mouse: 2 },
    TabInputText: mocks.TabInputText,
    TabInputWebview: mocks.TabInputWebview,
    Position,
    Range,
    WorkspaceEdit,
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
    readonly exportOutput = vi.fn(async () => ({ exported: true }));
    readonly dispose = vi.fn();

    constructor() {
      mocks.rustProcesses.push(this);
    }
  }
}));

vi.mock("./elementsTreeFeature", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./elementsTreeFeature")>();
  return {
    ...actual,
    registerNuiElementsTreeFeature: (
      ...args: Parameters<typeof actual.registerNuiElementsTreeFeature>
    ) => {
      mocks.registerElementsTreeFeature(...args);
      const feature = actual.registerNuiElementsTreeFeature(...args);
      mocks.elementsTreeFeatures.push(feature);
      return feature;
    }
  };
});

import { activate } from "./extension";

const disposable = () => ({ dispose: vi.fn() });

const documentFor = (
  fileName = "/tmp/pattern.nui",
  uri = `file://${fileName}`,
  initialSource = "nui 1\n"
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

const h3Source = [
  "nui 1",
  "point Left = coordinate(x: -50, y: 0)",
  "point Right = coordinate(x: 50, y: 0)",
  "line Guide = segment(start: @Left, end: @Right)"
].join("\n");

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
    selections: [],
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

const commandHandlerFor = (command: string): ((...args: unknown[]) => unknown) | undefined => {
  const handler = mocks.commandHandlers.get(command);
  return handler;
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
  mocks.createOutputChannel.mockImplementation(() => ({
    clear: vi.fn(),
    appendLine: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn()
  }));
  mocks.onDidChangeActiveTextEditor.mockImplementation((listener: (editor?: TestEditor) => void) => {
    mocks.activeEditorListeners.push(listener);
    return disposable();
  });
  mocks.onDidChangeTextEditorSelection.mockImplementation(
    (listener: (event: { textEditor: TestEditor; kind?: number }) => void) => {
      mocks.selectionChangeListeners.push(listener);
      return disposable();
    }
  );
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
  mocks.registerColorProvider.mockImplementation((selector: unknown, provider: unknown) => {
    const registration = disposable();
    mocks.colorRegistrations.push({ selector, provider, disposable: registration });
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

const runtimeDiagnosticFor = (
  code = "runtime-test",
  options: { exactSpan?: boolean } = {}
) => ({
  severity: "error" as const,
  line: 2,
  column: 7,
  code,
  message: `runtime ${code}`,
  exactSpanOnly: true as const,
  ...(options.exactSpan === false ? {} : {
    physicalSpan: {
      segments: [{ from: 12, to: 13 }],
      sourceRevision: 1
    }
  }),
  origin: "runtime" as const,
  bindingId: `binding:${code}`,
  navigationTarget: { kind: "binding" as const, bindingId: `binding:${code}` }
});

const canvasObservationSnapshotFor = (
  documentVersion: number
): VscodeCanvasObservationSnapshot => ({
  documentVersion,
  selectedElementIds: ["point-a"],
  canvasCanSelectInstance: false,
  selectionSubject: { kind: "elements" },
  compiledDocumentRevision: 8,
  previewActive: false,
  evaluationRevision: 8,
  evaluationRequestRevision: 13,
  evaluationStatus: "ready",
  evaluationSource: "rust",
  rustEligible: true,
  isStale: false,
  isCurrent: true,
  errorCount: 0,
  warningCount: 0,
  errorSummaries: [],
  warningSummaries: []
});

const publishCanvasObservation = (
  panel: TestPanel,
  snapshot: VscodeCanvasObservationSnapshot
): Promise<void> => messageHandlerFor(panel)({
  type: "canvasObservationPublication",
  snapshot
});

const publishCanvasTheme = (
  panel: TestPanel,
  documentVersion: number,
  themeOrBackground: typeof LEGACY_CANVAS_THEME | string = LEGACY_CANVAS_THEME,
  generation = 0
): Promise<void> => messageHandlerFor(panel)({
  type: "canvasThemePublication",
  documentVersion,
  generation,
  theme: typeof themeOrBackground === "string"
    ? { ...LEGACY_CANVAS_THEME, background: themeOrBackground }
    : themeOrBackground
});

afterEach(() => {
  delete process.env.NUINUICAD_VSCODE_BENCHMARK_CONFIG;
  mocks.activeTextEditor = null;
  mocks.activeTabInput = null;
  mocks.visibleTextEditors.length = 0;
  mocks.textDocuments.length = 0;
  mocks.commandHandlers.clear();
  mocks.activeEditorListeners.length = 0;
  mocks.selectionChangeListeners.length = 0;
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
  mocks.colorRegistrations.length = 0;
  mocks.elementsTreeFeatures.length = 0;
  mocks.showErrorMessage.mockReset();
  mocks.showWarningMessage.mockReset();
  mocks.showInformationMessage.mockReset();
  mocks.showSaveDialog.mockReset();
  mocks.createOutputChannel.mockReset();
  mocks.bakeSettings = {};
  mocks.showTextDocument.mockReset();
  mocks.applyEdit.mockReset();
  mocks.workspaceEdits.length = 0;
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
  mocks.registerColorProvider.mockReset();
  mocks.registerElementsTreeFeature.mockReset();
  mocks.registerCommand.mockReset();
  mocks.onDidChangeActiveTextEditor.mockReset();
  mocks.onDidChangeTextEditorSelection.mockReset();
  mocks.onDidChangeActiveColorTheme.mockReset();
  mocks.onDidOpenTextDocument.mockReset();
  mocks.onDidChangeTextDocument.mockReset();
  mocks.onDidCloseTextDocument.mockReset();
  mocks.getConfiguration.mockReset();
  mocks.onDidChangeConfiguration.mockReset();
  mocks.asRelativePath.mockReset();
});

describe("VS Code production document lifecycle", () => {
  it("registers and subscribes the Elements Tree lifecycle feature once", () => {
    const context = setup();

    expect(mocks.registerElementsTreeFeature).toHaveBeenCalledTimes(1);
    expect(context.subscriptions).toContain(mocks.elementsTreeFeatures[0]);
  });

  it("registers the standard file-backed nui Signature Help provider", () => {
    setup();

    expect(mocks.signatureHelpRegistrations).toHaveLength(1);
    expect(mocks.signatureHelpRegistrations[0]).toMatchObject({
      selector: { language: "nui", scheme: "file" },
      triggerCharacters: ["(", ",", ":"]
    });
  });

  it("publishes Module diagnostic related information through the current document URI", () => {
    const source = [
      "nui 1",
      "module M(required: number) {",
      "}",
      "instance Use = M()"
    ].join("\n");
    const document = documentFor("/tmp/related.nui", "file:///tmp/related.nui", source);
    setup(false, editorFor(document), [document]);

    const published = mocks.diagnosticCollections[0]!.set.mock.calls.at(-1)?.[1] as Array<{
      code?: string | number;
      relatedInformation?: Array<{
        message: string;
        location: { uri: unknown; range: { start: MockPosition; end: MockPosition } };
      }>;
    }>;
    const missing = published.find((item) => item.code === "module-missing-argument");

    expect(missing).toBeDefined();
    expect(missing?.relatedInformation).toHaveLength(1);
    expect(missing?.relatedInformation?.[0]).toMatchObject({
      location: {
        uri: document.uri,
        range: {
          start: { line: 1, character: 9 },
          end: { line: 1, character: 17 }
        }
      }
    });
    expect(missing?.relatedInformation?.[0]?.message).toEqual(expect.any(String));
  });

  it("aggregates exact-current runtime diagnostics after compiler diagnostics", async () => {
    const source = "nui 1\npoint A = offset(from: @missing, dx: 1, dy: 2)\n";
    const document = documentFor("/tmp/runtime-diagnostics.nui", "file:///tmp/runtime-diagnostics.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const collection = mocks.diagnosticCollections[0]!;
    const compilerPublished = collection.set.mock.calls.at(-1)?.[1] as Array<{ code?: string | number; message: string }>;
    expect(compilerPublished.length).toBeGreaterThan(0);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    collection.set.mockClear();

    await messageHandlerFor(panel)({
      type: "runtimeDiagnosticsPublication",
      documentVersion: document.version,
      diagnostics: [runtimeDiagnosticFor("runtime-current")]
    });

    const published = collection.set.mock.calls.at(-1)?.[1] as Array<{ code?: string | number; message: string }>;
    expect(published.slice(0, compilerPublished.length).map(({ code, message }) => ({ code, message }))).toEqual(
      compilerPublished.map(({ code, message }) => ({ code, message }))
    );
    expect(published.at(-1)?.code).toBe("runtime-current");
  });

  it("ignores stale and non-current-session runtime diagnostic publications", async () => {
    const source = "nui 1\nconst x: number = 1\n";
    const document = documentFor("/tmp/runtime-stale.nui", "file:///tmp/runtime-stale.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    const handler = messageHandlerFor(panel);
    await handler({ type: "webviewReady" });
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    await handler({
      type: "runtimeDiagnosticsPublication",
      documentVersion: document.version,
      diagnostics: [runtimeDiagnosticFor("runtime-current")]
    });
    const collection = mocks.diagnosticCollections[0]!;
    collection.set.mockClear();

    await handler({
      type: "runtimeDiagnosticsPublication",
      documentVersion: document.version - 1,
      diagnostics: [runtimeDiagnosticFor("runtime-stale")]
    });
    expect(collection.set).not.toHaveBeenCalled();

    panel.dispose();
    await handler({
      type: "runtimeDiagnosticsPublication",
      documentVersion: document.version,
      diagnostics: [runtimeDiagnosticFor("runtime-after-dispose")]
    });
    expect(collection.set).not.toHaveBeenCalled();
  });

  it("clears runtime diagnostics synchronously on source change", async () => {
    const source = "nui 1\nconst x: number = 1\n";
    const document = documentFor("/tmp/runtime-change.nui", "file:///tmp/runtime-change.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    await messageHandlerFor(panel)({
      type: "runtimeDiagnosticsPublication",
      documentVersion: document.version,
      diagnostics: [runtimeDiagnosticFor("runtime-before-change")]
    });

    document.setSourceText("nui 1\nconst y: number = 2\n");
    document.version += 1;
    emitDocumentChange(document);

    const published = mocks.diagnosticCollections[0]!.set.mock.calls.at(-1)?.[1] as Array<{ code?: string | number }>;
    expect(published.map((item) => item.code)).not.toContain("runtime-before-change");
  });

  it("treats a current empty runtime publication as clearing only the runtime layer", async () => {
    const source = "nui 1\npoint A = offset(from: @missing, dx: 1, dy: 2)\n";
    const document = documentFor("/tmp/runtime-empty.nui", "file:///tmp/runtime-empty.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const collection = mocks.diagnosticCollections[0]!;
    const compilerPublished = collection.set.mock.calls.at(-1)?.[1] as Array<{ code?: string | number; message: string }>;
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    await messageHandlerFor(panel)({
      type: "runtimeDiagnosticsPublication",
      documentVersion: document.version,
      diagnostics: [runtimeDiagnosticFor("runtime-to-clear")]
    });

    await messageHandlerFor(panel)({
      type: "runtimeDiagnosticsPublication",
      documentVersion: document.version,
      diagnostics: []
    });

    const published = collection.set.mock.calls.at(-1)?.[1] as Array<{ code?: string | number; message: string }>;
    expect(published.map(({ code, message }) => ({ code, message }))).toEqual(
      compilerPublished.map(({ code, message }) => ({ code, message }))
    );
  });

  it("retains runtime diagnostics across Canvas close but clears them on document close", async () => {
    const source = "nui 1\nconst x: number = 1\n";
    const document = documentFor("/tmp/runtime-close.nui", "file:///tmp/runtime-close.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    await messageHandlerFor(panel)({
      type: "runtimeDiagnosticsPublication",
      documentVersion: document.version,
      diagnostics: [runtimeDiagnosticFor("runtime-retained")]
    });
    const collection = mocks.diagnosticCollections[0]!;

    panel.dispose();
    collection.set.mockClear();
    emitDocumentChange(document, undefined, []);
    const retained = collection.set.mock.calls.at(-1)?.[1] as Array<{ code?: string | number }>;
    expect(retained.map((item) => item.code)).toContain("runtime-retained");

    emitDocumentClose(document);
    const reopened = documentFor("/tmp/runtime-close.nui", "file:///tmp/runtime-close.nui", source);
    mocks.textDocuments = [reopened];
    emitDocumentOpen(reopened);
    const reopenedPublished = collection.set.mock.calls.at(-1)?.[1] as Array<{ code?: string | number }>;
    expect(reopenedPublished.map((item) => item.code)).not.toContain("runtime-retained");
  });

  it("preserves exactSpanOnly fail-closed projection for runtime diagnostics", async () => {
    const source = "nui 1\nconst x: number = 1\n";
    const document = documentFor("/tmp/runtime-span.nui", "file:///tmp/runtime-span.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });

    await messageHandlerFor(panel)({
      type: "runtimeDiagnosticsPublication",
      documentVersion: document.version,
      diagnostics: [runtimeDiagnosticFor("runtime-no-span", { exactSpan: false })]
    });

    const published = mocks.diagnosticCollections[0]!.set.mock.calls.at(-1)?.[1] as Array<{ code?: string | number }>;
    expect(published.map((item) => item.code)).not.toContain("runtime-no-span");
  });

  it("invalidates the exact-current Canvas runtime through the root source-change path", async () => {
    const document = documentFor("/tmp/observation-change.nui", "file:///tmp/observation-change.nui");
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);

    await publishCanvasObservation(panel, canvasObservationSnapshotFor(document.version));
    expect(vscodeObservationState.snapshot().documents[0]?.canvas).not.toBeNull();

    document.version += 1;
    emitDocumentChange(document);

    expect(vscodeObservationState.snapshot().documents[0]?.canvas).toBeNull();
  });

  it("removes the closed document through the root close lifecycle", async () => {
    const document = documentFor("/tmp/observation-close.nui", "file:///tmp/observation-close.nui");
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await publishCanvasObservation(panel, canvasObservationSnapshotFor(document.version));

    mocks.textDocuments = [];
    emitDocumentClose(document);

    expect(vscodeObservationState.snapshot()).toEqual({ activeDocumentUri: null, documents: [] });
  });

  it("invalidates Canvas observation when the production Canvas session is disposed", async () => {
    const document = documentFor("/tmp/observation-canvas-close.nui", "file:///tmp/observation-canvas-close.nui");
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await publishCanvasObservation(panel, canvasObservationSnapshotFor(document.version));

    panel.dispose();

    expect(vscodeObservationState.snapshot().documents[0]?.canvas).toBeNull();
  });

  it("accepts current Canvas publication and rejects stale root-supplied versions", async () => {
    const document = documentFor("/tmp/observation-freshness.nui", "file:///tmp/observation-freshness.nui");
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);

    await publishCanvasObservation(panel, canvasObservationSnapshotFor(document.version));
    expect(vscodeObservationState.snapshot().documents[0]?.canvas?.documentVersion).toBe(1);

    await publishCanvasObservation(panel, canvasObservationSnapshotFor(document.version - 1));
    expect(vscodeObservationState.snapshot().documents[0]?.canvas?.documentVersion).toBe(1);

    document.version += 1;
    await publishCanvasObservation(panel, canvasObservationSnapshotFor(document.version - 1));
    expect(vscodeObservationState.snapshot().documents[0]?.canvas).toBeNull();

    panel.dispose();
    await publishCanvasObservation(panel, canvasObservationSnapshotFor(document.version));
    expect(vscodeObservationState.snapshot().documents[0]?.canvas).toBeNull();
  });

  it("resets observation state and detaches the host projection on Extension Host disposal", async () => {
    const document = documentFor("/tmp/observation-dispose.nui", "file:///tmp/observation-dispose.nui");
    const editor = editorFor(document);
    const context = setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await publishCanvasObservation(panel, canvasObservationSnapshotFor(document.version));
    expect(vscodeObservationState.snapshot().documents).toHaveLength(1);

    for (const subscription of context.subscriptions) subscription.dispose();
    mocks.textDocuments = [document];

    expect(vscodeObservationState.snapshot()).toEqual({ activeDocumentUri: null, documents: [] });
  });

  it("registers and opens the Output Preview production surface", () => {
    setup();

    expect(mocks.registerCommand).toHaveBeenCalledWith("nuinuiCAD.openOutputPreview", expect.any(Function));
    expect(mocks.registerCommand).toHaveBeenCalledWith("nuinuiCAD.fitOutputPreview", expect.any(Function));
    expect(mocks.registerCommand).toHaveBeenCalledWith("nuinuiCAD.clearOutputPreviewFocus", expect.any(Function));
    expect(mocks.registerCommand).toHaveBeenCalledWith("nuinuiCAD.exportCurrentOutput", expect.any(Function));
    const panel = openOutputPreviewPanelFor();
    expect(mocks.createWebviewPanel.mock.calls[0]?.[0]).toBe("nuinuiCAD.outputPreview");
    expect(panel.webview.html).toContain('<html lang="ja" data-nuinui-surface="outputPreview">');
  });

  it("reveals the existing Output Preview instead of creating a second panel", () => {
    setup();
    const panel = openOutputPreviewPanelFor();

    mocks.activeTabInput = new mocks.TabInputText(mocks.activeTextEditor!.document.uri);
    commandHandlerFor("nuinuiCAD.openOutputPreview")?.();

    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(panel.reveal).toHaveBeenCalledWith(2);
  });

  it("opens Output Preview for the active Canvas document without a source cursor", async () => {
    const documentA = documentFor("/tmp/a.nui", "file:///tmp/a.nui");
    const editorA = editorFor(documentA);
    setup(false, editorA, [documentA]);
    const canvas = openPanelFor(editorA);
    canvas.active = true;
    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.canvas");

    commandHandlerFor("nuinuiCAD.openOutputPreview")?.();

    const preview = mocks.panels.at(-1)!;
    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(2);
    expect(preview.webview.html).toContain('<html lang="ja" data-nuinui-surface="outputPreview">');

    await messageHandlerFor(preview)({ type: "webviewReady" });
    await messageHandlerFor(preview)({ type: "webviewAuthoritativeDocumentReady", documentVersion: documentA.version });
    expect(preview.webview.postMessage).toHaveBeenCalledWith({
      type: "outputPreviewOpen",
      documentVersion: documentA.version,
      normalizedSourceOffset: null
    });
  });

  it("keeps active Canvas document identity when another document already has an Output Preview", () => {
    const documentA = documentFor("/tmp/a.nui", "file:///tmp/a.nui");
    const documentB = documentFor("/tmp/b.nui", "file:///tmp/b.nui");
    const editorA = editorFor(documentA);
    const editorB = editorFor(documentB);
    setup(false, editorA, [documentA, documentB]);
    const canvasA = openPanelFor(editorA);
    const previewB = openOutputPreviewPanelFor(editorB);
    canvasA.active = true;
    previewB.active = false;
    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.canvas");

    commandHandlerFor("nuinuiCAD.openOutputPreview")?.();

    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(3);
    expect(mocks.createWebviewPanel.mock.calls.at(-1)?.[1]).toBe("a.nui — Output Preview");
    expect(mocks.panels.at(-1)?.webview.html).toContain('<html lang="ja" data-nuinui-surface="outputPreview">');
    expect(previewB.reveal).not.toHaveBeenCalled();
  });

  it("opens Canvas for the active Output Preview document", () => {
    const documentA = documentFor("/tmp/a.nui", "file:///tmp/a.nui");
    const editorA = editorFor(documentA);
    setup(false, editorA, [documentA]);
    const preview = openOutputPreviewPanelFor(editorA);
    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.outputPreview");

    commandHandlerFor("nuinuiCAD.openCanvas")?.();

    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(2);
    expect(mocks.panels.at(-1)?.webview.html).toContain('<html lang="ja" data-nuinui-surface="canvas">');
    expect(preview.reveal).not.toHaveBeenCalled();
  });

  it("fails closed for an unrelated active webview instead of using the active text editor", () => {
    setup();
    mocks.activeTabInput = new mocks.TabInputWebview("unrelated.webview");

    commandHandlerFor("nuinuiCAD.openCanvas")?.();

    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "nuinuiCAD requires an active .nui Text Editor or Output Preview."
    );
  });

  it("reveals an existing cross-surface target without duplicating it", () => {
    const documentA = documentFor("/tmp/a.nui", "file:///tmp/a.nui");
    const editorA = editorFor(documentA);
    setup(false, editorA, [documentA]);
    const canvas = openPanelFor(editorA);
    const preview = openOutputPreviewPanelFor(editorA);
    preview.active = true;
    canvas.active = false;
    mocks.activeTabInput = new mocks.TabInputWebview("nuinuiCAD.outputPreview");

    commandHandlerFor("nuinuiCAD.openCanvas")?.();

    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(2);
    expect(canvas.reveal).toHaveBeenCalledWith(2);
  });

  it("never resolves a cross-surface open command through another document", () => {
    const documentA = documentFor("/tmp/a.nui", "file:///tmp/a.nui");
    const documentB = documentFor("/tmp/b.nui", "file:///tmp/b.nui");
    const editorA = editorFor(documentA);
    const editorB = editorFor(documentB);
    setup(false, editorA, [documentA, documentB]);
    const previewA = openOutputPreviewPanelFor(editorA);
    const canvasB = openPanelFor(editorB);
    previewA.active = true;
    canvasB.active = false;
    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.outputPreview");

    commandHandlerFor("nuinuiCAD.openCanvas")?.();

    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(3);
    expect(mocks.panels.at(-1)?.webview.html).toContain('<html lang="ja" data-nuinui-surface="canvas">');
    expect(canvasB.reveal).not.toHaveBeenCalled();
  });

  it("fails closed when the active webview has no matching live session", () => {
    setup();
    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.canvas");

    commandHandlerFor("nuinuiCAD.openOutputPreview")?.();

    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith("nuinuiCAD requires an active .nui Text Editor or Canvas.");
  });

  it("keeps Canvas and Output Preview sessions independent for one document", () => {
    setup();
    const canvas = openPanelFor();
    const preview = openOutputPreviewPanelFor();

    preview.dispose();

    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(2);
    expect(canvas.dispose).not.toHaveBeenCalled();
  });

  it("hydrates and live-syncs the authoritative TextDocument in Output Preview", async () => {
    setup();
    const document = mocks.activeTextEditor!.document;
    const panel = openOutputPreviewPanelFor();

    await messageHandlerFor(panel)({ type: "webviewReady" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "replaceTextDocument",
      documentVersion: document.version
    }));
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "outputPreviewOpen",
      documentVersion: document.version,
      normalizedSourceOffset: expect.any(Number)
    }));

    document.setSourceText("nui 1\n// changed\n");
    document.version += 1;
    emitDocumentChange(document);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "commitText",
      sourceText: "nui 1\n// changed\n",
      documentVersion: document.version
    }));
  });

  it("routes Fit Output Preview through the active Preview session", async () => {
    setup();
    const panel = openOutputPreviewPanelFor();
    const document = mocks.activeTextEditor!.document;
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    panel.webview.postMessage.mockClear();

    commandHandlerFor("nuinuiCAD.fitOutputPreview")?.();

    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "outputPreviewFit" });
  });

  it("routes Reset before authoritative document readiness while Fit remains document-current gated", async () => {
    setup();
    const panel = openOutputPreviewPanelFor();
    await messageHandlerFor(panel)({ type: "webviewReady" });
    panel.webview.postMessage.mockClear();

    await messageHandlerFor(panel)({ type: "outputPreviewResetView" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "outputPreviewResetView" });

    panel.webview.postMessage.mockClear();
    commandHandlerFor("nuinuiCAD.resetOutputPreviewView")?.();
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "outputPreviewResetView" });

    panel.webview.postMessage.mockClear();
    commandHandlerFor("nuinuiCAD.fitOutputPreview")?.();
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith({ type: "outputPreviewFit" });
  });

  it("routes Clear Output Preview Focus through the active Preview session", async () => {
    setup();
    const panel = openOutputPreviewPanelFor();
    const document = mocks.activeTextEditor!.document;
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    panel.webview.postMessage.mockClear();

    commandHandlerFor("nuinuiCAD.clearOutputPreviewFocus")?.();

    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "outputPreviewClearFocus" });
  });

  it("routes Export Current Output only through a current active Preview", async () => {
    setup();
    commandHandlerFor("nuinuiCAD.exportCurrentOutput")?.();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "nuinuiCAD: Export Current Output is only available from an active Output Preview."
    );

    const panel = openOutputPreviewPanelFor();
    const document = mocks.activeTextEditor!.document;
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    await messageHandlerFor(panel)({
      type: "outputPreviewExportAvailability",
      documentVersion: document.version,
      outputKey: "print:output-a",
      format: "pdf"
    });
    panel.webview.postMessage.mockClear();

    commandHandlerFor("nuinuiCAD.exportCurrentOutput")?.();

    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "outputPreviewExport" });
  });

  it("saves the current PDF payload with the output-based default name", async () => {
    setup();
    const panel = openOutputPreviewPanelFor();
    const document = mocks.activeTextEditor!.document;
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    await messageHandlerFor(panel)({
      type: "outputPreviewExportAvailability",
      documentVersion: document.version,
      outputKey: "print:output-a",
      format: "pdf"
    });
    mocks.showSaveDialog.mockResolvedValue({ scheme: "file", fsPath: "/tmp/chosen", toString: () => "file:///tmp/chosen" });
    const payload = { version: 1, kind: "print" };

    await messageHandlerFor(panel)({
      type: "outputPreviewExportRequest",
      requestId: 4,
      documentVersion: document.version,
      outputKey: "print:output-a",
      outputName: "家庭用A4",
      format: "pdf",
      payload
    });

    expect(mocks.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({
      defaultUri: expect.objectContaining({ fsPath: "/tmp/pattern_家庭用A4.pdf" }),
      filters: { "PDF document": ["pdf"] },
      saveLabel: "Export PDF"
    }));
    expect(mocks.rustProcesses[0]?.exportOutput).toHaveBeenCalledWith({
      path: "/tmp/chosen.pdf",
      payload
    });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "outputPreviewExportResult",
      requestId: 4,
      status: "saved"
    });
    expect(mocks.showInformationMessage).toHaveBeenCalledWith("nuinuiCAD: Saved chosen.pdf.");
  });

  it("cancels silently and never writes an output file", async () => {
    setup();
    const panel = openOutputPreviewPanelFor();
    const document = mocks.activeTextEditor!.document;
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    await messageHandlerFor(panel)({
      type: "outputPreviewExportAvailability",
      documentVersion: document.version,
      outputKey: "svg:output-b",
      format: "svg"
    });
    mocks.showSaveDialog.mockResolvedValue(undefined);

    await messageHandlerFor(panel)({
      type: "outputPreviewExportRequest",
      requestId: 5,
      documentVersion: document.version,
      outputKey: "svg:output-b",
      outputName: "型紙SVG",
      format: "svg",
      payload: { version: 1, kind: "svg" }
    });

    expect(mocks.rustProcesses).toHaveLength(0);
    expect(mocks.showInformationMessage).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "outputPreviewExportResult",
      requestId: 5,
      status: "cancelled"
    });
  });

  it("does not write when the document changes while the save dialog is open", async () => {
    setup();
    const panel = openOutputPreviewPanelFor();
    const document = mocks.activeTextEditor!.document;
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    await messageHandlerFor(panel)({
      type: "outputPreviewExportAvailability",
      documentVersion: document.version,
      outputKey: "print:output-a",
      format: "pdf"
    });
    let resolveDialog!: (value: unknown) => void;
    mocks.showSaveDialog.mockImplementation(() => new Promise((resolve) => { resolveDialog = resolve; }));
    const exportRequest = messageHandlerFor(panel)({
      type: "outputPreviewExportRequest",
      requestId: 6,
      documentVersion: document.version,
      outputKey: "print:output-a",
      outputName: "A",
      format: "pdf",
      payload: { version: 1, kind: "print" }
    });

    document.version += 1;
    document.setSourceText("nui 1\n// changed\n");
    emitDocumentChange(document);
    resolveDialog({ scheme: "file", fsPath: "/tmp/stale.pdf", toString: () => "file:///tmp/stale.pdf" });
    await exportRequest;

    expect(mocks.rustProcesses).toHaveLength(0);
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "nuinuiCAD: Output Preview changed while the save dialog was open. Export again."
    );
  });

  it("fails closed for stale Output Preview source-navigation requests", async () => {
    setup();
    const panel = openOutputPreviewPanelFor();
    const document = mocks.activeTextEditor!.document;
    await messageHandlerFor(panel)({
      type: "outputPreviewSourceNavigation",
      documentVersion: document.version - 1,
      range: { from: 0, to: 4 }
    });

    expect(mocks.showTextDocument).not.toHaveBeenCalled();
  });

  it("routes a current Output Preview place commit through one native WorkspaceEdit", async () => {
    const source = "nui 1\nvalue: 10\n";
    const document = documentFor("/tmp/place.nui", "file:///tmp/place.nui", source);
    const editor = editorFor(document);
    setup(false, editor);
    const panel = openOutputPreviewPanelFor(editor);
    const valueStart = source.indexOf("10");
    mocks.applyEdit.mockResolvedValue(true);

    await messageHandlerFor(panel)({
      type: "outputPreviewPlaceCommit",
      documentVersion: document.version,
      normalizedSourceSnapshot: source,
      statementRange: { from: source.indexOf("value:"), to: source.length - 1 },
      patches: [{
        range: { from: valueStart, to: valueStart + 2 },
        expectedText: "10",
        replacement: "20"
      }]
    });

    expect(mocks.applyEdit).toHaveBeenCalledTimes(1);
    expect(mocks.workspaceEdits).toHaveLength(1);
    expect(mocks.workspaceEdits[0]?.replacements).toHaveLength(1);
    expect(mocks.workspaceEdits[0]?.replacements[0]).toMatchObject({
      uri: document.uri,
      replacement: "20"
    });
  });

  it("disposes all matching sessions when the source document closes", () => {
    setup();
    const canvas = openPanelFor();
    const preview = openOutputPreviewPanelFor();

    emitDocumentClose(mocks.activeTextEditor!.document);

    expect(canvas.dispose).toHaveBeenCalledTimes(1);
    expect(preview.dispose).toHaveBeenCalledTimes(1);
  });

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
    expect(panel.webview.html).toContain('<html lang="ja" data-nuinui-surface="canvas">');
  });

  it("reuses and reveals the existing panel when the same document command runs twice", () => {
    setup();
    const panel = openPanelFor();
    mocks.activeTabInput = new mocks.TabInputText(mocks.activeTextEditor!.document.uri);
    commandHandlerFor("nuinuiCAD.openCanvas")?.();

    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(panel.reveal).toHaveBeenCalledWith(2);
  });

  it("routes Canvas command palette commands to the active Canvas webview", () => {
    setup();
    const panel = openPanelFor();
    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.canvas");

    for (const command of [
      "nuinuiCAD.clearCanvasSelection",
      "nuinuiCAD.selectParentGroup",
      "nuinuiCAD.selectInstance",
      "nuinuiCAD.resetCanvasView",
      "nuinuiCAD.fitDrawing",
      "nuinuiCAD.toggleCanvasPointNames",
      "nuinuiCAD.toggleCanvasGeometryNames",
      "nuinuiCAD.toggleCanvasElementNames",
      "nuinuiCAD.toggleCanvasPoints"
    ]) {
      commandHandlerFor(command)?.();
    }

    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "clearCanvasSelection" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "selectParentGroup" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "selectInstance" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "resetCanvasView" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "fitDrawing" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "toggleCanvasPointNames" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "toggleCanvasGeometryNames" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "toggleCanvasElementNames" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "toggleCanvasPoints" });
  });

  it("accepts the direct Canvas TabInputWebview representation", () => {
    setup();
    const panel = openPanelFor();

    commandHandlerFor("nuinuiCAD.clearCanvasSelection")?.();

    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasCommand",
      commandId: "clearCanvasSelection"
    });
  });

  it("routes individual Canvas creation commands through the allowlisted creation protocol", async () => {
    setup();
    const panel = openPanelFor();
    const document = mocks.activeTextEditor!.document;
    mocks.activeTabInput = new mocks.TabInputWebview("nuinuiCAD.canvas");
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({
      type: "webviewAuthoritativeDocumentReady",
      documentVersion: document.version
    });

    commandHandlerFor("nuinuiCAD.create.addLine")?.();
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasCreationCommand",
      commandId: "addLine"
    });

    panel.webview.postMessage.mockClear();
    mocks.activeTabInput = new mocks.TabInputText(document.uri);
    commandHandlerFor("nuinuiCAD.create.addLine")?.();
    expect(panel.webview.postMessage).not.toHaveBeenCalled();
  });

  it("routes Bake Current Shape from a dynamic Canvas tab to Canvas", () => {
    setup();
    const panel = openPanelFor();
    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.canvas");

    commandHandlerFor("nuinuiCAD.bakeCurrentShape")?.();

    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasCommand",
      commandId: "bakeCurrentShape"
    }));
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
  });

  it("routes Go to Source Definition from a dynamic Canvas tab to Canvas", () => {
    setup();
    const panel = openPanelFor();
    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.canvas");

    commandHandlerFor("nuinuiCAD.goToSourceDefinition")?.();

    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasSourceDefinitionRequest"
    }));
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
  });

  it("resolves the Canvas context command through a dynamic Canvas tab", () => {
    setup();
    const panel = openPanelFor();
    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.canvas");

    // The webview/context contribution invokes this same registered command.
    commandHandlerFor("nuinuiCAD.goToSourceDefinition")?.();

    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasSourceDefinitionRequest"
    }));
  });

  it("resolves all Bake settings in the Extension Host before Canvas routing", () => {
    mocks.bakeSettings = {
      "nuinuiCAD.bake.emitSkippedComments": false,
      "nuinuiCAD.bake.includeHiddenGeometry": true,
      "nuinuiCAD.bake.includeDisabledGeometry": true
    };
    setup();
    const panel = openPanelFor();

    commandHandlerFor("nuinuiCAD.bakeCurrentShape")?.();

    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasCommand",
      commandId: "bakeCurrentShape",
      emitSkippedComments: false,
      includeHiddenGeometry: true,
      includeDisabledGeometry: true
    });
  });

  it("keeps Bake routed to the last active Canvas while the Command Palette owns focus", () => {
    setup();
    const sourceEditor = mocks.activeTextEditor!;
    const panel = openPanelFor(sourceEditor);
    const viewStateHandler = (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler;
    viewStateHandler();
    panel.canvasSelection = "NormalArc";

    mocks.activeTextEditor = sourceEditor;
    mocks.visibleTextEditors = [sourceEditor];
    panel.active = false;
    viewStateHandler();
    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.canvas");

    commandHandlerFor("nuinuiCAD.bakeCurrentShape")?.();

    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasCommand",
      commandId: "bakeCurrentShape"
    }));
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "bakeSourceRequest"
    }));
    expect(panel.canvasSelection).toBe("NormalArc");
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
  });

  it("routes Bake through Source after switching from Canvas while the Canvas remains visible", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 100, y: 0)",
      "point Derived = between(",
      "  start: @A,",
      "  end: @B,",
      "  ratio: 0.25,",
      ")"
    ].join("\n");
    const document = documentFor("/tmp/routing.nui", "file:///tmp/routing.nui", source);
    const editor = editorFor(document);
    editor.selection.active = document.positionAt(source.indexOf("Derived"));
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });

    panel.active = false;
    panel.canvasSelection = "NormalArc";
    mocks.activeTabInput = new mocks.TabInputText(document.uri);

    commandHandlerFor("nuinuiCAD.bakeCurrentShape")?.();

    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "bakeSourceRequest",
      normalizedSourceOffset: source.indexOf("Derived")
    }));
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasCommand",
      commandId: "bakeCurrentShape"
    }));
    expect(panel.canvasSelection).toBe("NormalArc");
  });

  it("routes Case K through Source when Palette focus leaves a stale Canvas tab input", async () => {
    const source = [
      "nui 1",
      "modifier Guide {",
      "  state: visible,",
      "}",
      "module Reusable() {",
      "  point P0 = coordinate(x: 0, y: 0)",
      "  point P1 = coordinate(x: 100, y: 0)",
      "  export line PublicEdge [Guide] = segment(",
      "    start: @P0,",
      "    end: @P1,",
      "  )",
      "}",
      "instance InstanceOne = Reusable()"
    ].join("\n");
    const document = documentFor("/tmp/case-k.nui", "file:///tmp/case-k.nui", source);
    const editor = editorFor(document);
    editor.selection.active = document.positionAt(source.indexOf("start: @P0"));
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    panel.canvasSelection = "InstanceOne::PublicEdge";
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });

    (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler();
    panel.active = true;
    mocks.activeTextEditor = editor;
    mocks.visibleTextEditors = [editor];
    mocks.activeTabInput = new mocks.TabInputText(document.uri);
    emitActiveEditorChange(editor);
    panel.active = false;
    (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler();
    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.canvas");

    commandHandlerFor("nuinuiCAD.bakeCurrentShape")?.();

    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "bakeSourceRequest"
    }));
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasCommand",
      commandId: "bakeCurrentShape"
    }));
    expect(document.getText()).toBe(source);
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
      if (command === "setContext") return;
      expect(command).toBe(direction);
      document.version = 2;
      document.setSourceText(`nui 1\n// native ${direction}\n`);
      emitDocumentChange(document);
    });

    await messageHandlerFor(panel)({
      type: "canvasHistoryRequest",
      direction,
      expectedDocumentVersion: 1
    });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: 2 });

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
      if (command === "setContext") return;
      expect(command).toBe(direction);
      document.version = 2;
      document.setSourceText(`nui 1\n// native ${direction}\n`);
    });

    await messageHandlerFor(panel)({
      type: "canvasHistoryRequest",
      direction,
      expectedDocumentVersion: 1
    });

    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "canvasHistoryResult" }));
    expect(panel.reveal).not.toHaveBeenCalled();

    emitDocumentChange(document);

    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "canvasHistoryResult" }));
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: 2 });

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

  it("completes changed Canvas history before releasing a deferred free-point invocation", async () => {
    const document = documentFor("/tmp/history-free-point.nui", "file:///tmp/history-free-point.nui", "nui 1\n");
    const editor = editorFor(document);
    setup(false, editor);
    document.languageId = "nui";
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    for (const listener of mocks.selectionChangeListeners) listener({ textEditor: editor, kind: 1 });
    mocks.showTextDocument.mockResolvedValue(editor);
    mocks.executeCommand.mockImplementation(async (command: string) => {
      if (command === "setContext") return;
      if (command === "undo") {
        document.version = 2;
        document.setSourceText("nui 1\n// undone\n");
        emitDocumentChange(document);
      }
    });

    await messageHandlerFor(panel)({
      type: "canvasHistoryRequest",
      direction: "undo",
      expectedDocumentVersion: 1
    });
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "canvasHistoryResult" }));

    panel.webview.postMessage.mockClear();
    commandHandlerFor("nuinuiCAD.createFreePointAtPointer")?.({
      webviewSection: "blank",
      [vscodeCanvasPointerContextKeys.x]: 24,
      [vscodeCanvasPointerContextKeys.y]: -13
    });
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasFreePointAtPointer"
    }));

    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: 2 });

    const messages = panel.webview.postMessage.mock.calls.map(([message]) => message);
    const historyResultIndex = messages.findIndex((message) => message?.type === "canvasHistoryResult");
    const freePointIndex = messages.findIndex((message) => message?.type === "canvasFreePointAtPointer");
    expect(historyResultIndex).toBeGreaterThanOrEqual(0);
    expect(freePointIndex).toBeGreaterThan(historyResultIndex);
    expect(mocks.showTextDocument).toHaveBeenCalledTimes(1);
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
    mocks.showTextDocument.mockImplementation(async () => {
      panel.active = false;
      return editor;
    });
    panel.reveal.mockImplementation(() => {
      panel.active = true;
    });
    mocks.executeCommand.mockImplementation(async (command: string) => {
      if (command === "setContext") return;
      throw new Error("native history failed");
    });

    await messageHandlerFor(panel)({
      type: "canvasHistoryRequest",
      direction: "undo",
      expectedDocumentVersion: 1
    });

    expect(panel.reveal).toHaveBeenCalledWith(2, false);
    expect(mocks.executeCommand).not.toHaveBeenCalledWith("setContext", "nuinuiCAD.canvasHistoryHandoff", false);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "replaceTextDocument" }));
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasHistoryResult",
      direction: "undo",
      status: "failed",
      documentVersion: 1
    });

    (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler();
    await vi.waitFor(() => expect(mocks.executeCommand).toHaveBeenCalledWith(
      "setContext",
      "nuinuiCAD.canvasHistoryHandoff",
      false
    ));
  });

  it("resyncs and never executes native history for a stale Canvas document version", async () => {
    setup();
    const panel = openPanelFor();

    await messageHandlerFor(panel)({
      type: "canvasHistoryRequest",
      direction: "redo",
      expectedDocumentVersion: 99
    });

    expect(
      mocks.executeCommand.mock.calls.filter(([command]) => command !== "setContext")
    ).toHaveLength(0);
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

  it.each(["undo", "redo"] as const)("routes a second Canvas %s through the handoff session while native history is in flight", async (direction) => {
    const document = documentFor("/tmp/history.nui", "file:///tmp/history.nui");
    const editor = editorFor(document);
    setup(false, editor);
    const panel = openPanelFor(editor);
    let resolveNativeHistory!: () => void;
    const nativeHistory = new Promise<void>((resolve) => {
      resolveNativeHistory = resolve;
    });
    const historyCommand = direction === "undo" ? "nuinuiCAD.canvasUndo" : "nuinuiCAD.canvasRedo";
    mocks.showTextDocument.mockImplementation(async () => {
      panel.active = false;
      return editor;
    });
    panel.reveal.mockImplementation(() => {
      panel.active = true;
    });
    mocks.executeCommand.mockImplementation((command: string) => {
      if (command === "setContext") return Promise.resolve();
      if (command === direction) return nativeHistory;
      return Promise.resolve();
    });

    const firstRequest = messageHandlerFor(panel)({
      type: "canvasHistoryRequest",
      direction,
      expectedDocumentVersion: 1
    });
    await vi.waitFor(() => expect(mocks.executeCommand).toHaveBeenCalledWith(direction));

    const setContextTrueCall = mocks.executeCommand.mock.calls.find(([command, key, enabled]) =>
      command === "setContext" && key === "nuinuiCAD.canvasHistoryHandoff" && enabled === true
    );
    expect(setContextTrueCall).toBeDefined();
    const setContextTrueCallIndex = mocks.executeCommand.mock.calls.indexOf(setContextTrueCall!);
    expect(mocks.executeCommand.mock.invocationCallOrder[setContextTrueCallIndex]).toBeLessThan(mocks.showTextDocument.mock.invocationCallOrder[0]!);

    commandHandlerFor(historyCommand)?.();

    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: direction });

    mocks.showErrorMessage.mockClear();
    panel.webview.postMessage.mockClear();
    commandHandlerFor("nuinuiCAD.fitDrawing")?.();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "nuinuiCAD: アクティブなCanvasがありません。Canvasを開いてから実行してください。"
    );
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "canvasCommand" }));

    resolveNativeHistory();
    await firstRequest;

    expect(panel.reveal).toHaveBeenCalledWith(2, false);
    expect(mocks.executeCommand).not.toHaveBeenCalledWith("setContext", "nuinuiCAD.canvasHistoryHandoff", false);

    (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler();
    await vi.waitFor(() => expect(mocks.executeCommand).toHaveBeenCalledWith(
      "setContext",
      "nuinuiCAD.canvasHistoryHandoff",
      false
    ));
  });

  it("clears the Canvas history handoff context when its session is disposed", async () => {
    const document = documentFor("/tmp/history.nui", "file:///tmp/history.nui");
    const editor = editorFor(document);
    setup(false, editor);
    const panel = openPanelFor(editor);
    let resolveNativeHistory!: () => void;
    const nativeHistory = new Promise<void>((resolve) => {
      resolveNativeHistory = resolve;
    });
    mocks.showTextDocument.mockImplementation(async () => {
      panel.active = false;
      return editor;
    });
    mocks.executeCommand.mockImplementation((command: string) => {
      if (command === "setContext") return Promise.resolve();
      if (command === "undo") return nativeHistory;
      return Promise.resolve();
    });

    const firstRequest = messageHandlerFor(panel)({
      type: "canvasHistoryRequest",
      direction: "undo",
      expectedDocumentVersion: 1
    });
    await vi.waitFor(() => expect(mocks.executeCommand).toHaveBeenCalledWith(
      "setContext",
      "nuinuiCAD.canvasHistoryHandoff",
      true
    ));

    (panel.dispose as unknown as () => void)();
    await vi.waitFor(() => expect(mocks.executeCommand).toHaveBeenCalledWith(
      "setContext",
      "nuinuiCAD.canvasHistoryHandoff",
      false
    ));

    resolveNativeHistory();
    await firstRequest;
  });

  it.each(["nuinuiCAD.canvasUndo", "nuinuiCAD.canvasRedo"])("rejects %s when no Canvas is active and no history handoff exists", (command) => {
    setup();
    const panel = openPanelFor();
    panel.active = false;

    commandHandlerFor(command)?.();

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
    mocks.activeTabInput = new mocks.TabInputText(editorB.document.uri);
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    const panelB = mocks.panels[1]!;

    expect(panelA.title).toBe("a.nui — nuinuiCAD");
    expect(panelB.title).toBe("b.nui — nuinuiCAD");

    documentA.version = 2;
    documentA.setSourceText("nui 1\nA changed\n");
    emitDocumentChange(documentA);

    expect(mocks.panels).toHaveLength(2);
    expect(panelA.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "commitText", documentVersion: 2 }));
    expect(panelB.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "commitText" }));
  });

  it("invalidates every open Canvas and Output Preview session when the active VS Code theme changes", () => {
    const documentA = documentFor("/tmp/a.nui", "file:///tmp/a.nui");
    const documentB = documentFor("/tmp/b.nui", "file:///tmp/b.nui");
    const editorA = editorFor(documentA);
    const editorB = editorFor(documentB);
    setup(false, editorA);
    const panelA = openPanelFor(editorA);
    mocks.activeTextEditor = editorB;
    mocks.visibleTextEditors = [editorB];
    mocks.textDocuments = [documentA, documentB];
    mocks.activeTabInput = new mocks.TabInputText(editorB.document.uri);
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    const panelB = mocks.panels[1]!;
    commandHandlerFor("nuinuiCAD.openOutputPreview")?.();
    const outputPreviewPanel = mocks.panels[2]!;

    expect(mocks.activeColorThemeListeners).toHaveLength(1);
    mocks.activeColorThemeListeners[0]!();

    expect(panelA.webview.postMessage).toHaveBeenCalledWith({ type: "canvasThemeChanged", generation: 1 });
    expect(panelB.webview.postMessage).toHaveBeenCalledWith({ type: "canvasThemeChanged", generation: 1 });
    expect(outputPreviewPanel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasThemeChanged", generation: 1 });
    expect(panelA.webview.postMessage).toHaveBeenCalledTimes(1);
    expect(panelB.webview.postMessage).toHaveBeenCalledTimes(1);
    expect(outputPreviewPanel.webview.postMessage).toHaveBeenCalledTimes(1);
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
    mocks.activeTabInput = new mocks.TabInputText(editorB.document.uri);
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
    mocks.activeTabInput = new mocks.TabInputText(editorB.document.uri);
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
    mocks.activeTabInput = new mocks.TabInputText(editorB.document.uri);
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    const panelB = mocks.panels[1]!;

    (panelA.dispose as unknown as () => void)();
    expect(panelA.dispose).toHaveBeenCalledTimes(1);
    expect(panelB.dispose).not.toHaveBeenCalled();

    documentB.version = 2;
    documentB.setSourceText("nui 1\n// panel B change\n");
    emitDocumentChange(documentB);

    expect(panelB.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "commitText",
      sourceText: "nui 1\n// panel B change\n",
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
    mocks.activeTabInput = new mocks.TabInputText(editorB.document.uri);
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
    emitActiveEditorChange(mocks.activeTextEditor);
    emitActiveEditorChange(mocks.activeTextEditor);
    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it("keeps benchmark lifecycle behavior without document sync or canvas edits", async () => {
    setup(true);
    const panel = mocks.panels[0]!;
    await messageHandlerFor(panel)({
      type: "canvasCommit",
      sourceText: "nui 1\n// webview change\n",
      expectedDocumentVersion: 1,
      mutationKind: "reset"
    });

    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "commitText" }));
    // Diagnostics, Explorer, Reference Pick, Geometry Reference Retarget,
    // Source Value Step, and the Canvas pointer-creation feature each observe
    // document changes without mutating the benchmark Source document.
    expect(mocks.onDidChangeTextDocument).toHaveBeenCalledTimes(6);
    expect(mocks.activeTextEditor!.edit).not.toHaveBeenCalled();
  });

  it("hydrates from the current authoritative document and ignores unrelated changes", async () => {
    setup();
    const panel = openPanelFor();
    const document = mocks.activeTextEditor!.document;
    await messageHandlerFor(panel)({ type: "webviewReady" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "replaceTextDocument", documentVersion: 1 }));

    document.version = 2;
    document.setSourceText("nui 1\n// changed\n");
    emitDocumentChange(document);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "commitText", documentVersion: 2 }));
  });

  it("retains an immediate Canvas free-point invocation until the changed document is authoritative again", async () => {
    const document = documentFor("/tmp/free-point-sync.nui", "file:///tmp/free-point-sync.nui", "nui 1\n");
    const editor = editorFor(document);
    setup(false, editor);
    document.languageId = "nui";
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    for (const listener of mocks.selectionChangeListeners) listener({ textEditor: editor, kind: 1 });
    await messageHandlerFor(panel)({
      type: "canvasPointerPublication",
      documentVersion: 1,
      pointer: { x: 12, y: -8 }
    });

    commandHandlerFor("nuinuiCAD.createFreePointAtPointer")?.();
    const firstRequest = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "canvasFreePointAtPointer") as {
        requestId: number;
      } | undefined;
    expect(firstRequest).toBeDefined();

    const committedSource = "nui 1\n// free point\n";
    editor.edit.mockImplementationOnce(async (callback: (builder: typeof editor.editBuilder) => void) => {
      callback(editor.editBuilder);
      document.version = 2;
      document.setSourceText(committedSource);
      emitDocumentChange(document);
      return true;
    });
    await messageHandlerFor(panel)({
      type: "canvasCommit",
      sourceText: committedSource,
      expectedDocumentVersion: 1,
      mutationKind: "reset",
      operationId: firstRequest!.requestId
    });
    await messageHandlerFor(panel)({
      type: "canvasFreePointAtPointerResult",
      requestId: firstRequest!.requestId,
      status: "applied",
      documentVersion: 2,
      nextSourcePosition: { line: 1, character: "// free point".length }
    });

    panel.webview.postMessage.mockClear();
    commandHandlerFor("nuinuiCAD.createFreePointAtPointer")?.({
      webviewSection: "blank",
      [vscodeCanvasPointerContextKeys.x]: 91,
      [vscodeCanvasPointerContextKeys.y]: -37
    });
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasFreePointAtPointer"
    }));

    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: 2 });

    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasFreePointAtPointer",
      documentVersion: 2,
      pointer: { x: 91, y: -37 },
      sourcePosition: { documentVersion: 2, line: 1, character: "// free point".length }
    }));
  });

  it("serializes Canvas free-point invocations through the authoritative session boundary", async () => {
    const document = documentFor("/tmp/free-point-queue.nui", "file:///tmp/free-point-queue.nui", "nui 1\n");
    const editor = editorFor(document);
    setup(false, editor, [document]);
    document.languageId = "nui";
    const panel = openPanelFor(editor);
    const handler = messageHandlerFor(panel);
    await handler({ type: "webviewReady" });
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    for (const listener of mocks.selectionChangeListeners) listener({ textEditor: editor, kind: 1 });

    await handler({
      type: "canvasPointerPublication",
      documentVersion: 1,
      pointer: { x: 12, y: -8 }
    });
    commandHandlerFor("nuinuiCAD.createFreePointAtPointer")?.();

    const freePointMessages = (): Array<{
      requestId: number;
      documentVersion: number;
      pointer: { x: number; y: number };
      sourcePosition: { documentVersion: number; line: number; character: number };
    }> => panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message): message is {
        type: "canvasFreePointAtPointer";
        requestId: number;
        documentVersion: number;
        pointer: { x: number; y: number };
        sourcePosition: { documentVersion: number; line: number; character: number };
      } => message?.type === "canvasFreePointAtPointer");
    expect(freePointMessages()).toHaveLength(1);
    const firstRequest = freePointMessages()[0]!;
    expect(firstRequest.pointer).toEqual({ x: 12, y: -8 });

    const committedSource = "nui 1\n// free point A\n";
    editor.edit.mockImplementationOnce(async (callback: (builder: typeof editor.editBuilder) => void) => {
      callback(editor.editBuilder);
      document.version = 2;
      document.setSourceText(committedSource);
      emitDocumentChange(document);
      return true;
    });
    await handler({
      type: "canvasCommit",
      sourceText: committedSource,
      expectedDocumentVersion: 1,
      mutationKind: "reset",
      operationId: firstRequest.requestId
    });

    mocks.showErrorMessage.mockClear();
    commandHandlerFor("nuinuiCAD.createFreePointAtPointer")?.({
      webviewSection: "blank",
      [vscodeCanvasPointerContextKeys.x]: 91,
      [vscodeCanvasPointerContextKeys.y]: -37
    });
    expect(freePointMessages()).toHaveLength(1);
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();

    await handler({
      type: "canvasFreePointAtPointerResult",
      requestId: firstRequest.requestId,
      status: "applied",
      documentVersion: 2,
      nextSourcePosition: { line: 1, character: "// free point A".length }
    });

    panel.webview.postMessage.mockClear();
    expect(freePointMessages()).toHaveLength(0);
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 2 });

    expect(freePointMessages()).toHaveLength(1);
    expect(freePointMessages()[0]).toMatchObject({
      documentVersion: 2,
      pointer: { x: 91, y: -37 },
      sourcePosition: { documentVersion: 2, line: 1, character: "// free point A".length }
    });
  });

  it("creates two consecutive free points from the real H3 Source anchor across native edits", async () => {
    const document = documentFor("/tmp/free-point-consecutive.nui", "file:///tmp/free-point-consecutive.nui", h3Source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    document.languageId = "nui";
    const panel = openPanelFor(editor);
    const handler = messageHandlerFor(panel);
    await handler({ type: "webviewReady" });
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });

    const sourceDefinitionStart = h3Source.indexOf("Guide");
    commandHandlerFor("nuinuiCAD.goToSourceDefinition")?.();
    const sourceDefinitionRequest = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "canvasSourceDefinitionRequest") as {
        requestId: number;
      } | undefined;
    expect(sourceDefinitionRequest).toBeDefined();
    mocks.showTextDocument.mockImplementation(async () => {
      panel.active = false;
      mocks.activeTextEditor = editor;
      return editor;
    });
    await handler({
      type: "canvasSourceDefinitionResult",
      requestId: sourceDefinitionRequest!.requestId,
      documentVersion: 1,
      range: { from: sourceDefinitionStart, to: sourceDefinitionStart + "Guide".length }
    });
    panel.active = true;
    mocks.activeTabInput = new mocks.TabInputWebview("nuinuiCAD.canvas");

    await handler({
      type: "canvasPointerPublication",
      documentVersion: 1,
      pointer: { x: 12, y: -8 }
    });
    commandHandlerFor("nuinuiCAD.createFreePointAtPointer")?.({
      webviewSection: "blank",
      [vscodeCanvasPointerContextKeys.x]: 12,
      [vscodeCanvasPointerContextKeys.y]: -8
    });
    const firstRequest = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "canvasFreePointAtPointer") as {
        requestId: number;
        documentVersion: number;
        pointer: { x: number; y: number };
        sourcePosition: { documentVersion: number; line: number; character: number };
      } | undefined;
    expect(firstRequest).toMatchObject({
      documentVersion: 1,
      pointer: { x: 12, y: -8 },
      sourcePosition: { documentVersion: 1, line: 3, character: "line ".length }
    });

    const firstSource = [
      h3Source,
      "point = coordinate(",
      "  x: 12,",
      "  y: -8,",
      ")"
    ].join("\n");
    const firstSourcePosition = document.positionAt(firstSource.indexOf("point = coordinate("));
    editor.edit.mockImplementationOnce(async (callback: (builder: typeof editor.editBuilder) => void) => {
      callback(editor.editBuilder);
      document.version = 2;
      document.setSourceText(firstSource);
      emitDocumentChange(document);
      return true;
    });
    await handler({
      type: "canvasCommit",
      sourceText: firstSource,
      expectedDocumentVersion: 1,
      mutationKind: "reset",
      operationId: firstRequest!.requestId
    });

    commandHandlerFor("nuinuiCAD.createFreePointAtPointer")?.({
      webviewSection: "blank",
      [vscodeCanvasPointerContextKeys.x]: 91,
      [vscodeCanvasPointerContextKeys.y]: -37
    });
    expect(panel.webview.postMessage.mock.calls.filter(([message]) => message?.type === "canvasFreePointAtPointer")).toHaveLength(1);

    await handler({
      type: "canvasFreePointAtPointerResult",
      requestId: firstRequest!.requestId,
      status: "applied",
      documentVersion: 2,
      nextSourcePosition: firstSourcePosition
    });

    panel.webview.postMessage.mockClear();
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 2 });
    const secondRequest = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "canvasFreePointAtPointer") as {
        requestId: number;
        documentVersion: number;
        pointer: { x: number; y: number };
        sourcePosition: { documentVersion: number; line: number; character: number };
      } | undefined;
    expect(secondRequest).toMatchObject({
      documentVersion: 2,
      pointer: { x: 91, y: -37 },
      sourcePosition: { documentVersion: 2, line: firstSourcePosition.line, character: firstSourcePosition.character }
    });

    const secondSource = [
      firstSource,
      "point = coordinate(",
      "  x: 91,",
      "  y: -37,",
      ")"
    ].join("\n");
    const secondSourcePosition = document.positionAt(secondSource.indexOf("point = coordinate(", firstSource.length));
    editor.edit.mockImplementationOnce(async (callback: (builder: typeof editor.editBuilder) => void) => {
      callback(editor.editBuilder);
      document.version = 3;
      document.setSourceText(secondSource);
      emitDocumentChange(document);
      return true;
    });
    await handler({
      type: "canvasCommit",
      sourceText: secondSource,
      expectedDocumentVersion: 2,
      mutationKind: "reset",
      operationId: secondRequest!.requestId
    });
    await handler({
      type: "canvasFreePointAtPointerResult",
      requestId: secondRequest!.requestId,
      status: "applied",
      documentVersion: 3,
      nextSourcePosition: secondSourcePosition
    });
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 3 });

    const pointDeclarations = document.getText().match(/^point(?: [A-Za-z_][A-Za-z0-9_]*)? = coordinate\(/gm) ?? [];
    expect(pointDeclarations).toHaveLength(4);
    expect(document.getText().indexOf("line Guide = segment(start: @Left, end: @Right)")).toBeLessThan(
      document.getText().indexOf("point = coordinate(\n  x: 12,\n  y: -8,\n)")
    );
    expect(document.getText().indexOf("point = coordinate(\n  x: 12,\n  y: -8,\n)")).toBeLessThan(
      document.getText().indexOf("point = coordinate(\n  x: 91,\n  y: -37,\n)")
    );
    expect(editor.edit).toHaveBeenCalledTimes(2);
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
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
    mocks.activeTabInput = new mocks.TabInputText(editorB.document.uri);
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    const panelB = mocks.panels[1]!;

    emitDocumentClose(documentA);
    expect(panelA.dispose).toHaveBeenCalledTimes(1);
    expect(panelB.dispose).not.toHaveBeenCalled();

    documentA.version = 4;
    documentA.setSourceText("nui 1\n// reopened\n");
    mocks.activeTextEditor = editorA;
    mocks.visibleTextEditors = [editorA];
    mocks.textDocuments = [documentA, documentB];
    mocks.activeTabInput = new mocks.TabInputText(editorA.document.uri);
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    const reopened = mocks.panels[2]!;
    await messageHandlerFor(reopened)({ type: "webviewReady" });
    expect(reopened).not.toBe(panelA);
    expect(reopened.webview.postMessage).toHaveBeenCalledWith({
      type: "replaceTextDocument",
      sourceText: "nui 1\n// reopened\n",
      documentVersion: 4
    });
  });

  it("reopens a fresh panel after panel-only disposal and hydrates current document text and version", async () => {
    setup();
    const editor = mocks.activeTextEditor!;
    const panelA = openPanelFor(editor);

    (panelA.dispose as unknown as () => void)();
    editor.document.version = 6;
    editor.document.setSourceText("nui 1\n// panel reopened\n");
    const panelB = openPanelFor(editor);
    await messageHandlerFor(panelB)({ type: "webviewReady" });

    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(2);
    expect(panelB).not.toBe(panelA);
    expect(panelB.webview.postMessage).toHaveBeenCalledWith({
      type: "replaceTextDocument",
      sourceText: "nui 1\n// panel reopened\n",
      documentVersion: 6
    });
  });

  it("fails closed and resyncs when the expected document version is stale", async () => {
    setup();
    const panel = openPanelFor();
    const document = mocks.activeTextEditor!.document;
    document.version = 2;
    document.setSourceText("nui 1\n// authoritative\n");
    await messageHandlerFor(panel)({
      type: "canvasCommit",
      sourceText: "nui 1\n// stale\n",
      expectedDocumentVersion: 1,
      mutationKind: "reset"
    });

    expect(mocks.activeTextEditor!.edit).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "replaceTextDocument",
      sourceText: "nui 1\n// authoritative\n",
      documentVersion: 2
    });
  });

  it("applies a valid model patch as one snapshot-coordinate edit transaction", async () => {
    const source = "nui 1\nA\nB\n";
    const document = documentFor("/tmp/pattern.nui", "file:///tmp/pattern.nui", source);
    const editor = editorFor(document);
    setup(false, editor);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({
      type: "canvasCommit",
      sourceText: "nui 1\nA changed\nB\n",
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
    const document = documentFor("/tmp/pattern.nui", "file:///tmp/pattern.nui", "nui 1\nA\n");
    const editor = editorFor(document);
    setup(false, editor);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({
      type: "canvasCommit",
      sourceText: "nui 1\nnot the patch result\n",
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
      sourceText: "nui 1\n// reset\n",
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
      sourceText: "nui 1\n// reset\n",
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
      sourceText: "nui 1\n// committed\n",
      expectedDocumentVersion: 1,
      mutationKind: "reset"
    });
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "commitText" }));

    editor.document.version = 2;
    editor.document.setSourceText("nui 1\n// committed\n");
    emitDocumentChange(editor.document);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "commitText", documentVersion: 2 }));
  });

  it("does not forward non-content TextDocument changes during a Canvas commit", async () => {
    const preDrag = "nui 1\n// pre-drag\n";
    const postDrag = "nui 1\n// post-drag\n";
    const document = documentFor("/tmp/drag.nui", "file:///tmp/drag.nui", preDrag);
    const editor = editorFor(document);
    setup(false, editor);
    const panel = openPanelFor(editor);
    editor.edit.mockImplementationOnce(async (callback: (builder: typeof editor.editBuilder) => void) => {
      callback(editor.editBuilder);
      emitDocumentChange(document, undefined, []);
      document.version = 2;
      document.setSourceText(postDrag);
      emitDocumentChange(document, undefined, [{ text: postDrag }]);
      return true;
    });

    await messageHandlerFor(panel)({
      type: "canvasCommit",
      sourceText: postDrag,
      expectedDocumentVersion: 1,
      mutationKind: "reset"
    });

    expect(panel.webview.postMessage.mock.calls.filter(([message]) => message?.type === "commitText")).toEqual([
      [{
        type: "commitText",
        sourceText: postDrag,
        documentVersion: 2,
        reason: "edit"
      }]
    ]);
  });

  it.each([
    ["nuinuiCAD.convertPointToXYOffset", "xy"],
    ["nuinuiCAD.convertPointToAngleDistanceOffset", "angle-distance"]
  ] as const)("passes the exact Explorer node to the %s conversion start", async (command, mode) => {
    const source = [
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "point Target = coordinate(x: 10, y: 5)"
    ].join("\n");
    const document = documentFor("/tmp/explorer-conversion.nui", "file:///tmp/explorer-conversion.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    panel.webview.postMessage.mockClear();
    mocks.activeTabInput = new mocks.TabInputText(document.uri);

    commandHandlerFor(command)?.({
      symbol: {
        name: "Target",
        detail: "point",
        kind: "object",
        range: {
          from: source.indexOf("point Target"),
          to: source.indexOf("point Target") + "point Target = coordinate(x: 10, y: 5)".length
        },
        selectionRange: {
          from: source.indexOf("Target"),
          to: source.indexOf("Target") + "Target".length
        },
        children: []
      }
    });

    await vi.waitFor(() => expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "coordinatePointConversionStart",
      mode,
      targetIds: [expect.any(String)]
    })));
  });

  it("keeps an owned conversion commit alive across its document change and presents one terminal result", async () => {
    const source = [
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "point Target = coordinate(x: 10, y: 5)"
    ].join("\n");
    const document = documentFor("/tmp/conversion-lifecycle.nui", "file:///tmp/conversion-lifecycle.nui", source);
    const editor = editorFor(document);
    editor.selection.active = { line: 2, character: source.split("\n")[2]!.indexOf("Target") };
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    mocks.activeTabInput = new mocks.TabInputText(document.uri);
    panel.webview.postMessage.mockClear();

    commandHandlerFor("nuinuiCAD.convertPointToXYOffset")?.();
    await vi.waitFor(() => expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "coordinatePointConversionStart"
    })));
    const startRequest = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "coordinatePointConversionStart") as {
        requestId: number;
        documentUri: string;
        mode: "xy";
        targetIds: readonly string[];
      };

    const committedSource = `${source}\n// converted\n`;
    editor.edit.mockImplementationOnce(async (callback: (builder: typeof editor.editBuilder) => void) => {
      callback(editor.editBuilder);
      document.version = 2;
      document.setSourceText(committedSource);
      emitDocumentChange(document);
      return true;
    });
    const canvasMessageHandler = panel.webview.onDidReceiveMessage.mock.calls[0]?.[0] as
      (message: unknown) => Promise<void>;
    await canvasMessageHandler({
      type: "canvasCommit",
      sourceText: committedSource,
      expectedDocumentVersion: 1,
      mutationKind: "reset",
      operationId: 77,
      coordinatePointConversionRequestId: startRequest.requestId
    });

    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasCommitResult",
      operationId: 77,
      status: "accepted",
      documentVersion: 2
    });

    mocks.showTextDocument.mockClear();
    mocks.showInformationMessage.mockClear();
    const terminalResult = {
      type: "coordinatePointConversionResult" as const,
      requestId: startRequest.requestId,
      operationId: 77,
      documentUri: startRequest.documentUri,
      documentVersion: 2,
      origin: "source" as const,
      mode: "xy" as const,
      status: "applied" as const,
      classification: "all-success" as const,
      successfulTargetIds: startRequest.targetIds,
      successfulTargetCount: startRequest.targetIds.length,
      skippedTargets: [],
      skippedTargetCount: 0
    };
    await messageHandlerFor(panel)(terminalResult);
    await messageHandlerFor(panel)(terminalResult);

    expect(mocks.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(mocks.showTextDocument).toHaveBeenCalledTimes(1);
  });
});

describe("VS Code explicit Canvas navigation lifecycle", () => {
  const prepareNavigation = async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const document = documentFor("/tmp/navigation-focus.nui", "file:///tmp/navigation-focus.nui", source);
    const editor = editorFor(document);
    editor.selection.active = { line: 1, character: source.split("\n")[1]!.indexOf("A") };
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    commandHandlerFor("nuinuiCAD.revealInCanvas")?.();
    const navigationRequest = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === "canvasNavigationRequest")
      .at(-1) as { requestId: number };
    return { document, panel, navigationRequest };
  };

  const focusMessagesFor = (panel: TestPanel) => panel.webview.postMessage.mock.calls
    .map(([message]) => message)
    .filter((message) => message?.type === "focusCanvas");

  it("does not open Canvas when the source cursor has no runtime target", () => {
    const source = "nui 1\n// comment only";
    const document = documentFor("/tmp/no-target.nui", "file:///tmp/no-target.nui", source);
    const editor = editorFor(document);
    editor.selection.active = { line: 1, character: 3 };
    setup(false, editor, [document]);

    commandHandlerFor("nuinuiCAD.revealInCanvas")?.();

    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();
  });

  it("reports source analysis unavailable for a fatal exact-current source without opening Canvas", () => {
    const source = "nui 1\npoint Broken = coordinate(";
    const document = documentFor("/tmp/reveal-fatal.nui", "file:///tmp/reveal-fatal.nui", source);
    const editor = editorFor(document);
    editor.selection.active = { line: 1, character: 8 };
    setup(false, editor, [document]);

    commandHandlerFor("nuinuiCAD.revealInCanvas")?.();

    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "Reveal in Canvas is unavailable because source analysis is not ready."
    );
  });

  it("waits for authoritative Webview hydration and latest request wins", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const document = documentFor("/tmp/reveal.nui", "file:///tmp/reveal.nui", source);
    const editor = editorFor(document);
    editor.selection.active = { line: 1, character: source.split("\n")[1]!.indexOf("A") };
    setup(false, editor, [document]);

    commandHandlerFor("nuinuiCAD.revealInCanvas")?.();
    const panel = mocks.panels[0]!;
    commandHandlerFor("nuinuiCAD.revealInCanvas")?.();
    expect(panel.webview.postMessage.mock.calls.filter(([message]) => message?.type === "canvasNavigationRequest")).toHaveLength(0);

    await messageHandlerFor(panel)({ type: "webviewReady" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "replaceTextDocument",
      sourceText: source,
      documentVersion: 1
    });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });

    const navigationRequests = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === "canvasNavigationRequest");
    expect(navigationRequests).toHaveLength(1);
    expect(navigationRequests[0]).toMatchObject({
      type: "canvasNavigationRequest",
      documentVersion: 1,
      normalizedSourceOffset: source.indexOf("A")
    });
  });

  it("defers Canvas focus while the destination panel is inactive", async () => {
    const { panel, navigationRequest } = await prepareNavigation();
    panel.active = false;
    panel.webview.postMessage.mockClear();
    panel.reveal.mockClear();

    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: navigationRequest.requestId,
      status: "resolved",
      degradations: []
    });

    expect(panel.reveal).toHaveBeenCalledWith(2, false);
    expect(focusMessagesFor(panel)).toHaveLength(0);
  });

  it("flushes one deferred Canvas focus when the destination becomes active", async () => {
    const { panel, navigationRequest } = await prepareNavigation();
    panel.active = false;
    panel.webview.postMessage.mockClear();

    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: navigationRequest.requestId,
      status: "resolved",
      degradations: []
    });

    panel.active = true;
    (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler();

    expect(focusMessagesFor(panel)).toEqual([{
      type: "focusCanvas",
      requestId: navigationRequest.requestId
    }]);
  });

  it("does not duplicate deferred Canvas focus for repeated active view-state events", async () => {
    const { panel, navigationRequest } = await prepareNavigation();
    panel.active = false;
    panel.webview.postMessage.mockClear();

    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: navigationRequest.requestId,
      status: "resolved",
      degradations: []
    });

    panel.active = true;
    const viewStateHandler = (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler;
    viewStateHandler();
    viewStateHandler();

    expect(focusMessagesFor(panel)).toHaveLength(1);
  });

  it("sends Canvas focus immediately when the destination panel is already active", async () => {
    const { panel, navigationRequest } = await prepareNavigation();
    panel.webview.postMessage.mockClear();
    panel.reveal.mockClear();

    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: navigationRequest.requestId,
      status: "resolved",
      degradations: []
    });

    expect(panel.reveal).toHaveBeenCalledWith(2, false);
    expect(focusMessagesFor(panel)).toEqual([{
      type: "focusCanvas",
      requestId: navigationRequest.requestId
    }]);
    (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler();
    expect(focusMessagesFor(panel)).toHaveLength(1);
  });

  it("clears deferred Canvas focus when navigation completes", async () => {
    const { panel, navigationRequest } = await prepareNavigation();
    panel.active = false;
    panel.webview.postMessage.mockClear();

    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: navigationRequest.requestId,
      status: "resolved",
      degradations: []
    });
    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: navigationRequest.requestId,
      status: "focused"
    });

    panel.active = true;
    (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler();

    expect(focusMessagesFor(panel)).toHaveLength(0);
  });

  it("prevents a superseded deferred request from focusing the Canvas", async () => {
    const { panel, navigationRequest: firstRequest } = await prepareNavigation();
    panel.active = false;
    panel.webview.postMessage.mockClear();

    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: firstRequest.requestId,
      status: "resolved",
      degradations: []
    });
    commandHandlerFor("nuinuiCAD.revealInCanvas")?.();
    const secondRequest = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === "canvasNavigationRequest")
      .at(-1) as { requestId: number };

    panel.active = true;
    (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler();
    expect(focusMessagesFor(panel)).toHaveLength(0);

    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: firstRequest.requestId,
      status: "resolved",
      degradations: []
    });
    expect(focusMessagesFor(panel)).toHaveLength(0);

    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: secondRequest.requestId,
      status: "resolved",
      degradations: []
    });
    expect(focusMessagesFor(panel)).toEqual([{
      type: "focusCanvas",
      requestId: secondRequest.requestId
    }]);
  });

  it("prevents an invalidated deferred request from focusing after a document reset", async () => {
    const { document, panel, navigationRequest } = await prepareNavigation();
    panel.active = false;
    panel.webview.postMessage.mockClear();

    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: navigationRequest.requestId,
      status: "resolved",
      degradations: []
    });
    document.version = 2;
    emitDocumentChange(document);

    panel.active = true;
    (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler();

    expect(focusMessagesFor(panel)).toHaveLength(0);
  });

  it("clears deferred Canvas focus when navigation fails", async () => {
    const { panel, navigationRequest } = await prepareNavigation();
    panel.active = false;
    panel.webview.postMessage.mockClear();

    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: navigationRequest.requestId,
      status: "resolved",
      degradations: []
    });
    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: navigationRequest.requestId,
      status: "failed",
      reason: "source-mismatch"
    });

    panel.active = true;
    (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler();

    expect(focusMessagesFor(panel)).toHaveLength(0);
  });

  it("keeps Reveal and Canvas-to-Source navigation isolated per document session", async () => {
    const sourceA = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const sourceB = [
      "nui 1",
      "point B = coordinate(x: 10, y: 0)"
    ].join("\n");
    const documentA = documentFor("/tmp/a.nui", "file:///tmp/a.nui", sourceA);
    const documentB = documentFor("/tmp/b.nui", "file:///tmp/b.nui", sourceB);
    const editorA = editorFor(documentA);
    const editorB = editorFor(documentB);
    editorA.selection.active = { line: 1, character: "point A = coordinate(x: 0, y: 0)".indexOf("A") };
    editorB.selection.active = { line: 1, character: "point B = coordinate(x: 10, y: 0)".indexOf("B") };
    setup(false, editorA, [documentA, documentB]);
    const panelA = openPanelFor(editorA);
    mocks.activeTextEditor = editorB;
    mocks.visibleTextEditors = [editorA, editorB];
    mocks.textDocuments = [documentA, documentB];
    mocks.activeTabInput = new mocks.TabInputText(editorB.document.uri);
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    const panelB = mocks.panels[1]!;

    await messageHandlerFor(panelB)({ type: "webviewReady" });
    await messageHandlerFor(panelB)({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    commandHandlerFor("nuinuiCAD.revealInCanvas")?.();

    expect(panelB.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasNavigationRequest",
      normalizedSourceOffset: sourceB.indexOf("B")
    }));
    expect(panelA.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "canvasNavigationRequest" }));

    panelA.active = true;
    panelB.active = false;
    mocks.activeTextEditor = editorA;
    mocks.visibleTextEditors = [editorA, editorB];
    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.canvas");
    commandHandlerFor("nuinuiCAD.goToSourceDefinition")?.();
    const request = panelA.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "canvasSourceDefinitionRequest") as { requestId: number } | undefined;
    expect(request).toBeDefined();

    mocks.showTextDocument.mockResolvedValue(editorA);
    await messageHandlerFor(panelA)({
      type: "canvasSourceDefinitionResult",
      requestId: request!.requestId,
      documentVersion: 1,
      range: { from: sourceA.indexOf("A"), to: sourceA.indexOf("A") + 1 }
    });

    expect(mocks.showTextDocument).toHaveBeenCalledWith(documentA, expect.objectContaining({ preserveFocus: false }));
    expect(mocks.showTextDocument).not.toHaveBeenCalledWith(documentB, expect.anything());
  });

  it("does not transfer focus for stale or no-target navigation results", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const document = documentFor("/tmp/navigation-stale.nui", "file:///tmp/navigation-stale.nui", source);
    const editor = editorFor(document);
    const initialActive = { line: 1, character: source.split("\n")[1]!.indexOf("A") };
    editor.selection.active = initialActive;
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);

    commandHandlerFor("nuinuiCAD.goToSourceDefinition")?.();
    const sourceRequest = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "canvasSourceDefinitionRequest") as { requestId: number };
    document.version = 2;
    await messageHandlerFor(panel)({
      type: "canvasSourceDefinitionResult",
      requestId: sourceRequest.requestId,
      documentVersion: 1,
      range: { from: source.indexOf("A"), to: source.indexOf("A") + 1 }
    });
    expect(mocks.showTextDocument).not.toHaveBeenCalled();
    expect(editor.selection.active).toEqual(initialActive);

    commandHandlerFor("nuinuiCAD.goToSourceDefinition")?.();
    const noTargetRequest = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message, index) => message?.type === "canvasSourceDefinitionRequest" && index > 0) as { requestId: number };
    await messageHandlerFor(panel)({
      type: "canvasSourceDefinitionResult",
      requestId: noTargetRequest.requestId,
      documentVersion: 2,
      range: null
    });
    expect(mocks.showTextDocument).not.toHaveBeenCalled();
    expect(editor.selection.active).toEqual(initialActive);

    panel.webview.postMessage.mockClear();
    panel.reveal.mockClear();
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: 2 });
    commandHandlerFor("nuinuiCAD.revealInCanvas")?.();
    const navigationRequest = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "canvasNavigationRequest") as { requestId: number };
    panel.webview.postMessage.mockClear();
    panel.reveal.mockClear();
    document.version = 3;
    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: navigationRequest.requestId,
      status: "resolved",
      degradations: []
    });

    expect(panel.reveal).not.toHaveBeenCalledWith(2, false);
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "focusCanvas" }));
  });

  it("blocks navigation during Canvas history and its handoff context", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const document = documentFor("/tmp/navigation-history.nui", "file:///tmp/navigation-history.nui", source);
    const editor = editorFor(document);
    editor.selection.active = { line: 1, character: source.split("\n")[1]!.indexOf("A") };
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    let resolveNativeHistory!: () => void;
    const nativeHistory = new Promise<void>((resolve) => {
      resolveNativeHistory = resolve;
    });
    mocks.showTextDocument.mockImplementation(async () => {
      panel.active = false;
      return editor;
    });
    mocks.executeCommand.mockImplementation((command: string) => {
      if (command === "setContext") return Promise.resolve();
      if (command === "undo") return nativeHistory;
      return Promise.resolve();
    });

    const historyRequest = messageHandlerFor(panel)({
      type: "canvasHistoryRequest",
      direction: "undo",
      expectedDocumentVersion: 1
    });
    await vi.waitFor(() => expect(mocks.executeCommand).toHaveBeenCalledWith(
      "setContext",
      "nuinuiCAD.canvasHistoryHandoff",
      true
    ));

    panel.active = true;
    panel.webview.postMessage.mockClear();
    commandHandlerFor("nuinuiCAD.goToSourceDefinition")?.();
    commandHandlerFor("nuinuiCAD.revealInCanvas")?.();

    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasSourceDefinitionRequest"
    }));
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasNavigationRequest"
    }));

    resolveNativeHistory();
    await historyRequest;
  });

  it("establishes the main-thread Rename caret through showTextDocument for named Canvas navigation", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(",
      "  x: 0,",
      "  y: 0",
      ")",
      "",
      "point B = coordinate(",
      "  x: 100,",
      "  y: 0",
      ")",
      "",
      "line BaseLine = segment(",
      "  start: @A,",
      "  end: @B",
      ")"
    ].join("\n");
    const document = documentFor("/tmp/go-to-source.nui", "file:///tmp/go-to-source.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    document.languageId = "nui";
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });

    commandHandlerFor("nuinuiCAD.goToSourceDefinition")?.();
    const request = panel.webview.postMessage.mock.calls.find(([message]) => message?.type === "canvasSourceDefinitionRequest")?.[0] as { requestId: number };
    expect(request).toBeDefined();

    let mainThreadPosition: MockPosition | null = null;
    mocks.showTextDocument.mockImplementation(async (
      _document: TestDocument,
      options: { selection?: { start: MockPosition; end: MockPosition } }
    ) => {
      const selection = options.selection;
      expect(selection).toBeDefined();
      mainThreadPosition = selection!.end;
      panel.active = false;
      mocks.activeTextEditor = editor;
      return editor;
    });
    const identifierFrom = source.indexOf("BaseLine");
    const identifierTo = identifierFrom + "BaseLine".length;
    const identifierStart = document.positionAt(identifierFrom);
    const identifierEnd = document.positionAt(identifierTo);
    await messageHandlerFor(panel)({
      type: "canvasSourceDefinitionResult",
      requestId: request.requestId,
      documentVersion: 1,
      range: { from: identifierFrom, to: identifierTo }
    });

    expect(mocks.showTextDocument).toHaveBeenCalledWith(document, expect.objectContaining({
      preserveFocus: false,
      selection: expect.objectContaining({ start: identifierStart, end: identifierStart })
    }));
    expect(mocks.activeTextEditor).toBe(editor);
    expect(panel.active).toBe(false);
    expect(mainThreadPosition).toEqual(identifierStart);
    const renameProvider = mocks.renameRegistrations[0]!.provider as {
      prepareRename: (document: TestDocument, position: { line: number; character: number }) => {
        range: { start: { line: number; character: number }; end: { line: number; character: number } };
        placeholder: string;
      };
    };
    expect(renameProvider.prepareRename(document, mainThreadPosition!)).toMatchObject({
      range: { start: identifierStart, end: identifierEnd },
      placeholder: "BaseLine"
    });
    expect(mocks.executeCommand).toHaveBeenCalledWith("editor.unfold");
    expect(editor.revealRange).toHaveBeenCalledWith(
      expect.objectContaining({ start: identifierStart, end: identifierEnd }),
      1
    );

    panel.active = true;
    mocks.activeTabInput = new mocks.TabInputWebview("nuinuiCAD.canvas");
    await messageHandlerFor(panel)({
      type: "canvasPointerPublication",
      documentVersion: 1,
      pointer: { x: 5, y: -2 }
    });
    commandHandlerFor("nuinuiCAD.createFreePointAtPointer")?.();
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasFreePointAtPointer",
      sourcePosition: {
        documentVersion: 1,
        line: identifierStart.line,
        character: identifierStart.character
      }
    }));
  });

  it("keeps unnamed Canvas keyword navigation exact without adding Rename support", async () => {
    const source = [
      "nui 1",
      "point = coordinate(x: 0, y: 0)"
    ].join("\n");
    const document = documentFor("/tmp/go-to-unnamed-source.nui", "file:///tmp/go-to-unnamed-source.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);

    commandHandlerFor("nuinuiCAD.goToSourceDefinition")?.();
    const request = panel.webview.postMessage.mock.calls.find(([message]) => message?.type === "canvasSourceDefinitionRequest")?.[0] as { requestId: number };
    expect(request).toBeDefined();

    let mainThreadPosition: MockPosition | null = null;
    mocks.showTextDocument.mockImplementation(async (
      _document: TestDocument,
      options: { selection?: { start: MockPosition; end: MockPosition } }
    ) => {
      const selection = options.selection;
      expect(selection).toBeDefined();
      mainThreadPosition = selection!.end;
      return editor;
    });
    await messageHandlerFor(panel)({
      type: "canvasSourceDefinitionResult",
      requestId: request.requestId,
      documentVersion: 1,
      range: { from: source.indexOf("point"), to: source.indexOf("point") + "point".length }
    });

    const keywordStart = document.positionAt(source.indexOf("point"));
    const keywordEnd = document.positionAt(source.indexOf("point") + "point".length);
    expect(mocks.showTextDocument).toHaveBeenCalledWith(document, expect.objectContaining({
      selection: expect.objectContaining({ start: keywordStart, end: keywordStart })
    }));
    expect(mainThreadPosition).toEqual(keywordStart);
    const renameProvider = mocks.renameRegistrations[0]!.provider as {
      prepareRename: (document: TestDocument, position: { line: number; character: number }) => unknown;
    };
    expect(() => renameProvider.prepareRename(document, mainThreadPosition!)).toThrow(
      "Rename is not available at this position."
    );
    expect(mocks.executeCommand).toHaveBeenCalledWith("editor.unfold");
    expect(editor.revealRange).toHaveBeenCalledWith(
      expect.objectContaining({ start: keywordStart, end: keywordEnd }),
      1
    );
  });
});

describe("VS Code compiler diagnostics lifecycle", () => {
  const invalidSource = "nui 1\npoint A = coordinate(x: 0, y: )\n";

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

  it("publishes invalid choice literals for typed declarations", () => {
    const source = [
      "nui 1",
      "let width: number = 10",
      "let mode: choice(front, back) = side"
    ].join("\n");
    const document = documentFor("/tmp/invalid-choice.nui", "file:///tmp/invalid-choice.nui", source);
    setup(false, null, [document]);

    const published = collectionFor().set.mock.calls.at(-1)?.[1] as Array<{
      code?: string | number;
      message: string;
      range: { start: MockPosition; end: MockPosition };
      severity: number;
      source?: string;
    }>;
    const diagnostic = published.find((item) => item.code === "invalid-choice-literal");

    expect(diagnostic).toMatchObject({
      code: "invalid-choice-literal",
      source: "nuinuiCAD",
      severity: 0,
      range: {
        start: { line: 2, character: 32 },
        end: { line: 2, character: 36 }
      }
    });
    expect(published.filter((item) => item.code === "invalid-choice-literal")).toHaveLength(1);
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
      "nui 1\nconst x: number = 1\nconst x: number = 2\n"
    );
    setup(false, null, [document]);
    const collection = collectionFor();
    const initialCallCount = collection.set.mock.calls.length;

    document.version = 2;
    document.setSourceText("nui 1\npoint A = coordinate(x: 0, y: 1)\n");
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
    documentB.setSourceText("nui 1\npoint B = coordinate(x: 0, y: 1)\n");
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
    const document = documentFor("/tmp/stale.nui", "file:///tmp/stale.nui", "nui 1\n");
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
    const document = documentFor("/tmp/reopen.nui", "file:///tmp/reopen.nui", "nui 1\n");
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

describe("VS Code Canvas theme warning lifecycle", () => {
  const sourceFor = (color: string): string => [
    "nui 1",
    "modifier Guide {",
    `  color: ${color},`,
    "}"
  ].join("\n");

  const warningCodesFor = (collection: TestDiagnosticCollection): Array<string | number | undefined> => {
    const diagnostics = collection.set.mock.calls.at(-1)?.[1] as Array<{ code?: string | number }> | undefined;
    return diagnostics?.map((diagnostic) => diagnostic.code) ?? [];
  };

  const synchronizeCanvasTheme = async (
    panel: TestPanel,
    documentVersion: number,
    background: string,
    generation = 0
  ): Promise<void> => {
    const handler = messageHandlerFor(panel);
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion });
    await publishCanvasTheme(panel, documentVersion, background, generation);
  };

  it("publishes an authoritative initial background into the existing Source diagnostics", async () => {
    const source = sourceFor("#999999");
    const document = documentFor("/tmp/contrast-initial.nui", "file:///tmp/contrast-initial.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const collection = mocks.diagnosticCollections[0]!;

    expect(warningCodesFor(collection)).not.toContain("modifier-fixed-color-low-contrast");
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await synchronizeCanvasTheme(panel, document.version, "#ffffff");

    expect(warningCodesFor(collection)).toContain("modifier-fixed-color-low-contrast");
    const warning = (collection.set.mock.calls.at(-1)?.[1] as Array<{
      code?: string | number;
      message: string;
      range: { start: MockPosition; end: MockPosition };
      severity: number;
      source?: string;
    }>).find((diagnostic) => diagnostic.code === "modifier-fixed-color-low-contrast");
    expect(warning).toMatchObject({
      severity: 1,
      source: "nuinuiCAD",
      message: "Fixed modifier color #999999 has low contrast against the current Canvas background.",
      range: {
        start: { line: 2, character: "  color: ".length },
        end: { line: 2, character: "  color: #999999".length }
      }
    });
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "canvasWarning" }));
  });

  it("preserves the exact fixed-color token range for CRLF Source documents", async () => {
    const source = sourceFor("#999999").replace(/\n/g, "\r\n");
    const document = documentFor("/tmp/contrast-crlf.nui", "file:///tmp/contrast-crlf.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await synchronizeCanvasTheme(panel, document.version, "#ffffff");

    const diagnostics = mocks.diagnosticCollections[0]!.set.mock.calls.at(-1)?.[1] as Array<{
      code?: string | number;
      range: { start: MockPosition; end: MockPosition };
    }>;
    expect(diagnostics.find((diagnostic) => diagnostic.code === "modifier-fixed-color-low-contrast")?.range).toEqual({
      start: { line: 2, character: "  color: ".length },
      end: { line: 2, character: "  color: #999999".length }
    });
  });

  it("reevaluates low-to-high and high-to-low only after fresh publication for the new document version", async () => {
    const document = documentFor(
      "/tmp/contrast-edit.nui",
      "file:///tmp/contrast-edit.nui",
      sourceFor("#999999")
    );
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await synchronizeCanvasTheme(panel, 1, "#ffffff");
    const collection = mocks.diagnosticCollections[0]!;
    expect(warningCodesFor(collection)).toContain("modifier-fixed-color-low-contrast");

    document.version = 2;
    document.setSourceText(sourceFor("#0000ff"));
    emitDocumentChange(document);
    expect(warningCodesFor(collection)).not.toContain("modifier-fixed-color-low-contrast");
    await synchronizeCanvasTheme(panel, 2, "#ffffff");
    expect(warningCodesFor(collection)).not.toContain("modifier-fixed-color-low-contrast");

    document.version = 3;
    document.setSourceText(sourceFor("#999999"));
    emitDocumentChange(document);
    expect(warningCodesFor(collection)).not.toContain("modifier-fixed-color-low-contrast");
    await synchronizeCanvasTheme(panel, 3, "#ffffff");
    expect(warningCodesFor(collection)).toContain("modifier-fixed-color-low-contrast");
  });

  it("rejects stale and wrong-session background publications", async () => {
    const document = documentFor("/tmp/contrast-stale.nui", "file:///tmp/contrast-stale.nui", sourceFor("#999999"));
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const firstPanel = openPanelFor(editor);
    const firstHandler = messageHandlerFor(firstPanel);
    await firstHandler({ type: "webviewReady" });
    await synchronizeCanvasTheme(firstPanel, 1, "#ffffff");
    const collection = mocks.diagnosticCollections[0]!;
    const callsAfterFresh = collection.set.mock.calls.length;

    await publishCanvasTheme(firstPanel, 0, "#000000");
    expect(collection.set.mock.calls).toHaveLength(callsAfterFresh);

    firstPanel.dispose();
    const secondPanel = openPanelFor(editor);
    const secondHandler = messageHandlerFor(secondPanel);
    await secondHandler({ type: "webviewReady" });
    await secondHandler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    await firstHandler({
      type: "canvasThemePublication",
      documentVersion: 1,
      generation: 0,
      theme: { ...LEGACY_CANVAS_THEME, background: "#ffffff" }
    });
    expect(warningCodesFor(collection)).not.toContain("modifier-fixed-color-low-contrast");
  });

  it("invalidates on theme change before refresh and clears on Canvas close", async () => {
    const document = documentFor("/tmp/contrast-theme.nui", "file:///tmp/contrast-theme.nui", sourceFor("#999999"));
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await synchronizeCanvasTheme(panel, 1, "#ffffff");
    const collection = mocks.diagnosticCollections[0]!;
    expect(warningCodesFor(collection)).toContain("modifier-fixed-color-low-contrast");

    mocks.activeColorThemeListeners[0]!();
    expect(warningCodesFor(collection)).not.toContain("modifier-fixed-color-low-contrast");
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasThemeChanged", generation: 1 });

    await publishCanvasTheme(panel, 1, "#000000", 0);
    expect(warningCodesFor(collection)).not.toContain("modifier-fixed-color-low-contrast");

    panel.dispose();
    expect(warningCodesFor(collection)).not.toContain("modifier-fixed-color-low-contrast");
  });

  it("does not guess a warning before Canvas is opened", () => {
    const document = documentFor("/tmp/contrast-no-canvas.nui", "file:///tmp/contrast-no-canvas.nui", sourceFor("#999999"));
    setup(false, null, [document]);

    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();
    expect(warningCodesFor(mocks.diagnosticCollections[0]!)).not.toContain("modifier-fixed-color-low-contrast");
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
      "nui 1\nconst value: number = ab"
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
    const document = documentFor("/tmp/no-canvas.nui", "file:///tmp/no-canvas.nui", "nui 1\npoint P = co");
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

describe("VS Code native document symbol lifecycle", () => {
  it("registers one nui/file document symbol provider with the session lifecycle", () => {
    const context = setup(false, null, []);
    const registration = mocks.documentSymbolRegistrations[0]!;

    expect(mocks.documentSymbolRegistrations).toHaveLength(1);
    expect(registration.selector).toEqual({ language: "nui", scheme: "file" });
    expect(registration.provider).toEqual(expect.objectContaining({ provideDocumentSymbols: expect.any(Function) }));
    expect(context.subscriptions).toContain(registration.disposable);
  });
});

describe("VS Code native fixed-color lifecycle", () => {
  it("registers one nui/file color provider with the session lifecycle", () => {
    setup(false, null, []);
    const registration = mocks.colorRegistrations[0]!;

    expect(mocks.colorRegistrations).toHaveLength(1);
    expect(registration.selector).toEqual({ language: "nui", scheme: "file" });
    expect(registration.provider).toEqual(expect.objectContaining({
      provideDocumentColors: expect.any(Function),
      provideColorPresentations: expect.any(Function)
    }));
  });

  it("refreshes one current registration as Canvas theme availability changes", async () => {
    const source = ["nui 1", "modifier Guide {", "  color: accent", "}"].join("\n");
    const document = documentFor("/tmp/colors.nui", "file:///tmp/colors.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    const handler = messageHandlerFor(panel);

    await handler({ type: "webviewReady" });
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    await publishCanvasTheme(panel, 1, { ...LEGACY_CANVAS_THEME, accent: "#123456" });
    expect(mocks.colorRegistrations).toHaveLength(2);
    expect(mocks.colorRegistrations[0]!.disposable.dispose).toHaveBeenCalledTimes(1);

    mocks.activeColorThemeListeners[0]!();
    expect(mocks.colorRegistrations).toHaveLength(3);
    expect(mocks.colorRegistrations[1]!.disposable.dispose).toHaveBeenCalledTimes(1);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasThemeChanged", generation: 1 });

    await publishCanvasTheme(panel, 1, { ...LEGACY_CANVAS_THEME, accent: "#654321" }, 1);
    expect(mocks.colorRegistrations).toHaveLength(4);
    expect(mocks.colorRegistrations[2]!.disposable.dispose).toHaveBeenCalledTimes(1);

    panel.dispose();
    expect(mocks.colorRegistrations).toHaveLength(5);
    expect(mocks.colorRegistrations[3]!.disposable.dispose).toHaveBeenCalledTimes(1);
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
      "nui 1",
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
      "nui 1",
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

describe("VS Code native references lifecycle", () => {
  it("registers the provider with the requested selector and lifecycle disposable", () => {
    const context = setup(false, null, []);
    const registration = mocks.referenceRegistrations[0]!;

    expect(mocks.referenceRegistrations).toHaveLength(1);
    expect(registration.selector).toEqual({ language: "nui", scheme: "file" });
    expect(registration.provider).toEqual(expect.objectContaining({ provideReferences: expect.any(Function) }));
    expect(context.subscriptions).toContain(registration.disposable);
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

describe("VS Code Canvas Ribbon lifecycle", () => {
  it("registers the global edit command and targets the normal Settings surface", () => {
    setup(false, null, []);

    expect(mocks.registerCommand).toHaveBeenCalledWith(
      "nuinuiCAD.editCanvasRibbon",
      expect.any(Function)
    );
    commandHandlerFor("nuinuiCAD.editCanvasRibbon")?.();
    expect(mocks.executeCommand).toHaveBeenCalledWith(
      "workbench.action.openSettings",
      "nuinuiCAD.canvasRibbon.ribbons"
    );
  });

  it("patches only a validated Ribbon position in authoritative User Settings", async () => {
    mocks.canvasRibbonSetting = [
      {
        id: "one",
        label: "One",
        x: null,
        y: 12,
        orientation: "horizontal",
        iconSize: 16,
        items: [{
          id: "edit",
          type: "command",
          commandId: "editCanvasRibbon",
          icon: "settings-2",
          label: "Legacy edit",
          showLabel: false,
          futureItemField: { keep: "verbatim" }
        }],
        futureRibbonField: { keep: true }
      },
      {
        id: "two",
        items: "malformed",
        futureMalformedRibbonField: [1, 2, 3]
      },
      {
        id: "one",
        label: "Later duplicate",
        x: 7,
        y: 8,
        items: [{ id: "later", type: "value", valueId: "canvasZoom" }],
        futureDuplicateField: "keep"
      },
      {
        id: "three",
        label: "Three",
        x: 4,
        y: 5,
        orientation: "vertical",
        iconSize: 20,
        items: [{ id: "zoom", type: "value", valueId: "canvasZoom" }]
      }
    ];
    const configuredRibbons = mocks.canvasRibbonSetting as Array<Record<string, unknown>>;
    setup();
    const panel = openPanelFor();
    await messageHandlerFor(panel)({ type: "canvasRibbonPositionCommit", ribbonId: "one", x: 40, y: 52 });

    expect(mocks.configurationUpdates).toEqual([{
      section: "nuinuiCAD.canvasRibbon.ribbons",
      target: 1,
      value: [
        { ...configuredRibbons[0], x: 40, y: 52 },
        configuredRibbons[1],
        configuredRibbons[2],
        configuredRibbons[3]
      ]
    }]);

    await messageHandlerFor(panel)({ type: "canvasRibbonPositionCommit", ribbonId: "one", x: Number.NaN, y: 52 });
    await messageHandlerFor(panel)({ type: "canvasRibbonPositionCommit", ribbonId: "one", x: Number.POSITIVE_INFINITY, y: 52 });
    await messageHandlerFor(panel)({ type: "canvasRibbonPositionCommit", ribbonId: "", x: 40, y: 52 });
    await messageHandlerFor(panel)({ type: "canvasRibbonPositionCommit", ribbonId: "missing", x: 40, y: 52 });
    expect(mocks.configurationUpdates).toHaveLength(1);
  });

  it("broadcasts normalized configuration changes to every open Canvas session", () => {
    mocks.canvasRibbonSetting = [];
    const documentA = documentFor("/tmp/a.nui", "file:///tmp/a.nui");
    const documentB = documentFor("/tmp/b.nui", "file:///tmp/b.nui");
    const editorA = editorFor(documentA);
    const editorB = editorFor(documentB);
    setup(false, editorA, [documentA]);
    const panelA = openPanelFor(editorA);
    mocks.activeTextEditor = editorB;
    mocks.visibleTextEditors = [editorB];
    mocks.textDocuments = [documentA, documentB];
    mocks.activeTabInput = new mocks.TabInputText(editorB.document.uri);
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    const panelB = mocks.panels.at(-1)!;
    panelA.webview.postMessage.mockClear();
    panelB.webview.postMessage.mockClear();

    mocks.canvasRibbonSetting = [{
      id: "new",
      label: "New",
      x: null,
      y: 12,
      orientation: "horizontal",
      iconSize: 16,
      items: []
    }];
    mocks.configurationChangeListeners[0]?.({
      affectsConfiguration: (section) => section === "nuinuiCAD.canvasRibbon.ribbons"
    });

    expect(panelA.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasRibbonConfiguration",
      ribbons: [{
        id: "new",
        label: "New",
        x: null,
        y: 12,
        orientation: "horizontal",
        items: []
      }]
    });
    expect(panelB.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasRibbonConfiguration",
      ribbons: [{
        id: "new",
        label: "New",
        x: null,
        y: 12,
        orientation: "horizontal",
        items: []
      }]
    });
  });
});


describe("SAY-81 Module instance Reveal feedback", () => {
  it("treats a resolved Module instance as selectable even when viewport pan has no bounds", async () => {
    const source = [
      "nui 1",
      "module M() {",
      "  point P = coordinate(x: 0, y: 0, state: hidden)",
      "}",
      "instance A = M()"
    ].join("\n");
    const document = documentFor("/tmp/instance.nui", "file:///tmp/instance.nui", source);
    const editor = editorFor(document);
    editor.selection.active = document.positionAt(source.indexOf("A = M"));
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    panel.webview.postMessage.mockClear();
    mocks.showErrorMessage.mockClear();

    commandHandlerFor("nuinuiCAD.revealInCanvas")?.();
    const request = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "canvasNavigationRequest") as { requestId: number } | undefined;
    expect(request).toBeDefined();

    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: request!.requestId,
      status: "resolved",
      degradations: []
    });

    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "focusCanvas",
      requestId: request!.requestId
    });
  });
});
