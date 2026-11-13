import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLanguageAnalysisSession,
  currentCompiledSemanticSnapshotFor
} from "./languageAnalysisSession";
import { queryDslReferencePickTarget } from "@nuinuicad/nui-language";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import { referencePickTargetProofFor } from "../../src/vscode/referencePickProtocol";
import { referencePickHoverForCanvasOption, startVscodeReferencePickCanvasSession, selectVscodeReferencePickCanvasDraft, confirmVscodeReferencePickCanvasSession } from "../../src/vscode/referencePickCanvasSession";
import { projectIncompleteReferencePickCandidate } from "../../src/vscode/referencePickCandidateProjection";
import { buildEvaluationOptions } from "../../src/geometry/productionEvaluationContext";
import { emptyEvaluationResult, evaluateElementsReference } from "../../src/geometry/evaluationEngine";

const mocks = vi.hoisted(() => ({
  textDocuments: [] as TestDocument[],
  changeListeners: [] as Array<(event: { document: TestDocument; contentChanges: readonly unknown[] }) => void>,
  closeListeners: [] as Array<(document: TestDocument) => void>,
  showTextDocument: vi.fn(),
  executeCommand: vi.fn(),
  activeEditor: null as ReturnType<typeof createEditor> | null,
  showInformationMessage: vi.fn(),
  writeText: vi.fn(),
  activeDocument: null as TestDocument | null
}));

type TestPosition = { line: number; character: number };
type TestDocument = {
  version: number;
  uri: { toString: () => string };
  getText: (range?: { start: TestPosition; end: TestPosition }) => string;
  fileName: string;
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
    window: { showTextDocument: mocks.showTextDocument, showInformationMessage: mocks.showInformationMessage, get activeTextEditor() { return mocks.activeEditor; } },
    env: { clipboard: { writeText: mocks.writeText } },
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
    fileName: "/pick.nui",
    getText: range => range ? source.slice(document.offsetAt(range.start), document.offsetAt(range.end)) : source,
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
    selection: { start: document.positionAt(0), end: document.positionAt(0), active: document.positionAt(0) },
    edit
  };
  mocks.activeDocument = document;
  mocks.activeEditor = editor;
  mocks.showTextDocument.mockResolvedValue(editor);
  return editor;
};

const createBridgeFixture = (
  requestId: number,
  initialDraftReferences?: readonly { base: string; pointKey?: string }[],
  preserveSourceFocus = false
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
    ...(preserveSourceFocus ? { preserveSourceFocus: true } : {}),
    postMessage
  } as never);
  return { source, document, editor, postMessage, bridge };
};

