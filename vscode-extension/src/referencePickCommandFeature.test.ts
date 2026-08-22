import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";

const mocks = vi.hoisted(() => ({
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  executeCommand: vi.fn(),
  showTextDocument: vi.fn(),
  activeTextEditor: undefined as TestEditor | undefined,
  activeEditorListeners: [] as Array<(editor: TestEditor | undefined) => void>,
  selectionListeners: [] as Array<(event: { textEditor: TestEditor }) => void>,
  documentChangeListeners: [] as Array<(event: { document: TestDocument; contentChanges: readonly unknown[] }) => void>,
  documentCloseListeners: [] as Array<(document: TestDocument) => void>,
  bridgeFactory: vi.fn()
}));

type TestPosition = { offset: number };
type TestSelection = { active: TestPosition };
type TestDocument = {
  version: number;
  fileName: string;
  uri: { scheme: string; toString: () => string };
  getText: () => string;
  offsetAt: (position: TestPosition) => number;
};
type TestEditor = {
  document: TestDocument;
  selection: TestSelection;
  viewColumn: number;
};

type TestWebview = {
  postMessage: ReturnType<typeof vi.fn>;
  onDidReceiveMessage: (listener: (message: unknown) => void) => { dispose: () => void };
};
type TestPanel = {
  reveal: ReturnType<typeof vi.fn>;
  webview: TestWebview;
  onDidDispose: (listener: () => void) => { dispose: () => void };
};

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
  commands: {
    registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
      mocks.commands.set(id, handler);
      return disposableFor(() => mocks.commands.delete(id));
    },
    executeCommand: mocks.executeCommand
  },
  window: {
    get activeTextEditor() {
      return mocks.activeTextEditor;
    },
    showTextDocument: mocks.showTextDocument,
    onDidChangeActiveTextEditor: (listener: (editor: TestEditor | undefined) => void) => {
      mocks.activeEditorListeners.push(listener);
      return disposableFor(() => removeListener(mocks.activeEditorListeners, listener));
    },
    onDidChangeTextEditorSelection: (listener: (event: { textEditor: TestEditor }) => void) => {
      mocks.selectionListeners.push(listener);
      return disposableFor(() => removeListener(mocks.selectionListeners, listener));
    }
  },
  workspace: {
    onDidChangeTextDocument: (listener: (event: { document: TestDocument; contentChanges: readonly unknown[] }) => void) => {
      mocks.documentChangeListeners.push(listener);
      return disposableFor(() => removeListener(mocks.documentChangeListeners, listener));
    },
    onDidCloseTextDocument: (listener: (document: TestDocument) => void) => {
      mocks.documentCloseListeners.push(listener);
      return disposableFor(() => removeListener(mocks.documentCloseListeners, listener));
    }
  }
}));

vi.mock("./referencePickSourceBridge", () => ({
  createVscodeReferencePickSourceBridge: mocks.bridgeFactory
}));

import {
  registerVscodeReferencePickFeature,
  VSCODE_REFERENCE_PICK_COMMAND_ID,
  VSCODE_REFERENCE_PICK_CONTEXT_KEY
} from "./referencePickCommandFeature";

const source = [
  "nui 4",
  "point A = coordinate(x: 0, y: 0)",
  "point B = coordinate(x: 10, y: 0)",
  "point P = offset(from: @A, dx: 0, dy: 0)"
].join("\n");

const createEditor = (): TestEditor => {
  const document: TestDocument = {
    version: 7,
    fileName: "/tmp/pick.nui",
    uri: { scheme: "file", toString: () => "file:///tmp/pick.nui" },
    getText: () => source,
    offsetAt: (position) => position.offset
  };
  return {
    document,
    selection: {
      active: { offset: source.indexOf("@A", source.indexOf("offset")) + 1 }
    },
    viewColumn: 1
  };
};

const createPanel = () => {
  const webviewListeners: Array<(message: unknown) => void> = [];
  const disposeListeners: Array<() => void> = [];
  const webview: TestWebview = {
    postMessage: vi.fn(),
    onDidReceiveMessage: (listener) => {
      webviewListeners.push(listener);
      return disposableFor(() => removeListener(webviewListeners, listener));
    }
  };
  const panel: TestPanel = {
    reveal: vi.fn(),
    webview,
    onDidDispose: (listener) => {
      disposeListeners.push(listener);
      return disposableFor(() => removeListener(disposeListeners, listener));
    }
  };
  return { panel, webviewListeners, disposeListeners };
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  mocks.commands.clear();
  mocks.executeCommand.mockReset();
  mocks.executeCommand.mockResolvedValue(undefined);
  mocks.showTextDocument.mockReset();
  mocks.activeTextEditor = undefined;
  mocks.activeEditorListeners = [];
  mocks.selectionListeners = [];
  mocks.documentChangeListeners = [];
  mocks.documentCloseListeners = [];
  mocks.bridgeFactory.mockReset();
});

