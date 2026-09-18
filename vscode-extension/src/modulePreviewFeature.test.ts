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
import type { VscodeModulePreviewValueSnapshot } from "../../src/vscode/protocol";

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
  textDocuments: undefined as TestDocument[] | undefined,
  visibleTextEditors: [] as TestEditor[],
  showTextDocument: vi.fn(),
  executeCommand: vi.fn(async () => undefined),
  showErrorMessage: vi.fn(),
  createWebviewPanel: vi.fn()
  ,nativeShowQuickPick: vi.fn()
  ,nativeShowInputBox: vi.fn()
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
  edit: ReturnType<typeof vi.fn>;
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
  TextDocumentChangeReason: { Undo: 1, Redo: 2 }
}));

import {
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
  return { document, edit };
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

const flushContext = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

afterEach(() => {
  cleanup();
  mocks.activeTextEditor = null;
  mocks.commandHandlers.clear();
  mocks.activeEditorListeners.length = 0;
  mocks.selectionListeners.length = 0;
  mocks.themeListeners.length = 0;
  mocks.documentChangeListeners.length = 0;
  mocks.documentCloseListeners.length = 0;
  mocks.configurationListeners.length = 0;
  mocks.textDocuments = undefined;
  mocks.visibleTextEditors.length = 0;
  mocks.executeCommand.mockClear();
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
      updateCanvasRibbonPosition: () => undefined,
      editCanvasRibbon: () => undefined,
      evaluateWithRust: async () => ({}),
      ...options
    });
    mocks.commandHandlers.get("nuinuiCAD.openModulePreview")!();
    return { source, document, editor, panel, analysis, feature };
  };

  const patchRequestFor = (
    fixture: ReturnType<typeof openModulePatchFixture>,
    overrides: Partial<VscodeModulePreviewModelPatchRequest> = {}
  ): VscodeModulePreviewModelPatchRequest => {
    const sessionId = fixture.panel.webview.postMessage.mock.calls
      .map(([message]) => message as { type?: string; sessionId?: string })
      .find((message) => message.type === "modulePreviewSession")?.sessionId;
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
    await fixture.panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
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
    await fixture.panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
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
    await fixture.panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
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
    await staleFixture.panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    await staleFixture.panel.receive(patchRequestFor(staleFixture, { expectedDocumentVersion: 0 }));
    expect(staleFixture.editor.edit).not.toHaveBeenCalled();
    expect(staleFixture.panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewModelPatchResult",
      status: "stale"
    }));
    staleFixture.feature.dispose();

    const mismatchFixture = openModulePatchFixture();
    await mismatchFixture.panel.receive({ type: "webviewReady" });
    await mismatchFixture.panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
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
    await unavailableFixture.panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
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
      await fixture.panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
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
      expect(fixture.panel.webview.postMessage).toHaveBeenCalledWith({
        type: "commitText",
        sourceText: fixture.document.getText(),
        documentVersion: 2,
        reason: direction
      });

      await fixture.panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 2 });
      expect(fixture.panel.webview.postMessage).toHaveBeenCalledWith({
        type: "modulePreviewTargetUnavailable",
        documentVersion: 2
      });
      expect(fixture.panel.reveal).toHaveBeenCalledWith(undefined, false);
      fixture.feature.dispose();
    }
  );

  it("fails closed before native history when the authoritative document version is stale", async () => {
    const fixture = openModulePatchFixture();
    await fixture.panel.receive({ type: "webviewReady" });
    await fixture.panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    fixture.document.setSource(fixture.source.replace("x: 1", "x: 3"));
    expect(fixture.feature.handoffNativeHistoryIfActive("undo")).toBe(false);
    expect(mocks.showTextDocument).not.toHaveBeenCalled();
    expect(mocks.executeCommand).not.toHaveBeenCalledWith("undo");
    fixture.feature.dispose();
  });

  it("fails closed when the document version drifts during Source activation", async () => {
    const fixture = openModulePatchFixture();
    await fixture.panel.receive({ type: "webviewReady" });
    await fixture.panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
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
    await panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    const initialTarget = {
      type: "modulePreviewTarget",
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

      await panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
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
    await panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 2 });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "modulePreviewTargetUnavailable",
      documentVersion: 2
    });
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewTarget",
      documentVersion: 2
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
    await panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });

    const expectedTarget = source.indexOf("module Preview");
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "modulePreviewTarget",
      documentVersion: 1,
      normalizedSourceOffset: expectedTarget
    });
    expect(panel.webview.postMessage.mock.calls.filter(([message]) =>
      (message as { type?: string }).type === "modulePreviewTarget"
    )).toHaveLength(1);

    const childPosition = positionAt(source, source.indexOf("point P0"));
    mocks.activeTextEditor.selection.active = childPosition;
    open();
    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(panel.webview.postMessage.mock.calls.filter(([message]) =>
      (message as { type?: string }).type === "modulePreviewTarget"
    )).toHaveLength(2);
    expect(panel.webview.postMessage).toHaveBeenLastCalledWith({
      type: "modulePreviewTarget",
      documentVersion: 1,
      normalizedSourceOffset: expectedTarget
    });

    await panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
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
    await panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
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
    hostAnalysis = createLanguageAnalysisSession(source)
  ) => {
    const document = createDocument(source);
    const editor = createEditor(document);
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
      evaluateWithRust: async () => ({})
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
    await panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    const sessionId = panel.webview.postMessage.mock.calls.map(([message]) => message).find((message) => message?.type === "modulePreviewSession")?.sessionId as string;
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

  it("opens a direct scalar status-site edit without the generic parameter QuickPick", async () => {
    const source = [
      "nui 1",
      "module Pocket(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}"
    ].join("\n");
    const { document, panel, feature, analysis } = registerInvocationFixture(source);
    await panel.receive({ type: "webviewReady" });
    await panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    const sessionId = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "modulePreviewSession")?.sessionId as string;
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
    await panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    const sessionId = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "modulePreviewSession")?.sessionId as string;
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
    await panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    const sessionId = panel.webview.postMessage.mock.calls
      .map(([message]) => message as { type?: string; sessionId?: string })
      .find((message) => message.type === "modulePreviewSession")?.sessionId;
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

  it("routes geometry values through Reference Pick and applies only the selected site", async () => {
    const source = [
      "nui 1",
      "point Top = coordinate(x: 0, y: 0)",
      "module Pocket(anchor: point) {",
      "}"
    ].join("\n");
    const { document, panel, feature, analysis } = registerInvocationFixture(source);
    await panel.receive({ type: "webviewReady" });
    await panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    const sessionId = panel.webview.postMessage.mock.calls.map(([message]) => message).find((message) => message?.type === "modulePreviewSession")?.sessionId as string;
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
    const { document, panel, feature, analysis } = registerInvocationFixture(source);
    await panel.receive({ type: "webviewReady" });
    await panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    const sessionId = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "modulePreviewSession")?.sessionId as string;
    const snapshot = { ...valueSnapshotFor(document, analysis, { name: "anchor", type: { kind: "point" }, value: "" }), sessionId };
    await panel.receive(snapshot);
    const group = snapshot.groups[0]!;
    const parameter = group.parameters[0]!;
    mocks.nativeShowQuickPick.mockResolvedValue({ label: "Pick from Canvas", kind: "pick" });
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
    expect(mocks.nativeShowQuickPick.mock.calls[0]?.[0].map((item: { label: string }) => item.label)).toEqual([
      "Pick from Canvas",
      "Enter expression..."
    ]);
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
    const { document, panel, feature, analysis } = registerInvocationFixture(source);
    await panel.receive({ type: "webviewReady" });
    await panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    const sessionId = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "modulePreviewSession")?.sessionId as string;
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
    expect(mocks.nativeShowInputBox).toHaveBeenCalledTimes(1);
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
    await panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    const sessionId = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "modulePreviewSession")?.sessionId as string;
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