beforeEach(() => {
  mocks.showInformationMessage.mockReset();
  mocks.writeText.mockReset();
  mocks.activeEditor = null;
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
  it.each(["confirm", "cancel", "stale", "failed"])("#1537 guards a named knot point through native source adoption: %s", async outcome => {
    const source = `nui 1
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 10, y: 0)
curve C = bezier(start: @A, end: @B, intermediates: [
  knot(point: @A, angle: 45, incoming: 2, outgoing: 3),
  knot(point: @B, angle: 90, incoming: 4, outgoing: 5)
])`;
    const document = createDocument(source);
    const editor = createEditor(document);
    mocks.textDocuments = [document];
    const bridge = createVscodeReferencePickSourceBridge({
      editor: editor as never, languageAnalysisSession: createLanguageAnalysisSession(source),
      requestId: 1537, normalizedSourceOffset: source.indexOf("point: @A") + 8, postMessage: vi.fn()
    });
    const request = bridge.start();
    expect(request).not.toBeNull();
    const proof = { requestId: 1537, documentUri: request!.documentUri, documentVersion: request!.documentVersion, targetProof: request!.targetProof };
    await bridge.handleResult({ type: "referencePickResult", ...proof, status: "started", candidateReferences: [{ base: "A" }, { base: "B" }] });
    if (outcome === "stale") document.version += 1;
    if (outcome === "failed") mocks.executeCommand.mockResolvedValue(false);
    const status = await bridge.handleResult(outcome === "cancel"
      ? { type: "referencePickResult", ...proof, status: "canceled" }
      : { type: "referencePickResult", ...proof, status: "confirmed", resultKind: "geometry", references: [{ base: "B" }] });
    if (outcome === "confirm") {
      expect(status).toBe("applied");
      expect(document.getText()).toBe(source.replace("point: @A", "point: @B"));
    } else {
      expect(status).not.toBe("applied");
      expect(document.getText()).toBe(source);
    }
    bridge.dispose();
  });

  it.each(["confirm", "cancel", "stale"])("#1538 preserves a partial list through real candidate/session and native snippet boundaries: %s", async outcome => {
    const source = "nui 1\nline A = segment(start: (0, 0), end: (10, 0))\nline B = segment(start: (0, 10), end: (10, 10))\nmove [@A, @](from: (0, 0), to: (1, 0)) // retained\nline C = segment(start: (50, 0), end: (60, 0))";
    const document = createDocument(source);
    const editor = createEditor(document);
    mocks.textDocuments = [document];
    const languageSession = createLanguageAnalysisSession(source);
    const bridge = createVscodeReferencePickSourceBridge({ editor: editor as never,
      languageAnalysisSession: languageSession, requestId: 1538,
      normalizedSourceOffset: source.indexOf("move ") + 5, postMessage: vi.fn() });
    const request = bridge.start()!;
    const sourceSnapshot = { normalizedSource: source, sourceRevision: languageSession.getSourceRevision() };
    const compiled = currentCompiledSemanticSnapshotFor(languageSession, sourceSnapshot)!.compiled!;
    const projected = projectIncompleteReferencePickCandidate({ source: sourceSnapshot, compiled, request })!;
    expect(projected).not.toBeNull();
    const evaluation = evaluateElementsReference(projected.document.elements,
      buildEvaluationOptions({ compiledDocument: projected, evaluationLimitIndex: undefined }));
    expect(evaluation.errors).toEqual([]);
    const started = startVscodeReferencePickCanvasSession({ request,
      authoritativeDocumentUri: request.documentUri, authoritativeDocumentVersion: request.documentVersion,
      source: sourceSnapshot, compiled, evaluation: emptyEvaluationResult([]), evaluationIsCurrent: false,
      candidateSnapshot: { source: { normalizedSource: projected.spans.sourceMap.source, sourceRevision: projected.spans.sourceMap.sourceRevision },
        compiled: projected, evaluation } });
    expect(started.session?.draft.draftReferences).toEqual([{ base: "A" }]);
    expect(await bridge.handleResult(started.result)).toBe("started");
    const candidate = started.session!.candidates.find(item => item.options.some(option => option.reference.base === "B"))!;
    const option = candidate.options.find(item => item.reference.base === "B" && !item.reference.pointKey)!;
    const selected = selectVscodeReferencePickCanvasDraft(started.session!, referencePickHoverForCanvasOption(candidate, option));
    const confirmed = confirmVscodeReferencePickCanvasSession(selected).result!;
    if (outcome === "cancel") {
      expect(await bridge.handleResult({ ...started.result, status: "canceled" })).toBe("canceled");
    } else {
      if (outcome === "stale") document.version += 1;
      expect(await bridge.handleResult(confirmed)).toBe(outcome === "stale" ? "stale" : "applied");
    }
    expect(document.getText()).toBe(outcome === "confirm" ? source.replace("[@A, @]", "[@A, @B]") : source);
    expect(mocks.executeCommand).toHaveBeenCalledTimes(outcome === "confirm" ? 1 : 0);
    if (outcome === "confirm") {
      expect(mocks.executeCommand.mock.calls[0]?.[0]).toBe("editor.action.insertSnippet");
      expect(mocks.executeCommand.mock.calls[0]?.[1]).toMatchObject({ snippet: "[@A, @B]" });
      expect(await bridge.handleResult(confirmed)).toBe("ignored");
    }
    bridge.dispose();
  });
  it("replaces a fixed generated endpoint with another exact occurrence through the Source bridge", async () => {
    const reference = "@G[1].end";
    const source = `nui 1
for j in range(min: 0, max: 1, step: 1, showGenerated: true) {
  line G = segment(start: (@j * 20, 0), end: (@j * 20 + 10, 0))
}
line H = segment(start: ${reference}, end: (10, 20))
`;
    const document = createDocument(source);
    const editor = createEditor(document);
    mocks.textDocuments = [document];
    const languageSession = createLanguageAnalysisSession(source);
    const bridge = createVscodeReferencePickSourceBridge({
      editor: editor as never,
      languageAnalysisSession: languageSession,
      requestId: 1559,
      normalizedSourceOffset: source.indexOf(reference) + 1,
      initialDraftReferences: [{ base: "G", occurrenceIndex: "1", pointKey: "end" }],
      postMessage: vi.fn()
    });
    const request = bridge.start();
    if (!request) throw new Error("Source bridge did not produce a fixed generated endpoint request");
    expect(request.targetProof.oldText).toBe(reference);
    expect(request.targetProof.sourceAnchor.statementIndex).toBeGreaterThan(0);

    const sourceSnapshot = { normalizedSource: source, sourceRevision: languageSession.getSourceRevision() };
    const compiled = currentCompiledSemanticSnapshotFor(languageSession, sourceSnapshot)?.compiled;
    if (!compiled?.document || !compiled.statementMap) throw new Error("fixture did not compile");
    const evaluation = evaluateElementsReference(compiled.document.elements, buildEvaluationOptions({
      compiledDocument: compiled as LastGoodDslDocument,
      evaluationLimitIndex: compiled.document.evaluationLimitIndex
    }));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(evaluation.errors).toEqual([]);
    const generatedLineId = compiled.document.elements.find((element) => element.name === "G")?.id;
    const generatedRows = evaluation.forGroupGeneratedRows?.filter((row) => row.templateElementId === generatedLineId) ?? [];
    expect(generatedRows.map((row) => row.iterationIndex)).toEqual([0, 1]);

    const started = startVscodeReferencePickCanvasSession({
      request: {
        ...request,
        initialDraftReferences: [{ base: "G", occurrenceIndex: "1", pointKey: "end" }]
      },
      authoritativeDocumentUri: request.documentUri,
      authoritativeDocumentVersion: request.documentVersion,
      source: sourceSnapshot,
      compiled,
      evaluation,
      evaluationIsCurrent: true
    });
    expect(started.result.status).toBe("started");
    if (!started.session) throw new Error("Canvas session did not start for a fixed generated endpoint");
    expect(await bridge.handleResult(started.result)).toBe("started");

    const firstRow = generatedRows.find((row) => row.iterationIndex === 0);
    const candidate = started.session.candidates.find((item) => item.elementId === firstRow?.generatedElementId);
    const option = candidate?.options.find((item) =>
      item.kind === "point" && item.reference.base === "G" &&
      item.reference.occurrenceIndex === 0 && item.reference.pointKey === "end"
    );
    expect(option).toMatchObject({
      kind: "point",
      point: { x: 10, y: 0 },
      reference: { base: "G", occurrenceIndex: 0, pointKey: "end" }
    });
    if (!candidate || !option || option.kind !== "point") throw new Error("second generated endpoint was unavailable");
    const selected = selectVscodeReferencePickCanvasDraft(
      started.session,
      referencePickHoverForCanvasOption(candidate, option)
    );
    const confirmed = confirmVscodeReferencePickCanvasSession(selected).result;
    expect(confirmed).toMatchObject({
      status: "confirmed",
      resultKind: "geometry",
      references: [{ base: "G", occurrenceIndex: 0, pointKey: "end" }]
    });
    if (!confirmed) throw new Error("Canvas did not confirm the selected generated endpoint");

    expect(await bridge.handleResult(confirmed)).toBe("applied");
    expect(document.getText()).toBe(source.replace(reference, "@G[0].end"));
    expect(bridge.appliedHandoff()?.references).toEqual([{ base: "G", occurrenceIndex: 0, pointKey: "end" }]);
    expect(mocks.executeCommand).toHaveBeenCalledTimes(1);
    expect(mocks.executeCommand.mock.calls[0]?.[1]).toMatchObject({ snippet: "@G[0].end" });
    bridge.dispose();
  });
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

  it("marks a restored Pick request to preserve Source focus", () => {
    const { bridge } = createBridgeFixture(26, [{ base: "A" }], true);

    expect(bridge.start()).toMatchObject({ preserveSourceFocus: true });
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

it.each(['insert', 'replace', 'cancel', 'version', 'range', 'uri', 'focus', 'close', 'unknown', 'copy'] as const)("Browse explicit-edit authority: %s", async outcome => {
  const source = 'nui 1\npoint A = coordinate(x: 10, y: 20)\nextract E(source: , parts: [a: .., b: ..])\n// keep comment';
  const document = createDocument(source);
  const editor = createEditor(document);
  const from = source.indexOf('source: ') + 'source: '.length;
  const to = outcome === 'replace' ? from + 1 : from;
  editor.selection = { start: document.positionAt(from), end: document.positionAt(to), active: document.positionAt(to) };
  mocks.textDocuments = [document];
  const bridge = createVscodeReferencePickSourceBridge({ editor: editor as never, languageAnalysisSession: createLanguageAnalysisSession(source), requestId: 1590, normalizedSourceOffset: from, browse: true, postMessage: vi.fn() });
  const request = bridge.start()!;
  expect(request).toMatchObject({ mode: 'browse', targetProof: null, initialSelection: { from, to, oldText: source.slice(from, to) } });
  const base = { type: 'referencePickResult' as const, requestId: request.requestId, documentUri: request.documentUri, documentVersion: request.documentVersion, targetProof: null };
  expect(await bridge.handleResult({ ...base, status: 'started', sessionMode: 'browse', candidateReferences: [], browseReferences: [{ base: 'A' }] })).toBe('started');
  expect(document.getText()).toBe(source);
  mocks.showInformationMessage.mockImplementation(async (message, _options, action) => {
    expect(message).toContain('URI: file:///pick.nui');
    expect(message).toContain('Version: 3');
    expect(message).toContain(`Existing text: ${JSON.stringify(source.slice(from, to))}`);
    expect(message).toContain('Insert text: "@A"');
    expect(document.getText()).toBe(source);
    if (outcome === 'version') document.replace(document.positionAt(source.length), document.positionAt(source.length), ' ');
    if (outcome === 'range') editor.selection = { start: document.positionAt(0), end: document.positionAt(0), active: document.positionAt(0) };
    if (outcome === 'focus') mocks.activeEditor = null;
    if (outcome === 'close') { mocks.textDocuments = []; for (const listener of [...mocks.closeListeners]) listener(document); }
    if (outcome === 'uri') document.uri = { toString: () => 'file:///wrong.nui' };
    return outcome === 'cancel' ? undefined : action;
  });
  const result = await bridge.handleResult({ ...base, status: outcome === 'copy' ? 'copy' : 'explicit-edit', reference: { base: outcome === 'unknown' ? 'Fabricated' : 'A' } });
  if (outcome === 'insert' || outcome === 'replace') {
    expect(result).toBe('applied');
    expect(document.getText()).toBe(source.slice(0, from) + '@A' + source.slice(to));
    expect(editor.edit).toHaveBeenCalledTimes(1);
    expect(editor.edit).toHaveBeenCalledWith(expect.any(Function), { undoStopBefore: true, undoStopAfter: true });
  } else {
    expect(editor.edit).not.toHaveBeenCalled();
    expect(document.getText()).toBe(outcome === 'version' ? source + ' ' : source);
    expect(result).toBe(outcome === 'cancel' || outcome === 'copy' ? 'active' : outcome === 'unknown' ? 'rejected' : 'stale');
    if (outcome === 'copy') expect(mocks.writeText).toHaveBeenCalledWith('@A');
  }
  bridge.dispose();
});

it("does not turn a Browse response into automatic replacement even with an original target proof", async () => {
  const { bridge, editor, document, source } = createBridgeFixture(1591);
  const request = bridge.start()!;
  const base = { type: 'referencePickResult' as const, requestId: request.requestId, documentUri: request.documentUri, documentVersion: request.documentVersion, targetProof: request.targetProof };
  expect(await bridge.handleResult({ ...base, status: 'started', sessionMode: 'browse', candidateReferences: [], browseReferences: [{ base: 'A' }] })).toBe('started');
  expect(await bridge.handleResult({ ...base, status: 'confirmed', resultKind: 'geometry', references: [{ base: 'A' }] })).toBe('rejected');
  expect(editor.edit).not.toHaveBeenCalled();
  expect(mocks.executeCommand).not.toHaveBeenCalled();
  expect(document.getText()).toBe(source);
});

it("rejects explicit selection with changed snapshot provenance before showing confirmation", async () => {
  const { bridge, document, source } = createBridgeFixture(1592);
  const request = bridge.start()!;
  const snapshot = { sourceRevision: 1, matchesCurrentSource: false, origin: 'pinned' as const };
  const base = { type: 'referencePickResult' as const, requestId: request.requestId, documentUri: request.documentUri, documentVersion: request.documentVersion, targetProof: request.targetProof };
  expect(await bridge.handleResult({ ...base, status: 'started', sessionMode: 'browse', candidateReferences: [], browseReferences: [{ base: 'A' }], snapshot })).toBe('started');
  expect(await bridge.handleResult({ ...base, status: 'explicit-edit', reference: { base: 'A' }, snapshot: { ...snapshot, sourceRevision: 2 } })).toBe('rejected');
  expect(mocks.showInformationMessage).not.toHaveBeenCalled();
  expect(document.getText()).toBe(source);
  bridge.dispose();
});

const verifyCancellationDuringSourceFocus = async (factory: typeof createVscodeReferencePickSourceBridge) => {
  const source = 'nui 1\npoint A = coordinate(x: 0, y: 0)\npoint B = coordinate(x: 10, y: 20)\npoint P = offset(from: @A, dx: 0, dy: 0)';
  const document = createDocument(source), editor = createEditor(document);
  mocks.textDocuments = [document];
  const bridge = factory({ editor: editor as never, languageAnalysisSession: createLanguageAnalysisSession(source), requestId: 1594, normalizedSourceOffset: source.lastIndexOf('@A') + 1, postMessage: vi.fn() });
  const request = bridge.start()!;
  const base = { type: 'referencePickResult' as const, requestId: request.requestId, documentUri: request.documentUri, documentVersion: request.documentVersion, targetProof: request.targetProof };
  expect(await bridge.handleResult({ ...base, status: 'started', candidateReferences: [{ base: 'A' }, { base: 'B' }] })).toBe('started');
  let resume!: (value: typeof editor) => void;
  mocks.showTextDocument.mockImplementationOnce(() => new Promise(resolve => { resume = resolve; }));
  const confirmation = bridge.handleResult({ ...base, status: 'confirmed', resultKind: 'geometry', references: [{ base: 'B' }] });
  expect(mocks.showTextDocument).toHaveBeenCalledTimes(1);
  bridge.cancel();
  resume(editor);
  await confirmation;
  expect(document.getText()).toBe(source);
  expect(mocks.executeCommand).not.toHaveBeenCalled();
  bridge.dispose();
};

it('does not mutate Source when canceled while native Source focus is pending', async () => {
  await verifyCancellationDuringSourceFocus(createVscodeReferencePickSourceBridge);
});
