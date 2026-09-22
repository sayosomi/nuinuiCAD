import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  showTextDocument: vi.fn(),
  executeCommand: vi.fn(),
  writable: true,
  Position: class Position {
    constructor(public readonly line: number, public readonly character: number) {}
  },
  Selection: class Selection {
    constructor(public readonly start: unknown, public readonly end: unknown) {}
  }
}));

vi.mock("vscode", () => ({
  ViewColumn: { Beside: 2 },
  Position: mocks.Position,
  Selection: mocks.Selection,
  commands: { executeCommand: mocks.executeCommand },
  window: { showTextDocument: mocks.showTextDocument },
  workspace: { fs: { isWritableFileSystem: () => mocks.writable } }
}));

import type { VscodeToExtensionMessage } from "../../src/vscode/protocol";
import { createOutputPreviewSourceInteractionFeature } from "./outputPreviewSourceInteractionFeature";

type TestPosition = { line: number; character: number };

type TestDocument = {
  languageId: string;
  fileName: string;
  version: number;
  uri: { scheme: string; toString: () => string };
  getText: () => string;
  positionAt: (offset: number) => TestPosition;
};

type TestEditor = { document: TestDocument; viewColumn?: number };

const source = "nui 1";

const documentFor = (uri: string, overrides: Partial<TestDocument> = {}): TestDocument => ({
  languageId: "nui",
  fileName: "/tmp/preview.nui",
  version: 7,
  uri: { scheme: "file", toString: () => uri },
  getText: () => source,
  positionAt: (offset) => ({ line: 0, character: offset }),
  ...overrides
});

const createInteraction = (document: TestDocument, editor: TestEditor) => {
  const panel = { active: true };
  const session = { document, panel };
  const feature = createOutputPreviewSourceInteractionFeature({
    isSessionCurrent: () => true,
    isOpenDocument: () => true,
    sameDocument: (left, right) => left.uri.toString() === right.uri.toString(),
    isNormalizedRangeSafe: () => true,
    visibleEditorFor: () => editor,
    resyncOutputPreview: () => undefined
  });
  return { feature, session };
};

const request = (documentVersion: number): Extract<VscodeToExtensionMessage, { type: "outputPreviewInsertTemplate" }> => ({
  type: "outputPreviewInsertTemplate",
  documentVersion
});

describe("Output Preview Source Insert Template interaction", () => {
  beforeEach(() => {
    mocks.showTextDocument.mockReset();
    mocks.executeCommand.mockReset();
    mocks.executeCommand.mockResolvedValue(undefined);
    mocks.writable = true;
  });

  it("reveals the exact associated Source at EOF before invoking the canonical command", async () => {
    const document = documentFor("file:///tmp/preview.nui");
    const unrelated = documentFor("file:///tmp/unrelated.nui");
    const unrelatedEditor = { document: unrelated, viewColumn: 1 };
    const associatedEditor = { document, viewColumn: 2 };
    mocks.showTextDocument.mockResolvedValue(associatedEditor);
    const { feature, session } = createInteraction(document, unrelatedEditor);

    await feature.handleInsertTemplate(session, request(document.version));

    expect(mocks.showTextDocument).toHaveBeenCalledWith(document, expect.objectContaining({
      viewColumn: 1,
      preserveFocus: false,
      preview: false,
      selection: expect.objectContaining({
        start: expect.objectContaining({ line: 0, character: source.length }),
        end: expect.objectContaining({ line: 0, character: source.length })
      })
    }));
    expect(mocks.showTextDocument.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.executeCommand.mock.invocationCallOrder[0]!);
    expect(mocks.executeCommand).toHaveBeenCalledWith("nuinuiCAD.insertTemplate", {
      documentUri: "file:///tmp/preview.nui",
      expectedDocumentVersion: document.version,
      insertionOrigin: "document-end"
    });
  });

  it("rejects a stale request before revealing or invoking the command", async () => {
    const document = documentFor("file:///tmp/preview.nui");
    const { feature, session } = createInteraction(document, { document });

    await feature.handleInsertTemplate(session, request(document.version - 1));

    expect(mocks.showTextDocument).not.toHaveBeenCalled();
    expect(mocks.executeCommand).not.toHaveBeenCalled();
  });

  it.each([
    ["non-file", { uri: { scheme: "untitled", toString: () => "untitled:preview" } }],
    ["wrong language", { languageId: "plaintext" }],
    ["wrong extension", { fileName: "/tmp/preview.txt" }]
  ] as const)("rejects an unavailable %s Source without mutation", async (_label, overrides) => {
    const document = documentFor("file:///tmp/preview.nui", overrides);
    const { feature, session } = createInteraction(document, { document });

    await feature.handleInsertTemplate(session, request(document.version));

    expect(mocks.showTextDocument).not.toHaveBeenCalled();
    expect(mocks.executeCommand).not.toHaveBeenCalled();
  });

  it("rejects a read-only Source without mutation", async () => {
    mocks.writable = false;
    const document = documentFor("file:///tmp/preview.nui");
    const { feature, session } = createInteraction(document, { document });

    await feature.handleInsertTemplate(session, request(document.version));

    expect(mocks.showTextDocument).not.toHaveBeenCalled();
    expect(mocks.executeCommand).not.toHaveBeenCalled();
  });

  it("rejects a reveal result for a different document", async () => {
    const document = documentFor("file:///tmp/preview.nui");
    const otherDocument = documentFor("file:///tmp/other.nui");
    mocks.showTextDocument.mockResolvedValue({ document: otherDocument });
    const { feature, session } = createInteraction(document, { document });

    await feature.handleInsertTemplate(session, request(document.version));

    expect(mocks.executeCommand).not.toHaveBeenCalled();
  });

  it("rejects a document changed during reveal", async () => {
    const document = documentFor("file:///tmp/preview.nui");
    mocks.showTextDocument.mockImplementation(async () => {
      document.version += 1;
      return { document };
    });
    const { feature, session } = createInteraction(document, { document });

    await feature.handleInsertTemplate(session, request(document.version));

    expect(mocks.executeCommand).not.toHaveBeenCalled();
  });
});
