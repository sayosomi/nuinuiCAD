import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";

const mocks = vi.hoisted(() => ({
  textDocuments: [] as TestDocument[],
  changeListeners: [] as Array<(event: { document: TestDocument; contentChanges: readonly unknown[] }) => void>,
  closeListeners: [] as Array<(document: TestDocument) => void>,
  showTextDocument: vi.fn()
}));

type TestPosition = { line: number; character: number };
type TestDocument = {
  version: number;
  uri: { toString: () => string };
  getText: () => string;
  positionAt: (offset: number) => TestPosition;
  offsetAt: (position: TestPosition) => number;
  replace: (from: TestPosition, to: TestPosition, replacement: string) => void;
};

vi.mock("vscode", () => {
  class Range {
    constructor(public readonly start: TestPosition, public readonly end: TestPosition) {}
  }
  const disposable = (remove: () => void) => ({ dispose: remove });
  return {
    Range,
    workspace: {
      get textDocuments() {
        return mocks.textDocuments;
      },
      onDidChangeTextDocument: (listener: (event: { document: TestDocument; contentChanges: readonly unknown[] }) => void) => {
        mocks.changeListeners.push(listener);
        return disposable(() => {
          const index = mocks.changeListeners.indexOf(listener);
          if (index >= 0) mocks.changeListeners.splice(index, 1);
        });
      },
      onDidCloseTextDocument: (listener: (document: TestDocument) => void) => {
        mocks.closeListeners.push(listener);
        return disposable(() => {
          const index = mocks.closeListeners.indexOf(listener);
          if (index >= 0) mocks.closeListeners.splice(index, 1);
        });
      }
    },
    window: { showTextDocument: mocks.showTextDocument }
  };
});

import { createVscodeReferencePickSourceBridge } from "./referencePickSourceBridge";

const createDocument = (initialSource: string): TestDocument => {
  let source = initialSource;
  const lineStarts = () => {
    const starts = [0];
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] === "\n") starts.push(index + 1);
    }
    return starts;
  };
  const document: TestDocument = {
    version: 3,
    uri: { toString: () => "file:///pick.nui" },
    getText: () => source,
    positionAt: (offset) => {
      const starts = lineStarts();
      let line = 0;
      for (let index = 1; index < starts.length && starts[index]! <= offset; index += 1) line = index;
      return { line, character: offset - starts[line]! };
    },
    offsetAt: (position) => (lineStarts()[position.line] ?? source.length) + position.character,
    replace: (from, to, replacement) => {
      const fromOffset = document.offsetAt(from);
      const toOffset = document.offsetAt(to);
      source = source.slice(0, fromOffset) + replacement + source.slice(toOffset);
      document.version += 1;
    }
  };
  return document;
};

const createEditor = (document: TestDocument) => {
  const edit = vi.fn(async (
    callback: (builder: { replace: (range: { start: TestPosition; end: TestPosition }, replacement: string) => void }) => void,
    options: unknown
  ) => {
    void options;
    let pending: { range: { start: TestPosition; end: TestPosition }; replacement: string } | null = null;
    callback({ replace: (range, replacement) => { pending = { range, replacement }; } });
    if (!pending) return false;
    const editValue = pending as { range: { start: TestPosition; end: TestPosition }; replacement: string };
    document.replace(editValue.range.start, editValue.range.end, editValue.replacement);
    return true;
  });
  return {
    document,
    viewColumn: 1,
    edit
  };
};

const createBridgeFixture = (
  requestId: number,
  initialDraftReferences?: readonly { base: string; pointKey?: string }[]
) => {
  const source = "nui 4\npoint A = coordinate(x: 0, y: 0)\npoint P = offset(from: @A, dx: 0, dy: 0)";
  const document = createDocument(source);
  const editor = createEditor(document);
  mocks.textDocuments = [document];
  const postMessage = vi.fn();
  const bridge = createVscodeReferencePickSourceBridge({
    editor: editor as never,
    languageAnalysisSession: createLanguageAnalysisSession(source),
    requestId,
    normalizedSourceOffset: source.indexOf("@A", source.indexOf("offset")) + 1,
    initialDraftReferences,
    postMessage
  });
  return { source, document, editor, postMessage, bridge };
};

