import { beforeEach, describe, expect, it, vi } from "vitest";
import * as nuiLanguage from "@nuinuicad/nui-language";
import { compileDslDocument, createModuleRuntimeContext, queryDslReferencePickTarget } from "@nuinuicad/nui-language";
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
import { referencePickTargetProofFor } from "../../src/vscode/referencePickProtocol";
import { buildEvaluationOptions } from "../../src/geometry/productionEvaluationContext";
import { evaluateElementsReference } from "../../src/geometry/evaluationEngine";
import { evaluationResultToPayload } from "../../src/geometry/evaluationPayload";

const mocks = vi.hoisted(() => ({
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  executeCommand: vi.fn(),
  showTextDocument: vi.fn(),
  showErrorMessage: vi.fn(),
  showQuickPick: vi.fn(),
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
    showQuickPick: mocks.showQuickPick,
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
  sourceTargetAvailabilityForEditor,
  sourceTargetAvailabilityForEditorAsync,
  VSCODE_REFERENCE_PICK_COMMAND_ID,
  VSCODE_REFERENCE_PICK_CONTEXT_KEY,
  VSCODE_REVEAL_IN_CANVAS_SOURCE_TARGET_CONTEXT_KEY
} from "./referencePickCommandFeature";

const source = [
  "nui 1",
  "point A = coordinate(x: 0, y: 0)",
  "point B = coordinate(x: 10, y: 0)",
  "point P = offset(from: A, dx: 0, dy: 0)"
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
  source.indexOf("A", source.indexOf("offset"))
);

const createMutableEditor = (initialSource = source) => {
  let currentSource = initialSource;
  const document: TestDocument = {
    version: 7,
    fileName: "/tmp/pick.nui",
    uri: { scheme: "file", toString: () => "file:///tmp/pick.nui" },
    getText: () => currentSource,
    offsetAt: (position) => position.offset
  };
  const editor: TestEditor = {
    document,
    selection: { active: { offset: initialSource.lastIndexOf("from: A") + "from: ".length } },
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
  "  point P = coordinate(x: value, y: 0)",
  "}"
].join("\n");

const graphSemanticSnapshotFor = async (
  editor: TestEditor,
  session: ReturnType<typeof createLanguageAnalysisSession>,
  graphRevision = 9,
  identity?: { sourceDocumentUri: string; rootDocumentId: string }
): Promise<{
  documentVersion: number;
  sourceDocumentUri: string;
  rootDocumentId: string;
  graphRevision: number;
  sourceRevision: number;
  sourceText: string;
  compiled: ReturnType<typeof compileDslDocument>;
}> => {
  const sourceDocumentUri = identity?.sourceDocumentUri ?? editor.document.uri.toString();
  const root: RootCurrentSourceSnapshot = {
    kind: "root-current",
    documentId: documentIdFromHost(identity?.rootDocumentId ?? sourceDocumentUri),
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
    sourceDocumentUri,
    rootDocumentId: String(root.documentId),
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

const deferredFor = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

beforeEach(() => {
  mocks.commands.clear();
  mocks.executeCommand.mockReset();
  mocks.executeCommand.mockResolvedValue(undefined);
  mocks.showTextDocument.mockReset();
  mocks.showErrorMessage.mockReset();
  mocks.showQuickPick.mockReset();
  mocks.showQuickPick.mockResolvedValue(undefined);
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
  it("#1538 A: transports the authored valid prefix from the real Source command", async () => {
    const text = "nui 1\nline A = segment(start: (0, 0), end: (10, 0))\nline B = segment(start: (0, 10), end: (10, 10))\nmove [A, ](from: (0, 0), to: (1, 0))";
    const editor = createEditorForSource(text, text.indexOf(", ]") + 2);
    mocks.activeTextEditor = editor;
    mocks.showTextDocument.mockResolvedValue(editor);
    const languageSession = createLanguageAnalysisSession(text);
    const { panel } = createPanel();
    const bridge = createBridge();
    mocks.bridgeFactory.mockReturnValue(bridge);
    const feature = registerVscodeReferencePickFeature({
      languageAnalysisSessionFor: () => languageSession,
      ensureCanvas: () => ({ document: editor.document, panel, isAuthoritativeReady: () => true })
    });
    await mocks.commands.get(VSCODE_REFERENCE_PICK_COMMAND_ID)?.();
    expect(mocks.bridgeFactory).toHaveBeenCalledWith(expect.objectContaining({
      initialDraftReferences: [{ base: "A" }],
      expectedTargetProof: expect.objectContaining({ oldText: "[A, ]" })
    }));
    feature.dispose();
  });

  it("#1714 keeps the qualified Source spelling in the Host seed until Canvas confirmation", async () => {
    const text = `nui 1
group Outer {
  point Anchor = coordinate(x: 0, y: 0)
  point Other = coordinate(x: 10, y: 0)
  group Inner {
    line L = segment(start: Outer::Anchor, end: Outer::Other)
  }
}
`;
    const editor = createEditorForSource(text, text.indexOf("end: Outer::Other") + "end: ".length + 1);
    mocks.activeTextEditor = editor;
    mocks.showTextDocument.mockResolvedValue(editor);
    const languageSession = createLanguageAnalysisSession(text);
    const { panel } = createPanel();
    const bridge = createBridge();
    mocks.bridgeFactory.mockReturnValue(bridge);
    const feature = registerVscodeReferencePickFeature({
      languageAnalysisSessionFor: () => languageSession,
      ensureCanvas: () => ({ document: editor.document, panel, isAuthoritativeReady: () => true })
    });

    await mocks.commands.get(VSCODE_REFERENCE_PICK_COMMAND_ID)?.();

    expect(mocks.bridgeFactory).toHaveBeenCalledWith(expect.objectContaining({
      initialDraftReferences: [{ base: "Outer::Other" }],
      expectedTargetProof: expect.objectContaining({ oldText: "Outer::Other" })
    }));
    feature.dispose();
  });

  it.each(["edge", "extend", "move", "mirrorMove", "reverse"])("starts the shared host Pick for completed and unfinished %s targets", async (operation) => {
    const args = operation === "extend" ? "to: (20, 0)" : operation === "move" ? "from: (0, 0), to: (1, 0)" :
      operation === "mirrorMove" ? "axis1: (0, 0), axis2: (0, 1)" : operation === "edge" ? "index: 0" : "";
    const completed = operation === "edge" ? "[A.end, B.start]" : operation === "extend" ? "A.end" : "A";
    const prefixReference = operation === "edge" || operation === "extend" ? "A.end" : "A";
    for (const header of [completed, "", " ", `[${prefixReference}, ]`, `[${prefixReference}, `]) {
      mocks.bridgeFactory.mockClear();
      const prefix = "nui 1\nline A = segment(start: (0, 0), end: (10, 0))\nline B = segment(start: (10, -10), end: (10, 10))\n";
      const text = `${prefix}${operation} ${header}(${args})`;
      const offset = prefix.length + operation.length + 1 + header.length;
      const editor = createEditorForSource(text, offset);
      mocks.activeTextEditor = editor;
      mocks.showTextDocument.mockResolvedValue(editor);
      const languageSession = createLanguageAnalysisSession(text);
      const { panel } = createPanel();
      const bridge = createBridge();
      mocks.bridgeFactory.mockReturnValue(bridge);
      const feature = registerVscodeReferencePickFeature({
        languageAnalysisSessionFor: () => languageSession,
        ensureCanvas: () => ({ document: editor.document, panel, isAuthoritativeReady: () => true })
      });
      await mocks.commands.get(VSCODE_REFERENCE_PICK_COMMAND_ID)?.();
      expect(bridge.start, `${operation} ${header}`).toHaveBeenCalledTimes(1);
      expect(mocks.bridgeFactory).toHaveBeenCalledWith(expect.objectContaining({
        expectedTargetProof: expect.objectContaining({ syntax: "transformationTarget", oldText: header.trimEnd() })
      }));
      feature.dispose();
    }
  });
  it("projects Reveal availability at a completed statement's physical EOL", () => {
    const eolSource = [
      "nui 1",
      "point P = coordinate(x: 10, y: 20)   "
    ].join("\n");
    const editor = createEditorForSource(eolSource, eolSource.length);
    const languageSession = createLanguageAnalysisSession(eolSource);

    expect(sourceTargetAvailabilityForEditor(editor, languageSession)).toMatchObject({
      revealInCanvas: true
    });
  });

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

  it("does not enumerate Pick targets or recompute local availability for an identical editor revision and selection", async () => {
    const editor = createEditor();
    mocks.activeTextEditor = editor;
    const languageSession = createLanguageAnalysisSession(source);
    const pickResolution = vi.spyOn(nuiLanguage, "queryDslReferencePickTargetResolution");
    const revealQuery = vi.spyOn(nuiLanguage, "queryDslCanvasRevealSourceTarget");
    const bakeQuery = vi.spyOn(nuiLanguage, "queryDslCanvasSourceTarget");
    const outputRevealQuery = vi.spyOn(nuiLanguage, "queryDslOutputPreviewRevealSourceTarget");
    const feature = registerVscodeReferencePickFeature({
      languageAnalysisSessionFor: () => languageSession,
      ensureCanvas: () => null
    });

    await flush();
    expect(pickResolution).not.toHaveBeenCalled();
    expect(revealQuery).toHaveBeenCalledTimes(1);
    expect(bakeQuery).toHaveBeenCalledTimes(1);
    expect(outputRevealQuery).toHaveBeenCalledTimes(1);
    expect(mocks.executeCommand.mock.calls.filter(([command]) => command === "setContext")).toHaveLength(4);

    for (const listener of [...mocks.selectionListeners]) listener({ textEditor: editor });
    await flush();

    expect(pickResolution).not.toHaveBeenCalled();
    expect(revealQuery).toHaveBeenCalledTimes(1);
    expect(bakeQuery).toHaveBeenCalledTimes(1);
    expect(outputRevealQuery).toHaveBeenCalledTimes(1);
    expect(mocks.executeCommand.mock.calls.filter(([command]) => command === "setContext")).toHaveLength(4);

    feature.dispose();
    pickResolution.mockRestore();
    revealQuery.mockRestore();
    bakeQuery.mockRestore();
    outputRevealQuery.mockRestore();
  });

  it("discards graph availability after a Source revision changes while the graph request is pending", async () => {
    const moduleSource = [
      "nui 1",
      "import \"./library.nui\" as lib",
      "instance Direct = lib::Panel(value: 20)"
    ].join("\n");
    const { editor, setDocument } = createMutableEditor(moduleSource);
    editor.selection = { active: { offset: moduleSource.indexOf("Direct") } };
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

    await flush();
    expect(resolvers).toHaveLength(1);
    const staleSnapshot = await graphSemanticSnapshotFor(editor, languageSession);

    const editedSource = `${moduleSource}\n// newer source revision`;
    setDocument(editedSource, editor.document.version + 1);
    for (const listener of [...mocks.documentChangeListeners]) {
      listener({ document: editor.document, contentChanges: [{}] });
    }
    await flush();
    expect(resolvers).toHaveLength(2);
    const currentSnapshot = await graphSemanticSnapshotFor(editor, languageSession);
    resolvers[1]?.(currentSnapshot);
    await flush();
    resolvers[0]?.(staleSnapshot);
    await flush();

    const revealValues = mocks.executeCommand.mock.calls
      .filter(([command, key]) => command === "setContext" && key === "nuinuiCAD.revealInCanvasSourceTarget")
      .map(([, , value]) => value);
    expect(revealValues.at(-1)).toBe(true);
    expect(revealValues.filter((value) => value === true)).toHaveLength(1);

    feature.dispose();
  });

  it("discards graph availability after the active Source editor changes", async () => {
    const importedSource = [
      "nui 1",
      "import \"./library.nui\" as lib",
      "instance Direct = lib::Panel(value: 20)"
    ].join("\n");
    const importedEditor = createEditorForSource(importedSource, importedSource.indexOf("Direct"));
    const inactiveSource = "nui 1\n// no reveal target";
    const inactiveEditor = createEditorForSource(inactiveSource, 0);
    const importedSession = createLanguageAnalysisSession(importedSource);
    const inactiveSession = createLanguageAnalysisSession(inactiveSource);
    mocks.activeTextEditor = importedEditor;
    const resolvers: Array<(snapshot: unknown) => void> = [];
    mocks.multiDocumentHost = {
      languageSemanticSnapshotFor: vi.fn(() => new Promise((resolve) => resolvers.push(resolve)))
    };
    const feature = registerVscodeReferencePickFeature({
      languageAnalysisSessionFor: (document) =>
        document === importedEditor.document ? importedSession : inactiveSession,
      ensureCanvas: () => null
    });

    await flush();
    expect(resolvers).toHaveLength(1);
    const staleSnapshot = await graphSemanticSnapshotFor(importedEditor, importedSession);
    mocks.activeTextEditor = inactiveEditor;
    for (const listener of [...mocks.activeEditorListeners]) listener(inactiveEditor);
    await flush();
    resolvers[0]?.(staleSnapshot);
    await flush();

    const revealValues = mocks.executeCommand.mock.calls
      .filter(([command, key]) => command === "setContext" && key === "nuinuiCAD.revealInCanvasSourceTarget")
      .map(([, , value]) => value);
    expect(revealValues.at(-1)).toBe(false);
    expect(revealValues).not.toContain(true);

    feature.dispose();
  });

  it.each(["Source invalidation", "active editor switching"])(
    "reapplies the latest false context after an obsolete true write completes (%s)",
    async (invalidation) => {
      const importedSource = [
        "nui 1",
        "import \"./library.nui\" as lib",
        "instance Direct = lib::Panel(value: 20)"
      ].join("\n");
      const inactiveSource = "nui 1\n// no reveal target";
      const mutable = invalidation === "Source invalidation"
        ? createMutableEditor(importedSource)
        : null;
      const importedEditor = mutable?.editor ?? createEditorForSource(importedSource, importedSource.indexOf("Direct"));
      importedEditor.selection = { active: { offset: importedSource.indexOf("Direct") } };
      const inactiveEditor = createEditorForSource(inactiveSource, 0);
      const importedSession = createLanguageAnalysisSession(importedSource);
      const inactiveSession = createLanguageAnalysisSession(inactiveSource);
      mocks.activeTextEditor = importedEditor;
      const graphResolvers: Array<(snapshot: unknown) => void> = [];
      mocks.multiDocumentHost = {
        languageSemanticSnapshotFor: vi.fn(() => new Promise((resolve) => graphResolvers.push(resolve)))
      };
      const revealWrite = deferredFor<void>();
      const revealWriteOrder: string[] = [];
      mocks.executeCommand.mockImplementation((command, contextKey, value) => {
        if (command === "setContext" && contextKey === VSCODE_REVEAL_IN_CANVAS_SOURCE_TARGET_CONTEXT_KEY) {
          if (value === true) {
            revealWriteOrder.push("start:true");
            return revealWrite.promise.then(() => {
              revealWriteOrder.push("complete:true");
            });
          }
          if (value === false) revealWriteOrder.push("write:false");
        }
        return Promise.resolve(undefined);
      });
      const feature = registerVscodeReferencePickFeature({
        languageAnalysisSessionFor: (document) =>
          document === importedEditor.document ? importedSession : inactiveSession,
        ensureCanvas: () => null
      });

      try {
        await flush();
        expect(graphResolvers).toHaveLength(1);
        expect(mocks.executeCommand.mock.calls.filter(([command]) => command === "setContext")).toHaveLength(4);
        revealWriteOrder.length = 0;

        const graphSnapshot = await graphSemanticSnapshotFor(importedEditor, importedSession);
        graphResolvers[0]?.(graphSnapshot);
        await vi.waitFor(() => expect(revealWriteOrder).toEqual(["start:true"]));
        expect(mocks.executeCommand.mock.calls
          .filter(([command, key]) => command === "setContext" && key === VSCODE_REVEAL_IN_CANVAS_SOURCE_TARGET_CONTEXT_KEY)
          .map(([, , value]) => value)).toEqual([false, true]);
        for (const listener of [...mocks.selectionListeners]) listener({ textEditor: importedEditor });
        await flush();
        expect(revealWriteOrder).toEqual(["start:true"]);

        if (mutable) {
          mutable.setDocument(inactiveSource, importedEditor.document.version + 1);
          importedEditor.selection = { active: { offset: 0 } };
          for (const listener of [...mocks.documentChangeListeners]) {
            listener({ document: importedEditor.document, contentChanges: [{}] });
          }
        } else {
          mocks.activeTextEditor = inactiveEditor;
          for (const listener of [...mocks.activeEditorListeners]) listener(inactiveEditor);
        }
        await flush();
        expect(revealWriteOrder).toEqual(["start:true"]);

        revealWrite.resolve(undefined);
        await vi.waitFor(() => expect(revealWriteOrder).toEqual([
          "start:true",
          "complete:true",
          "write:false"
        ]));
        await vi.waitFor(() => expect(mocks.executeCommand.mock.calls
          .filter(([command]) => command === "setContext")).toHaveLength(12));
        const revealValues = mocks.executeCommand.mock.calls
          .filter(([command, key]) => command === "setContext" && key === VSCODE_REVEAL_IN_CANVAS_SOURCE_TARGET_CONTEXT_KEY)
          .map(([, , value]) => value);
        expect(revealValues).toEqual([false, true, false]);
      } finally {
        revealWrite.resolve(undefined);
        feature.dispose();
      }
    }
  );

  it("recomputes context availability when incomplete Source becomes valid", async () => {
    const incompleteSource = "nui 1\npoint P = coordinate(x: 10, y: ";
    const validSource = "nui 1\npoint P = coordinate(x: 10, y: 20)   ";
    const { editor, setDocument } = createMutableEditor(incompleteSource);
    editor.selection = { active: { offset: incompleteSource.length } };
    mocks.activeTextEditor = editor;
    const languageSession = createLanguageAnalysisSession(incompleteSource);
    const feature = registerVscodeReferencePickFeature({
      languageAnalysisSessionFor: () => languageSession,
      ensureCanvas: () => null
    });

    await flush();
    const initialRevealValues = mocks.executeCommand.mock.calls
      .filter(([command, key]) => command === "setContext" && key === "nuinuiCAD.revealInCanvasSourceTarget")
      .map(([, , value]) => value);
    expect(initialRevealValues.at(-1)).toBe(false);

    setDocument(validSource, editor.document.version + 1);
    editor.selection = { active: { offset: validSource.length } };
    for (const listener of [...mocks.documentChangeListeners]) {
      listener({ document: editor.document, contentChanges: [{}] });
    }
    await flush();
    expect(languageSession.getSource()).toBe(validSource);
    expect(sourceTargetAvailabilityForEditor(editor, languageSession)).toMatchObject({
      revealInCanvas: true
    });
    await vi.waitFor(() => expect(mocks.executeCommand).toHaveBeenCalledWith(
      "setContext",
      "nuinuiCAD.revealInCanvasSourceTarget",
      true
    ));
    const currentPickValues = mocks.executeCommand.mock.calls
      .filter(([command, key]) => command === "setContext" && key === VSCODE_REFERENCE_PICK_CONTEXT_KEY)
      .map(([, , value]) => value);
    expect(currentPickValues.at(-1)).toBe(true);
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
      "line Base = segment(start: A, end: B)",
      "point P = offset(from: A, dx: Base.length, dy: 0)"
    ].join("\n");
    const occurrence = numericSource.indexOf("Base.length");
    const editor = createEditorForSource(numericSource, occurrence + 1);
    mocks.activeTextEditor = editor;
    const languageSession = createLanguageAnalysisSession(numericSource);
    const feature = registerVscodeReferencePickFeature({
      languageAnalysisSessionFor: () => languageSession,
      ensureCanvas: () => null
    });

    for (const offset of [occurrence + 1, occurrence + "Base".length, occurrence + "Base.".length + 2]) {
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

  it("derives the Source context key from the supported file-backed Source surface", async () => {
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
      true
    );

    feature.dispose();
  });

  it("starts Browse from a Source caret without a target", async () => {
    const editor = createEditor();
    editor.selection = { active: { offset: 0 } };
    mocks.activeTextEditor = editor;
    const languageSession = createLanguageAnalysisSession(source);
    const { panel } = createPanel();
    const bridge = createBridge();
    mocks.bridgeFactory.mockReturnValue(bridge);
    mocks.showTextDocument.mockResolvedValue(editor);
    const ensureCanvas = vi.fn(() => ({ document: editor.document, panel, isAuthoritativeReady: () => true }));
    const feature = registerVscodeReferencePickFeature({
      languageAnalysisSessionFor: () => languageSession,
      ensureCanvas
    });

    const command = mocks.commands.get(VSCODE_REFERENCE_PICK_COMMAND_ID);
    if (!command) throw new Error("reference pick command was not registered");
    await command();

    expect(ensureCanvas).toHaveBeenCalledWith(editor.document);
    expect(mocks.bridgeFactory).toHaveBeenCalledWith(expect.objectContaining({ browse: true, normalizedSourceOffset: 0 }));
    expect(bridge.start).toHaveBeenCalledTimes(1);
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();

    feature.dispose();
  });

  it("resolves ambiguous same-line Source targets with native Quick Pick before Canvas", async () => {
    const ambiguousSource = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "point P = offset(from: A, dx: 0, dy: 0)"
    ].join("\n");
    const editor = createEditorForSource(ambiguousSource, ambiguousSource.lastIndexOf("point P"));
    mocks.activeTextEditor = editor;
    mocks.showTextDocument.mockResolvedValue(editor);
    const languageSession = createLanguageAnalysisSession(ambiguousSource);
    const { panel } = createPanel();
    const bridge = createBridge();
    mocks.bridgeFactory.mockReturnValue(bridge);
    mocks.showQuickPick.mockImplementation(async (items: readonly { target: unknown }[]) => items[1]);
    const ensureCanvas = vi.fn(() => ({
      document: editor.document,
      panel,
      isAuthoritativeReady: () => true
    }));
    const feature = registerVscodeReferencePickFeature({
      languageAnalysisSessionFor: () => languageSession,
      ensureCanvas
    });

    await mocks.commands.get(VSCODE_REFERENCE_PICK_COMMAND_ID)?.();

    expect(mocks.showQuickPick).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ label: "A" })]),
      expect.objectContaining({
        placeHolder: "Choose a Source target to pick from Canvas",
        matchOnDescription: true,
        matchOnDetail: true,
        ignoreFocusOut: true
      })
    );
    expect(ensureCanvas).toHaveBeenCalledTimes(1);
    expect(mocks.bridgeFactory).toHaveBeenCalledWith(expect.objectContaining({
      normalizedSourceOffset: ambiguousSource.indexOf("0", ambiguousSource.indexOf("dx:")),
      expectedTargetProof: expect.objectContaining({ oldText: "0" })
    }));
    expect(bridge.start).toHaveBeenCalledTimes(1);

    feature.dispose();
  });

  it("disambiguates duplicate numeric Quick Pick rows in source order and hands off the second range", async () => {
    const duplicateSource = [
      "nui 1",
      "const sum: number = 10 + 10"
    ].join("\n");
    const lineFrom = duplicateSource.indexOf("const sum");
    const first = duplicateSource.indexOf("10");
    const second = duplicateSource.indexOf("10", first + 1);
    const editor = createEditorForSource(duplicateSource, lineFrom);
    mocks.activeTextEditor = editor;
    mocks.showTextDocument.mockResolvedValue(editor);
    const languageSession = createLanguageAnalysisSession(duplicateSource);
    const { panel } = createPanel();
    const bridge = createBridge();
    mocks.bridgeFactory.mockReturnValue(bridge);
    let quickPickItems: ReadonlyArray<{
      label: string;
      description?: string;
      detail?: string;
      target: { range: { from: number; to: number } };
    }> = [];
    mocks.showQuickPick.mockImplementation(async (items: typeof quickPickItems) => {
      quickPickItems = items;
      return items[1];
    });
    const feature = registerVscodeReferencePickFeature({
      languageAnalysisSessionFor: () => languageSession,
      ensureCanvas: vi.fn(() => ({
        document: editor.document,
        panel,
        isAuthoritativeReady: () => true
      }))
    });

    await mocks.commands.get(VSCODE_REFERENCE_PICK_COMMAND_ID)?.();

    expect(quickPickItems).toHaveLength(2);
    expect(quickPickItems.map((item) => item.label)).toEqual(["10", "10"]);
    expect(quickPickItems.map((item) => item.description)).toEqual([
      expect.stringContaining("1/2"),
      expect.stringContaining("2/2")
    ]);
    expect(quickPickItems.map((item) => item.detail)).toEqual(["10", "10"]);
    expect(quickPickItems[0]?.target.range).toEqual({ from: first, to: first + 2 });
    expect(quickPickItems[1]?.target.range).toEqual({ from: second, to: second + 2 });
    expect(mocks.bridgeFactory).toHaveBeenCalledWith(expect.objectContaining({
      normalizedSourceOffset: second,
      expectedTargetProof: expect.objectContaining({
        range: { from: second, to: second + 2 },
        oldText: "10"
      })
    }));
    expect(bridge.start).toHaveBeenCalledTimes(1);
    feature.dispose();
  });

  it("enters Browse without choosing an operand when target choice is dismissed", async () => {
    const ambiguousSource = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point P = offset(from: A, dx: 0, dy: 0)"
    ].join("\n");
    const editor = createEditorForSource(ambiguousSource, ambiguousSource.lastIndexOf("point P"));
    mocks.activeTextEditor = editor;
    const languageSession = createLanguageAnalysisSession(ambiguousSource);
    const { panel } = createPanel();
    const bridge = createBridge();
    mocks.bridgeFactory.mockReturnValue(bridge);
    mocks.showTextDocument.mockResolvedValue(editor);
    const ensureCanvas = vi.fn(() => ({ document: editor.document, panel, isAuthoritativeReady: () => true }));
    const feature = registerVscodeReferencePickFeature({
      languageAnalysisSessionFor: () => languageSession,
      ensureCanvas
    });

    await mocks.commands.get(VSCODE_REFERENCE_PICK_COMMAND_ID)?.();

    expect(mocks.showQuickPick).toHaveBeenCalledTimes(1);
    expect(ensureCanvas).toHaveBeenCalledWith(editor.document);
    expect(mocks.bridgeFactory).toHaveBeenCalledWith(expect.objectContaining({ browse: true }));
    expect(bridge.start).toHaveBeenCalledTimes(1);
    feature.dispose();
  });

  it("hands an existing numeric property draft to Canvas for the exact Source operand", async () => {
    const numericSource = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: A, end: B)",
      "point P = offset(from: A, dx: Base.length, dy: 0)"
    ].join("\n");
    const propertyOffset = numericSource.indexOf("Base.length");
    const editor = createEditorForSource(numericSource, propertyOffset + 1);
    mocks.activeTextEditor = editor;
    mocks.showTextDocument.mockResolvedValue(editor);
    const languageSession = createLanguageAnalysisSession(numericSource);
    const { panel } = createPanel();
    const bridge = createBridge();
    mocks.bridgeFactory.mockReturnValue(bridge);
    const feature = registerVscodeReferencePickFeature({
      languageAnalysisSessionFor: () => languageSession,
      ensureCanvas: vi.fn(() => ({
        document: editor.document,
        panel,
        isAuthoritativeReady: () => true
      }))
    });

    await mocks.commands.get(VSCODE_REFERENCE_PICK_COMMAND_ID)?.();

    expect(mocks.bridgeFactory).toHaveBeenCalledWith(expect.objectContaining({
      normalizedSourceOffset: propertyOffset,
      initialNumericPropertyDraft: { reference: { base: "Base" }, property: "length" },
      expectedTargetProof: expect.objectContaining({ oldText: "Base.length" })
    }));
    expect(bridge.start).toHaveBeenCalledTimes(1);
    feature.dispose();
  });

  it("starts Canvas Pick from an own-line geometry target activated by indentation", async () => {
    const multilineSource = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "module M(anchor: point, distance: number) {",
      "}",
      "instance X = M(",
      "  anchor: A,",
      "  distance: 20,",
      ")"
    ].join("\n");
    const anchorLine = multilineSource.lastIndexOf("  anchor");
    const editor = createEditorForSource(multilineSource, anchorLine);
    mocks.activeTextEditor = editor;
    mocks.showTextDocument.mockResolvedValue(editor);
    const languageSession = createLanguageAnalysisSession(multilineSource);
    const { panel } = createPanel();
    const bridge = createBridge();
    mocks.bridgeFactory.mockReturnValue(bridge);
    const feature = registerVscodeReferencePickFeature({
      languageAnalysisSessionFor: () => languageSession,
      ensureCanvas: vi.fn(() => ({
        document: editor.document,
        panel,
        isAuthoritativeReady: () => true
      }))
    });

    await mocks.commands.get(VSCODE_REFERENCE_PICK_COMMAND_ID)?.();

    expect(bridge.start).toHaveBeenCalledTimes(1);
    expect(mocks.bridgeFactory).toHaveBeenCalledWith(expect.objectContaining({
      normalizedSourceOffset: multilineSource.indexOf("A", anchorLine),
      expectedTargetProof: expect.objectContaining({
        oldText: "A",
        activationRange: { from: anchorLine, to: multilineSource.indexOf("\n", anchorLine) }
      })
    }));
    feature.dispose();
  });

  it("starts Canvas Pick from broad numeric own-line targets, including a trailing empty operand", async () => {
    const cases = [
      { value: "20,", expectedText: "20", insertion: false },
      { value: "10 +", expectedText: "", insertion: true }
    ] as const;
    for (const entry of cases) {
      const multilineSource = [
        "nui 1",
        "point A = coordinate(x: 0, y: 0)",
        "module M(anchor: point, distance: number) {",
        "}",
        "instance X = M(",
        "  anchor: A,",
        `  distance: ${entry.value}`,
        ")"
      ].join("\n");
      const distanceLine = multilineSource.lastIndexOf("  distance");
      const editor = createEditorForSource(multilineSource, distanceLine);
      mocks.activeTextEditor = editor;
      mocks.showTextDocument.mockResolvedValue(editor);
      const languageSession = createLanguageAnalysisSession(multilineSource);
      const { panel } = createPanel();
      const bridge = createBridge();
      mocks.bridgeFactory.mockReset();
      mocks.bridgeFactory.mockReturnValue(bridge);
      const feature = registerVscodeReferencePickFeature({
        languageAnalysisSessionFor: () => languageSession,
        ensureCanvas: vi.fn(() => ({
          document: editor.document,
          panel,
          isAuthoritativeReady: () => true
        }))
      });

      await mocks.commands.get(VSCODE_REFERENCE_PICK_COMMAND_ID)?.();

      const valueFrom = entry.insertion
        ? multilineSource.indexOf("+", distanceLine) + 1
        : multilineSource.indexOf(entry.expectedText, distanceLine);
      expect(bridge.start).toHaveBeenCalledTimes(1);
      expect(mocks.bridgeFactory).toHaveBeenCalledWith(expect.objectContaining({
        normalizedSourceOffset: valueFrom,
        expectedTargetProof: expect.objectContaining({
          oldText: entry.expectedText,
          activationRange: { from: distanceLine, to: multilineSource.indexOf("\n", distanceLine) }
        })
      }));
      feature.dispose();
      mocks.commands.clear();
    }
  });

  it("explains missing Canvas in Japanese even without a target", async () => {
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
      "nuinuiCAD: Canvasを利用できません。このファイルのCanvasを開いて図形を評価し、Reference Pickを再実行してください。"
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
    expect(mocks.bridgeFactory).toHaveBeenCalledWith(expect.objectContaining({
      initialDraftReferences: [{ base: "A" }]
    }));
    expect(bridge.start).toHaveBeenCalledTimes(1);

    for (const listener of [...webviewListeners]) {
      listener({ type: "referencePickResult", status: "started" });
    }
    await flush();
    expect(bridge.handleResult).toHaveBeenCalledTimes(1);
    expect(panel.reveal).toHaveBeenLastCalledWith(2, false);

    feature.dispose();
  });

  it("restores the captured Source selection after explicit Canvas cancellation", async () => {
    const editor = createEditor();
    const originalSelection = editor.selection;
    mocks.activeTextEditor = editor;
    mocks.showTextDocument.mockResolvedValue(editor);
    const languageSession = createLanguageAnalysisSession(source);
    const { panel, webviewListeners } = createPanel();
    const bridge = createBridge();
    bridge.handleResult.mockResolvedValue("canceled");
    mocks.bridgeFactory.mockReturnValue(bridge);
    const feature = registerVscodeReferencePickFeature({
      languageAnalysisSessionFor: () => languageSession,
      ensureCanvas: vi.fn(() => ({
        document: editor.document,
        panel,
        isAuthoritativeReady: () => true
      }))
    });

    const command = mocks.commands.get(VSCODE_REFERENCE_PICK_COMMAND_ID);
    if (!command) throw new Error("reference pick command was not registered");
    await command();

    expect(mocks.showTextDocument).toHaveBeenCalledTimes(1);
    expect(mocks.showTextDocument.mock.calls[0]?.[1]).toMatchObject({
      viewColumn: editor.viewColumn,
      preserveFocus: false,
      preview: false,
      selection: originalSelection
    });
    expect(bridge.start).toHaveBeenCalledTimes(1);
    const resultListener = webviewListeners[0];
    if (!resultListener) throw new Error("reference pick webview listener was not installed");

    editor.selection = { active: { offset: 0 } };
    resultListener({ type: "referencePickResult", status: "canceled" });
    await flush();

    expect(webviewListeners).toHaveLength(0);
    expect(mocks.showTextDocument).toHaveBeenCalledTimes(2);
    expect(mocks.showTextDocument.mock.calls[1]).toEqual([
      editor.document,
      {
        viewColumn: editor.viewColumn,
        preserveFocus: false,
        preview: false,
        selection: originalSelection
      }
    ]);
    expect(mocks.bridgeFactory).toHaveBeenCalledTimes(1);
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();

    for (const listener of [...mocks.documentChangeListeners]) {
      listener({ document: editor.document, contentChanges: [{}] });
    }
    expect(mocks.bridgeFactory).toHaveBeenCalledTimes(1);

    feature.dispose();
  });

  it.each([
    ["en", "nuinuiCAD: Canvas references are unavailable. Complete or evaluate independent geometry, open Canvas, then start Pick again."],
    ["ja-JP", "nuinuiCAD: Canvas参照を利用できません。独立した図形を完成・評価し、Canvasを開いてPickを再実行してください。"]
  ])("reports a matching rejected Canvas Pick as unavailable instead of silently clearing it (%s)", async (locale, message) => {
    const editor = createEditor();
    const initialSource = editor.document.getText();
    mocks.activeTextEditor = editor;
    mocks.showTextDocument.mockResolvedValue(editor);
    const languageSession = createLanguageAnalysisSession(initialSource);
    const { panel, webviewListeners } = createPanel();
    const bridge = createBridge();
    bridge.handleResult.mockResolvedValue("rejected");
    mocks.bridgeFactory.mockReturnValue(bridge);
    const feature = registerVscodeReferencePickFeature({
      languageAnalysisSessionFor: () => languageSession,
      displayLanguageFor: () => locale,
      ensureCanvas: () => ({ document: editor.document, panel, isAuthoritativeReady: () => true }) as never
    });

    const command = mocks.commands.get(VSCODE_REFERENCE_PICK_COMMAND_ID);
    if (!command) throw new Error("reference pick command was not registered");
    await command();
    const listener = webviewListeners[0];
    if (!listener) throw new Error("reference pick listener was not installed");
    listener({ type: "referencePickResult", status: "rejected" });
    await flush();

    expect(bridge.handleResult).toHaveBeenCalledTimes(1);
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(message);
    expect(editor.document.getText()).toBe(initialSource);
    expect(webviewListeners).toHaveLength(0);
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

  it.each(["nui 1\nimport \"./library.nui\" as lib\npoint A = coordinate(x: 0, y: 0)\npoint C = coordinate(x: 10, y: 0)\npoint P = offset(from: A, dx: 0, dy: 0)\ninstance Use = lib::Panel(value: 20)", source, "nui 1\nline A = segment(start: (0, 0), end: (10, 0))\nline C = segment(start: (0, 1), end: (10, 1))\nreverse A()", "nui 1\nline A = segment(start: (0, 0), end: (10, 0))\nline C = segment(start: (0, 1), end: (10, 1))\nmove [A, ](from: (0, 0), to: (1, 0))", `nui 1
group Outer {
  point Anchor = coordinate(x: 0, y: 0)
  point Other = coordinate(x: 10, y: 0)
  group Inner {
    line L = segment(start: Outer::Anchor, end: Outer::Other)
  }
}
`])("restores a fresh Pick on native Undo and closes it on Redo: %s", async (source) => {
    const { editor, setDocument } = createMutableEditor(source);
    const targetPrefix = ["move [", "reverse ", "from: ", "end: Outer::Other"].find(prefix => source.includes(prefix))!;
    editor.selection.active.offset = source.includes("end: Outer::Other")
      ? source.indexOf(targetPrefix) + "end: ".length + 1
      : source.indexOf(targetPrefix) + targetPrefix.length;
    mocks.activeTextEditor = editor;
    mocks.showTextDocument.mockResolvedValue(editor);
    const languageSession = createLanguageAnalysisSession(source);
    const { panel, webviewListeners } = createPanel();
    const bridge = createBridge();
    const restoredBridge = createBridge();
    bridge.handleResult
      .mockResolvedValueOnce("started")
      .mockResolvedValueOnce("applied");
    const targetSource = { normalizedSource: source, sourceRevision: languageSession.getSourceRevision() };
    const imported = source.includes('import "./library.nui"');
    const graphSnapshots = new Map<number, Awaited<ReturnType<typeof graphSemanticSnapshotFor>>>();
    if (imported) {
      graphSnapshots.set(editor.document.version, await graphSemanticSnapshotFor(editor, languageSession));
      mocks.multiDocumentHost = { languageSemanticSnapshotFor: async () => {
        const version = editor.document.version;
        let snapshot = graphSnapshots.get(version);
        if (!snapshot) {
          snapshot = await graphSemanticSnapshotFor(editor, languageSession, version + 10);
          graphSnapshots.set(version, snapshot);
        }
        return snapshot;
      } };
    }
    const compiled = imported ? graphSnapshots.get(7)!.compiled : compileDslDocument(source, { sourceRevision: targetSource.sourceRevision });
    const target = queryDslReferencePickTarget({ source: targetSource, position: editor.selection.active.offset,
      semantic: { sourceRevision: targetSource.sourceRevision, sourceText: source, compiled } })!;
    const targetProof = referencePickTargetProofFor(source, target)!;
    const references = source.includes("[A, ]") ? [{ base: "A" }, { base: "C" }] :
      source.includes("end: Outer::Other") ? [{ base: "Other" }] : [{ base: "C" }];
    const postSource = source.includes("[A, ]") ? source.replace("[A, ]", "[A, C]") :
      source.includes("reverse A") ? source.replace("reverse A", "reverse C") :
        source.includes("end: Outer::Other") ? source.replace("end: Outer::Other", "end: Other") : source.replace("from: A", "from: C");
    bridge.appliedHandoff.mockReturnValue({
      documentUri: editor.document.uri.toString(),
      documentVersion: 8,
      preConfirmSource: source,
      postConfirmSource: postSource,
      normalizedSourceOffset: editor.selection.active.offset,
      targetProof,
      references
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

    if (imported) bridge.handleResult.mockReset().mockImplementationOnce(async () => { setDocument(postSource, 8); return "applied"; });
    else setDocument(postSource, 8);
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

    await vi.waitFor(() => expect(restoredBridge.start).toHaveBeenCalledTimes(1));
    expect(mocks.bridgeFactory.mock.calls[1]?.[0]).toMatchObject({
      requestId: 2,
      normalizedSourceOffset: editor.selection.active.offset,
      initialDraftReferences: references,
      preserveSourceFocus: true,
      expectedTargetProof: targetProof
    });
    expect(webviewListeners).toHaveLength(1);
    expect(panel.reveal).toHaveBeenLastCalledWith(2, true);

    const restoredListener = webviewListeners[0];
    if (!restoredListener) throw new Error("restored webview listener was not installed");
    restoredListener({ type: "referencePickResult", status: "started" });
    await flush();
    expect(panel.reveal).toHaveBeenLastCalledWith(2, true);

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
    expect(mocks.showTextDocument).toHaveBeenCalledTimes(1);

    feature.dispose();
  });
});

it.each(["C", "F"] as const)("#1623 %s sends a request-bound graph projection through the production host command", async relation => {
  const { importedPickFixture } = await import("../../src/vscode/importedReferencePickFixture");
  const { evaluationResultToPayload } = await import("../../src/geometry/evaluationPayload");
  const f = await importedPickFixture(relation);
  const editor = createEditorForSource(f.source.normalizedSource, f.request.normalizedSourceOffset);
  editor.document.uri.toString = () => f.request.documentUri;
  mocks.activeTextEditor = editor;
  mocks.showTextDocument.mockResolvedValue(editor);
  const session = createLanguageAnalysisSession(f.source.normalizedSource);
  const semantic = { sourceDocumentUri: f.request.documentUri, rootDocumentId: f.request.documentUri, documentVersion: 7, graphRevision: 41,
    sourceRevision: 12, sourceText: f.source.normalizedSource, compiled: f.compiled };
  mocks.multiDocumentHost = { languageSemanticSnapshotFor: vi.fn(async () => semantic) };
  const { panel, webviewListeners } = createPanel();
  const bridge = createBridge();
  mocks.bridgeFactory.mockImplementation(options => {
    bridge.start.mockImplementation(() => {
      options.postMessage(f.request);
      return f.request;
    });
    return bridge;
  });
  const transport = vi.fn(async () => evaluationResultToPayload(f.evaluation));
  const feature = registerVscodeReferencePickFeature({ languageAnalysisSessionFor: () => session,
    ensureCanvas: async () => ({ document: editor.document, panel, isAuthoritativeReady: () => true }) as never,
    rustTransport: transport });
  await mocks.commands.get(VSCODE_REFERENCE_PICK_COMMAND_ID)!();
  await vi.waitFor(() => expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ graphSnapshot: expect.any(Object) })));
  expect(transport).toHaveBeenCalledTimes(1);
  expect(mocks.bridgeFactory).toHaveBeenCalledWith(expect.objectContaining({ semanticSnapshot: semantic }));
  const message = panel.webview.postMessage.mock.calls.map(([m]) => m).find(m => m.graphSnapshot);
  const roundTrip = JSON.parse(JSON.stringify(message));
  expect(roundTrip.graphSnapshot.result.status).toBe("started");
  expect(roundTrip.graphSnapshot.result.candidateReferences).toContainEqual({ base: "A" });
  for (const listener of [...webviewListeners]) listener(roundTrip.graphSnapshot.result);
  await vi.waitFor(() => expect(bridge.handleResult).toHaveBeenCalledTimes(1));
  mocks.multiDocumentHost.languageSemanticSnapshotFor = async () => ({ ...semantic, graphRevision: 42 });
  for (const listener of [...webviewListeners]) listener({ ...roundTrip.graphSnapshot.result, status: "confirmed" });
  await vi.waitFor(() => expect(bridge.cancel).toHaveBeenCalled());
  expect(bridge.handleResult).toHaveBeenCalledTimes(1);
  feature.dispose();
});

