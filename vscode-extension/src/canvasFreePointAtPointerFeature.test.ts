import { beforeEach, describe, expect, it, vi } from "vitest";
import { vscodeCanvasPointerContextKeys } from "../../src/vscode/protocol";

const mocks = vi.hoisted(() => ({
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  selectionListeners: [] as Array<(event: { textEditor: TestEditor; kind?: number }) => void>,
  documentChangeListeners: [] as Array<(event: { document: TestDocument; contentChanges: unknown[]; reason?: number }) => void>,
  closeListeners: [] as Array<(document: TestDocument) => void>,
  showErrorMessage: vi.fn()
}));

type TestDocument = {
  uri: { scheme: string; toString: () => string };
  fileName: string;
  languageId: string;
  version: number;
};

type TestEditor = {
  document: TestDocument;
  selection: { active: { line: number; character: number } };
};

const disposable = (dispose: () => void = () => undefined) => ({ dispose });

vi.mock("vscode", () => ({
  commands: {
    registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
      mocks.commands.set(id, handler);
      return disposable(() => mocks.commands.delete(id));
    }
  },
  window: {
    onDidChangeTextEditorSelection: (listener: (event: { textEditor: TestEditor; kind?: number }) => void) => {
      mocks.selectionListeners.push(listener);
      return disposable();
    },
    activeTextEditor: null,
    showErrorMessage: mocks.showErrorMessage
  },
  workspace: {
    onDidChangeTextDocument: (listener: (event: { document: TestDocument; contentChanges: unknown[]; reason?: number }) => void) => {
      mocks.documentChangeListeners.push(listener);
      return disposable();
    },
    onDidCloseTextDocument: (listener: (document: TestDocument) => void) => {
      mocks.closeListeners.push(listener);
      return disposable();
    }
  },
  TextEditorSelectionChangeKind: { Keyboard: 1, Mouse: 2 },
  TextDocumentChangeReason: { Undo: 1, Redo: 2 },
  Disposable: {
    from: (...items: Array<{ dispose: () => void }>) => disposable(() => {
      for (const item of items) item.dispose();
    })
  }
}));

import {
  registerVscodeCanvasFreePointAtPointerFeature,
  VSCODE_CANVAS_FREE_POINT_AT_POINTER_COMMAND_ID
} from "./canvasFreePointAtPointerFeature";

const documentFor = (version = 1): TestDocument => ({
  uri: { scheme: "file", toString: () => "file:///pattern.nui" },
  fileName: "/pattern.nui",
  languageId: "nui",
  version
});

const editorFor = (document: TestDocument, line = 2, character = 1): TestEditor => ({
  document,
  selection: { active: { line, character } }
});

beforeEach(() => {
  mocks.commands.clear();
  mocks.selectionListeners.length = 0;
  mocks.documentChangeListeners.length = 0;
  mocks.closeListeners.length = 0;
  mocks.showErrorMessage.mockReset();
});

