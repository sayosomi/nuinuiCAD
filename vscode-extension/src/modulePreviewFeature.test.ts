import { afterEach, describe, expect, it, vi } from "vitest";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";
import type {
  VscodeModulePreviewParameterSetValueRequest,
  VscodeModulePreviewParameterSnapshot,
  VscodeModulePreviewParameterValueFocus
} from "../../src/vscode/protocol";

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

type TestParameterWebview = {
  postMessage: ReturnType<typeof vi.fn>;
  onDidReceiveMessage: ReturnType<typeof vi.fn>;
  receive: (message: unknown) => Promise<void>;
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
  NUI_MODULE_PREVIEW_VALUE_INPUT_FOCUS_CONTEXT,
  NUI_MODULE_PREVIEW_VALUE_STEP_BACKWARD_COMMAND_ID,
  NUI_MODULE_PREVIEW_VALUE_STEP_FORWARD_COMMAND_ID,
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
  fireViewState: (state?: { active?: boolean; visible?: boolean }) => void;
} => {
  let receiveHandler: ((message: unknown) => unknown) | null = null;
  let disposeHandler: (() => void) | null = null;
  let viewStateHandler: ((event: { webviewPanel: TestPanel }) => void) | null = null;
  const panel = {
    title: "",
    active: true,
    visible: true,
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
    onDidChangeViewState: vi.fn((handler: (event: { webviewPanel: TestPanel }) => void) => {
      viewStateHandler = handler;
      return { dispose: () => undefined };
    }),
    onDidDispose: vi.fn((handler: () => void) => {
      disposeHandler = handler;
      return { dispose: () => undefined };
    }),
    receive: async (message: unknown) => {
      await receiveHandler?.(message);
    },
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

const createParameterWebview = (): TestParameterWebview => {
  let receiveHandler: ((message: unknown) => unknown) | null = null;
  return {
    postMessage: vi.fn(async () => true),
    onDidReceiveMessage: vi.fn((handler: (message: unknown) => unknown) => {
      receiveHandler = handler;
      return { dispose: () => undefined };
    }),
    receive: async (message) => {
      await receiveHandler?.(message);
    }
  };
};

const flushContext = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const parameterSnapshotFor = ({
  sessionId,
  document,
  target,
  sourceRevision,
  value = "1",
  numericTypeOptions
}: {
  sessionId: string;
  document: TestDocument;
  target: { statementId: string; statementIndex: number; name: string };
  sourceRevision: number;
  value?: string;
  numericTypeOptions?: { step?: number; min?: number; max?: number };
}): VscodeModulePreviewParameterSnapshot => ({
  type: "modulePreviewParameterSnapshot",
  sessionId,
  documentUri: document.uri.toString(),
  documentVersion: document.version,
  sourceRevision,
  sessionRevision: 1,
  target: {
    definitionStatementId: target.statementId,
    definitionStatementIndex: target.statementIndex,
    name: target.name
  },
  ancestorContexts: [],
  parameters: {
    kind: "target",
    definitionStatementId: target.statementId,
    name: target.name,
    parameters: [{
      definitionStatementId: target.statementId,
      parameterIndex: 0,
      name: "width",
      type: { kind: "number" },
      ...(numericTypeOptions ? { numericTypeOptions } : {}),
      optional: false,
      required: true,
      defaultSourceText: null,
      value,
      diagnostic: null
    }]
  },
  inputDiagnostics: [],
  previewStatus: "current"
});

const parameterSetValueFor = (
  snapshot: VscodeModulePreviewParameterSnapshot,
  expression: string
): VscodeModulePreviewParameterSetValueRequest => ({
  type: "modulePreviewParameterSetValue",
  sessionId: snapshot.sessionId,
  documentUri: snapshot.documentUri,
  documentVersion: snapshot.documentVersion,
  sourceRevision: snapshot.sourceRevision,
  sessionRevision: snapshot.sessionRevision,
  targetDefinitionStatementId: snapshot.target.definitionStatementId,
  definitionStatementId: snapshot.target.definitionStatementId,
  parameterIndex: 0,
  expression
});

const parameterValueFocusFor = (
  snapshot: VscodeModulePreviewParameterSnapshot,
  overrides: Partial<Omit<VscodeModulePreviewParameterValueFocus, "type">> = {}
): VscodeModulePreviewParameterValueFocus => ({
  type: "modulePreviewParameterValueFocus",
  sessionId: snapshot.sessionId,
  documentUri: snapshot.documentUri,
  documentVersion: snapshot.documentVersion,
  sourceRevision: snapshot.sourceRevision,
  sessionRevision: snapshot.sessionRevision,
  targetDefinitionStatementId: snapshot.target.definitionStatementId,
  definitionStatementId: snapshot.parameters.parameters[0]!.definitionStatementId,
  parameterIndex: 0,
  value: snapshot.parameters.parameters[0]!.value,
  selectionStart: 0,
  selectionEnd: snapshot.parameters.parameters[0]!.value.length,
  focusGeneration: 1,
  ...overrides
});

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
      canvasThemeGeneration: () => 0,
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

  it("owns exact Preview Value focus, relays typed steps through setValue, restores selection, and consumes unsupported steps", async () => {
    const source = [
      "nui 4",
      "module Pocket(width: number(step: 2, min: 0, max: 10)) {",
      "  point P = coordinate(x: @width, y: 0)",
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
    const parameterView = createParameterWebview();
    feature.attachParameterView(parameterView as never);
    await parameterView.receive({ type: "modulePreviewParametersViewReady" });
    mocks.commandHandlers.get("nuinuiCAD.openModulePreview")!();
    await panel.receive({ type: "webviewReady" });
    await panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });

    const sessionMessage = panel.webview.postMessage.mock.calls
      .map(([message]) => message as { type?: string; sessionId?: string })
      .find((message) => message.type === "modulePreviewSession");
    const target = analysis.definitionSemanticSnapshot({
      normalizedSource: source,
      sourceRevision: analysis.getSourceRevision()
    })?.compiled?.moduleSemanticAnalysis?.definitions.find((definition) => definition.name === "Pocket");
    if (!sessionMessage?.sessionId || !target) throw new Error("expected exact Preview session");
    const sourceRevision = analysis.getSourceRevision();
    const snapshot = parameterSnapshotFor({
      sessionId: sessionMessage.sessionId,
      document,
      target,
      sourceRevision,
      value: "1",
      numericTypeOptions: { step: 2, min: 0, max: 10 }
    });
    await panel.receive(snapshot);
    const focus = parameterValueFocusFor(snapshot, { selectionStart: 0, selectionEnd: 1 });
    await parameterView.receive(focus);
    for (let index = 0; index < 5; index += 1) await flushContext();
    expect(mocks.executeCommand).toHaveBeenCalledWith(
      "setContext",
      NUI_MODULE_PREVIEW_VALUE_INPUT_FOCUS_CONTEXT,
      true
    );

    mocks.executeCommand.mockClear();
    await parameterView.receive({
      type: "modulePreviewParameterValueBlur",
      sessionId: focus.sessionId,
      documentUri: focus.documentUri,
      documentVersion: focus.documentVersion,
      sourceRevision: focus.sourceRevision,
      sessionRevision: focus.sessionRevision,
      targetDefinitionStatementId: focus.targetDefinitionStatementId,
      definitionStatementId: focus.definitionStatementId,
      parameterIndex: focus.parameterIndex,
      focusGeneration: focus.focusGeneration
    });
    for (let index = 0; index < 5; index += 1) await flushContext();
    expect(mocks.executeCommand).toHaveBeenLastCalledWith(
      "setContext",
      NUI_MODULE_PREVIEW_VALUE_INPUT_FOCUS_CONTEXT,
      false
    );
    await parameterView.receive(focus);
    for (let index = 0; index < 5; index += 1) await flushContext();

    await parameterView.receive(parameterValueFocusFor(snapshot, {
      value: "0",
      selectionStart: 0,
      selectionEnd: 1,
      focusGeneration: 2
    }));
    panel.webview.postMessage.mockClear();
    await mocks.commandHandlers.get(NUI_MODULE_PREVIEW_VALUE_STEP_FORWARD_COMMAND_ID)!();
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewSetValue"
    }));
    for (let index = 0; index < 5; index += 1) await flushContext();
    expect(mocks.executeCommand).toHaveBeenLastCalledWith(
      "setContext",
      NUI_MODULE_PREVIEW_VALUE_INPUT_FOCUS_CONTEXT,
      true
    );

    await parameterView.receive(parameterValueFocusFor(snapshot, {
      value: "1",
      selectionStart: 0,
      selectionEnd: 1,
      focusGeneration: 3
    }));

    const staleFocusVariants: Array<Partial<Omit<VscodeModulePreviewParameterValueFocus, "type">>> = [
      { sessionId: "stale-session" },
      { documentUri: "file:///stale.nui" },
      { documentVersion: 2 },
      { sourceRevision: sourceRevision + 1 },
      { sessionRevision: 2 },
      { targetDefinitionStatementId: "stale-target" },
      { definitionStatementId: "stale-parameter" },
      { parameterIndex: 1 },
      { value: "stale-value", selectionStart: 0, selectionEnd: 1 }
    ];
    for (const variant of staleFocusVariants) {
      await parameterView.receive(parameterValueFocusFor(snapshot, variant));
    }

    panel.webview.postMessage.mockClear();
    await mocks.commandHandlers.get(NUI_MODULE_PREVIEW_VALUE_STEP_FORWARD_COMMAND_ID)!();
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewSetValue",
      sessionId: snapshot.sessionId,
      targetDefinitionStatementId: snapshot.target.definitionStatementId,
      expression: "3"
    }));
    expect(document.getText()).toBe(source);

    const updatedSnapshot = {
      ...snapshot,
      sessionRevision: 2,
      parameters: {
        ...snapshot.parameters,
        parameters: snapshot.parameters.parameters.map((parameter) => ({ ...parameter, value: "3" }))
      }
    };
    await panel.receive(updatedSnapshot);
    expect(parameterView.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewRestoreParameterValueSelection"
    }));

    await parameterView.receive(parameterValueFocusFor(updatedSnapshot, {
      value: "3",
      selectionStart: 0,
      selectionEnd: 1,
      focusGeneration: 4
    }));
    expect(parameterView.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewRestoreParameterValueSelection",
      value: "3",
      selectionStart: 0,
      selectionEnd: 1,
      focusGeneration: 4
    }));

    await parameterView.receive(parameterValueFocusFor(updatedSnapshot, {
      value: "3",
      selectionStart: 0,
      selectionEnd: 1,
      focusGeneration: 5
    }));
    panel.webview.postMessage.mockClear();
    await mocks.commandHandlers.get(NUI_MODULE_PREVIEW_VALUE_STEP_BACKWARD_COMMAND_ID)!();
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewSetValue",
      expression: "1"
    }));

    const unsupportedSnapshot: VscodeModulePreviewParameterSnapshot = {
      ...updatedSnapshot,
      sessionRevision: 3,
      parameters: {
        ...updatedSnapshot.parameters,
        parameters: updatedSnapshot.parameters.parameters.map((parameter) => ({
          ...parameter,
          type: { kind: "string" as const },
          value: "text",
          numericTypeOptions: undefined
        }))
      }
    };
    await panel.receive(unsupportedSnapshot);
    await parameterView.receive(parameterValueFocusFor(unsupportedSnapshot, {
      value: "text",
      selectionStart: 0,
      selectionEnd: 4,
      focusGeneration: 5
    }));
    panel.webview.postMessage.mockClear();
    await mocks.commandHandlers.get(NUI_MODULE_PREVIEW_VALUE_STEP_FORWARD_COMMAND_ID)!();
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "modulePreviewSetValue" }));
    for (let index = 0; index < 5; index += 1) await flushContext();
    expect(mocks.executeCommand).toHaveBeenLastCalledWith(
      "setContext",
      NUI_MODULE_PREVIEW_VALUE_INPUT_FOCUS_CONTEXT,
      true
    );

    feature.dispose();
  });

  it("retains the exact live session projection, relays actions, and rejects stale source/disposal races", async () => {
    const source = [
      "nui 4",
      "module Outer(scale: number) {",
      "  module Inner(width: number = @scale * 2) {",
      "    point P = coordinate(x: @width, y: 0)",
      "  }",
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
    const parameterView = createParameterWebview();
    feature.attachParameterView(parameterView as never);
    await parameterView.receive({ type: "modulePreviewParametersViewReady" });
    mocks.commandHandlers.get("nuinuiCAD.openModulePreview")!();
    await panel.receive({ type: "webviewReady" });
    await panel.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });

    const sessionMessage = panel.webview.postMessage.mock.calls
      .map(([message]) => message as { type?: string; sessionId?: string; documentUri?: string })
      .find((message) => message.type === "modulePreviewSession");
    const semantic = analysis.definitionSemanticSnapshot({
      normalizedSource: source,
      sourceRevision: analysis.getSourceRevision()
    });
    const target = semantic?.compiled?.moduleSemanticAnalysis?.definitions.find((definition) => definition.name === "Inner");
    expect(sessionMessage?.sessionId).toBeTruthy();
    expect(target).toBeDefined();
    if (!sessionMessage?.sessionId || !target) throw new Error("expected live session proof");

    const snapshot = {
      type: "modulePreviewParameterSnapshot" as const,
      sessionId: sessionMessage.sessionId,
      documentUri: document.uri.toString(),
      documentVersion: 1,
      sourceRevision: analysis.getSourceRevision(),
      sessionRevision: 1,
      target: {
        definitionStatementId: target.statementId,
        definitionStatementIndex: target.statementIndex,
        name: target.name
      },
      ancestorContexts: [{
        kind: "ancestor" as const,
        definitionStatementId: "unused-outer",
        name: "Outer",
        parameters: []
      }],
      parameters: {
        kind: "target" as const,
        definitionStatementId: target.statementId,
        name: target.name,
        parameters: [{
          definitionStatementId: target.statementId,
          parameterIndex: 0,
          name: "width",
          type: { kind: "number" as const },
          optional: false,
          required: false,
          defaultSourceText: "@scale * 2",
          value: "",
          diagnostic: null
        }]
      },
      inputDiagnostics: [],
      previewStatus: "current" as const
    };
    await panel.receive(snapshot);
    expect(parameterView.postMessage).toHaveBeenCalledWith(snapshot);
    const lateParameterView = createParameterWebview();
    feature.attachParameterView(lateParameterView as never);
    expect(lateParameterView.postMessage).toHaveBeenCalledWith(snapshot);
    feature.attachParameterView(parameterView as never);
    parameterView.postMessage.mockClear();
    panel.webview.postMessage.mockClear();

    const firstAction = {
      type: "modulePreviewParameterSetValue",
      sessionId: snapshot.sessionId,
      documentUri: snapshot.documentUri,
      documentVersion: snapshot.documentVersion,
      sourceRevision: snapshot.sourceRevision,
      sessionRevision: snapshot.sessionRevision,
      targetDefinitionStatementId: target.statementId,
      definitionStatementId: target.statementId,
      parameterIndex: 0,
      expression: "3"
    };
    const secondAction = { ...firstAction, expression: "4" };
    await parameterView.receive(firstAction);
    await parameterView.receive(secondAction);
    expect(panel.webview.postMessage.mock.calls.map(([message]) => {
      const action = message as { type?: string; sessionId?: string; expression?: string };
      return { type: action.type, sessionId: action.sessionId, expression: action.expression };
    })).toEqual([
      { type: "modulePreviewSetValue", sessionId: snapshot.sessionId, expression: "3" },
      { type: "modulePreviewSetValue", sessionId: snapshot.sessionId, expression: "4" }
    ]);

    const firstResult = {
      ...snapshot,
      sessionRevision: 2,
      parameters: {
        ...snapshot.parameters,
        parameters: snapshot.parameters.parameters.map((parameter) =>
          parameter.parameterIndex === 0 ? { ...parameter, value: "3" } : parameter
        )
      }
    };
    const secondResult = {
      ...firstResult,
      sessionRevision: 3,
      parameters: {
        ...firstResult.parameters,
        parameters: firstResult.parameters.parameters.map((parameter) =>
          parameter.parameterIndex === 0 ? { ...parameter, value: "4" } : parameter
        )
      }
    };
    await panel.receive(firstResult);
    await panel.receive(secondResult);

    parameterView.postMessage.mockClear();
    mocks.activeTextEditor.selection.active = positionAt(source, source.indexOf("module Outer"));
    mocks.commandHandlers.get("nuinuiCAD.openModulePreview")!();
    const retargetedSession = panel.webview.postMessage.mock.calls
      .map(([message]) => message as { type?: string; sessionId?: string })
      .reverse()
      .find((message) => message.type === "modulePreviewSession");
    expect(retargetedSession?.sessionId).toBeTruthy();
    expect(retargetedSession?.sessionId).not.toBe(snapshot.sessionId);
    expect(parameterView.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewParametersUnavailable",
      reason: "not-ready"
    }));
    panel.webview.postMessage.mockClear();
    await parameterView.receive({
      type: "modulePreviewParameterSetValue",
      sessionId: snapshot.sessionId,
      documentUri: snapshot.documentUri,
      documentVersion: snapshot.documentVersion,
      sourceRevision: snapshot.sourceRevision,
      sessionRevision: snapshot.sessionRevision,
      targetDefinitionStatementId: target.statementId,
      definitionStatementId: target.statementId,
      parameterIndex: 0,
      expression: "stale-after-retarget"
    });
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "modulePreviewSetValue" }));

    document.setSource(source.replace("y: 0", "y: 1"));
    for (const listener of mocks.documentChangeListeners) listener({ document, contentChanges: [{}] });
    expect(parameterView.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewParametersUnavailable",
      reason: "source-stale",
      documentVersion: 2
    }));
    panel.webview.postMessage.mockClear();
    await parameterView.receive({
      type: "modulePreviewParameterSetValue",
      sessionId: snapshot.sessionId,
      documentUri: snapshot.documentUri,
      documentVersion: snapshot.documentVersion,
      sourceRevision: snapshot.sourceRevision,
      sessionRevision: snapshot.sessionRevision,
      targetDefinitionStatementId: target.statementId,
      definitionStatementId: target.statementId,
      parameterIndex: 0,
      expression: "4"
    });
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "modulePreviewSetValue" }));

    panel.fireDispose();
    expect(parameterView.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewParametersUnavailable",
      sessionId: null,
      reason: "no-session"
    }));
    feature.dispose();
  });

  it("switches to existing live panels and restores only their retained exact projection", async () => {
    const source = [
      "nui 4",
      "module Pocket(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}"
    ].join("\n");
    const documentA = createDocument(source, "file:///workspace/a.nui");
    const documentB = createDocument(source, "file:///workspace/b.nui");
    const panelA = createPanel();
    const panelB = createPanel();
    const panels = [panelA, panelB];
    mocks.createWebviewPanel.mockImplementation((viewType: string, title: string) => {
      expect(viewType).toBe(NUI_MODULE_PREVIEW_VIEW_TYPE);
      expect(title).toBe("Module Preview");
      const panel = panels.shift();
      if (!panel) throw new Error("unexpected third Module Preview panel");
      panel.title = title;
      return panel;
    });
    const analyses = new Map<string, ReturnType<typeof createLanguageAnalysisSession>>();
    const sessionFor = (document: TestDocument) => {
      const key = document.uri.toString();
      const existing = analyses.get(key);
      if (existing) return existing;
      const created = createLanguageAnalysisSession(document.getText());
      analyses.set(key, created);
      return created;
    };
    mocks.activeTextEditor = {
      document: documentA,
      selection: { active: positionAt(source, source.indexOf("point P")) }
    };
    const feature = registerModulePreviewFeature({
      languageAnalysisSessionFor: sessionFor as never,
      canvasThemeGeneration: () => 0,
      webviewHtml: () => "<html />",
      canvasRibbons: () => [],
      updateCanvasRibbonPosition: () => undefined,
      editCanvasRibbon: () => undefined,
      evaluateWithRust: async () => ({})
    });
    const parameterView = createParameterWebview();
    feature.attachParameterView(parameterView as never);
    await parameterView.receive({ type: "modulePreviewParametersViewReady" });
    const open = mocks.commandHandlers.get("nuinuiCAD.openModulePreview");
    if (!open) throw new Error("expected open Module Preview command");

    open();
    await panelA.receive({ type: "webviewReady" });
    await panelA.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    const sessionA = panelA.webview.postMessage.mock.calls
      .map(([message]) => message as { type?: string; sessionId?: string })
      .find((message) => message.type === "modulePreviewSession");
    const targetA = analyses.get(documentA.uri.toString())?.definitionSemanticSnapshot({
      normalizedSource: source,
      sourceRevision: analyses.get(documentA.uri.toString())?.getSourceRevision() ?? 0
    })?.compiled?.moduleSemanticAnalysis?.definitions.find((definition) => definition.name === "Pocket");
    if (!sessionA?.sessionId || !targetA) throw new Error("expected exact session A");
    const snapshotA = parameterSnapshotFor({
      sessionId: sessionA.sessionId,
      document: documentA,
      target: targetA,
      sourceRevision: analyses.get(documentA.uri.toString())?.getSourceRevision() ?? 0,
      value: "2"
    });
    await panelA.receive(snapshotA);

    mocks.activeTextEditor = {
      document: documentB,
      selection: { active: positionAt(source, source.indexOf("point P")) }
    };
    open();
    await panelB.receive({ type: "webviewReady" });
    await panelB.receive({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    const sessionB = panelB.webview.postMessage.mock.calls
      .map(([message]) => message as { type?: string; sessionId?: string })
      .find((message) => message.type === "modulePreviewSession");
    const targetB = analyses.get(documentB.uri.toString())?.definitionSemanticSnapshot({
      normalizedSource: source,
      sourceRevision: analyses.get(documentB.uri.toString())?.getSourceRevision() ?? 0
    })?.compiled?.moduleSemanticAnalysis?.definitions.find((definition) => definition.name === "Pocket");
    if (!sessionB?.sessionId || !targetB) throw new Error("expected exact session B");
    const snapshotB = parameterSnapshotFor({
      sessionId: sessionB.sessionId,
      document: documentB,
      target: targetB,
      sourceRevision: analyses.get(documentB.uri.toString())?.getSourceRevision() ?? 0,
      value: "4"
    });
    await panelB.receive(snapshotB);

    parameterView.postMessage.mockClear();
    panelA.fireViewState({ active: true, visible: true });
    expect(parameterView.postMessage).toHaveBeenCalledWith(snapshotA);

    parameterView.postMessage.mockClear();
    panelB.fireViewState({ active: true, visible: true });
    expect(parameterView.postMessage).toHaveBeenCalledWith(snapshotB);

    parameterView.postMessage.mockClear();
    mocks.activeTextEditor = null;
    for (const listener of mocks.activeEditorListeners) listener();
    expect(parameterView.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewParametersUnavailable",
      reason: "no-session"
    }));
    panelB.webview.postMessage.mockClear();
    await parameterView.receive(parameterSetValueFor(snapshotB, "5"));
    expect(panelB.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewSetValue",
      sessionId: snapshotB.sessionId,
      expression: "5"
    }));

    documentA.setSource(source.replace("y: 0", "y: 1"));
    for (const listener of mocks.documentChangeListeners) {
      listener({ document: documentA, contentChanges: [{}] });
    }
    parameterView.postMessage.mockClear();
    panelA.fireViewState({ active: true, visible: true });
    expect(parameterView.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewParametersUnavailable",
      sessionId: snapshotA.sessionId,
      documentVersion: 2,
      reason: "source-stale"
    }));
    expect(parameterView.postMessage).not.toHaveBeenCalledWith(snapshotA);

    panelB.webview.postMessage.mockClear();
    await parameterView.receive(parameterSetValueFor(snapshotB, "stale B action"));
    expect(panelB.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewSetValue"
    }));

    parameterView.postMessage.mockClear();
    panelB.fireViewState({ active: true, visible: true });
    expect(parameterView.postMessage).toHaveBeenCalledWith(snapshotB);

    panelB.fireDispose();
    expect(parameterView.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewParametersUnavailable",
      sessionId: null,
      reason: "no-session"
    }));
    panelA.fireDispose();
    feature.dispose();
  });
});
