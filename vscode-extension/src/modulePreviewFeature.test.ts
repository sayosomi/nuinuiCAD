import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLanguageAnalysisSession,
  currentCompiledSemanticSnapshotFor
} from "./languageAnalysisSession";
import type {
  VscodeModulePreviewModelPatchRequest,
  VscodeToExtensionMessage
} from "../../src/vscode/protocol";
import type {
  VscodeModulePreviewValueParameter,
  VscodeModulePreviewValueSnapshot
} from "../../src/vscode/protocol";

const mocks = vi.hoisted(() => ({
  activeTextEditor: null as null | {
    document: TestDocument;
    selection: { active: { line: number; character: number } };
  },
  commandHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  commandRegistrations: [] as string[],
  activeEditorListeners: [] as Array<() => void>,
  selectionListeners: [] as Array<(event: { textEditor: unknown }) => void>,
  themeListeners: [] as Array<() => void>,
  documentChangeListeners: [] as Array<(event: TestDocumentChangeEvent) => void>,
  documentCloseListeners: [] as Array<(document: TestDocument) => void>,
  configurationListeners: [] as Array<(event: { affectsConfiguration: (section: string) => boolean }) => void>,
  textDocuments: undefined as TestDocument[] | undefined,
  visibleTextEditors: [] as TestEditor[],
  showTextDocument: vi.fn(),
  executeCommand: vi.fn(async () => undefined),
  showErrorMessage: vi.fn(),
  createWebviewPanel: vi.fn(),
  nativeShowQuickPick: vi.fn(),
  nativeShowInputBox: vi.fn()
}));

vi.mock("./nativeQuickInput", () => ({
  nativeShowQuickPick: mocks.nativeShowQuickPick,
  nativeShowInputBox: mocks.nativeShowInputBox
}));

type TestDocument = {
  fileName: string;
  version: number;
  uri: { scheme: string; toString: () => string };
  getText: () => string;
  offsetAt: (position: { line: number; character: number }) => number;
  positionAt: (offset: number) => { line: number; character: number };
  setSource: (source: string) => void;
};

type TestEditor = {
  document: TestDocument;
  selection: { active: { line: number; character: number } };
  edit: ReturnType<typeof vi.fn>;
  revealRange: ReturnType<typeof vi.fn>;
};

type TestDocumentChangeEvent = {
  document: TestDocument;
  reason?: number;
  contentChanges: readonly unknown[];
};

type TestPanel = {
  title: string;
  active: boolean;
  visible: boolean;
  webview: {
    html: string;
    postMessage: ReturnType<typeof vi.fn>;
    onDidReceiveMessage: ReturnType<typeof vi.fn>;
  };
  reveal: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  onDidChangeViewState: ReturnType<typeof vi.fn>;
  onDidDispose: ReturnType<typeof vi.fn>;
};

vi.mock("vscode", () => ({
  window: {
    get activeTextEditor() {
      return mocks.activeTextEditor;
    },
    get visibleTextEditors() {
      return mocks.visibleTextEditors;
    },
    createWebviewPanel: mocks.createWebviewPanel,
    showTextDocument: mocks.showTextDocument,
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
    get textDocuments() {
      return mocks.textDocuments;
    },
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
      mocks.commandRegistrations.push(command);
      mocks.commandHandlers.set(command, handler);
      return { dispose: () => mocks.commandHandlers.delete(command) };
    },
    executeCommand: mocks.executeCommand
  },
  ViewColumn: { Beside: 2 },
  Range: class Range {
    constructor(
      readonly start: { line: number; character: number },
      readonly end: { line: number; character: number }
    ) {}
  },
  Selection: class Selection {
    constructor(
      readonly start: { line: number; character: number },
      readonly end: { line: number; character: number }
    ) {}
    get active() {
      return this.end;
    }
  },
  TextDocumentChangeReason: { Undo: 1, Redo: 2 }
}));

import {
  MODULE_PREVIEW_INSERT_INSTANCE_COMMAND,
  NUI_MODULE_PREVIEW_INSERT_CONTEXT,
  NUI_MODULE_PREVIEW_SOURCE_TARGET_CONTEXT,
  registerModulePreviewFeature
} from "./modulePreviewFeature";
import { createWebviewEditableFocusContext } from "./webviewEditableFocusContext";

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

const createDocument = (
  initialSource: string,
  uri = "file:///workspace/pattern.nui"
): TestDocument => {
  let source = initialSource;
  const document: TestDocument = {
    fileName: uri.replace("file://", ""),
    version: 1,
    uri: { scheme: "file", toString: () => uri },
    getText: () => source,
    offsetAt: (position) => offsetAt(source, position),
    positionAt: (offset) => positionAt(source, offset),
    setSource: (nextSource) => {
      source = nextSource;
      document.version += 1;
    }
  };
  return document;
};

const createEditor = (document: TestDocument): TestEditor => {
  const edit = vi.fn(async (
    callback: (builder: { replace: (range: { start: { line: number; character: number }; end: { line: number; character: number } }, replacement: string) => void }) => void
  ) => {
    const edits: Array<{
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
      replacement: string;
    }> = [];
    callback({ replace: (range, replacement) => edits.push({ range, replacement }) });
    let nextSource = document.getText();
    for (const current of [...edits].reverse()) {
      const from = document.offsetAt(current.range.start);
      const to = document.offsetAt(current.range.end);
      nextSource = `${nextSource.slice(0, from)}${current.replacement}${nextSource.slice(to)}`;
    }
    if (edits.length > 0) document.setSource(nextSource);
    return true;
  });
  return {
    document,
    selection: { active: positionAt(document.getText(), document.getText().length) },
    edit,
    revealRange: vi.fn()
  };
};

const createPanel = (options: {
  eagerWebviewReady?: boolean;
  startupMessages?: readonly unknown[];
} = {}): TestPanel & {
  receive: (message: unknown) => Promise<void>;
  fireDispose: () => void;
  fireViewState: (state?: { active?: boolean; visible?: boolean }) => void;
} => {
  const receiveHandlers: Array<(message: unknown) => unknown> = [];
  let disposeHandler: (() => void) | null = null;
  let viewStateHandler: ((event: { webviewPanel: TestPanel }) => void) | null = null;
  let html = "";
  // Keep eager startup callback dispatch synchronous, while allowing the test
  // to await only handler work that actually crosses an async boundary.
  const dispatch = (message: unknown): Promise<void> | undefined => {
    const pending: Array<PromiseLike<unknown>> = [];
    for (const handler of [...receiveHandlers]) {
      const result = handler(message);
      if (result && typeof result === "object" && "then" in result) {
        pending.push(result as PromiseLike<unknown>);
      }
    }
    return pending.length > 0
      ? Promise.all(pending).then(() => undefined)
      : undefined;
  };
  const receive = async (message: unknown): Promise<void> => {
    await dispatch(message);
  };
  const panel = {
    title: "",
    active: true,
    visible: true,
    webview: {
      get html() {
        return html;
      },
      set html(value: string) {
        html = value;
        const startupMessages = options.startupMessages ?? (
          options.eagerWebviewReady ? [{ type: "webviewReady" }] : []
        );
        if (startupMessages.length > 0) {
          for (const message of startupMessages) void dispatch(message);
        }
      },
      postMessage: vi.fn(async () => true),
      onDidReceiveMessage: vi.fn((handler: (message: unknown) => unknown) => {
        receiveHandlers.push(handler);
        return { dispose: () => undefined };
      })
    },
    reveal: vi.fn(),
    dispose: vi.fn(),
    onDidChangeViewState: vi.fn((handler: (event: { webviewPanel: TestPanel }) => void) => {
      viewStateHandler = handler;
      return { dispose: () => undefined };
    }),
    onDidDispose: vi.fn((handler: () => void) => {
      disposeHandler = handler;
      return { dispose: () => undefined };
    }),
    receive,
    fireDispose: () => disposeHandler?.(),
    fireViewState: (state = {}) => {
      panel.active = state.active ?? panel.active;
      panel.visible = state.visible ?? panel.visible;
      viewStateHandler?.({ webviewPanel: panel });
    }
  } satisfies TestPanel & {
    receive: (message: unknown) => Promise<void>;
    fireDispose: () => void;
    fireViewState: (state?: { active?: boolean; visible?: boolean }) => void;
  };
  return panel;
};

const latestBootstrapFor = (panel: TestPanel) => panel.webview.postMessage.mock.calls
  .map(([message]) => message as {
    type?: string;
    sessionId?: string;
    sessionGeneration?: number;
    documentUri?: string;
    documentVersion?: number;
  })
  .filter((message) => message.type === "modulePreviewBootstrap")
  .at(-1);

const acknowledgeBootstrap = async (panel: TestPanel): Promise<void> => {
  const bootstrap = latestBootstrapFor(panel);
  if (!bootstrap?.sessionId || !Number.isInteger(bootstrap.sessionGeneration) ||
    !bootstrap.documentUri || !Number.isInteger(bootstrap.documentVersion)) {
    throw new Error("expected Module Preview bootstrap");
  }
  await (panel as TestPanel & { receive: (message: unknown) => Promise<void> }).receive({
    type: "modulePreviewBootstrapAcknowledged",
    sessionId: bootstrap.sessionId,
    sessionGeneration: bootstrap.sessionGeneration,
    documentUri: bootstrap.documentUri,
    documentVersion: bootstrap.documentVersion
  });
};

const flushContext = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

