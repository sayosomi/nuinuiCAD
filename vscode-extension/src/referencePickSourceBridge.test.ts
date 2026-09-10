import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLanguageAnalysisSession,
  currentCompiledSemanticSnapshotFor
} from "./languageAnalysisSession";
import { queryDslReferencePickTarget } from "@nuinuicad/nui-language";
import { referencePickTargetProofFor } from "../../src/vscode/referencePickProtocol";

const mocks = vi.hoisted(() => ({
  textDocuments: [] as TestDocument[],
  changeListeners: [] as Array<(event: { document: TestDocument; contentChanges: readonly unknown[] }) => void>,
  closeListeners: [] as Array<(document: TestDocument) => void>,
  showTextDocument: vi.fn(),
  executeCommand: vi.fn(),
  activeDocument: null as TestDocument | null
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
    window: { showTextDocument: mocks.showTextDocument },
    commands: { executeCommand: mocks.executeCommand }
  };
});

import {
  createVscodeReferencePickSourceBridge,
  snippetLiteralForText
} from "./referencePickSourceBridge";

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
  const editor = {
    document,
    viewColumn: 1,
    edit
  };
  mocks.activeDocument = document;
  mocks.showTextDocument.mockResolvedValue(editor);
  return editor;
};

const createBridgeFixture = (
  requestId: number,
  initialDraftReferences?: readonly { base: string; pointKey?: string }[]
) => {
  const source = "nui 1\npoint A = coordinate(x: 0, y: 0)\npoint P = offset(from: @A, dx: 0, dy: 0)";
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
  mocks.executeCommand.mockReset();
  mocks.executeCommand.mockImplementation(async (
    _command: string,
    args: { snippet: string; ranges: Array<{ start: TestPosition; end: TestPosition }> }
  ) => {
    const literal = args.snippet.replace(/\\([\\$}])/g, "$1");
    const range = args.ranges[0];
    if (range) mocks.activeDocument?.replace(range.start, range.end, literal);
    return true;
  });
  mocks.activeDocument = null;
});

