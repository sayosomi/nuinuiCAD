import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";

const mocks = vi.hoisted(() => ({
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  executeCommand: vi.fn(),
  showTextDocument: vi.fn(),
  showErrorMessage: vi.fn(),
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
  TextDocumentChangeReason: { Undo: 1, Redo: 2 },
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
    showErrorMessage: mocks.showErrorMessage,
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

const createMutableEditor = () => {
  let currentSource = source;
  const document: TestDocument = {
    version: 7,
    fileName: "/tmp/pick.nui",
    uri: { scheme: "file", toString: () => "file:///tmp/pick.nui" },
    getText: () => currentSource,
    offsetAt: (position) => position.offset
  };
  const editor: TestEditor = {
    document,
    selection: { active: { offset: source.indexOf("@A", source.indexOf("offset")) + 1 } },
    viewColumn: 1
  };
  return {
    editor,
    setDocument: (nextSource: string, nextVersion: number) => {
      currentSource = nextSource;
      document.version = nextVersion;
    }
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

const createBridge = () => ({
  start: vi.fn(() => ({ type: "referencePickStartRequest" })),
  handleResult: vi.fn(async () => "started"),
  cancel: vi.fn(),
  dispose: vi.fn(),
  activeRequest: vi.fn(),
  isApplying: vi.fn(() => false),
  appliedHandoff: vi.fn(() => null)
});

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
  mocks.showErrorMessage.mockReset();
  mocks.showErrorMessage.mockResolvedValue(undefined);
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

  it("keeps Palette execution fail-closed and explains a non-pickable Source caret", async () => {
    const editor = createEditor();
    editor.selection = { active: { offset: 0 } };
    mocks.activeTextEditor = editor;
    const languageSession = createLanguageAnalysisSession(source);
    const ensureCanvas = vi.fn();
    const feature = registerVscodeReferencePickFeature({
      languageAnalysisSessionFor: () => languageSession,
      ensureCanvas
    });

    const command = mocks.commands.get(VSCODE_REFERENCE_PICK_COMMAND_ID);
    if (!command) throw new Error("reference pick command was not registered");
    await command();

    expect(ensureCanvas).not.toHaveBeenCalled();
    expect(mocks.bridgeFactory).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "nuinuiCAD: Source Editorのカーソル位置にCanvasから選択できる参照先がありません。"
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
    const bridge = createBridge();
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
    const bridge = createBridge();
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

  it("cancels an active Canvas Pick when Source changes after the bridge starts", async () => {
    const editor = createEditor();
    mocks.activeTextEditor = editor;
    mocks.showTextDocument.mockResolvedValue(editor);
    const languageSession = createLanguageAnalysisSession(source);
    const { panel, webviewListeners } = createPanel();
    const bridge = createBridge();
    mocks.bridgeFactory.mockReturnValue(bridge);
    const feature = registerVscodeReferencePickFeature({
      languageAnalysisSessionFor: () => languageSession,
      ensureCanvas: async () => ({
        document: editor.document,
        panel,
        isAuthoritativeReady: () => true
      }) as never
    });

    const command = mocks.commands.get(VSCODE_REFERENCE_PICK_COMMAND_ID);
    if (!command) throw new Error("reference pick command was not registered");
    await command();
    expect(bridge.start).toHaveBeenCalledTimes(1);
    expect(webviewListeners).toHaveLength(1);

    for (const listener of [...mocks.documentChangeListeners]) {
      listener({ document: editor.document, contentChanges: [{}] });
    }

    expect(bridge.cancel).toHaveBeenCalledTimes(1);
    expect(webviewListeners).toHaveLength(0);

    feature.dispose();
  });

  it("restores a fresh Pick on the matching native Undo and closes it on Redo", async () => {
    const { editor, setDocument } = createMutableEditor();
    mocks.activeTextEditor = editor;
    mocks.showTextDocument.mockResolvedValue(editor);
    const languageSession = createLanguageAnalysisSession(source);
    const { panel, webviewListeners } = createPanel();
    const bridge = createBridge();
    const restoredBridge = createBridge();
    bridge.handleResult
      .mockResolvedValueOnce("started")
      .mockResolvedValueOnce("applied");
    const targetProof = {
      sourceAnchor: {
        statementIndex: 3,
        statementRange: { from: 0, to: source.length, startLine: 0, endLine: 6 }
      },
      expectedGeometryInterface: "line",
      role: "geometry",
      multiplicity: "single",
      range: { from: source.indexOf("@A", source.indexOf("offset")), to: source.indexOf("@A", source.indexOf("offset")) + 2 },
      oldText: "@A"
    } as const;
    const postSource = source.replace("from: @A", "from: @C");
    bridge.appliedHandoff.mockReturnValue({
      documentUri: editor.document.uri.toString(),
      documentVersion: 8,
      preConfirmSource: source,
      postConfirmSource: postSource,
      normalizedSourceOffset: editor.selection.active.offset,
      targetProof,
      references: [{ base: "C" }]
    });
    mocks.bridgeFactory
      .mockReturnValueOnce(bridge)
      .mockReturnValueOnce(restoredBridge);
    const feature = registerVscodeReferencePickFeature({
      languageAnalysisSessionFor: () => languageSession,
      ensureCanvas: async () => ({
        document: editor.document,
        panel,
        isAuthoritativeReady: () => true
      }) as never
    });

    const command = mocks.commands.get(VSCODE_REFERENCE_PICK_COMMAND_ID);
    if (!command) throw new Error("reference pick command was not registered");
    await command();
    const initialListener = webviewListeners[0];
    if (!initialListener) throw new Error("initial webview listener was not installed");
    initialListener({ type: "referencePickResult", status: "started" });
    await flush();

    bridge.isApplying.mockReturnValue(true);
    for (const listener of [...mocks.documentChangeListeners]) {
      listener({ document: editor.document, contentChanges: [{}] });
    }
    expect(bridge.cancel).not.toHaveBeenCalled();
    bridge.isApplying.mockReturnValue(false);

    setDocument(postSource, 8);
    initialListener({ type: "referencePickResult", status: "confirmed" });
    await flush();
    expect(bridge.appliedHandoff).toHaveBeenCalledTimes(1);
    expect(webviewListeners).toHaveLength(0);

    setDocument(source, 9);
    for (const listener of [...mocks.documentChangeListeners]) {
      listener({
        document: editor.document,
        contentChanges: [{}],
        reason: 1
      });
    }
    await flush();

    expect(restoredBridge.start).toHaveBeenCalledTimes(1);
    expect(mocks.bridgeFactory.mock.calls[1]?.[0]).toMatchObject({
      requestId: 2,
      normalizedSourceOffset: editor.selection.active.offset,
      initialDraftReferences: [{ base: "C" }],
      expectedTargetProof: targetProof
    });
    expect(webviewListeners).toHaveLength(1);

    setDocument(postSource, 10);
    for (const listener of [...mocks.documentChangeListeners]) {
      listener({
        document: editor.document,
        contentChanges: [{}],
        reason: 2
      });
    }

    expect(restoredBridge.cancel).toHaveBeenCalledTimes(1);
    expect(webviewListeners).toHaveLength(0);

    feature.dispose();
  });
});