describe("registerVscodeReferencePickFeature", () => {
  it("derives the Source context key from the shared exact target query", async () => {
    const editor = createEditor();
    mocks.activeTextEditor = editor;
    const languageSession = createLanguageAnalysisSession(source);
    const feature = registerVscodeReferencePickFeature({
      languageAnalysisSessionFor: () => languageSession,
      ensureCanvas: () => null
    });

    await flush();
    expect(mocks.executeCommand).toHaveBeenCalledWith(
      "setContext",
      VSCODE_REFERENCE_PICK_CONTEXT_KEY,
      true
    );

    editor.selection = { active: { offset: 0 } };
    for (const listener of [...mocks.selectionListeners]) listener({ textEditor: editor });
    await flush();
    expect(mocks.executeCommand).toHaveBeenLastCalledWith(
      "setContext",
      VSCODE_REFERENCE_PICK_CONTEXT_KEY,
      false
    );

    feature.dispose();
  });

  it("reuses the matching Canvas, waits for authoritative readiness, then focuses Canvas on started", async () => {
    const editor = createEditor();
    mocks.activeTextEditor = editor;
    mocks.showTextDocument.mockResolvedValue(editor);
    const languageSession = createLanguageAnalysisSession(source);
    const { panel, webviewListeners } = createPanel();
    let ready = false;
    const ensureCanvas = vi.fn(async () => ({
      document: editor.document,
      panel,
      isAuthoritativeReady: () => ready
    }));
    const bridge = {
      start: vi.fn(() => ({ type: "referencePickStartRequest" })),
      handleResult: vi.fn(async () => "started"),
      cancel: vi.fn(),
      dispose: vi.fn(),
      activeRequest: vi.fn()
    };
    mocks.bridgeFactory.mockReturnValue(bridge);
    const feature = registerVscodeReferencePickFeature({
      languageAnalysisSessionFor: () => languageSession,
      ensureCanvas: ensureCanvas as never
    });

    const command = mocks.commands.get(VSCODE_REFERENCE_PICK_COMMAND_ID);
    if (!command) throw new Error("reference pick command was not registered");
    await command();

    expect(ensureCanvas).toHaveBeenCalledWith(editor.document);
    expect(mocks.showTextDocument).toHaveBeenCalledWith(editor.document, expect.objectContaining({
      viewColumn: editor.viewColumn,
      preserveFocus: false,
      preview: false,
      selection: editor.selection
    }));
    expect(panel.reveal).toHaveBeenCalledWith(2, true);
    expect(mocks.bridgeFactory).not.toHaveBeenCalled();

    ready = true;
    for (const listener of [...webviewListeners]) {
      listener({ type: "webviewAuthoritativeDocumentReady", documentVersion: editor.document.version });
    }
    expect(mocks.bridgeFactory).toHaveBeenCalledTimes(1);
    expect(bridge.start).toHaveBeenCalledTimes(1);

    for (const listener of [...webviewListeners]) {
      listener({ type: "referencePickResult", status: "started" });
    }
    await flush();
    expect(bridge.handleResult).toHaveBeenCalledTimes(1);
    expect(panel.reveal).toHaveBeenLastCalledWith(2, false);

    feature.dispose();
  });

  it("abandons a pending Pick when Source changes before Canvas becomes ready", async () => {
    const editor = createEditor();
    mocks.activeTextEditor = editor;
    mocks.showTextDocument.mockResolvedValue(editor);
    const languageSession = createLanguageAnalysisSession(source);
    const { panel, webviewListeners } = createPanel();
    let ready = false;
    const bridge = {
      start: vi.fn(() => ({ type: "referencePickStartRequest" })),
      handleResult: vi.fn(async () => "started"),
      cancel: vi.fn(),
      dispose: vi.fn(),
      activeRequest: vi.fn()
    };
    mocks.bridgeFactory.mockReturnValue(bridge);
    const feature = registerVscodeReferencePickFeature({
      languageAnalysisSessionFor: () => languageSession,
      ensureCanvas: async () => ({
        document: editor.document,
        panel,
        isAuthoritativeReady: () => ready
      }) as never
    });

    const command = mocks.commands.get(VSCODE_REFERENCE_PICK_COMMAND_ID);
    if (!command) throw new Error("reference pick command was not registered");
    await command();
    expect(webviewListeners).toHaveLength(1);

    for (const listener of [...mocks.documentChangeListeners]) {
      listener({ document: editor.document, contentChanges: [{}] });
    }
    expect(webviewListeners).toHaveLength(0);

    ready = true;
    expect(mocks.bridgeFactory).not.toHaveBeenCalled();
    expect(bridge.start).not.toHaveBeenCalled();

    feature.dispose();
  });
});