describe("createVscodeReferencePickSourceBridge", () => {
  it("revalidates then applies through the merge-capable snippet command and restores Source focus", async () => {
    const source = [
      "nui 1",
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
      resultKind: "geometry",
      references: [{ base: "B" }]
    })).toBe("applied");

    expect(editor.edit).not.toHaveBeenCalled();
    expect(mocks.executeCommand).toHaveBeenCalledTimes(1);
    expect(mocks.executeCommand.mock.calls[0]?.[0]).toBe("editor.action.insertSnippet");
    expect(mocks.executeCommand.mock.calls[0]?.[1]).toMatchObject({
      snippet: "@B",
      ranges: [{ start: { line: 3 }, end: { line: 3 } }]
    });
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
    expect(mocks.showTextDocument).toHaveBeenCalledTimes(2);
    expect(mocks.showTextDocument.mock.calls[0]?.[1]).toMatchObject({
      preserveFocus: false,
      preview: false
    });
  });

  it("escapes replacement text before it enters snippet literal data", async () => {
    const input = "a$}" + "\\" + "b";
    const expected = "a\\$\\}" + "\\\\" + "b";
    expect(snippetLiteralForText(input)).toBe(expected);
  });

  it("accepts an explicit terminal cancellation without editing or creating an applied handoff", async () => {
    const { source, document, editor, bridge } = createBridgeFixture(24);
    const request = bridge.start();
    expect(request).not.toBeNull();
    const originalVersion = document.version;

    expect(await bridge.handleResult({
      type: "referencePickResult",
      requestId: 24,
      documentUri: request!.documentUri,
      documentVersion: request!.documentVersion,
      targetProof: request!.targetProof,
      status: "started",
      candidateReferences: [{ base: "A" }]
    })).toBe("started");
    expect(await bridge.handleResult({
      type: "referencePickResult",
      requestId: 24,
      documentUri: request!.documentUri,
      documentVersion: request!.documentVersion,
      targetProof: request!.targetProof,
      status: "canceled"
    })).toBe("canceled");

    expect(editor.edit).not.toHaveBeenCalled();
    expect(document.getText()).toBe(source);
    expect(document.version).toBe(originalVersion);
    expect(bridge.appliedHandoff()).toBeNull();
    expect(bridge.activeRequest()).toBeNull();
  });

  it("carries an optional restored draft into a fresh start request", () => {
    const { bridge } = createBridgeFixture(20, [{ base: "A" }]);
    const request = bridge.start();

    expect(request).not.toBeNull();
    expect(request?.initialDraftReferences).toEqual([{ base: "A" }]);
  });

  it("carries an existing numeric property draft into a fresh start request", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "point P = offset(from: @A, dx: @Base.length, dy: 0)"
    ].join("\n");
    const document = createDocument(source);
    const editor = createEditor(document);
    mocks.textDocuments = [document];
    const bridge = createVscodeReferencePickSourceBridge({
      editor: editor as never,
      languageAnalysisSession: createLanguageAnalysisSession(source),
      requestId: 22,
      normalizedSourceOffset: source.indexOf("@Base.length") + 1,
      initialNumericPropertyDraft: { reference: { base: "Base" }, property: "length" },
      postMessage: vi.fn()
    });

    const request = bridge.start();

    expect(request?.initialNumericPropertyDraft).toEqual({
      reference: { base: "Base" },
      property: "length"
    });
  });

  it("accepts a broad own-line proof when the bridge re-queries from the exact value", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "module M(anchor: point, distance: number) {",
      "}",
      "instance X = M(",
      "  anchor: @A,",
      "  distance: 20,",
      ")"
    ].join("\n");
    const document = createDocument(source);
    const editor = createEditor(document);
    mocks.textDocuments = [document];
    const session = createLanguageAnalysisSession(source);
    const broadOffset = source.lastIndexOf("  anchor");
    const sourceSnapshot = {
      normalizedSource: source,
      sourceRevision: session.getSourceRevision()
    };
    const semantic = currentCompiledSemanticSnapshotFor(session, sourceSnapshot);
    const broadTarget = queryDslReferencePickTarget({
      source: sourceSnapshot,
      position: broadOffset,
      semantic
    });
    if (!broadTarget) throw new Error("missing broad own-line target");
    const proof = referencePickTargetProofFor(source, broadTarget);
    if (!proof) throw new Error("missing broad own-line proof");
    const bridge = createVscodeReferencePickSourceBridge({
      editor: editor as never,
      languageAnalysisSession: session,
      requestId: 23,
      normalizedSourceOffset: broadTarget.range.from,
      expectedTargetProof: proof,
      postMessage: vi.fn()
    });

    const request = bridge.start();

    expect(request).not.toBeNull();
    expect(request?.targetProof.activationRange).toEqual({
      from: broadOffset,
      to: source.indexOf("\n", broadOffset)
    });
  });

  it("applies a numeric confirmation as one complete Source edit and restores the final caret", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "point P = offset(from: @A, dx: 20, dy: 0)"
    ].join("\n");
    const document = createDocument(source);
    const editor = createEditor(document);
    mocks.textDocuments = [document];
    const postMessage = vi.fn();
    const position = source.indexOf("20") + 1;
    const bridge = createVscodeReferencePickSourceBridge({
      editor: editor as never,
      languageAnalysisSession: createLanguageAnalysisSession(source),
      requestId: 21,
      normalizedSourceOffset: position,
      postMessage
    });
    const request = bridge.start();
    expect(request).not.toBeNull();
    const proof = request!.targetProof;
    expect(await bridge.handleResult({
      type: "referencePickResult",
      requestId: 21,
      documentUri: request!.documentUri,
      documentVersion: request!.documentVersion,
      targetProof: proof,
      status: "started",
      candidateReferences: [{ base: "Base" }],
      numericCandidates: [{ reference: { base: "Base" }, properties: ["length"] }]
    })).toBe("started");
    expect(await bridge.handleResult({
      type: "referencePickResult",
      requestId: 21,
      documentUri: request!.documentUri,
      documentVersion: request!.documentVersion,
      targetProof: proof,
      status: "confirmed",
      resultKind: "numericProperty",
      reference: { base: "Base" },
      property: "length"
    })).toBe("applied");

    expect(editor.edit).not.toHaveBeenCalled();
    expect(mocks.executeCommand).toHaveBeenCalledWith(
      "editor.action.insertSnippet",
      expect.objectContaining({ snippet: "@Base.length" })
    );
    expect(document.getText()).toContain("dx: @Base.length");
    expect(mocks.showTextDocument.mock.calls[1]?.[1]).toMatchObject({
      selection: { start: { line: 4, character: source.split("\n")[4]!.indexOf("20") + "@Base.length".length } }
    });
  });

  it("fails closed when the merge-capable command does not produce the planned Source", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "point P = offset(from: @A, dx: 0, dy: 0)"
    ].join("\n");
    const document = createDocument(source);
    const editor = createEditor(document);
    mocks.textDocuments = [document];
    const bridge = createVscodeReferencePickSourceBridge({
      editor: editor as never,
      languageAnalysisSession: createLanguageAnalysisSession(source),
      requestId: 25,
      normalizedSourceOffset: source.indexOf("from: @A") + "from: @A".length - 1,
      postMessage: vi.fn()
    });
    const request = bridge.start();
    expect(request).not.toBeNull();
    await bridge.handleResult({
      type: "referencePickResult",
      requestId: 25,
      documentUri: request!.documentUri,
      documentVersion: request!.documentVersion,
      targetProof: request!.targetProof,
      status: "started",
      candidateReferences: [{ base: "A" }, { base: "B" }]
    });
    mocks.executeCommand.mockImplementationOnce(async () => true);

    await expect(bridge.handleResult({
      type: "referencePickResult",
      requestId: 25,
      documentUri: request!.documentUri,
      documentVersion: request!.documentVersion,
      targetProof: request!.targetProof,
      status: "confirmed",
      resultKind: "geometry",
      references: [{ base: "B" }]
    })).resolves.toBe("rejected");
    expect(document.getText()).toBe(source);
    expect(editor.edit).not.toHaveBeenCalled();
    expect(bridge.appliedHandoff()).toBeNull();
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
