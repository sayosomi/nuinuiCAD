import { beforeEach, describe, expect, it, vi } from "vitest";

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
  it("retains explicit Source positions, uses the latest Canvas pointer, and advances after acceptance", () => {
    const document = documentFor();
    const editor = editorFor(document, 3, 4);
    const token = {};
    const postFreePointAtPointer = vi.fn();
    const endpoint = {
      sessionToken: token,
      document,
      isCurrent: () => true,
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

  it("does not fall back from an invalid or non-blank context to the latest pointer", () => {
    const document = documentFor();
    const editor = editorFor(document);
    const postFreePointAtPointer = vi.fn();
    const feature = registerVscodeCanvasFreePointAtPointerFeature({
      activeCanvasEndpoint: () => ({
        sessionToken: {},
        document,
        isCurrent: () => true,
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
    feature.dispose();
  });
});
