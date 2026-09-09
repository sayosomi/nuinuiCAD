import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectionListeners: [] as Array<(event: { textEditor: TestEditor; kind?: number }) => void>,
  documentChangeListeners: [] as Array<(event: { document: TestDocument; contentChanges: unknown[]; reason?: number }) => void>,
  closeListeners: [] as Array<(document: TestDocument) => void>
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
  window: {
    onDidChangeTextEditorSelection: (listener: (event: { textEditor: TestEditor; kind?: number }) => void) => {
      mocks.selectionListeners.push(listener);
      return disposable();
    },
    activeTextEditor: null
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

import { registerVscodeSourceAuthoringPositionFeature } from "./sourceAuthoringPositionFeature";

const documentFor = (version = 1): TestDocument => ({
  uri: { scheme: "file", toString: () => "file:///pattern.nui" },
  fileName: "/pattern.nui",
  languageId: "nui",
  version
});

beforeEach(() => {
  mocks.selectionListeners.length = 0;
  mocks.documentChangeListeners.length = 0;
  mocks.closeListeners.length = 0;
});

describe("shared VS Code Source authoring position owner", () => {
  it("supplies one retained position to free-point command requests", () => {
    const document = documentFor();
    const editor = { document, selection: { active: { line: 4, character: 2 } } };
    const feature = registerVscodeSourceAuthoringPositionFeature();
    mocks.selectionListeners[0]?.({ textEditor: editor, kind: 1 });

    const freeRequestId = feature.beginCommandOwnedEdit({
      sessionToken: {},
      document,
      sourcePosition: { documentVersion: 1, line: 4, character: 2 }
    });

    expect(freeRequestId).toEqual(expect.any(Number));
    expect(feature.sourceAuthoringPositionFor(document)).toEqual({ documentVersion: 1, line: 4, character: 2 });
    feature.dispose();
  });

  it("advances only after the marked host edit is observed and accepted", () => {
    const document = documentFor();
    const feature = registerVscodeSourceAuthoringPositionFeature();
    mocks.selectionListeners[0]?.({
      textEditor: { document, selection: { active: { line: 2, character: 1 } } },
      kind: 1
    });
    const requestId = feature.beginCommandOwnedEdit({
      sessionToken: {},
      document,
      sourcePosition: { documentVersion: 1, line: 2, character: 1 }
    })!;
    feature.markCommandOwnedEdit(requestId);
    document.version = 2;
    mocks.documentChangeListeners[0]?.({ document, contentChanges: [{}] });

    expect(feature.completeCommandOwnedEdit({
      requestId,
      document,
      documentVersion: 2,
      postPosition: { line: 2, character: 25 }
    })).toBe(true);
    expect(feature.sourceAuthoringPositionFor(document)).toEqual({
      documentVersion: 2,
      line: 2,
      character: 25
    });
    feature.dispose();
  });

  it("does not advance a rejected command-owned edit", () => {
    const document = documentFor();
    const feature = registerVscodeSourceAuthoringPositionFeature();
    mocks.selectionListeners[0]?.({
      textEditor: { document, selection: { active: { line: 2, character: 1 } } },
      kind: 1
    });
    const requestId = feature.beginCommandOwnedEdit({
      sessionToken: {},
      document,
      sourcePosition: { documentVersion: 1, line: 2, character: 1 }
    })!;
    feature.markCommandOwnedEdit(requestId);
    feature.rejectCommandOwnedEdit(requestId);
    document.version = 2;

    expect(feature.completeCommandOwnedEdit({
      requestId,
      document,
      documentVersion: 2,
      postPosition: { line: 2, character: 25 }
    })).toBe(false);
    expect(feature.sourceAuthoringPositionFor(document)).toEqual({ documentVersion: 1, line: 2, character: 1 });
    feature.dispose();
  });
});
