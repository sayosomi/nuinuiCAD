import { beforeEach, describe, expect, it, vi } from "vitest";
import { compileDslDocument, createModuleRuntimeContext } from "@nuinuicad/nui-language";
import {
  analyzeMultiDocumentModuleSemantics,
  buildMultiDocumentImportGraph,
  documentIdFromHost,
  moduleDeclarationContributor,
  savedSourceFingerprintFromHost,
  type DependencySavedSourceSnapshot,
  type RootCurrentSourceSnapshot
} from "@nuinuicad/nui-language/workspace";
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
  multiDocumentHost: null as {
    languageSemanticSnapshotFor: (document: TestDocument) => Promise<unknown>;
  } | null,
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

vi.mock("./multiDocumentHost", () => ({
  activeVscodeMultiDocumentHost: () => mocks.multiDocumentHost
}));

import {
  registerVscodeReferencePickFeature,
  revealInCanvasSourceTargetForEditor,
  sourceTargetAvailabilityForEditorAsync,
  VSCODE_REFERENCE_PICK_COMMAND_ID,
  VSCODE_REFERENCE_PICK_CONTEXT_KEY
} from "./referencePickCommandFeature";

const source = [
  "nui 1",
  "point A = coordinate(x: 0, y: 0)",
  "point B = coordinate(x: 10, y: 0)",
  "point P = offset(from: @A, dx: 0, dy: 0)"
].join("\n");

const createEditorForSource = (documentSource: string, offset: number): TestEditor => {
  const document: TestDocument = {
    version: 7,
    fileName: "/tmp/pick.nui",
    uri: { scheme: "file", toString: () => "file:///tmp/pick.nui" },
    getText: () => documentSource,
    offsetAt: (position) => position.offset
  };
  return {
    document,
    selection: {
      active: { offset }
    },
    viewColumn: 1
  };
};

const createEditor = (): TestEditor => createEditorForSource(
  source,
  source.indexOf("@A", source.indexOf("offset")) + 1
);

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

const importedCallerLibrarySource = [
  "nui 1",
  "export module Panel(value: number) {",
  "  point P = coordinate(x: @value, y: 0)",
  "}"
].join("\n");

const graphSemanticSnapshotFor = async (
  editor: TestEditor,
  session: ReturnType<typeof createLanguageAnalysisSession>,
  graphRevision = 9
): Promise<{
  documentVersion: number;
  rootDocumentId: string;
  graphRevision: number;
  sourceRevision: number;
  sourceText: string;
  compiled: ReturnType<typeof compileDslDocument>;
}> => {
  const root: RootCurrentSourceSnapshot = {
    kind: "root-current",
    documentId: documentIdFromHost(editor.document.uri.toString()),
    normalizedSource: editor.document.getText(),
    sourceRevision: session.getSourceRevision()
  };
  const library: DependencySavedSourceSnapshot = {
    kind: "dependency-saved",
    documentId: documentIdFromHost("file:///tmp/library.nui"),
    savedSourceFingerprint: savedSourceFingerprintFromHost("sha256:reference-pick-library"),
    normalizedSource: importedCallerLibrarySource
  };
  const graph = await buildMultiDocumentImportGraph({
    root,
    loader: {
      loadSavedDependency: async (importerDocumentId, importPath) =>
        importerDocumentId === root.documentId && importPath === "./library.nui"
          ? { status: "loaded", snapshot: library }
          : { status: "failed", reason: "missing" }
    },
    declarationContributors: [moduleDeclarationContributor]
  });
  const analysis = analyzeMultiDocumentModuleSemantics(graph);
  const moduleRuntimeContext = createModuleRuntimeContext(graph, analysis);
  const rootNode = graph.nodes.get(root.documentId);
  if (!rootNode) throw new Error("missing imported graph root");
  const compiled = compileDslDocument(root.normalizedSource, {
    preparsed: rootNode.artifact.parsed,
    sourceRevision: root.sourceRevision,
    assignedStatementIds: rootNode.artifact.statementIdByStatementIndex,
    moduleRuntimeContext
  });
  if (!graph.valid || !analysis.valid || !moduleRuntimeContext.valid || !compiled.moduleMaterialization) {
    throw new Error("missing genuine imported Module graph materialization");
  }
  return {
    documentVersion: editor.document.version,
    rootDocumentId: editor.document.uri.toString(),
    graphRevision,
    sourceRevision: root.sourceRevision,
    sourceText: root.normalizedSource,
    compiled
  };
};

