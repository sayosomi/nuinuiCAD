import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ComponentProps, type RefObject } from "react";
import type { CanvasHostAdapter } from "../../src/components/canvasHostAdapter";
import type { VscodeModulePreviewValueSnapshot } from "../../src/vscode/protocol";

const mocks = vi.hoisted(() => ({
  activeTextEditor: null as TestEditor | null,
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
  executeCommand: vi.fn(),
  showErrorMessage: vi.fn(),
  createWebviewPanel: vi.fn(),
  nativeShowQuickPick: vi.fn(),
  nativeShowInputBox: vi.fn(),
  hostAdapter: null as CanvasHostAdapter | null
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

type PanelWithBridge = TestPanel & {
  receive: (message: unknown) => Promise<void>;
  fireDispose: () => void;
  traffic: Array<{ direction: "extension" | "webview"; message: { type?: string } }>;
};

vi.mock("vscode", () => ({
  env: { language: "en" },
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

vi.mock("../../src/components/DrawingCanvas", () => ({
  DrawingCanvas: ({
    canvasFocusRef,
    hostAdapter
  }: ComponentProps<"div"> & {
    canvasFocusRef?: RefObject<HTMLDivElement | null>;
    hostAdapter: CanvasHostAdapter;
  }) => {
    mocks.hostAdapter = hostAdapter;
    return createElement(
      "div",
      { ref: canvasFocusRef, "data-testid": "module-preview-canvas-viewport" },
      hostAdapter.renderPickModeChrome?.()
    );
  }
}));

vi.mock("../../src/geometry/useEvaluationEngine", async () => {
  const actual = await vi.importActual<typeof import("../../src/geometry/useEvaluationEngine")>("../../src/geometry/useEvaluationEngine");
  return {
    ...actual,
    useEvaluationEngine: vi.fn(() => ({
      evaluation: {
        computedGeometry: new Map(),
        preMutationGeometry: new Map(),
        instanceBaseGeometry: new Map(),
        errors: [],
        warnings: [],
        evaluatedElementIds: new Set(),
        evaluationLimitIndex: 0,
        effectiveVisibleElementIds: new Set(),
        effectiveEnabledElementIds: new Set(),
        effectiveDrawingModifierStrokes: new Map()
      },
      evaluationRevision: 0,
      evaluationRequestRevision: 0,
      mode: "reference" as const,
      source: "reference" as const,
      status: "ready" as const,
      rustEligible: false,
      isStale: false,
      error: null
    }))
  };
});

vi.mock("./nativeQuickInput", () => ({
  nativeShowQuickPick: mocks.nativeShowQuickPick,
  nativeShowInputBox: mocks.nativeShowInputBox
}));

import { createLanguageAnalysisSession } from "./languageAnalysisSession";
import {
  MODULE_PREVIEW_INSERT_INSTANCE_COMMAND,
  registerModulePreviewFeature
} from "./modulePreviewFeature";
import { ModulePreviewApp } from "../../src/vscode/ModulePreviewApp";

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

const createDocument = (sourceText: string): TestDocument => {
  let source = sourceText;
  const document: TestDocument = {
    fileName: "/workspace/pattern.nui",
    version: 1,
    uri: { scheme: "file", toString: () => "file:///workspace/pattern.nui" },
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

const createEditor = (document: TestDocument): TestEditor => ({
  document,
  selection: { active: positionAt(document.getText(), document.getText().indexOf("module Pocket")) },
  edit: vi.fn(async (
    callback: (builder: {
      replace: (
        range: { start: { line: number; character: number }; end: { line: number; character: number } },
        replacement: string
      ) => void
    }) => void
  ) => {
    const edits: Array<{
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
      replacement: string;
    }> = [];
    callback({
      replace: (range, replacement) => edits.push({ range, replacement })
    });
    let nextSource = document.getText();
    for (const edit of [...edits].reverse()) {
      const from = document.offsetAt(edit.range.start);
      const to = document.offsetAt(edit.range.end);
      nextSource = `${nextSource.slice(0, from)}${edit.replacement}${nextSource.slice(to)}`;
    }
    if (edits.length > 0) document.setSource(nextSource);
    return true;
  }),
  revealRange: vi.fn()
});

const createPanel = (): PanelWithBridge => {
  const receiveHandlers: Array<(message: unknown) => unknown> = [];
  let disposeHandler: (() => void) | null = null;
  let html = "";
  const traffic: PanelWithBridge["traffic"] = [];
  const dispatch = async (message: unknown): Promise<void> => {
    const pending = receiveHandlers.map((handler) => handler(message));
    await Promise.all(pending.map(async (result) => {
      if (result && typeof result === "object" && "then" in result) await result;
    }));
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
      },
      postMessage: vi.fn(async (message: { type?: string }) => {
        traffic.push({ direction: "extension", message });
        window.dispatchEvent(new MessageEvent("message", { data: message }));
        return true;
      }),
      onDidReceiveMessage: vi.fn((handler: (message: unknown) => unknown) => {
        receiveHandlers.push(handler);
        return { dispose: () => {
          const index = receiveHandlers.indexOf(handler);
          if (index >= 0) receiveHandlers.splice(index, 1);
        } };
      })
    },
    reveal: vi.fn(),
    dispose: vi.fn(),
    onDidChangeViewState: vi.fn(() => ({ dispose: () => undefined })),
    onDidDispose: vi.fn((handler: () => void) => {
      disposeHandler = handler;
      return { dispose: () => undefined };
    }),
    receive: dispatch,
    fireDispose: () => disposeHandler?.(),
    traffic
  } satisfies PanelWithBridge;
  return panel;
};

const apiFor = (panel: PanelWithBridge) => ({
  postMessage: vi.fn((message: { type?: string }) => {
    panel.traffic.push({ direction: "webview", message });
    return panel.receive(message);
  })
});

const flushCrossBoundary = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

const messageIndex = (
  panel: PanelWithBridge,
  direction: "extension" | "webview",
  type: string,
  from = 0
): number => panel.traffic.findIndex((entry, index) => index >= from && entry.direction === direction && entry.message.type === type);

let activeFeature: { dispose: () => void } | null = null;

afterEach(() => {
  cleanup();
  activeFeature?.dispose();
  activeFeature = null;
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
  mocks.executeCommand.mockReset();
  mocks.executeCommand.mockImplementation(async (command: string) => {
    const handler = mocks.commandHandlers.get(command);
    return handler ? await handler() : undefined;
  });
  mocks.showTextDocument.mockReset();
  mocks.showErrorMessage.mockReset();
  mocks.createWebviewPanel.mockReset();
  mocks.nativeShowQuickPick.mockReset();
  mocks.nativeShowInputBox.mockReset();
  mocks.hostAdapter = null;
});

describe("Module Preview Host/Webview re-entry boundary", () => {
  it("re-establishes natural value authority on a fresh panel and keeps same-generation bootstrap idempotent", async () => {
    const source = [
      "nui 1",
      "point Top = coordinate(x: 15, y: 20)",
      "module Pocket(width: number, anchor: point) {",
      "  point P = coordinate(x: @width, y: @anchor.y)",
      "}",
      ""
    ].join("\n");
    const document = createDocument(source);
    const editor = createEditor(document);
    const oldPanel = createPanel();
    const newPanel = createPanel();
    const analysis = createLanguageAnalysisSession(source);
    mocks.createWebviewPanel.mockReturnValueOnce(oldPanel).mockReturnValueOnce(newPanel);
    mocks.activeTextEditor = editor;
    mocks.textDocuments = [document];
    mocks.visibleTextEditors = [editor];
    mocks.executeCommand.mockImplementation(async (command: string) => {
      const handler = mocks.commandHandlers.get(command);
      return handler ? await handler() : undefined;
    });

    const feature = registerModulePreviewFeature({
      languageAnalysisSessionFor: (() => analysis) as never,
      canvasThemeGeneration: () => 0,
      webviewHtml: () => "<html />",
      canvasRibbons: () => [],
      updateCanvasRibbonPosition: () => undefined,
      editCanvasRibbon: () => undefined,
      evaluateWithRust: async () => ({})
    });
    activeFeature = feature;

    const open = mocks.commandHandlers.get("nuinuiCAD.openModulePreview");
    if (!open) throw new Error("expected open Module Preview command");
    open();

    let oldView: ReturnType<typeof render>;
    await act(async () => {
      oldView = render(<ModulePreviewApp api={apiFor(oldPanel)} />);
      await flushCrossBoundary();
    });

    const oldBootstrap = oldPanel.traffic.find((entry) =>
      entry.direction === "extension" && entry.message.type === "modulePreviewBootstrap"
    )?.message as typeof oldPanel.traffic[number]["message"] & {
      sessionId: string;
      sessionGeneration: number;
      documentUri: string;
      documentVersion: number;
      sourceText: string;
    } | undefined;
    if (!oldBootstrap) throw new Error("expected old-panel bootstrap");
    const oldSnapshot = oldPanel.traffic.findLast((entry) =>
      entry.direction === "webview" && entry.message.type === "modulePreviewValueSnapshot"
    )?.message as VscodeModulePreviewValueSnapshot | undefined;
    expect(oldSnapshot).toMatchObject({
      sessionId: oldBootstrap.sessionId,
      target: { name: "Pocket" },
      groups: [expect.objectContaining({
        kind: "target",
        name: "Pocket",
        parameters: expect.arrayContaining([
          expect.objectContaining({ name: "width", valueState: "required-missing" }),
          expect.objectContaining({ name: "anchor", valueState: "required-missing" })
        ])
      })],
      previewStatus: "noValidPreview"
    });

    const oldReadyIndex = messageIndex(oldPanel, "webview", "webviewReady");
    const oldBootstrapIndex = messageIndex(oldPanel, "extension", "modulePreviewBootstrap");
    const oldAcknowledgedIndex = messageIndex(oldPanel, "webview", "modulePreviewBootstrapAcknowledged");
    const oldTargetIndex = messageIndex(oldPanel, "extension", "modulePreviewTarget");
    const oldSnapshotIndex = messageIndex(oldPanel, "webview", "modulePreviewValueSnapshot");
    expect(oldReadyIndex).toBeGreaterThanOrEqual(0);
    expect(oldBootstrapIndex).toBeGreaterThan(oldReadyIndex);
    expect(oldAcknowledgedIndex).toBeGreaterThan(oldBootstrapIndex);
    expect(oldTargetIndex).toBeGreaterThan(oldAcknowledgedIndex);
    expect(oldSnapshotIndex).toBeGreaterThan(oldTargetIndex);

    oldPanel.fireDispose();
    oldView!.unmount();
    const oldTrafficLengthAfterDispose = oldPanel.traffic.length;
    await act(async () => {
      await oldPanel.receive({
        type: "modulePreviewBootstrapAcknowledged",
        sessionId: oldBootstrap.sessionId,
        sessionGeneration: oldBootstrap.sessionGeneration,
        documentUri: oldBootstrap.documentUri,
        documentVersion: oldBootstrap.documentVersion
      });
      await oldPanel.receive(oldSnapshot);
      await flushCrossBoundary();
    });
    expect(oldPanel.traffic).toHaveLength(oldTrafficLengthAfterDispose);

    const hostRevisionBeforeIndependentAdvance = analysis.getSourceRevision();
    analysis.replaceSource(`${source}\n`);
    analysis.replaceSource(source);
    expect(analysis.getSourceRevision()).toBeGreaterThan(hostRevisionBeforeIndependentAdvance);

    open();
    const staleAcknowledgement = {
      type: "modulePreviewBootstrapAcknowledged" as const,
      sessionId: oldBootstrap.sessionId,
      sessionGeneration: oldBootstrap.sessionGeneration,
      documentUri: oldBootstrap.documentUri,
      documentVersion: oldBootstrap.documentVersion
    };
    await newPanel.receive(staleAcknowledgement);

    let newView: ReturnType<typeof render>;
    await act(async () => {
      newView = render(<ModulePreviewApp api={apiFor(newPanel)} />);
      await flushCrossBoundary();
    });

    const newBootstrap = newPanel.traffic.find((entry) =>
      entry.direction === "extension" && entry.message.type === "modulePreviewBootstrap"
    )?.message as typeof oldBootstrap | undefined;
    if (!newBootstrap) throw new Error("expected fresh-panel bootstrap");
    expect(newBootstrap.sessionId).not.toBe(oldBootstrap.sessionId);
    expect(newBootstrap.sessionGeneration).toBeGreaterThan(oldBootstrap.sessionGeneration);

    const newSnapshot = newPanel.traffic.findLast((entry) =>
      entry.direction === "webview" && entry.message.type === "modulePreviewValueSnapshot"
    )?.message as VscodeModulePreviewValueSnapshot | undefined;
    expect(newSnapshot).toMatchObject({
      sessionId: newBootstrap.sessionId,
      documentUri: newBootstrap.documentUri,
      documentVersion: newBootstrap.documentVersion,
      target: { name: "Pocket" },
      groups: [expect.objectContaining({
        kind: "target",
        name: "Pocket",
        parameters: expect.arrayContaining([
          expect.objectContaining({ name: "width", valueState: "required-missing" }),
          expect.objectContaining({ name: "anchor", valueState: "required-missing" })
        ])
      })]
    });
    expect(newSnapshot?.sessionId).not.toBe(oldSnapshot?.sessionId);
    expect(newSnapshot?.sourceRevision).not.toBe(analysis.getSourceRevision());

    const newReadyIndex = messageIndex(newPanel, "webview", "webviewReady");
    const newBootstrapIndex = messageIndex(newPanel, "extension", "modulePreviewBootstrap");
    const newAcknowledgedIndex = messageIndex(newPanel, "webview", "modulePreviewBootstrapAcknowledged");
    const newTargetIndex = messageIndex(newPanel, "extension", "modulePreviewTarget");
    const newSnapshotIndex = messageIndex(newPanel, "webview", "modulePreviewValueSnapshot");
    expect(newBootstrapIndex).toBeGreaterThan(newReadyIndex);
    expect(newAcknowledgedIndex).toBeGreaterThan(newBootstrapIndex);
    expect(newTargetIndex).toBeGreaterThan(newAcknowledgedIndex);
    expect(newSnapshotIndex).toBeGreaterThan(newTargetIndex);
    expect(newPanel.traffic.some((entry) =>
      entry.direction === "extension" && entry.message.type === "modulePreviewTarget" &&
      entry.message.sessionId === oldBootstrap.sessionId
    )).toBe(false);

    expect(screen.getByRole("status")).toHaveTextContent('Parameter "width" requires a value.');

    mocks.nativeShowInputBox.mockResolvedValue("12");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "width" }));
      await flushCrossBoundary();
    });
    expect(mocks.nativeShowInputBox).toHaveBeenCalledTimes(1);
    expect(newPanel.traffic.some((entry) =>
      entry.direction === "extension" && entry.message.type === "modulePreviewValueEdit"
    )).toBe(true);
    expect(newPanel.traffic.findLast((entry) =>
      entry.direction === "webview" && entry.message.type === "modulePreviewValueSnapshot"
    )?.message).toMatchObject({
      groups: [expect.objectContaining({
        name: "Pocket",
        parameters: expect.arrayContaining([
          expect.objectContaining({ name: "width", value: "12", valueState: "explicit" }),
          expect.objectContaining({ name: "anchor", valueState: "required-missing" })
        ])
      })]
    });
    expect(screen.getByRole("status")).toHaveTextContent('Parameter "anchor" requires a value.');

    mocks.nativeShowQuickPick.mockImplementation(async (items: readonly { label: string }[]) =>
      items.find((item) => item.label === "Target: Pocket.width")
    );
    mocks.nativeShowInputBox.mockResolvedValue("13");

    const targetCountBeforeDuplicate = newPanel.traffic.filter((entry) =>
      entry.direction === "extension" && entry.message.type === "modulePreviewTarget"
    ).length;
    const acknowledgementCountBeforeDuplicate = newPanel.traffic.filter((entry) =>
      entry.direction === "webview" && entry.message.type === "modulePreviewBootstrapAcknowledged"
    ).length;
    await act(async () => {
      newPanel.webview.postMessage(newBootstrap);
      await flushCrossBoundary();
    });
    expect(newPanel.traffic.filter((entry) =>
      entry.direction === "webview" && entry.message.type === "modulePreviewBootstrapAcknowledged"
    )).toHaveLength(acknowledgementCountBeforeDuplicate + 1);
    expect(newPanel.traffic.filter((entry) =>
      entry.direction === "extension" && entry.message.type === "modulePreviewTarget"
    )).toHaveLength(targetCountBeforeDuplicate);
    expect(screen.getByRole("status")).toHaveTextContent('Parameter "anchor" requires a value.');

    mocks.nativeShowQuickPick.mockImplementation(async (items: readonly { label: string }[]) =>
      items.find((item) => item.label === "Target: Pocket.width")
    );
    mocks.nativeShowInputBox.mockResolvedValue("13");
    await act(async () => {
      await mocks.commandHandlers.get("nuinuiCAD.editModulePreviewValues")?.();
      await flushCrossBoundary();
    });
    expect(mocks.nativeShowQuickPick).toHaveBeenCalledTimes(1);
    expect(mocks.nativeShowInputBox).toHaveBeenCalledTimes(2);
    expect(newPanel.traffic).toEqual(expect.arrayContaining([
      expect.objectContaining({
        direction: "extension",
        message: expect.objectContaining({
          type: "modulePreviewValueEdit",
          definitionName: "Pocket",
          parameterName: "width",
          expression: "13"
        })
      })
    ]));

    mocks.nativeShowQuickPick.mockImplementation(async (items: readonly { label: string; kind?: string }[]) =>
      items.find((item) => item.kind === "pick")
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "anchor" }));
      await flushCrossBoundary();
    });
    const pickRequest = newPanel.traffic.findLast((entry) =>
      entry.direction === "extension" && entry.message.type === "modulePreviewReferencePickStartRequest"
    )?.message as typeof newPanel.traffic[number]["message"] & {
      expectedGeometryInterface: string;
      parameterName: string;
    } | undefined;
    expect(pickRequest).toMatchObject({
      parameterName: "anchor",
      expectedGeometryInterface: "point"
    });
    expect(screen.getByText("PICK MODE")).toBeInTheDocument();
    const hostAdapter = mocks.hostAdapter;
    if (!hostAdapter) throw new Error("expected Module Preview Canvas host adapter");
    const pointCandidate = hostAdapter.pickModeCandidates?.[0];
    const pointOption = pointCandidate?.options[0];
    if (!pointCandidate || pointOption?.kind !== "point" || !pointOption.sourceReference) {
      throw new Error("expected authored point Pick candidate");
    }
    act(() => {
      hostAdapter.applyPickedPoint({
        pickedPointAnchor: pointOption.anchor,
        pickedPointCandidateElementId: pointCandidate.elementId,
        pickedPointSourceReference: pointOption.sourceReference
      });
    });
    await act(async () => {
      await flushCrossBoundary();
    });
    const pickedHostAdapter = mocks.hostAdapter;
    if (!pickedHostAdapter) throw new Error("expected updated Module Preview Canvas host adapter");
    act(() => {
      pickedHostAdapter.dispatchCanvasPickCommand?.("finishPickMode");
    });
    await act(async () => {
      await flushCrossBoundary();
    });
    expect(newPanel.traffic).toEqual(expect.arrayContaining([
      expect.objectContaining({
        direction: "webview",
        message: expect.objectContaining({
          type: "modulePreviewReferencePickResult",
          status: "confirmed",
          references: [{ base: "Top" }]
        })
      })
    ]));
    const currentSnapshot = newPanel.traffic.findLast((entry) =>
      entry.direction === "webview" && entry.message.type === "modulePreviewValueSnapshot" &&
      (entry.message as VscodeModulePreviewValueSnapshot).previewStatus === "current"
    )?.message as VscodeModulePreviewValueSnapshot | undefined;
    expect(currentSnapshot).toMatchObject({
      target: { name: "Pocket" },
      previewStatus: "current",
      groups: [expect.objectContaining({
        kind: "target",
        name: "Pocket",
        parameters: [
          expect.objectContaining({ name: "width", value: "13", valueState: "explicit" }),
          expect.objectContaining({ name: "anchor", value: "@Top", valueState: "explicit" })
        ]
      })]
    });
    if (!currentSnapshot) throw new Error("expected current Module Preview snapshot");

    await act(async () => {
      await newPanel.receive({
        ...currentSnapshot,
        sessionId: oldBootstrap.sessionId
      });
      await flushCrossBoundary();
    });
    expect(newPanel.traffic.filter((entry) =>
      entry.direction === "webview" && entry.message.type === "modulePreviewValueSnapshot"
    ).at(-1)?.message).toBe(currentSnapshot);

    editor.selection.active = positionAt(document.getText(), document.getText().length);
    mocks.showTextDocument.mockResolvedValue(editor);
    mocks.executeCommand.mockImplementation(async (command: string) => {
      const handler = mocks.commandHandlers.get(command);
      return handler ? await handler() : undefined;
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Insert Instance" }));
      await flushCrossBoundary();
    });
    expect(mocks.commandHandlers.has(MODULE_PREVIEW_INSERT_INSTANCE_COMMAND)).toBe(true);
    expect(editor.edit).toHaveBeenCalledTimes(1);
    expect(document.getText()).toContain("instance PocketInstance = Pocket(width: 13, anchor: @Top)");
    expect(mocks.showErrorMessage).not.toHaveBeenCalledWith("The Module Preview target is stale.");

    await act(async () => {
      newPanel.webview.postMessage({
        ...newBootstrap,
        sessionId: oldBootstrap.sessionId,
        sessionGeneration: oldBootstrap.sessionGeneration
      });
      await flushCrossBoundary();
    });
    expect(newPanel.traffic.filter((entry) =>
      entry.direction === "webview" && entry.message.type === "modulePreviewBootstrapAcknowledged"
    )).toHaveLength(acknowledgementCountBeforeDuplicate + 1);
    expect(mocks.commandRegistrations).toContain(MODULE_PREVIEW_INSERT_INSTANCE_COMMAND);

    newView!.unmount();
    feature.dispose();
    activeFeature = null;
  });
});