it.each((["target-bound", "browse"] as const).flatMap(mode => [true, false].map(warm => ({ mode, warm }))))(
  "#1631 carries NFC Source and NFD graph identities through $mode with warm=$warm Canvas",
  async ({ mode, warm }) => {
    const source = [
      "nui 1",
      'import "./library.nui" as lib',
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: A, dx: 10, dy: 0)",
      "instance Direct = lib::Panel(value: 20)"
    ].join("\n");
    const nfcPath = "/synthetic/型紙-ず/pick_ascii.nui";
    const sourceDocumentUri = `file://${nfcPath}`;
    const rootDocumentId = `file://${nfcPath.normalize("NFD")}`;
    const offset = mode === "target-bound" ? source.indexOf("from: A") + "from: ".length : source.length;
    const editor = createEditorForSource(source, offset);
    editor.document.uri.toString = () => sourceDocumentUri;
    mocks.activeTextEditor = editor;
    mocks.showTextDocument.mockResolvedValue(editor);
    const session = createLanguageAnalysisSession(source);
    const semantic = await graphSemanticSnapshotFor(editor, session, 41, { sourceDocumentUri, rootDocumentId });
    const sourceSnapshot = { normalizedSource: source, sourceRevision: semantic.sourceRevision };
    const target = mode === "target-bound" ? queryDslReferencePickTarget({ source: sourceSnapshot, position: offset,
      semantic: { sourceRevision: semantic.sourceRevision, sourceText: source, compiled: semantic.compiled } }) : null;
    const request = {
      type: "referencePickStartRequest" as const,
      requestId: 1631,
      documentUri: sourceDocumentUri,
      documentVersion: editor.document.version,
      normalizedSourceOffset: offset,
      mode,
      targetProof: target ? referencePickTargetProofFor(source, target) : null
    };
    const evaluation = evaluateElementsReference(semantic.compiled.document!.elements, buildEvaluationOptions({
      compiledDocument: semantic.compiled as never,
      evaluationLimitIndex: undefined
    }));
    const { panel, webviewListeners } = createPanel();
    const bridge = createBridge();
    let ready = warm;
    const ensureCanvas = vi.fn(async () => ({ document: editor.document, panel, isAuthoritativeReady: () => ready }));
    mocks.multiDocumentHost = { languageSemanticSnapshotFor: vi.fn(async () => semantic) };
    mocks.bridgeFactory.mockImplementation(options => {
      bridge.start.mockImplementation(() => {
        options.postMessage(request);
        return request;
      });
      return bridge;
    });
    const transport = vi.fn(async () => evaluationResultToPayload(evaluation));
    const feature = registerVscodeReferencePickFeature({ languageAnalysisSessionFor: () => session,
      ensureCanvas: ensureCanvas as never, rustTransport: transport });

    await mocks.commands.get(VSCODE_REFERENCE_PICK_COMMAND_ID)!();
    expect(ensureCanvas).toHaveBeenCalledWith(editor.document);
    if (!warm) {
      expect(mocks.bridgeFactory).not.toHaveBeenCalled();
      ready = true;
      for (const listener of [...webviewListeners]) listener({ type: "webviewAuthoritativeDocumentReady" });
    }
    await vi.waitFor(() => expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ graphSnapshot: expect.any(Object) })
    ));

    expect(mocks.bridgeFactory).toHaveBeenCalledWith(expect.objectContaining({
      semanticSnapshot: expect.objectContaining({ sourceDocumentUri, rootDocumentId }),
      ...(mode === "browse" ? { browse: true } : {})
    }));
    expect(transport).toHaveBeenCalledTimes(1);
    const message = panel.webview.postMessage.mock.calls.map(([value]) => value).find(value => value.graphSnapshot);
    const wire = JSON.parse(JSON.stringify(message));
    expect(wire.graphSnapshot).toMatchObject({ documentUri: sourceDocumentUri, rootDocumentId });
    expect(wire.graphSnapshot.result.status).toBe("started");
    const references = mode === "browse"
      ? wire.graphSnapshot.result.browseReferences
      : wire.graphSnapshot.result.candidateReferences;
    expect(references).toContainEqual({ base: "A" });

    feature.dispose();
    mocks.commands.clear();
  }
);

it("#1631 reports an explicit rejected start without diagnosing a Source edit", async () => {
  const editor = createEditor();
  editor.selection = { active: { offset: 0 } };
  mocks.activeTextEditor = editor;
  const session = createLanguageAnalysisSession(source);
  const { panel } = createPanel();
  const bridge = createBridge();
  bridge.start.mockImplementation(() => null as never);
  mocks.bridgeFactory.mockReturnValue(bridge);
  const feature = registerVscodeReferencePickFeature({
    languageAnalysisSessionFor: () => session,
    ensureCanvas: () => ({ document: editor.document, panel, isAuthoritativeReady: () => true }) as never
  });

  await mocks.commands.get(VSCODE_REFERENCE_PICK_COMMAND_ID)!();

  expect(mocks.showErrorMessage).toHaveBeenCalledWith(
    "nuinuiCAD: Pick could not start because the current Source and Canvas reference could not be verified."
  );
  expect(mocks.showErrorMessage.mock.calls.flat().join(" ")).not.toContain("Source changed");
  feature.dispose();
  mocks.commands.clear();
});