beforeEach(() => {
  mocks.textDocuments = [];
  mocks.changeListeners = [];
  mocks.closeListeners = [];
  mocks.showTextDocument.mockReset();
  mocks.showTextDocument.mockResolvedValue(undefined);
});

describe("createVscodeReferencePickSourceBridge", () => {
  it("revalidates then applies exactly one native editor edit / Undo step and restores Source focus", async () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "point P = offset(from: @A, dx: 0, dy: 0)"
    ].join("\n");
    const document = createDocument(source);
    const editor = createEditor(document);
    mocks.textDocuments = [document];
    const postMessage = vi.fn();
    const position = source.indexOf("from: @A") + "from: @A".length - 1;
    const bridge = createVscodeReferencePickSourceBridge({
      editor: editor as never,
      languageAnalysisSession: createLanguageAnalysisSession(source),
      requestId: 17,
      normalizedSourceOffset: position,
      postMessage
    });
    const request = bridge.start();
    expect(request).not.toBeNull();

    expect(await bridge.handleResult({
      type: "referencePickResult",
      requestId: 17,
      documentUri: request!.documentUri,
      documentVersion: request!.documentVersion,
      targetProof: request!.targetProof,
      status: "started",
      candidateReferences: [{ base: "A" }, { base: "B" }]
    })).toBe("started");
    expect(await bridge.handleResult({
      type: "referencePickResult",
      requestId: 17,
      documentUri: request!.documentUri,
      documentVersion: request!.documentVersion,
      targetProof: request!.targetProof,
      status: "confirmed",
      references: [{ base: "B" }]
    })).toBe("applied");

    expect(editor.edit).toHaveBeenCalledTimes(1);
    expect(editor.edit.mock.calls[0]?.[1]).toEqual({ undoStopBefore: true, undoStopAfter: true });
    expect(document.getText()).toContain("from: @B");
    expect(bridge.appliedHandoff()).toEqual({
      documentUri: "file:///pick.nui",
      documentVersion: 4,
      preConfirmSource: source,
      postConfirmSource: document.getText(),
      normalizedSourceOffset: position,
      targetProof: request!.targetProof,
      references: [{ base: "B" }]
    });
    expect(mocks.showTextDocument).toHaveBeenCalledTimes(1);
    expect(mocks.showTextDocument.mock.calls[0]?.[1]).toMatchObject({
      preserveFocus: false,
      preview: false
    });
  });

  it("carries an optional restored draft into a fresh start request", () => {
    const { bridge } = createBridgeFixture(20, [{ base: "A" }]);
    const request = bridge.start();

    expect(request).not.toBeNull();
    expect(request?.initialDraftReferences).toEqual([{ base: "A" }]);
  });

  it("cancels the draft immediately when the captured Source document changes", () => {
    const { document, postMessage, bridge } = createBridgeFixture(18);
    expect(bridge.start()).not.toBeNull();

    for (const listener of [...mocks.changeListeners]) {
      listener({ document, contentChanges: [{}] });
    }
    expect(bridge.activeRequest()).toBeNull();
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "referencePickCancelRequest",
      requestId: 18,
      documentUri: "file:///pick.nui",
      documentVersion: 3
    });
  });

  it("cancels the draft when the captured Source document closes", () => {
    const { document, postMessage, bridge } = createBridgeFixture(19);
    expect(bridge.start()).not.toBeNull();

    for (const listener of [...mocks.closeListeners]) listener(document);

    expect(bridge.activeRequest()).toBeNull();
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "referencePickCancelRequest",
      requestId: 19,
      documentUri: "file:///pick.nui",
      documentVersion: 3
    });
  });
});