afterEach(() => {
  cleanup();
  mocks.activeTextEditor = null;
  mocks.commandHandlers.clear();
  mocks.commandRegistrations.length = 0;
  mocks.activeEditorListeners.length = 0;
  mocks.selectionListeners.length = 0;
  mocks.themeListeners.length = 0;
  mocks.documentChangeListeners.length = 0;
  mocks.documentCloseListeners.length = 0;
  mocks.configurationListeners.length = 0;
  mocks.textDocuments = undefined;
  mocks.visibleTextEditors.length = 0;
  mocks.executeCommand.mockClear();
  mocks.executeCommand.mockReset();
  mocks.executeCommand.mockImplementation(async (command: string) => {
    const handler = mocks.commandHandlers.get(command);
    return handler ? await handler() : undefined;
  });
  mocks.showTextDocument.mockReset();
  mocks.showErrorMessage.mockClear();
  mocks.createWebviewPanel.mockReset();
  mocks.nativeShowQuickPick.mockReset();
  mocks.nativeShowInputBox.mockReset();
});

describe("registerModulePreviewFeature", () => {
  const openModulePatchFixture = (options: {
    presentBakeOperationResult?: (
      message: Extract<VscodeToExtensionMessage, { type: "bakeOperationResult" }>
    ) => Promise<void> | void;
    canvasGridSettings?: () => { enabled: boolean; spacingMm: number; majorEvery: number; snapEnabled: boolean };
  } = {}) => {
    const source = [
      "nui 1",
      "module Pocket() {",
      "  point P = coordinate(x: 1, y: 0)",
      "  point Q = coordinate(x: 5, y: 0)",
      "}"
    ].join("\n");
    const document = createDocument(source);
    const editor = createEditor(document);
    const panel = createPanel();
    const analysis = createLanguageAnalysisSession(source);
    mocks.createWebviewPanel.mockReturnValue(panel);
    mocks.activeTextEditor = {
      document,
      selection: { active: positionAt(source, source.indexOf("point P")) }
    };
    mocks.textDocuments = [document];
    mocks.visibleTextEditors = [editor];
    const feature = registerModulePreviewFeature({
      languageAnalysisSessionFor: (() => analysis) as never,
      canvasThemeGeneration: () => 0,
      webviewHtml: () => "<html />",
      canvasRibbons: () => [],
      canvasGridSettings: options.canvasGridSettings,
      updateCanvasRibbonPosition: () => undefined,
      editCanvasRibbon: () => undefined,
      evaluateWithRust: async () => ({}),
      ...options
    });
    mocks.commandHandlers.get("nuinuiCAD.openModulePreview")!();
    return { source, document, editor, panel, analysis, feature };
  };

  it("publishes initial and live Canvas grid configuration to the open Module Preview", async () => {
    let settings = { enabled: false, spacingMm: 2.5, majorEvery: 1, snapEnabled: true };
    const fixture = openModulePatchFixture({ canvasGridSettings: () => settings });

    await fixture.panel.receive({ type: "webviewReady" });
    expect(fixture.panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasGridConfiguration",
      settings
    });

    fixture.panel.webview.postMessage.mockClear();
    settings = { enabled: true, spacingMm: 20, majorEvery: 3, snapEnabled: false };
    for (const listener of mocks.configurationListeners) {
      listener({ affectsConfiguration: (section) => section === "nuinuiCAD.canvas.grid.spacingMm" });
    }

    expect(fixture.panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasGridConfiguration",
      settings
    });
    fixture.feature.dispose();
  });

  const patchRequestFor = (
    fixture: ReturnType<typeof openModulePatchFixture>,
    overrides: Partial<VscodeModulePreviewModelPatchRequest> = {}
  ): VscodeModulePreviewModelPatchRequest => {
    const sessionId = fixture.panel.webview.postMessage.mock.calls
      .map(([message]) => message as { type?: string; sessionId?: string })
      .find((message) => message.type === "modulePreviewBootstrap")?.sessionId;
    const target = currentCompiledSemanticSnapshotFor(fixture.analysis, {
      normalizedSource: fixture.source,
      sourceRevision: fixture.analysis.getSourceRevision()
    })?.compiled?.moduleSemanticAnalysis?.definitions.find((definition) => definition.name === "Pocket");
    if (!sessionId || !target) throw new Error("expected Module Preview patch identity");
    const expectedPatchedSource = fixture.source.replace("x: 1", "x: 2");
    return {
      type: "modulePreviewModelPatch",
      operationId: 1,
      sessionId,
      documentUri: fixture.document.uri.toString(),
      expectedDocumentVersion: fixture.document.version,
      normalizedSource: fixture.source,
      sourceRevision: fixture.analysis.getSourceRevision(),
      targetDefinitionStatementId: target.statementId,
      previewRevision: 1,
      sourceOwners: [{ runtimeElementId: "preview-runtime-point", sourceStatementId: "authored-point" }],
      splices: [{ startLine: 3, endLine: 3, replacementLines: ["  point P = coordinate(x: 2, y: 0)"] }],
      expectedPatchedSource,
      ...overrides
    };
  };

  it("applies one exact Module Preview model patch as one native undo transaction", async () => {
    const fixture = openModulePatchFixture();
    await fixture.panel.receive({ type: "webviewReady" });
    expect(fixture.panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "webviewPresentation",
      presentation: expect.objectContaining({ locale: "en" })
    }));
    await acknowledgeBootstrap(fixture.panel);
    await fixture.panel.receive(patchRequestFor(fixture));

    expect(fixture.document.getText()).toContain("x: 2");
    expect(fixture.editor.edit).toHaveBeenCalledTimes(1);
    expect(fixture.editor.edit).toHaveBeenCalledWith(expect.any(Function), {
      undoStopBefore: true,
      undoStopAfter: true
    });
    expect(fixture.panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewModelPatchResult",
      operationId: 1,
      status: "applied",
      documentVersion: 2
    }));
    fixture.feature.dispose();
  });

  it("forwards existing Bake commands and settings to the active Module Preview", () => {
    const fixture = openModulePatchFixture();

    expect(fixture.feature.postBakeCommandIfActive("bakeCurrentShape", {
      emitSkippedComments: false,
      includeHiddenGeometry: true,
      includeDisabledGeometry: true
    })).toBe(true);
    expect(fixture.panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasCommand",
      commandId: "bakeCurrentShape",
      emitSkippedComments: false,
      includeHiddenGeometry: true,
      includeDisabledGeometry: true
    });
    expect(fixture.feature.postBakeCommandIfActive("bakeBaseShape", {
      emitSkippedComments: true,
      includeHiddenGeometry: false,
      includeDisabledGeometry: false
    })).toBe(true);
    fixture.feature.dispose();
  });

  it("forwards Module Preview Bake results to the shared Extension Host presentation owner", async () => {
    const presentBakeOperationResult = vi.fn(async () => undefined);
    const fixture = openModulePatchFixture({ presentBakeOperationResult });
    const message: Extract<VscodeToExtensionMessage, { type: "bakeOperationResult" }> = {
      type: "bakeOperationResult",
      surface: "modulePreview",
      mode: "current",
      status: "nothing",
      summary: {
        successfulTargetCount: 0,
        skippedTargetCount: 1,
        skippedTargets: [{
          targetId: "target-1",
          sourceElementId: "source-1",
          sourceLabel: "text Memo",
          reason: { code: "unsupported-geometry-kind", geometryKind: "text" }
        }]
      }
    };

    await fixture.panel.receive(message);

    expect(presentBakeOperationResult).toHaveBeenCalledWith(message);
    fixture.feature.dispose();
  });

  it("applies multiple Bake splices through one authoritative editor transaction", async () => {
    const fixture = openModulePatchFixture();
    await fixture.panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(fixture.panel);
    const expectedPatchedSource = fixture.source
      .replace("x: 1", "x: 2")
      .replace("x: 5", "x: 6");
    await fixture.panel.receive(patchRequestFor(fixture, {
      sourceOwners: [
        { runtimeElementId: "preview-runtime-point", sourceStatementId: "authored-point" },
        { runtimeElementId: "preview-runtime-point-2", sourceStatementId: "authored-point-2" }
      ],
      splices: [
        { startLine: 3, endLine: 3, replacementLines: ["  point P = coordinate(x: 2, y: 0)"] },
        { startLine: 4, endLine: 4, replacementLines: ["  point Q = coordinate(x: 6, y: 0)"] }
      ],
      expectedPatchedSource
    }));

    expect(fixture.document.getText()).toBe(expectedPatchedSource);
    expect(fixture.editor.edit).toHaveBeenCalledTimes(1);
    fixture.feature.dispose();
  });

  it("fails closed for malformed multi-target ownership proofs", async () => {
    const fixture = openModulePatchFixture();
    await fixture.panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(fixture.panel);
    await fixture.panel.receive(patchRequestFor(fixture, {
      sourceOwners: [
        { runtimeElementId: "preview-runtime-point", sourceStatementId: "authored-point" },
        { runtimeElementId: "preview-runtime-point", sourceStatementId: "authored-point-2" }
      ]
    }));

    expect(fixture.editor.edit).not.toHaveBeenCalled();
    expect(fixture.document.getText()).toBe(fixture.source);
    fixture.feature.dispose();
  });

  it("rejects stale versions and mismatched expected patched source without editing", async () => {
    const staleFixture = openModulePatchFixture();
    await staleFixture.panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(staleFixture.panel);
    await staleFixture.panel.receive(patchRequestFor(staleFixture, { expectedDocumentVersion: 0 }));
    expect(staleFixture.editor.edit).not.toHaveBeenCalled();
    expect(staleFixture.panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewModelPatchResult",
      status: "stale"
    }));
    staleFixture.feature.dispose();

    const mismatchFixture = openModulePatchFixture();
    await mismatchFixture.panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(mismatchFixture.panel);
    await mismatchFixture.panel.receive(patchRequestFor(mismatchFixture, {
      expectedPatchedSource: mismatchFixture.source
    }));
    expect(mismatchFixture.editor.edit).not.toHaveBeenCalled();
    expect(mismatchFixture.document.getText()).toBe(mismatchFixture.source);
    expect(mismatchFixture.panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewModelPatchResult",
      status: "rejected"
    }));
    mismatchFixture.feature.dispose();

    const unavailableFixture = openModulePatchFixture();
    mocks.visibleTextEditors = [];
    await unavailableFixture.panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(unavailableFixture.panel);
    await unavailableFixture.panel.receive(patchRequestFor(unavailableFixture));
    expect(unavailableFixture.editor.edit).not.toHaveBeenCalled();
    expect(unavailableFixture.panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewModelPatchResult",
      status: "rejected"
    }));
    unavailableFixture.feature.dispose();
  });

  it.each(["undo", "redo"] as const)(
    "hands %s to native VS Code history after activating the matching Source editor",
    async (direction) => {
      const fixture = openModulePatchFixture();
      await fixture.panel.receive({ type: "webviewReady" });
      await acknowledgeBootstrap(fixture.panel);
      await flushContext();
      mocks.executeCommand.mockClear();
      fixture.panel.webview.postMessage.mockClear();
      fixture.panel.reveal.mockImplementation(() => {
        fixture.panel.active = true;
      });
      mocks.showTextDocument.mockImplementation(async () => {
        fixture.panel.active = false;
        return fixture.editor;
      });
      mocks.executeCommand.mockImplementation(async (command: string) => {
        if (command === "setContext") return;
        expect(command).toBe(direction);
        fixture.document.setSource([
          "nui 1",
          "point A = coordinate(x: 0, y: 0)"
        ].join("\n"));
        for (const listener of mocks.documentChangeListeners) {
          listener({
            document: fixture.document,
            contentChanges: [{}],
            reason: direction === "undo" ? 1 : 2
          });
        }
      });

      expect(fixture.feature.handoffNativeHistoryIfActive(direction)).toBe(true);
      await vi.waitFor(() => expect(mocks.executeCommand).toHaveBeenCalledWith(direction));
      await flushContext();

      expect(mocks.showTextDocument).toHaveBeenCalledWith(fixture.document, {
        viewColumn: undefined,
        preserveFocus: false,
        preview: false
      });
      expect(mocks.executeCommand.mock.calls.filter(([command]) => command !== "setContext")).toEqual([[direction]]);
      expect(fixture.panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: "modulePreviewBootstrap",
        sourceText: fixture.document.getText(),
        documentVersion: 2
      }));

      await acknowledgeBootstrap(fixture.panel);
      expect(fixture.panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: "modulePreviewTargetUnavailable",
        documentVersion: 2
      }));
      expect(fixture.panel.reveal).toHaveBeenCalledWith(undefined, false);
      fixture.feature.dispose();
    }
  );

  it("fails closed before native history when the authoritative document version is stale", async () => {
    const fixture = openModulePatchFixture();
    await fixture.panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(fixture.panel);
    fixture.document.setSource(fixture.source.replace("x: 1", "x: 3"));
    expect(fixture.feature.handoffNativeHistoryIfActive("undo")).toBe(false);
    expect(mocks.showTextDocument).not.toHaveBeenCalled();
    expect(mocks.executeCommand).not.toHaveBeenCalledWith("undo");
    fixture.feature.dispose();
  });

  it("fails closed when the document version drifts during Source activation", async () => {
    const fixture = openModulePatchFixture();
    await fixture.panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(fixture.panel);
    await flushContext();
    mocks.executeCommand.mockClear();
    mocks.showTextDocument.mockImplementation(async () => {
      fixture.document.setSource(fixture.source.replace("x: 1", "x: 4"));
      return fixture.editor;
    });

    expect(fixture.feature.handoffNativeHistoryIfActive("undo")).toBe(true);
    await vi.waitFor(() => expect(mocks.showTextDocument).toHaveBeenCalled());
    await flushContext();

    expect(mocks.executeCommand).not.toHaveBeenCalledWith("undo");
    fixture.feature.dispose();
  });

  it("rebuilds the exact target after each Webview recreation and fails closed when it disappears", async () => {
    const source = [
      "nui 1",
      "module Pocket() {",
      "  point P = coordinate(x: 1, y: 0)",
      "}"
    ].join("\n");
    const document = createDocument(source);
    const panel = createPanel();
    mocks.createWebviewPanel.mockReturnValue(panel);
    const analysis = createLanguageAnalysisSession(source);
    mocks.activeTextEditor = {
      document,
      selection: { active: positionAt(source, source.indexOf("point P")) }
    };
    const feature = registerModulePreviewFeature({
      languageAnalysisSessionFor: (() => analysis) as never,
      canvasThemeGeneration: () => 0,
      webviewHtml: () => "<html />",
      canvasRibbons: () => [],
      updateCanvasRibbonPosition: () => undefined,
      editCanvasRibbon: () => undefined,
      evaluateWithRust: async () => ({})
    });
    mocks.commandHandlers.get("nuinuiCAD.openModulePreview")!();

    await panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(panel);
    const initialBootstrap = latestBootstrapFor(panel);
    if (!initialBootstrap?.sessionId || !Number.isInteger(initialBootstrap.sessionGeneration) || !initialBootstrap.documentUri) {
      throw new Error("expected Module Preview bootstrap identity");
    }
    const initialTarget = {
      type: "modulePreviewTarget",
      sessionId: initialBootstrap.sessionId,
      sessionGeneration: initialBootstrap.sessionGeneration,
      documentUri: initialBootstrap.documentUri,
      documentVersion: 1,
      normalizedSourceOffset: source.indexOf("module Pocket")
    };
    expect(panel.webview.postMessage).toHaveBeenCalledWith(initialTarget);

    for (let recreation = 0; recreation < 2; recreation += 1) {
      panel.webview.postMessage.mockClear();
      await panel.receive({ type: "webviewReady" });
      expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
        type: "modulePreviewTarget"
      }));
      expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
        type: "modulePreviewTargetUnavailable"
      }));

      await acknowledgeBootstrap(panel);
      expect(panel.webview.postMessage).toHaveBeenCalledWith(initialTarget);
    }

    document.setSource([
      "nui 1",
      "point A = coordinate(x: 1, y: 0)"
    ].join("\n"));
    for (const listener of mocks.documentChangeListeners) {
      listener({ document, contentChanges: [{}] });
    }

    panel.webview.postMessage.mockClear();
    await panel.receive({ type: "webviewReady" });
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewTargetUnavailable"
    }));
    await acknowledgeBootstrap(panel);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewTargetUnavailable",
      documentVersion: 2
    }));
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewTarget",
      documentVersion: 2
    }));

    feature.dispose();
  });

  it("creates a fresh session after panel disposal and rejects late messages from the disposed session", async () => {
    const source = [
      "nui 1",
      "module Pocket(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}"
    ].join("\n");
    const document = createDocument(source);
    const oldPanel = createPanel();
    const newPanel = createPanel();
    const analysis = createLanguageAnalysisSession(source);
    mocks.createWebviewPanel.mockReturnValueOnce(oldPanel).mockReturnValueOnce(newPanel);
    mocks.activeTextEditor = {
      document,
      selection: { active: positionAt(source, source.indexOf("module Pocket")) }
    };
    mocks.textDocuments = [document];
    mocks.visibleTextEditors = [createEditor(document)];
    const feature = registerModulePreviewFeature({
      languageAnalysisSessionFor: (() => analysis) as never,
      canvasThemeGeneration: () => 0,
      webviewHtml: () => "<html />",
      canvasRibbons: () => [],
      updateCanvasRibbonPosition: () => undefined,
      editCanvasRibbon: () => undefined,
      evaluateWithRust: async () => ({})
    });
    expect(mocks.commandRegistrations.filter((command) => command === MODULE_PREVIEW_INSERT_INSTANCE_COMMAND)).toHaveLength(1);

    const open = mocks.commandHandlers.get("nuinuiCAD.openModulePreview");
    if (!open) throw new Error("expected open Module Preview command");
    open();
    await oldPanel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(oldPanel);
    await flushContext();
    expect(mocks.executeCommand).toHaveBeenCalledWith("setContext", NUI_MODULE_PREVIEW_INSERT_CONTEXT, true);
    const oldSessionId = oldPanel.webview.postMessage.mock.calls
      .map(([message]) => message as { type?: string; sessionId?: string })
      .find((message) => message.type === "modulePreviewBootstrap")?.sessionId;
    if (!oldSessionId) throw new Error("expected disposed Module Preview session identity");

    oldPanel.fireDispose();
    await flushContext();
    expect(mocks.executeCommand).toHaveBeenCalledWith("setContext", NUI_MODULE_PREVIEW_INSERT_CONTEXT, false);
    oldPanel.webview.postMessage.mockClear();
    await oldPanel.receive({ type: "webviewReady" });
    expect(oldPanel.webview.postMessage).not.toHaveBeenCalled();

    open();
    await newPanel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(newPanel);
    await flushContext();
    expect(mocks.executeCommand).toHaveBeenCalledWith("setContext", NUI_MODULE_PREVIEW_INSERT_CONTEXT, true);
    const newSessionId = newPanel.webview.postMessage.mock.calls
      .map(([message]) => message as { type?: string; sessionId?: string })
      .find((message) => message.type === "modulePreviewBootstrap")?.sessionId;
    expect(newSessionId).toBeDefined();
    expect(newSessionId).not.toBe(oldSessionId);

    const staleSnapshot = {
      ...valueSnapshotFor(document, analysis, { name: "width", type: { kind: "number" }, value: "11" }),
      sessionId: oldSessionId
    };
    await oldPanel.receive(staleSnapshot);
    await newPanel.receive(staleSnapshot);
    await newPanel.receive({
      type: "modulePreviewBootstrapAcknowledged",
      sessionId: oldSessionId,
      sessionGeneration: 1,
      documentUri: document.uri.toString(),
      documentVersion: document.version
    });
    expect(newPanel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewValueSnapshot",
      sessionId: oldSessionId
    }));

    const currentSnapshot = { ...staleSnapshot, sessionId: newSessionId };
    mocks.executeCommand.mockClear();
    mocks.executeCommand.mockImplementationOnce(async (command: string) => {
      expect(command).toBe(MODULE_PREVIEW_INSERT_INSTANCE_COMMAND);
      return undefined;
    });
    await newPanel.receive({ type: "modulePreviewInsertInstance" });
    expect(mocks.executeCommand).toHaveBeenCalledWith(MODULE_PREVIEW_INSERT_INSTANCE_COMMAND);

    await newPanel.receive({
      type: "modulePreviewValueSiteEdit",
      sessionId: currentSnapshot.sessionId,
      documentUri: currentSnapshot.documentUri,
      documentVersion: currentSnapshot.documentVersion,
      normalizedSource: currentSnapshot.normalizedSource,
      sourceRevision: currentSnapshot.sourceRevision,
      sessionRevision: currentSnapshot.sessionRevision,
      targetDefinitionStatementIndex: currentSnapshot.target.definitionStatementIndex,
      targetName: currentSnapshot.target.name,
      definitionStatementIndex: currentSnapshot.groups[0]!.definitionStatementIndex,
      definitionName: currentSnapshot.groups[0]!.name,
      blockKind: currentSnapshot.groups[0]!.kind,
      parameterIndex: 0,
      parameterName: "width"
    });
    expect(newPanel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewValueUnavailable",
      reason: "not-ready"
    }));

    await newPanel.receive(currentSnapshot);
    mocks.nativeShowQuickPick.mockImplementation(async (items: readonly { label: string }[]) =>
      items.find((item) => item.label === "Target: Pocket.width")
    );
    mocks.nativeShowInputBox.mockResolvedValue("12");
    newPanel.webview.postMessage.mockClear();
    await mocks.commandHandlers.get("nuinuiCAD.editModulePreviewValues")!();
    await flushContext();
    expect(mocks.nativeShowInputBox).toHaveBeenCalledTimes(1);
    expect(newPanel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewValueEdit",
      definitionName: "Pocket",
      parameterName: "width",
      expression: "12"
    }));

    mocks.nativeShowInputBox.mockResolvedValue("13");
    await newPanel.receive({
      type: "modulePreviewValueSiteEdit",
      sessionId: currentSnapshot.sessionId,
      documentUri: currentSnapshot.documentUri,
      documentVersion: currentSnapshot.documentVersion,
      normalizedSource: currentSnapshot.normalizedSource,
      sourceRevision: currentSnapshot.sourceRevision,
      sessionRevision: currentSnapshot.sessionRevision,
      targetDefinitionStatementIndex: currentSnapshot.target.definitionStatementIndex,
      targetName: currentSnapshot.target.name,
      definitionStatementIndex: currentSnapshot.groups[0]!.definitionStatementIndex,
      definitionName: currentSnapshot.groups[0]!.name,
      blockKind: currentSnapshot.groups[0]!.kind,
      parameterIndex: 0,
      parameterName: "width"
    });
    expect(mocks.nativeShowInputBox).toHaveBeenCalledTimes(2);
    expect(newPanel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewValueEdit",
      definitionName: "Pocket",
      parameterName: "width",
      expression: "13"
    }));

    feature.dispose();
  });

  it("delivers a parameterless target after eager editable-focus and Webview handshakes", async () => {
    const source = [
      "nui 1",
      "module Preview() {",
      "  point P0 = coordinate(x: 0, y: 0)",
      "  point P1 = coordinate(x: 40, y: 0)",
      "  line Edge = segment(start: @P0, end: @P1)",
      "}"
    ].join("\n");
    const document = createDocument(source);
    const panel = createPanel({
      startupMessages: [
        { type: "webviewEditableFocus", focused: false },
        { type: "webviewReady" }
      ]
    });
    mocks.createWebviewPanel.mockReturnValue(panel);
    const analysis = createLanguageAnalysisSession(source);
    mocks.activeTextEditor = {
      document,
      selection: { active: positionAt(source, source.indexOf("module Preview")) }
    };
    mocks.textDocuments = [document];
    mocks.visibleTextEditors = [createEditor(document)];
    const focusContext = createWebviewEditableFocusContext(
      (key, value) => mocks.executeCommand("setContext", key, value)
    );
    const feature = registerModulePreviewFeature({
      languageAnalysisSessionFor: (() => analysis) as never,
      canvasThemeGeneration: () => 0,
      webviewHtml: () => "<html />",
      canvasRibbons: () => [],
      updateCanvasRibbonPosition: () => undefined,
      editCanvasRibbon: () => undefined,
      evaluateWithRust: async () => ({}),
      attachWebviewEditableFocus: focusContext.attach
    });
    const open = mocks.commandHandlers.get("nuinuiCAD.openModulePreview");
    if (!open) throw new Error("expected open Module Preview command");

    open();
    await acknowledgeBootstrap(panel);

    const expectedTarget = source.indexOf("module Preview");
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewTarget",
      documentVersion: 1,
      normalizedSourceOffset: expectedTarget
    }));
    expect(panel.webview.postMessage.mock.calls.filter(([message]) =>
      (message as { type?: string }).type === "modulePreviewTarget"
    )).toHaveLength(1);

    const childPosition = positionAt(source, source.indexOf("point P0"));
    mocks.activeTextEditor.selection.active = childPosition;
    open();
    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(panel.webview.postMessage.mock.calls.filter(([message]) =>
      (message as { type?: string }).type === "modulePreviewTarget"
    )).toHaveLength(1);

    await acknowledgeBootstrap(panel);
    expect(panel.webview.postMessage.mock.calls.filter(([message]) =>
      (message as { type?: string }).type === "modulePreviewTarget"
    )).toHaveLength(2);
    expect(panel.webview.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "modulePreviewTarget",
      documentVersion: 1,
      normalizedSourceOffset: expectedTarget
    }));
    expect(panel.webview.postMessage.mock.calls.filter(([message]) =>
      (message as { type?: string }).type === "modulePreviewTarget"
    )).toHaveLength(2);
    feature.dispose();
    focusContext.dispose();
  });

  it("fails closed when the open target identity disappears instead of rebinding to its ancestor", async () => {
    const source = [
      "nui 1",
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
      canvasThemeGeneration: () => 0,
      webviewHtml: () => "<html />",
      canvasRibbons: () => [],
      updateCanvasRibbonPosition: () => undefined,
      editCanvasRibbon: () => undefined,
      evaluateWithRust: async () => ({})
    });
    mocks.commandHandlers.get("nuinuiCAD.openModulePreview")!();
    await panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(panel);
    panel.webview.postMessage.mockClear();

    const nextSource = [
      "nui 1",
      "module Outer() {",
      "  point A = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n");
    document.setSource(nextSource);
    for (const listener of mocks.documentChangeListeners) {
      listener({ document, contentChanges: [{}] });
    }
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewBootstrap",
      documentVersion: 2
    }));
    await acknowledgeBootstrap(panel);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewTargetUnavailable",
      documentVersion: 2
    }));
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewTarget",
      documentVersion: 2,
      normalizedSourceOffset: nextSource.indexOf("module Outer")
    }));

    feature.dispose();
  });

  it("uses an exact-current context key only for the Source context menu", async () => {
    const source = [
      "nui 1",
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
      canvasThemeGeneration: () => 0,
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

  const registerInvocationFixture = (
    source: string,
    hostAnalysis = createLanguageAnalysisSession(source),
    displayLanguage = "en"
  ) => {
    const document = createDocument(source);
    const editor = createEditor(document);
    editor.selection.active = positionAt(source, source.indexOf("module Pocket"));
    const panel = createPanel();
    mocks.createWebviewPanel.mockReturnValue(panel);
    mocks.activeTextEditor = {
      document,
      selection: { active: positionAt(source, source.indexOf("module Pocket")) }
    };
    mocks.visibleTextEditors = [editor];
    mocks.textDocuments = [document];
    const feature = registerModulePreviewFeature({
      languageAnalysisSessionFor: () => hostAnalysis,
      canvasThemeGeneration: () => 0,
      webviewHtml: () => "<html />",
      canvasRibbons: () => [],
      updateCanvasRibbonPosition: () => undefined,
      editCanvasRibbon: () => undefined,
      evaluateWithRust: async () => ({}),
      displayLanguageFor: () => displayLanguage
    });
    mocks.commandHandlers.get("nuinuiCAD.openModulePreview")!();
    return { document, panel, feature, analysis: hostAnalysis };
  };

  const valueSnapshotFor = (
    document: TestDocument,
    analysis: ReturnType<typeof createLanguageAnalysisSession>,
    parameter: { name: string; type: { kind: "number" | "point" | "line" | "path" }; value: string }
  ): VscodeModulePreviewValueSnapshot => {
    const compiled = analysis.runtimeEvaluationSnapshot()!.compiled;
    const definition = compiled.moduleSemanticAnalysis!.definitions.find((candidate) => candidate.name === "Pocket")!;
    return {
      type: "modulePreviewValueSnapshot",
      sessionId: "module-preview-session:1",
      documentUri: document.uri.toString(),
      documentVersion: document.version,
      normalizedSource: document.getText(),
      sourceRevision: analysis.getSourceRevision(),
      sessionRevision: 1,
      target: { definitionStatementIndex: definition.statementIndex, name: definition.name },
      groups: [{
        kind: "target",
        definitionStatementIndex: definition.statementIndex,
        name: definition.name,
        parameters: [{
          parameterIndex: 0,
          name: parameter.name,
          type: parameter.type,
          optional: false,
          required: true,
          defaultSourceText: null,
          value: parameter.value,
          valueState: "explicit",
          diagnostic: null
        }]
      }],
      inputDiagnostics: [],
      previewStatus: "current"
    };
  };

  it("inserts the current target values through one native Source edit and selects the generated name", async () => {
    const source = [
      "nui 1",
      "point Top = coordinate(x: 0, y: 0)",
      "module Pocket(anchor: point) {",
      "}",
      ""
    ].join("\n");
    const { document, panel, feature, analysis } = registerInvocationFixture(source);
    const editor = mocks.visibleTextEditors[0]!;
    await panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(panel);
    const sessionId = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "modulePreviewBootstrap")?.sessionId as string;
    const snapshot = { ...valueSnapshotFor(document, analysis, { name: "anchor", type: { kind: "point" }, value: "@Top" }), sessionId };
    await panel.receive(snapshot);
    mocks.showTextDocument.mockResolvedValue(editor);

    await panel.receive({ type: "modulePreviewInsertInstance" });

    expect(document.getText()).toBe([
      "nui 1",
      "point Top = coordinate(x: 0, y: 0)",
      "module Pocket(anchor: point) {",
      "}",
      "instance PocketInstance = Pocket(anchor: @Top)",
      ""
    ].join("\n"));
    expect(editor.edit).toHaveBeenCalledTimes(1);
    expect(editor.edit).toHaveBeenCalledWith(expect.any(Function), {
      undoStopBefore: true,
      undoStopAfter: true
    });
    expect(mocks.showTextDocument).toHaveBeenCalledWith(document, expect.objectContaining({ preserveFocus: false, preview: false }));
    expect(editor.selection.active).toEqual({ line: 4, character: 23 });
    expect(editor.revealRange).toHaveBeenCalledTimes(1);
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("uses the visible same-document Source caret at execution time", async () => {
    const source = [
      "nui 1",
      "point Top = coordinate(x: 0, y: 0)",
      "module Pocket(anchor: point) {",
      "}",
      "point After = coordinate(x: 2, y: 0)",
      ""
    ].join("\n");
    const { document, panel, feature, analysis } = registerInvocationFixture(source);
    const editor = mocks.visibleTextEditors[0]!;
    await panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(panel);
    const sessionId = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "modulePreviewBootstrap")?.sessionId as string;
    const snapshot = { ...valueSnapshotFor(document, analysis, { name: "anchor", type: { kind: "point" }, value: "@Top" }), sessionId };
    await panel.receive(snapshot);
    editor.selection.active = positionAt(source, source.indexOf("point After"));
    mocks.showTextDocument.mockResolvedValue(editor);

    await panel.receive({ type: "modulePreviewInsertInstance" });

    expect(document.getText()).toBe([
      "nui 1",
      "point Top = coordinate(x: 0, y: 0)",
      "module Pocket(anchor: point) {",
      "}",
      "point After = coordinate(x: 2, y: 0)",
      "instance PocketInstance = Pocket(anchor: @Top)",
      ""
    ].join("\n"));
    expect(editor.edit).toHaveBeenCalledTimes(1);
    feature.dispose();
  });

  it("presents an illegal nested lexical insertion through native VS Code error notification", async () => {
    const source = [
      "nui 1",
      "point Top = coordinate(x: 0, y: 0)",
      "module Outer() {",
      "  module Pocket(anchor: point) {",
      "  }",
      "}",
      ""
    ].join("\n");
    const { document, panel, feature, analysis } = registerInvocationFixture(source, undefined, "ja");
    const editor = mocks.visibleTextEditors[0]!;
    await panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(panel);
    const sessionId = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "modulePreviewBootstrap")?.sessionId as string;
    await panel.receive({
      ...valueSnapshotFor(document, analysis, { name: "anchor", type: { kind: "point" }, value: "@Top" }),
      sessionId
    });
    editor.selection.active = positionAt(source, source.length);
    mocks.showErrorMessage.mockClear();

    await panel.receive({ type: "modulePreviewInsertInstance" });

    expect(editor.edit).not.toHaveBeenCalled();
    expect(document.getText()).toBe(source);
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "現在のSource挿入位置では対象のModuleを参照できません。"
    );
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "modulePreviewInsertInstanceResult" })
    );
    feature.dispose();
  });

  it("fails closed when the same-document Source editor is unavailable or the visible editor is for another document", async () => {
    const source = [
      "nui 1",
      "point Top = coordinate(x: 0, y: 0)",
      "module Pocket(anchor: point) {",
      "}",
      ""
    ].join("\n");
    const unavailable = registerInvocationFixture(source);
    const unavailableEditor = mocks.visibleTextEditors[0]!;
    await unavailable.panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(unavailable.panel);
    const unavailableSessionId = unavailable.panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "modulePreviewBootstrap")?.sessionId as string;
    await unavailable.panel.receive({ ...valueSnapshotFor(unavailable.document, unavailable.analysis, { name: "anchor", type: { kind: "point" }, value: "@Top" }), sessionId: unavailableSessionId });
    mocks.visibleTextEditors = [];
    await unavailable.panel.receive({ type: "modulePreviewInsertInstance" });
    expect(unavailableEditor.edit).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith("The current same-document Source editor is not available.");
    unavailable.feature.dispose();

    const wrongDocument = registerInvocationFixture(source);
    const wrongEditor = createEditor(createDocument(source, "file:///workspace/other.nui"));
    mocks.visibleTextEditors = [wrongEditor];
    await wrongDocument.panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(wrongDocument.panel);
    const wrongSessionId = wrongDocument.panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "modulePreviewBootstrap")?.sessionId as string;
    await wrongDocument.panel.receive({ ...valueSnapshotFor(wrongDocument.document, wrongDocument.analysis, { name: "anchor", type: { kind: "point" }, value: "@Top" }), sessionId: wrongSessionId });
    await wrongDocument.panel.receive({ type: "modulePreviewInsertInstance" });
    expect(wrongEditor.edit).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith("The current same-document Source editor is not available.");
    wrongDocument.feature.dispose();
  });

  it("shows a localized generic rejection when VS Code throws while applying an insertion", async () => {
    const source = [
      "nui 1",
      "point Top = coordinate(x: 0, y: 0)",
      "module Pocket(anchor: point) {",
      "}",
      ""
    ].join("\n");
    const { document, panel, feature, analysis } = registerInvocationFixture(source, undefined, "ja");
    const editor = mocks.visibleTextEditors[0]!;
    await panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(panel);
    const sessionId = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "modulePreviewBootstrap")?.sessionId as string;
    await panel.receive({
      ...valueSnapshotFor(document, analysis, { name: "anchor", type: { kind: "point" }, value: "@Top" }),
      sessionId
    });
    editor.edit.mockRejectedValue(new Error("private editor failure detail"));

    await panel.receive({ type: "modulePreviewInsertInstance" });

    expect(document.getText()).toBe(source);
    expect(mocks.showErrorMessage).toHaveBeenCalledWith("VS CodeがModuleインスタンスのSource編集を拒否しました。");
    expect(mocks.showErrorMessage).not.toHaveBeenCalledWith("private editor failure detail");
    feature.dispose();
  });

  it("localizes Insert Instance preflight rejections without applying Source edits", async () => {
    const source = [
      "nui 1",
      "point Top = coordinate(x: 0, y: 0)",
      "module Pocket(anchor: point) {",
      "}",
      ""
    ].join("\n");
    const cases = [
      { kind: "missing-group", expected: "現在のModule Previewに正確な対象値グループがありません。" },
      { kind: "incomplete", expected: "インスタンスを挿入する前に必須の対象値を入力してください。" },
      { kind: "empty-argument", expected: "現在のModule Previewに空の明示引数があります。" },
      { kind: "source-editor", expected: "同じ文書を表示する現在のSource Editorを利用できません。" }
    ] as const;

    for (const item of cases) {
      const { document, panel, feature, analysis } = registerInvocationFixture(source, undefined, "ja");
      const editor = mocks.visibleTextEditors[0]!;
      await panel.receive({ type: "webviewReady" });
      await acknowledgeBootstrap(panel);
      const sessionId = panel.webview.postMessage.mock.calls
        .map(([message]) => message)
        .find((message) => message?.type === "modulePreviewBootstrap")?.sessionId as string;
      const base = valueSnapshotFor(document, analysis, { name: "anchor", type: { kind: "point" }, value: "@Top" });
      const baseGroup = base.groups[0]!;
      const baseParameter = baseGroup.parameters[0]!;
      const groups = item.kind === "missing-group"
        ? []
        : [{
          ...baseGroup,
          parameters: [{
            ...baseParameter,
            value: item.kind === "incomplete" ? "" : item.kind === "empty-argument" ? "" : "@Top",
            valueState: item.kind === "incomplete" ? "required-missing" as const : "explicit" as const
          }]
        }];
      await panel.receive({ ...base, sessionId, groups });
      if (item.kind === "source-editor") mocks.visibleTextEditors = [];

      await panel.receive({ type: "modulePreviewInsertInstance" });

      expect(editor.edit).not.toHaveBeenCalled();
      expect(document.getText()).toBe(source);
      expect(mocks.showErrorMessage).toHaveBeenLastCalledWith(item.expected);
      feature.dispose();
    }
  });

  it("fails closed without editing for stale source, session, or target proof", async () => {
    const source = [
      "nui 1",
      "point Top = coordinate(x: 0, y: 0)",
      "module Pocket(anchor: point) {",
      "}",
      ""
    ].join("\n");
    const staleSource = registerInvocationFixture(source);
    const staleEditor = mocks.visibleTextEditors[0]!;
    await staleSource.panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(staleSource.panel);
    const staleSessionId = staleSource.panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "modulePreviewBootstrap")?.sessionId as string;
    const staleSnapshot = { ...valueSnapshotFor(staleSource.document, staleSource.analysis, { name: "anchor", type: { kind: "point" }, value: "@Top" }), sessionId: staleSessionId };
    await staleSource.panel.receive(staleSnapshot);
    staleSource.document.setSource(source.replace("y: 0", "y: 1"));
    await staleSource.panel.receive({ type: "modulePreviewInsertInstance" });
    expect(staleEditor.edit).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith("Module Preview session is no longer authoritative.");
    staleSource.feature.dispose();

    const wrongSession = registerInvocationFixture(source);
    const wrongSessionEditor = mocks.visibleTextEditors[0]!;
    await wrongSession.panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(wrongSession.panel);
    const currentSessionId = wrongSession.panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "modulePreviewBootstrap")?.sessionId as string;
    const currentSnapshot = { ...valueSnapshotFor(wrongSession.document, wrongSession.analysis, { name: "anchor", type: { kind: "point" }, value: "@Top" }), sessionId: currentSessionId };
    await wrongSession.panel.receive({ ...currentSnapshot, sessionId: "module-preview-session:wrong" });
    await wrongSession.panel.receive({ type: "modulePreviewInsertInstance" });
    expect(wrongSessionEditor.edit).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith("The current Module Preview values are not exact-current.");
    wrongSession.feature.dispose();

    const wrongTarget = registerInvocationFixture(source);
    const wrongTargetEditor = mocks.visibleTextEditors[0]!;
    await wrongTarget.panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(wrongTarget.panel);
    const wrongTargetSessionId = wrongTarget.panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "modulePreviewBootstrap")?.sessionId as string;
    const targetSnapshot = { ...valueSnapshotFor(wrongTarget.document, wrongTarget.analysis, { name: "anchor", type: { kind: "point" }, value: "@Top" }), sessionId: wrongTargetSessionId };
    await wrongTarget.panel.receive({
      ...targetSnapshot,
      target: { ...targetSnapshot.target, name: "Other" }
    });
    await wrongTarget.panel.receive({ type: "modulePreviewInsertInstance" });
    expect(wrongTargetEditor.edit).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith("The current Module Preview values are not exact-current.");
    wrongTarget.feature.dispose();
  });

  it("does not edit when the retained Preview is last-good or has a target error", async () => {
    const source = [
      "nui 1",
      "point Top = coordinate(x: 0, y: 0)",
      "module Pocket(anchor: point) {",
      "}",
      ""
    ].join("\n");
    const { document, panel, feature, analysis } = registerInvocationFixture(source);
    const editor = mocks.visibleTextEditors[0]!;
    await panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(panel);
    const sessionId = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "modulePreviewBootstrap")?.sessionId as string;
    const snapshot = { ...valueSnapshotFor(document, analysis, { name: "anchor", type: { kind: "point" }, value: "@Top" }), sessionId };
    mocks.showTextDocument.mockResolvedValue(editor);

    await panel.receive({ ...snapshot, previewStatus: "lastGood" });
    await panel.receive({ type: "modulePreviewInsertInstance" });
    expect(editor.edit).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith("The current Module Preview values are not exact-current.");

    await acknowledgeBootstrap(panel);
    await panel.receive({ ...snapshot, sessionRevision: 2, groups: [{
      ...snapshot.groups[0]!,
      parameters: [{ ...snapshot.groups[0]!.parameters[0]!, value: "", valueState: "required-missing" }
      ]
    }] });
    await panel.receive({ type: "modulePreviewInsertInstance" });
    expect(editor.edit).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith("Complete the required target values before inserting an instance.");
    feature.dispose();
  });

  it("orders native Preview Values sites and applies scalar edits without Source mutation", async () => {
    const source = [
      "nui 1",
      "module Outer(scale: number) {",
      "  module Pocket(width: number) {",
      "    point P = coordinate(x: @width, y: 0)",
      "  }",
      "}"
    ].join("\n");
    const { document, panel, feature, analysis } = registerInvocationFixture(source);
    await panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(panel);
    const sessionId = panel.webview.postMessage.mock.calls.map(([message]) => message).find((message) => message?.type === "modulePreviewBootstrap")?.sessionId as string;
    const snapshot = { ...valueSnapshotFor(document, analysis, { name: "width", type: { kind: "number" }, value: "12" }), sessionId };
    const contextDefinition = analysis.runtimeEvaluationSnapshot()!.compiled.moduleSemanticAnalysis!.definitions.find((definition) => definition.name === "Outer")!;
    const targetGroup = snapshot.groups[0]!;
    const enrichedSnapshot: VscodeModulePreviewValueSnapshot = {
      ...snapshot,
      groups: [{
        kind: "ancestor", definitionStatementIndex: contextDefinition.statementIndex, name: "Outer",
        parameters: [{ parameterIndex: 0, name: "scale", type: { kind: "number" }, optional: false, required: true, defaultSourceText: null, value: "2", valueState: "explicit", diagnostic: null }]
      }, targetGroup]
    };
    await panel.receive(enrichedSnapshot);
    mocks.nativeShowQuickPick.mockImplementation(async (items: readonly { label: string }[]) => items[1]);
    mocks.nativeShowInputBox.mockResolvedValue("13");
    panel.webview.postMessage.mockClear();
    const command = mocks.commandHandlers.get("nuinuiCAD.editModulePreviewValues")!();
    await command;
    await flushContext();
    expect(mocks.nativeShowQuickPick.mock.calls[0]?.[0].map((item: { label: string }) => item.label)).toEqual([
      "Context: Outer.scale",
      "Target: Pocket.width"
    ]);
    expect(mocks.nativeShowInputBox).toHaveBeenCalledTimes(1);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewValueEdit",
      definitionName: "Pocket",
      parameterName: "width",
      expression: "13"
    }));
    expect(document.getText()).toBe(source);
    feature.dispose();
  });

  it("localizes native Preview Values rows while retaining order, value states, site proofs, and submitted expressions", async () => {
    const source = [
      "nui 1",
      "module Outer(scale: number) {",
      "  module Pocket(width: number) {",
      "  }",
      "}"
    ].join("\n");
    const { document, panel, feature, analysis } = registerInvocationFixture(source, undefined, "ja-JP");
    await panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(panel);
    const sessionId = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "modulePreviewBootstrap")?.sessionId as string;
    const base = valueSnapshotFor(document, analysis, { name: "width", type: { kind: "number" }, value: "12" });
    const outer = analysis.runtimeEvaluationSnapshot()!.compiled.moduleSemanticAnalysis!.definitions
      .find((definition) => definition.name === "Outer")!;
    const baseParameter = base.groups[0]!.parameters[0]!;
    const parameter = (overrides: Partial<VscodeModulePreviewValueParameter>): VscodeModulePreviewValueParameter => ({
      ...baseParameter,
      ...overrides
    });
    const snapshot: VscodeModulePreviewValueSnapshot = {
      ...base,
      sessionId,
      groups: [
        {
          kind: "ancestor",
          definitionStatementIndex: outer.statementIndex,
          name: "Outer",
          parameters: [
            parameter({ parameterIndex: 0, name: "scale", value: "2", valueState: "explicit" }),
            parameter({ parameterIndex: 1, name: "ease", value: "", defaultSourceText: "4", valueState: "omitted-defaulted" }),
            parameter({ parameterIndex: 2, name: "optionalEase", value: "", defaultSourceText: null, optional: true, required: false, valueState: "omitted-optional" }),
            parameter({ parameterIndex: 3, name: "requiredEase", value: "", valueState: "required-missing" }),
            parameter({ parameterIndex: 4, name: "invalidEase", value: "?", valueState: "invalid" })
          ]
        },
        {
          ...base.groups[0]!,
          parameters: [parameter({ parameterIndex: 0, name: "width", value: "12", valueState: "explicit" })]
        }
      ]
    };
    await panel.receive(snapshot);
    mocks.nativeShowQuickPick.mockImplementation(async (items: readonly unknown[]) => items.at(-1));
    mocks.nativeShowInputBox.mockResolvedValue(" 13 ");
    panel.webview.postMessage.mockClear();

    await mocks.commandHandlers.get("nuinuiCAD.editModulePreviewValues")!();
    await flushContext();

    const [items, options] = mocks.nativeShowQuickPick.mock.calls[0]! as [
      ReadonlyArray<{ label: string; description: string; detail: string; site: Record<string, unknown> }>,
      { placeHolder: string }
    ];
    expect(items.map((item) => item.label)).toEqual([
      "コンテキスト: Outer.scale",
      "コンテキスト: Outer.ease",
      "コンテキスト: Outer.optionalEase",
      "コンテキスト: Outer.requiredEase",
      "コンテキスト: Outer.invalidEase",
      "対象: Pocket.width"
    ]);
    expect(items.map((item) => item.description)).toEqual([
      "明示値: 2",
      "省略・デフォルト: 4",
      "省略・任意",
      "必須値がありません",
      "無効: ?",
      "明示値: 12"
    ]);
    expect(items.every((item) => item.detail === "number パラメータ")).toBe(true);
    expect(options.placeHolder).toBe("編集するModule Previewの値を選択");
    expect(items.at(-1)?.site).toMatchObject({
      sessionId,
      targetDefinitionStatementIndex: base.target.definitionStatementIndex,
      targetName: "Pocket",
      definitionStatementIndex: base.target.definitionStatementIndex,
      definitionName: "Pocket",
      blockKind: "target",
      parameterIndex: 0,
      parameterName: "width"
    });
    expect(mocks.nativeShowInputBox).toHaveBeenCalledWith({ prompt: "対象 Pocket.width", value: "12" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewValueEdit",
      definitionStatementIndex: base.target.definitionStatementIndex,
      definitionName: "Pocket",
      blockKind: "target",
      parameterIndex: 0,
      parameterName: "width",
      expression: " 13 "
    }));
    expect(document.getText()).toBe(source);

    mocks.nativeShowQuickPick.mockImplementation(async (items: readonly unknown[]) => items[0]);
    mocks.nativeShowInputBox.mockResolvedValue("3");
    panel.webview.postMessage.mockClear();
    await mocks.commandHandlers.get("nuinuiCAD.editModulePreviewValues")!();
    await flushContext();
    expect(mocks.nativeShowInputBox).toHaveBeenLastCalledWith({ prompt: "コンテキスト Outer.scale", value: "2" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewValueEdit",
      definitionStatementIndex: outer.statementIndex,
      definitionName: "Outer",
      blockKind: "ancestor",
      parameterIndex: 0,
      parameterName: "scale",
      expression: "3"
    }));
    feature.dispose();
  });

  it("opens a direct scalar status-site edit without the generic parameter QuickPick", async () => {
    const source = [
      "nui 1",
      "module Pocket(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}"
    ].join("\n");
    const { document, panel, feature, analysis } = registerInvocationFixture(source);
    await panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(panel);
    const sessionId = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "modulePreviewBootstrap")?.sessionId as string;
    const snapshot = { ...valueSnapshotFor(document, analysis, { name: "width", type: { kind: "number" }, value: "" }), sessionId };
    await panel.receive(snapshot);
    const group = snapshot.groups[0]!;
    const parameter = group.parameters[0]!;
    mocks.nativeShowInputBox.mockResolvedValue("13");
    panel.webview.postMessage.mockClear();

    await panel.receive({
      type: "modulePreviewValueSiteEdit",
      sessionId: snapshot.sessionId,
      documentUri: snapshot.documentUri,
      documentVersion: snapshot.documentVersion,
      normalizedSource: snapshot.normalizedSource,
      sourceRevision: snapshot.sourceRevision,
      sessionRevision: snapshot.sessionRevision,
      targetDefinitionStatementIndex: snapshot.target.definitionStatementIndex,
      targetName: snapshot.target.name,
      definitionStatementIndex: group.definitionStatementIndex,
      definitionName: group.name,
      blockKind: group.kind,
      parameterIndex: parameter.parameterIndex,
      parameterName: parameter.name
    });
    await flushContext();

    expect(mocks.nativeShowQuickPick).not.toHaveBeenCalled();
    expect(mocks.nativeShowInputBox).toHaveBeenCalledTimes(1);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewValueEdit",
      definitionName: "Pocket",
      parameterName: "width",
      expression: "13"
    }));
    expect(document.getText()).toBe(source);
    feature.dispose();
  });

  it("rejects a stale direct status-site proof without opening or applying an editor", async () => {
    const source = [
      "nui 1",
      "module Pocket(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}"
    ].join("\n");
    const { document, panel, feature, analysis } = registerInvocationFixture(source);
    await panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(panel);
    const sessionId = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "modulePreviewBootstrap")?.sessionId as string;
    const snapshot = { ...valueSnapshotFor(document, analysis, { name: "width", type: { kind: "number" }, value: "" }), sessionId };
    await panel.receive(snapshot);
    const group = snapshot.groups[0]!;
    const parameter = group.parameters[0]!;
    mocks.nativeShowInputBox.mockResolvedValue("13");
    panel.webview.postMessage.mockClear();

    await panel.receive({
      type: "modulePreviewValueSiteEdit",
      sessionId: snapshot.sessionId,
      documentUri: snapshot.documentUri,
      documentVersion: snapshot.documentVersion,
      normalizedSource: snapshot.normalizedSource,
      sourceRevision: snapshot.sourceRevision,
      sessionRevision: snapshot.sessionRevision + 1,
      targetDefinitionStatementIndex: snapshot.target.definitionStatementIndex,
      targetName: snapshot.target.name,
      definitionStatementIndex: group.definitionStatementIndex,
      definitionName: group.name,
      blockKind: group.kind,
      parameterIndex: parameter.parameterIndex,
      parameterName: parameter.name
    });
    await flushContext();

    expect(mocks.nativeShowQuickPick).not.toHaveBeenCalled();
    expect(mocks.nativeShowInputBox).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "modulePreviewValueEdit" }));
    expect(document.getText()).toBe(source);
    feature.dispose();
  });

  it("preserves exact-current value authority after stale feedback and immediately reopens Preview Values", async () => {
    const source = [
      "nui 1",
      "module Pocket(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}"
    ].join("\n");
    const { document, panel, feature, analysis } = registerInvocationFixture(source);
    await panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(panel);
    const sessionId = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "modulePreviewBootstrap")?.sessionId as string;
    const snapshot = {
      ...valueSnapshotFor(document, analysis, { name: "width", type: { kind: "number" }, value: "12" }),
      sessionId
    };
    await panel.receive(snapshot);
    const group = snapshot.groups[0]!;
    const parameter = group.parameters[0]!;
    panel.webview.postMessage.mockClear();

    await panel.receive({
      type: "modulePreviewValueSiteEdit",
      sessionId: snapshot.sessionId,
      documentUri: snapshot.documentUri,
      documentVersion: snapshot.documentVersion,
      normalizedSource: snapshot.normalizedSource,
      sourceRevision: snapshot.sourceRevision,
      sessionRevision: snapshot.sessionRevision + 1,
      targetDefinitionStatementIndex: snapshot.target.definitionStatementIndex,
      targetName: snapshot.target.name,
      definitionStatementIndex: group.definitionStatementIndex,
      definitionName: group.name,
      blockKind: group.kind,
      parameterIndex: parameter.parameterIndex,
      parameterName: parameter.name
    });
    await flushContext();

    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewValueUnavailable"
    }));

    mocks.nativeShowQuickPick.mockImplementation(async (items: readonly unknown[]) => items[0]);
    mocks.nativeShowInputBox.mockResolvedValue("13");
    panel.webview.postMessage.mockClear();
    await mocks.commandHandlers.get("nuinuiCAD.editModulePreviewValues")!();
    await flushContext();

    expect(mocks.nativeShowInputBox).toHaveBeenCalledTimes(1);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewValueEdit",
      definitionName: "Pocket",
      parameterName: "width",
      expression: "13"
    }));
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("waits through cold-start hydration until the exact-current value snapshot arrives", async () => {
    const source = [
      "nui 1",
      "module Pocket(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}"
    ].join("\n");
    const { document, panel, feature, analysis } = registerInvocationFixture(source);
    const command = mocks.commandHandlers.get("nuinuiCAD.editModulePreviewValues")!;

    command();
    await flushContext();
    expect(mocks.nativeShowQuickPick).not.toHaveBeenCalled();

    await panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(panel);
    const sessionId = panel.webview.postMessage.mock.calls
      .map(([message]) => message as { type?: string; sessionId?: string })
      .find((message) => message.type === "modulePreviewBootstrap")?.sessionId;
    if (!sessionId) throw new Error("expected Module Preview session identity");
    const target = analysis.runtimeEvaluationSnapshot()!.compiled.moduleSemanticAnalysis!.definitions
      .find((definition) => definition.name === "Pocket")!;

    await panel.receive({
      type: "modulePreviewValueUnavailable",
      sessionId,
      documentUri: document.uri.toString(),
      documentVersion: document.version,
      normalizedSource: source,
      sourceRevision: analysis.getSourceRevision(),
      sessionRevision: 1,
      target: { definitionStatementIndex: target.statementIndex, name: target.name },
      reason: "source-stale"
    });
    await flushContext();
    expect(mocks.nativeShowQuickPick).not.toHaveBeenCalled();

    await panel.receive({
      ...valueSnapshotFor(document, analysis, {
        name: "width",
        type: { kind: "number" },
        value: "12"
      }),
      sessionId,
      sessionRevision: 2
    });
    await flushContext();
    expect(mocks.nativeShowQuickPick).toHaveBeenCalledTimes(1);
    feature.dispose();
  });

  it("does not replace a snapshot that arrives at the Preview Values timeout boundary", async () => {
    vi.useFakeTimers();
    try {
      const source = [
        "nui 1",
        "module Pocket(width: number) {",
        "  point P = coordinate(x: @width, y: 0)",
        "}"
      ].join("\n");
      const { document, panel, feature, analysis } = registerInvocationFixture(source);
      await panel.receive({ type: "webviewReady" });
      await acknowledgeBootstrap(panel);
      const command = mocks.commandHandlers.get("nuinuiCAD.editModulePreviewValues")!;
      command();

      vi.advanceTimersByTime(5000);
      const sessionId = panel.webview.postMessage.mock.calls
        .map(([message]) => message as { type?: string; sessionId?: string })
      .find((message) => message.type === "modulePreviewBootstrap")?.sessionId;
      if (!sessionId) throw new Error("expected Module Preview session identity");
      const lateSnapshot = {
        ...valueSnapshotFor(document, analysis, { name: "width", type: { kind: "number" }, value: "12" }),
        sessionId
      };
      const snapshotDelivery = panel.receive(lateSnapshot);
      await snapshotDelivery;
      await flushContext();

      expect(mocks.showErrorMessage).toHaveBeenCalledTimes(1);
      mocks.nativeShowQuickPick.mockImplementation(async (items: readonly unknown[]) => items[0]);
      mocks.nativeShowInputBox.mockResolvedValue("13");
      panel.webview.postMessage.mockClear();
      command();
      await flushContext();

      expect(mocks.nativeShowInputBox).toHaveBeenCalledTimes(1);
      expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: "modulePreviewValueEdit",
        definitionName: "Pocket",
        parameterName: "width",
        expression: "13"
      }));
      feature.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("routes geometry values through Reference Pick and applies only the selected site", async () => {
    const source = [
      "nui 1",
      "point Top = coordinate(x: 0, y: 0)",
      "module Pocket(anchor: point) {",
      "}"
    ].join("\n");
    const { document, panel, feature, analysis } = registerInvocationFixture(source);
    await panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(panel);
    const sessionId = panel.webview.postMessage.mock.calls.map(([message]) => message).find((message) => message?.type === "modulePreviewBootstrap")?.sessionId as string;
    const snapshot = { ...valueSnapshotFor(document, analysis, { name: "anchor", type: { kind: "point" }, value: "" }), sessionId };
    await panel.receive({ ...snapshot, groups: [{ ...snapshot.groups[0]!, parameters: [{ ...snapshot.groups[0]!.parameters[0]!, value: "", valueState: "required-missing" }] }] });
    mocks.nativeShowQuickPick.mockImplementation(async (items: readonly { label: string }[]) => items[0]);
    panel.webview.postMessage.mockClear();
    const command = mocks.commandHandlers.get("nuinuiCAD.editModulePreviewValues")!();
    await command;
    await flushContext();
    const request = panel.webview.postMessage.mock.calls.map(([message]) => message).find((message) => message?.type === "modulePreviewReferencePickStartRequest");
    expect(request).toEqual(expect.objectContaining({ definitionName: "Pocket", parameterName: "anchor", expectedGeometryInterface: "point" }));
    if (!request) throw new Error("expected Reference Pick request");
    await panel.receive({ ...request, type: "modulePreviewReferencePickResult", status: "started", candidateReferences: [{ base: "Top" }] });
    await panel.receive({ ...request, type: "modulePreviewReferencePickResult", status: "confirmed", resultKind: "geometry", references: [{ base: "Top" }] });
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "modulePreviewValueEdit", parameterName: "anchor", expression: "@Top" }));
    feature.dispose();
  });

  it("opens only the geometry-method QuickPick for a direct geometry status-site edit", async () => {
    const source = [
      "nui 1",
      "point Top = coordinate(x: 0, y: 0)",
      "module Pocket(anchor: point) {",
      "}"
    ].join("\n");
    const { document, panel, feature, analysis } = registerInvocationFixture(source, undefined, "ja");
    await panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(panel);
    const sessionId = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "modulePreviewBootstrap")?.sessionId as string;
    const snapshot = { ...valueSnapshotFor(document, analysis, { name: "anchor", type: { kind: "point" }, value: "" }), sessionId };
    await panel.receive(snapshot);
    const group = snapshot.groups[0]!;
    const parameter = group.parameters[0]!;
    mocks.nativeShowQuickPick.mockResolvedValue({ label: "Canvasから選択", kind: "pick" });
    panel.webview.postMessage.mockClear();

    await panel.receive({
      type: "modulePreviewValueSiteEdit",
      sessionId: snapshot.sessionId,
      documentUri: snapshot.documentUri,
      documentVersion: snapshot.documentVersion,
      normalizedSource: snapshot.normalizedSource,
      sourceRevision: snapshot.sourceRevision,
      sessionRevision: snapshot.sessionRevision,
      targetDefinitionStatementIndex: snapshot.target.definitionStatementIndex,
      targetName: snapshot.target.name,
      definitionStatementIndex: group.definitionStatementIndex,
      definitionName: group.name,
      blockKind: group.kind,
      parameterIndex: parameter.parameterIndex,
      parameterName: parameter.name
    });
    await flushContext();

    expect(mocks.nativeShowQuickPick).toHaveBeenCalledTimes(1);
    expect(mocks.nativeShowQuickPick.mock.calls[0]?.[0].map((item: { label: string; kind: string }) => ({
      label: item.label,
      kind: item.kind
    }))).toEqual([
      { label: "Canvasから選択", kind: "pick" },
      { label: "式を入力...", kind: "expression" }
    ]);
    expect(mocks.nativeShowQuickPick.mock.calls[0]?.[1]).toMatchObject({
      placeHolder: "Pocket.anchorの編集方法を選択"
    });
    expect(mocks.nativeShowInputBox).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewReferencePickStartRequest",
      parameterName: "anchor",
      expectedGeometryInterface: "point"
    }));
    feature.dispose();
  });

  it("offers Enter expression for geometry values through the same ephemeral edit path", async () => {
    const source = [
      "nui 1",
      "point RootA = coordinate(x: 0, y: 0)",
      "module Pocket(anchor: point) {",
      "}"
    ].join("\n");
    const { document, panel, feature, analysis } = registerInvocationFixture(source, undefined, "ja");
    await panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(panel);
    const sessionId = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "modulePreviewBootstrap")?.sessionId as string;
    const snapshot = {
      ...valueSnapshotFor(document, analysis, { name: "anchor", type: { kind: "point" }, value: "" }),
      sessionId,
      groups: [{
        kind: "target" as const,
        definitionStatementIndex: valueSnapshotFor(document, analysis, { name: "anchor", type: { kind: "point" }, value: "" }).groups[0]!.definitionStatementIndex,
        name: "Pocket",
        parameters: [{
          parameterIndex: 0,
          name: "anchor",
          type: { kind: "point" as const },
          optional: false,
          required: true,
          defaultSourceText: null,
          value: "",
          valueState: "required-missing" as const,
          diagnostic: null
        }]
      }]
    } satisfies VscodeModulePreviewValueSnapshot;
    await panel.receive(snapshot);
    mocks.nativeShowQuickPick.mockImplementation(async (items: readonly { label: string; kind?: string }[]) =>
      items[0]?.kind ? items[1] : items[0]
    );
    mocks.nativeShowInputBox.mockResolvedValue("@RootA");
    panel.webview.postMessage.mockClear();

    const command = mocks.commandHandlers.get("nuinuiCAD.editModulePreviewValues")!();
    await command;
    await flushContext();

    expect(mocks.nativeShowQuickPick).toHaveBeenCalledTimes(2);
    expect(mocks.nativeShowQuickPick.mock.calls[1]?.[0].map((item: { label: string; kind: string }) => ({
      label: item.label,
      kind: item.kind
    }))).toEqual([
      { label: "Canvasから選択", kind: "pick" },
      { label: "式を入力...", kind: "expression" }
    ]);
    expect(mocks.nativeShowQuickPick.mock.calls[1]?.[1]).toMatchObject({
      placeHolder: "Pocket.anchorの編集方法を選択"
    });
    expect(mocks.nativeShowInputBox).toHaveBeenCalledTimes(1);
    expect(mocks.nativeShowInputBox).toHaveBeenCalledWith({ prompt: "対象 Pocket.anchor", value: "" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewValueEdit",
      parameterName: "anchor",
      expression: "@RootA"
    }));
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewReferencePickStartRequest"
    }));
    expect(document.getText()).toBe(source);
    feature.dispose();
  });

  it("uses the active exact-current Preview session without Source focus", async () => {
    const source = [
      "nui 1",
      "module Pocket(width: number) {",
      "}"
    ].join("\n");
    const { document, panel, feature, analysis } = registerInvocationFixture(source);
    await panel.receive({ type: "webviewReady" });
    await acknowledgeBootstrap(panel);
    const sessionId = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "modulePreviewBootstrap")?.sessionId as string;
    await panel.receive({
      ...valueSnapshotFor(document, analysis, { name: "width", type: { kind: "number" }, value: "12" }),
      sessionId
    });
    mocks.activeTextEditor!.selection.active = positionAt(source, 0);
    mocks.nativeShowQuickPick.mockResolvedValue(undefined);

    const command = mocks.commandHandlers.get("nuinuiCAD.editModulePreviewValues")!();
    await command;
    await flushContext();

    expect(mocks.nativeShowQuickPick).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ label: "Target: Pocket.width" })
    ]), expect.anything());
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
    feature.dispose();
  });

});