describe("Canvas free point at pointer feature", () => {
  it("retains a pending invocation through authoritative sync with its pointer and current anchor", () => {
    const document = documentFor();
    const initialEditor = editorFor(document, 3, 4);
    const latestEditor = editorFor(document, 8, 6);
    const token = {};
    let authoritativeReady = false;
    let latestPointer = { x: 12, y: -8 };
    const postFreePointAtPointer = vi.fn();
    const endpoint = {
      sessionToken: token,
      document,
      isCurrent: () => true,
      isAuthoritativeReady: () => authoritativeReady,
      lastCanvasPointer: () => latestPointer,
      postFreePointAtPointer
    };
    const feature = registerVscodeCanvasFreePointAtPointerFeature({
      activeCanvasEndpoint: () => endpoint
    });

    mocks.selectionListeners[0]?.({ textEditor: initialEditor, kind: 1 });
    void mocks.commands.get(VSCODE_CANVAS_FREE_POINT_AT_POINTER_COMMAND_ID)?.({
      webviewSection: "blank",
      [vscodeCanvasPointerContextKeys.x]: 91,
      [vscodeCanvasPointerContextKeys.y]: -37
    });
    expect(postFreePointAtPointer).not.toHaveBeenCalled();

    latestPointer = { x: 100, y: 100 };
    mocks.selectionListeners[0]?.({ textEditor: latestEditor, kind: 1 });
    authoritativeReady = true;
    feature.handleAuthoritativeDocumentReady(token, document, document.version);
    feature.handleAuthoritativeDocumentReady(token, document, document.version);

    expect(postFreePointAtPointer).toHaveBeenCalledTimes(1);
    expect(postFreePointAtPointer).toHaveBeenCalledWith(expect.objectContaining({
      pointer: { x: 91, y: -37 },
      sourcePosition: { documentVersion: 1, line: 8, character: 6 }
    }));
    feature.dispose();
  });

  it("fails closed when a deferred invocation becomes stale or its session is invalidated", () => {
    const document = documentFor();
    const editor = editorFor(document, 3, 4);
    const token = {};
    let current = true;
    let authoritativeReady = false;
    const postFreePointAtPointer = vi.fn();
    const feature = registerVscodeCanvasFreePointAtPointerFeature({
      activeCanvasEndpoint: () => ({
        sessionToken: token,
        document,
        isCurrent: () => current,
        isAuthoritativeReady: () => authoritativeReady,
        lastCanvasPointer: () => ({ x: 12, y: -8 }),
        postFreePointAtPointer
      })
    });

    mocks.selectionListeners[0]?.({ textEditor: editor, kind: 1 });
    void mocks.commands.get(VSCODE_CANVAS_FREE_POINT_AT_POINTER_COMMAND_ID)?.();
    authoritativeReady = true;
    document.version = 2;
    feature.handleAuthoritativeDocumentReady(token, document, document.version);
    expect(postFreePointAtPointer).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("古くなっています"));

    mocks.showErrorMessage.mockClear();
    authoritativeReady = false;
    document.version = 3;
    feature.setExplicitSourceAuthoringPosition(document, {
      documentVersion: 3,
      line: 3,
      character: 4
    });
    void mocks.commands.get(VSCODE_CANVAS_FREE_POINT_AT_POINTER_COMMAND_ID)?.();
    current = false;
    authoritativeReady = true;
    feature.handleAuthoritativeDocumentReady(token, document, document.version);
    expect(postFreePointAtPointer).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("古くなっています"));
    feature.dispose();
  });

  it("queues a successor behind an in-flight request and dispatches it with its pointer and advanced anchor", () => {
    const document = documentFor();
    const editor = editorFor(document, 3, 4);
    const token = {};
    const authoritativeReady = true;
    const postFreePointAtPointer = vi.fn();
    const endpoint = {
      sessionToken: token,
      document,
      isCurrent: () => true,
      isAuthoritativeReady: () => authoritativeReady,
      lastCanvasPointer: () => ({ x: 12, y: -8 }),
      postFreePointAtPointer
    };
    const feature = registerVscodeCanvasFreePointAtPointerFeature({
      activeCanvasEndpoint: () => endpoint
    });

    mocks.selectionListeners[0]?.({ textEditor: editor, kind: 1 });
    void mocks.commands.get(VSCODE_CANVAS_FREE_POINT_AT_POINTER_COMMAND_ID)?.({
      webviewSection: "blank",
      [vscodeCanvasPointerContextKeys.x]: 11,
      [vscodeCanvasPointerContextKeys.y]: -7
    });
    void mocks.commands.get(VSCODE_CANVAS_FREE_POINT_AT_POINTER_COMMAND_ID)?.({
      webviewSection: "blank",
      [vscodeCanvasPointerContextKeys.x]: 91,
      [vscodeCanvasPointerContextKeys.y]: -37
    });

    expect(postFreePointAtPointer).toHaveBeenCalledTimes(1);
    const firstRequestId = postFreePointAtPointer.mock.calls[0]![0].requestId as number;
    document.version = 2;
    feature.handleResult(token, document, {
      type: "canvasFreePointAtPointerResult",
      requestId: firstRequestId,
      status: "applied",
      documentVersion: 2,
      nextSourcePosition: { line: 3, character: 19 }
    });
    expect(postFreePointAtPointer).toHaveBeenCalledTimes(1);

    feature.handleAuthoritativeDocumentReady(token, document, 2);

    expect(postFreePointAtPointer).toHaveBeenCalledTimes(2);
    expect(postFreePointAtPointer).toHaveBeenLastCalledWith(expect.objectContaining({
      documentVersion: 2,
      pointer: { x: 91, y: -37 },
      sourcePosition: { documentVersion: 2, line: 3, character: 19 }
    }));
    feature.dispose();
  });

  it("preserves FIFO order while authoritative readiness is pending", () => {
    const document = documentFor();
    const editor = editorFor(document, 3, 4);
    const token = {};
    let authoritativeReady = false;
    const postFreePointAtPointer = vi.fn();
    const endpoint = {
      sessionToken: token,
      document,
      isCurrent: () => true,
      isAuthoritativeReady: () => authoritativeReady,
      lastCanvasPointer: () => ({ x: 12, y: -8 }),
      postFreePointAtPointer
    };
    const feature = registerVscodeCanvasFreePointAtPointerFeature({
      activeCanvasEndpoint: () => endpoint
    });

    mocks.selectionListeners[0]?.({ textEditor: editor, kind: 1 });
    void mocks.commands.get(VSCODE_CANVAS_FREE_POINT_AT_POINTER_COMMAND_ID)?.({
      webviewSection: "blank",
      [vscodeCanvasPointerContextKeys.x]: 11,
      [vscodeCanvasPointerContextKeys.y]: -7
    });
    void mocks.commands.get(VSCODE_CANVAS_FREE_POINT_AT_POINTER_COMMAND_ID)?.({
      webviewSection: "blank",
      [vscodeCanvasPointerContextKeys.x]: 91,
      [vscodeCanvasPointerContextKeys.y]: -37
    });
    expect(postFreePointAtPointer).not.toHaveBeenCalled();

    authoritativeReady = true;
    feature.handleAuthoritativeDocumentReady(token, document, 1);
    expect(postFreePointAtPointer).toHaveBeenCalledTimes(1);
    expect(postFreePointAtPointer).toHaveBeenLastCalledWith(expect.objectContaining({
      pointer: { x: 11, y: -7 }
    }));

    const firstRequestId = postFreePointAtPointer.mock.calls[0]![0].requestId as number;
    document.version = 2;
    feature.handleResult(token, document, {
      type: "canvasFreePointAtPointerResult",
      requestId: firstRequestId,
      status: "applied",
      documentVersion: 2,
      nextSourcePosition: { line: 3, character: 19 }
    });
    expect(postFreePointAtPointer).toHaveBeenCalledTimes(1);

    feature.handleAuthoritativeDocumentReady(token, document, 2);
    expect(postFreePointAtPointer).toHaveBeenCalledTimes(2);
    expect(postFreePointAtPointer).toHaveBeenLastCalledWith(expect.objectContaining({
      pointer: { x: 91, y: -37 },
      documentVersion: 2,
      sourcePosition: { documentVersion: 2, line: 3, character: 19 }
    }));
    feature.dispose();
  });

  it("isolates queued work by exact session and document during readiness and disposal", () => {
    const documentA = documentFor();
    const documentB = { ...documentFor(), uri: { scheme: "file", toString: () => "file:///other-pattern.nui" } };
    const editorA = editorFor(documentA, 3, 4);
    const editorB = editorFor(documentB, 5, 6);
    const tokenA = {};
    const tokenB = {};
    const postA = vi.fn();
    const postB = vi.fn();
    const endpointA = {
      sessionToken: tokenA,
      document: documentA,
      isCurrent: () => true,
      isAuthoritativeReady: () => false,
      lastCanvasPointer: () => ({ x: 1, y: 2 }),
      postFreePointAtPointer: postA
    };
    const endpointB = {
      sessionToken: tokenB,
      document: documentB,
      isCurrent: () => true,
      isAuthoritativeReady: () => false,
      lastCanvasPointer: () => ({ x: 3, y: 4 }),
      postFreePointAtPointer: postB
    };
    let activeEndpoint = endpointA;
    const feature = registerVscodeCanvasFreePointAtPointerFeature({
      activeCanvasEndpoint: () => activeEndpoint
    });

    mocks.selectionListeners[0]?.({ textEditor: editorA, kind: 1 });
    mocks.selectionListeners[0]?.({ textEditor: editorB, kind: 1 });
    void mocks.commands.get(VSCODE_CANVAS_FREE_POINT_AT_POINTER_COMMAND_ID)?.({
      webviewSection: "blank",
      [vscodeCanvasPointerContextKeys.x]: 10,
      [vscodeCanvasPointerContextKeys.y]: 20
    });
    activeEndpoint = endpointB;
    void mocks.commands.get(VSCODE_CANVAS_FREE_POINT_AT_POINTER_COMMAND_ID)?.({
      webviewSection: "blank",
      [vscodeCanvasPointerContextKeys.x]: 30,
      [vscodeCanvasPointerContextKeys.y]: 40
    });

    feature.disposeSession(tokenA, documentA);
    feature.handleAuthoritativeDocumentReady(tokenA, documentA, 1);
    expect(postA).not.toHaveBeenCalled();

    feature.handleAuthoritativeDocumentReady(tokenB, documentB, 1);
    expect(postB).toHaveBeenCalledTimes(1);
    expect(postB).toHaveBeenCalledWith(expect.objectContaining({ pointer: { x: 30, y: 40 } }));
    feature.dispose();
  });

  it("fails closed with an explicit error when queued work crosses unrelated Source drift", () => {
    const document = documentFor();
    const editor = editorFor(document, 3, 4);
    const token = {};
    let authoritativeReady = false;
    const postFreePointAtPointer = vi.fn();
    const feature = registerVscodeCanvasFreePointAtPointerFeature({
      activeCanvasEndpoint: () => ({
        sessionToken: token,
        document,
        isCurrent: () => true,
        isAuthoritativeReady: () => authoritativeReady,
        lastCanvasPointer: () => ({ x: 12, y: -8 }),
        postFreePointAtPointer
      })
    });

    mocks.selectionListeners[0]?.({ textEditor: editor, kind: 1 });
    void mocks.commands.get(VSCODE_CANVAS_FREE_POINT_AT_POINTER_COMMAND_ID)?.({
      webviewSection: "blank",
      [vscodeCanvasPointerContextKeys.x]: 91,
      [vscodeCanvasPointerContextKeys.y]: -37
    });
    document.version = 2;
    mocks.documentChangeListeners[0]?.({ document, contentChanges: [{}] });
    authoritativeReady = true;
    feature.handleAuthoritativeDocumentReady(token, document, 2);

    expect(postFreePointAtPointer).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("古くなっています"));
    feature.dispose();
  });

  it("retains explicit Source positions, uses the latest Canvas pointer, and advances after acceptance", () => {
    const document = documentFor();
    const editor = editorFor(document, 3, 4);
    const token = {};
    const postFreePointAtPointer = vi.fn();
    const endpoint = {
      sessionToken: token,
      document,
      isCurrent: () => true,
      isAuthoritativeReady: () => true,
      lastCanvasPointer: () => ({ x: 12, y: -8 }),
      postFreePointAtPointer
    };
    const feature = registerVscodeCanvasFreePointAtPointerFeature({
      activeCanvasEndpoint: () => endpoint
    });

    mocks.selectionListeners[0]?.({ textEditor: editor, kind: 1 });
    void mocks.commands.get(VSCODE_CANVAS_FREE_POINT_AT_POINTER_COMMAND_ID)?.();
    expect(postFreePointAtPointer).toHaveBeenCalledWith(expect.objectContaining({
      documentVersion: 1,
      pointer: { x: 12, y: -8 },
      sourcePosition: { documentVersion: 1, line: 3, character: 4 }
    }));

    const requestId = postFreePointAtPointer.mock.calls[0]![0].requestId as number;
    document.version = 2;
    feature.handleResult(token, document, {
      type: "canvasFreePointAtPointerResult",
      requestId,
      status: "applied",
      documentVersion: 2,
      nextSourcePosition: { line: 3, character: 19 }
    });
    void mocks.commands.get(VSCODE_CANVAS_FREE_POINT_AT_POINTER_COMMAND_ID)?.();
    expect(postFreePointAtPointer).toHaveBeenLastCalledWith(expect.objectContaining({
      documentVersion: 2,
      sourcePosition: { documentVersion: 2, line: 3, character: 19 }
    }));
    feature.dispose();
  });

  it("restores the pre-command anchor on Undo so the next creation can proceed", () => {
    const document = documentFor();
    const editor = editorFor(document, 3, 4);
    const token = {};
    const postFreePointAtPointer = vi.fn();
    const feature = registerVscodeCanvasFreePointAtPointerFeature({
      activeCanvasEndpoint: () => ({
        sessionToken: token,
        document,
        isCurrent: () => true,
        isAuthoritativeReady: () => true,
        lastCanvasPointer: () => ({ x: 12, y: -8 }),
        postFreePointAtPointer
      })
    });

    mocks.selectionListeners[0]?.({ textEditor: editor, kind: 1 });
    void mocks.commands.get(VSCODE_CANVAS_FREE_POINT_AT_POINTER_COMMAND_ID)?.();
    const firstRequestId = postFreePointAtPointer.mock.calls[0]![0].requestId as number;
    document.version = 2;
    feature.handleResult(token, document, {
      type: "canvasFreePointAtPointerResult",
      requestId: firstRequestId,
      status: "applied",
      documentVersion: 2,
      nextSourcePosition: { line: 3, character: 19 }
    });

    document.version = 3;
    mocks.documentChangeListeners[0]?.({
      document,
      contentChanges: [{}],
      reason: 1
    });
    void mocks.commands.get(VSCODE_CANVAS_FREE_POINT_AT_POINTER_COMMAND_ID)?.();
    expect(postFreePointAtPointer).toHaveBeenLastCalledWith(expect.objectContaining({
      documentVersion: 3,
      sourcePosition: { documentVersion: 3, line: 3, character: 4 }
    }));
    feature.dispose();
  });

  it("restores the post-insertion anchor on Redo", () => {
    const document = documentFor();
    const editor = editorFor(document, 3, 4);
    const token = {};
    const postFreePointAtPointer = vi.fn();
    const feature = registerVscodeCanvasFreePointAtPointerFeature({
      activeCanvasEndpoint: () => ({
        sessionToken: token,
        document,
        isCurrent: () => true,
        isAuthoritativeReady: () => true,
        lastCanvasPointer: () => ({ x: 12, y: -8 }),
        postFreePointAtPointer
      })
    });

    mocks.selectionListeners[0]?.({ textEditor: editor, kind: 1 });
    void mocks.commands.get(VSCODE_CANVAS_FREE_POINT_AT_POINTER_COMMAND_ID)?.();
    const requestId = postFreePointAtPointer.mock.calls[0]![0].requestId as number;
    document.version = 2;
    feature.handleResult(token, document, {
      type: "canvasFreePointAtPointerResult",
      requestId,
      status: "applied",
      documentVersion: 2,
      nextSourcePosition: { line: 3, character: 19 }
    });
    document.version = 3;
    mocks.documentChangeListeners[0]?.({ document, contentChanges: [{}], reason: 1 });
    document.version = 4;
    mocks.documentChangeListeners[0]?.({ document, contentChanges: [{}], reason: 2 });
    void mocks.commands.get(VSCODE_CANVAS_FREE_POINT_AT_POINTER_COMMAND_ID)?.();

    expect(postFreePointAtPointer).toHaveBeenLastCalledWith(expect.objectContaining({
      documentVersion: 4,
      sourcePosition: { documentVersion: 4, line: 3, character: 19 }
    }));
    feature.dispose();
  });

  it("fails closed after unrelated Source drift instead of treating it as command history", async () => {
    const document = documentFor();
    const editor = editorFor(document, 3, 4);
    const token = {};
    const postFreePointAtPointer = vi.fn();
    const feature = registerVscodeCanvasFreePointAtPointerFeature({
      activeCanvasEndpoint: () => ({
        sessionToken: token,
        document,
        isCurrent: () => true,
        isAuthoritativeReady: () => true,
        lastCanvasPointer: () => ({ x: 12, y: -8 }),
        postFreePointAtPointer
      })
    });
    const activeTextEditor = (await import("vscode")).window as unknown as { activeTextEditor: TestEditor | null };

    mocks.selectionListeners[0]?.({ textEditor: editor, kind: 1 });
    void mocks.commands.get(VSCODE_CANVAS_FREE_POINT_AT_POINTER_COMMAND_ID)?.();
    const requestId = postFreePointAtPointer.mock.calls[0]![0].requestId as number;
    document.version = 2;
    feature.handleResult(token, document, {
      type: "canvasFreePointAtPointerResult",
      requestId,
      status: "applied",
      documentVersion: 2,
      nextSourcePosition: { line: 3, character: 19 }
    });

    editor.selection.active = { line: 6, character: 2 };
    activeTextEditor.activeTextEditor = editor;
    document.version = 3;
    mocks.documentChangeListeners[0]?.({ document, contentChanges: [{}] });
    await Promise.resolve();
    document.version = 4;
    mocks.documentChangeListeners[0]?.({ document, contentChanges: [{}], reason: 1 });
    void mocks.commands.get(VSCODE_CANVAS_FREE_POINT_AT_POINTER_COMMAND_ID)?.();

    expect(postFreePointAtPointer).toHaveBeenCalledTimes(1);
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("古くなっています"));
    feature.dispose();
  });

  it("does not fall back from an invalid or non-blank context to the latest pointer", () => {
    const document = documentFor();
    const editor = editorFor(document);
    const postFreePointAtPointer = vi.fn();
    const feature = registerVscodeCanvasFreePointAtPointerFeature({
      activeCanvasEndpoint: () => ({
        sessionToken: {},
        document,
        isCurrent: () => true,
        isAuthoritativeReady: () => true,
        lastCanvasPointer: () => ({ x: 1, y: 2 }),
        postFreePointAtPointer
      })
    });
    mocks.selectionListeners[0]?.({ textEditor: editor, kind: 2 });

    void mocks.commands.get(VSCODE_CANVAS_FREE_POINT_AT_POINTER_COMMAND_ID)?.({ webviewSection: "element" });
    void mocks.commands.get(VSCODE_CANVAS_FREE_POINT_AT_POINTER_COMMAND_ID)?.({ webviewSection: "blank" });
    expect(postFreePointAtPointer).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledTimes(2);
    feature.dispose();
  });

  it("updates the retained Source position after a direct edit, but ignores programmatic selection", async () => {
    const document = documentFor();
    const editor = editorFor(document, 1, 0);
    const postFreePointAtPointer = vi.fn();
    const feature = registerVscodeCanvasFreePointAtPointerFeature({
      activeCanvasEndpoint: () => ({
        sessionToken: {},
        document,
        isCurrent: () => true,
        isAuthoritativeReady: () => true,
        lastCanvasPointer: () => ({ x: 1, y: 2 }),
        postFreePointAtPointer
      })
    });
    mocks.selectionListeners[0]?.({ textEditor: editor, kind: 3 });
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();

    mocks.selectionListeners[0]?.({ textEditor: editor, kind: 1 });
    document.version = 2;
    editor.selection.active = { line: 5, character: 2 };
    const activeTextEditor = (await import("vscode")).window as unknown as { activeTextEditor: TestEditor | null };
    activeTextEditor.activeTextEditor = editor;
    mocks.documentChangeListeners[0]?.({ document, contentChanges: [{}] });
    await Promise.resolve();
    void mocks.commands.get(VSCODE_CANVAS_FREE_POINT_AT_POINTER_COMMAND_ID)?.();
    expect(postFreePointAtPointer).toHaveBeenCalledWith(expect.objectContaining({
      sourcePosition: { documentVersion: 2, line: 5, character: 2 }
    }));

    feature.setExplicitSourceAuthoringPosition(document, {
      documentVersion: 2,
      line: 4,
      character: 3
    });
    editor.selection.active = { line: 9, character: 9 };
    mocks.selectionListeners[0]?.({ textEditor: editor, kind: 3 });
    void mocks.commands.get(VSCODE_CANVAS_FREE_POINT_AT_POINTER_COMMAND_ID)?.();
    expect(postFreePointAtPointer).toHaveBeenLastCalledWith(expect.objectContaining({
      sourcePosition: { documentVersion: 2, line: 4, character: 3 }
    }));
    feature.dispose();
  });
});