const graphRequiredLocalSessionFor = async (
  editor: TestEditor,
  source: string
): Promise<ReturnType<typeof createLanguageAnalysisSession>> => {
  const session = createLanguageAnalysisSession(source);
  const graphSnapshot = await graphSemanticSnapshotFor(editor, session);
  const sessionDocument = (session as unknown as {
    document: { getState: () => { doc: unknown; currentCompiled: unknown } };
  }).document;
  const state = sessionDocument.getState() as {
    doc: typeof graphSnapshot.compiled;
    currentCompiled: typeof graphSnapshot.compiled;
  };
  state.doc = graphSnapshot.compiled;
  state.currentCompiled = graphSnapshot.compiled;
  return session;
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
  mocks.showErrorMessage.mockReset();
  mocks.showErrorMessage.mockResolvedValue(undefined);
  mocks.activeTextEditor = undefined;
  mocks.activeEditorListeners = [];
  mocks.selectionListeners = [];
  mocks.documentChangeListeners = [];
  mocks.documentCloseListeners = [];
  mocks.multiDocumentHost = null;
  mocks.bridgeFactory.mockReset();
});

describe("registerVscodeReferencePickFeature", () => {
  it("publishes Reveal availability from the exact graph semantic snapshot for an imported caller", async () => {
    const moduleSource = [
      "nui 1",
      "import \"./library.nui\" as lib",
      "instance Direct = lib::Panel(value: 20)"
    ].join("\n");
    const editor = createEditorForSource(moduleSource, moduleSource.indexOf("Direct"));
    mocks.activeTextEditor = editor;
    const languageSession = createLanguageAnalysisSession(moduleSource);
    const semanticSnapshot = await graphSemanticSnapshotFor(editor, languageSession);
    mocks.multiDocumentHost = {
      languageSemanticSnapshotFor: vi.fn(async () => semanticSnapshot)
    };

    const materialized = semanticSnapshot.compiled.moduleMaterialization!.executionStatements;
    const rootDirect = materialized.find((entry) =>
      entry.type === "moduleInstance" &&
      entry.sourceStatementIndex === 2 &&
      String(entry.origin?.sourceDocumentId) === semanticSnapshot.rootDocumentId
    );
    const dependencyCollision = materialized.find((entry) =>
      entry.sourceStatementIndex === 2 &&
      String(entry.origin?.sourceDocumentId) === "file:///tmp/library.nui"
    );
    expect(rootDirect).toBeDefined();
    expect(dependencyCollision).toBeDefined();
    expect(rootDirect!.runtimeElementId).not.toBe(dependencyCollision!.runtimeElementId);

    const resolved = await revealInCanvasSourceTargetForEditor(editor, languageSession);
    expect(resolved.status).toBe("resolved");
    if (resolved.status !== "resolved") return;
    expect(resolved.value.target).toEqual({
      kind: "statement-owner",
      sourceStatementIndex: 2
    });
    expect(resolved.value.runtimeProjection).toEqual({
      candidates: [rootDirect!.runtimeElementId]
    });
    expect(resolved.value.runtimeProjection!.candidates).toHaveLength(1);
    expect(resolved.value.runtimeProjection!.candidates).toContain(rootDirect!.runtimeElementId);
    expect(resolved.value.runtimeProjection!.candidates).not.toContain(dependencyCollision!.runtimeElementId);
    expect(resolved.value.graphRevision).not.toBeNull();
    await expect(sourceTargetAvailabilityForEditorAsync(editor, languageSession)).resolves.toMatchObject({
      revealInCanvas: true
    });

    const feature = registerVscodeReferencePickFeature({
      languageAnalysisSessionFor: () => languageSession,
      ensureCanvas: () => null
    });

    await vi.waitFor(() => {
      expect(mocks.executeCommand).toHaveBeenCalledWith(
        "setContext",
        "nuinuiCAD.revealInCanvasSourceTarget",
        true
      );
    });
    feature.dispose();
  });

  it("keeps a graph-required Reveal target unavailable when the graph semantic snapshot is unusable", async () => {
    const moduleSource = [
      "nui 1",
      "import \"./library.nui\" as lib",
      "instance Direct = lib::Panel(value: 20)"
    ].join("\n");
    const editor = createEditorForSource(moduleSource, moduleSource.indexOf("Direct"));
    mocks.activeTextEditor = editor;
    const languageSession = await graphRequiredLocalSessionFor(editor, moduleSource);
    mocks.multiDocumentHost = {
      languageSemanticSnapshotFor: vi.fn(async () => null)
    };
    const feature = registerVscodeReferencePickFeature({
      languageAnalysisSessionFor: () => languageSession,
      ensureCanvas: () => null
    });

    await flush();
    const revealContextValues = mocks.executeCommand.mock.calls
      .filter(([command, key]) => command === "setContext" && key === "nuinuiCAD.revealInCanvasSourceTarget")
      .map(([, , value]) => value);
    expect(revealContextValues.at(-1)).toBe(false);
    feature.dispose();
  });

  it("does not let a stale graph availability result overwrite a newer Source context", async () => {
    const moduleSource = [
      "nui 1",
      "import \"./library.nui\" as lib",
      "instance Direct = lib::Panel(value: 20)"
    ].join("\n");
    const editor = createEditorForSource(moduleSource, moduleSource.indexOf("Direct"));
    mocks.activeTextEditor = editor;
    const languageSession = createLanguageAnalysisSession(moduleSource);
    const resolvers: Array<(snapshot: unknown) => void> = [];
    mocks.multiDocumentHost = {
      languageSemanticSnapshotFor: vi.fn(() => new Promise((resolve) => resolvers.push(resolve)))
    };
    const feature = registerVscodeReferencePickFeature({
      languageAnalysisSessionFor: () => languageSession,
      ensureCanvas: () => null
    });

    editor.selection = { active: { offset: 0 } };
    for (const listener of [...mocks.selectionListeners]) listener({ textEditor: editor });
    await flush();
    const staleSnapshot = await graphSemanticSnapshotFor(editor, languageSession);
    resolvers[0]?.(staleSnapshot);
    await flush();

    expect(mocks.executeCommand).toHaveBeenCalledWith(
      "setContext",
      "nuinuiCAD.revealInCanvasSourceTarget",
      false
    );
    feature.dispose();
  });

  it("projects the Reference Pick context for a final empty Module geometry argument without a trailing comma", async () => {
    const moduleSource = [
      "nui 1",
      "module M(broad: path) {",
      "}",
      "instance X = M(broad: )"
    ].join("\n");
    const position = moduleSource.lastIndexOf("broad: ") + "broad: ".length;
    const editor = createEditorForSource(moduleSource, position);
    mocks.activeTextEditor = editor;
    const languageSession = createLanguageAnalysisSession(moduleSource);
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

    feature.dispose();
  });

  it("projects the Reference Pick context for multiline final empty Module geometry arguments with or without a trailing comma", async () => {
    for (const argumentLine of ["broad: ", "broad: ,"]) {
      const moduleSource = [
        "nui 1",
        "module M(broad: path) {",
        "}",
        "instance X = M(",
        argumentLine,
        ")"
      ].join("\n");
      const position = moduleSource.lastIndexOf("broad: ") + "broad: ".length;
      const editor = createEditorForSource(moduleSource, position);
      mocks.activeTextEditor = editor;
      const languageSession = createLanguageAnalysisSession(moduleSource);
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

      feature.dispose();
      mocks.executeCommand.mockClear();
    }
  });

  it("keeps the Reference Pick context enabled across a complete existing numeric-property occurrence", async () => {
    const numericSource = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "point P = offset(from: @A, dx: @Base.length, dy: 0)"
    ].join("\n");
    const occurrence = numericSource.indexOf("@Base.length");
    const editor = createEditorForSource(numericSource, occurrence + 1);
    mocks.activeTextEditor = editor;
    const languageSession = createLanguageAnalysisSession(numericSource);
    const feature = registerVscodeReferencePickFeature({
      languageAnalysisSessionFor: () => languageSession,
      ensureCanvas: () => null
    });

    for (const offset of [occurrence + 1, occurrence + "@Base".length, occurrence + "@Base.".length + 2]) {
      editor.selection = { active: { offset } };
      for (const listener of [...mocks.selectionListeners]) listener({ textEditor: editor });
      await flush();
      expect(mocks.executeCommand).toHaveBeenLastCalledWith(
        "setContext",
        VSCODE_REFERENCE_PICK_CONTEXT_KEY,
        true
      );
    }

    feature.dispose();
  });

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
      "nuinuiCAD: There is no reference target that can be selected from Canvas at the current Source caret position."
    );

    feature.dispose();
  });

  it("uses Japanese copy for the same non-pickable Source caret", async () => {
    const editor = createEditor();
    editor.selection = { active: { offset: 0 } };
    mocks.activeTextEditor = editor;
    const languageSession = createLanguageAnalysisSession(source);
    const feature = registerVscodeReferencePickFeature({
      languageAnalysisSessionFor: () => languageSession,
      ensureCanvas: vi.fn(),
      displayLanguageFor: () => "ja-JP"
    });

    await mocks.commands.get(VSCODE_REFERENCE_PICK_COMMAND_ID)?.();

    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "nuinuiCAD: 現在の Source のキャレット位置には、Canvas から選択できる参照先がありません。"
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
