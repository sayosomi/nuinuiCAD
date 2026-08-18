import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => {
  class Position {
    constructor(public readonly line: number, public readonly character: number) {}
  }
  class Range {
    constructor(public readonly start: Position, public readonly end: Position) {}
  }
  class WorkspaceEdit {
    readonly edits: Array<{ uri: unknown; range: Range; newText: string }> = [];

    replace(uri: unknown, range: Range, newText: string): void {
      this.edits.push({ uri, range, newText });
    }
  }
  return { Position, Range, WorkspaceEdit };
// @ts-expect-error Vitest's runtime supports the virtual-module options used here.
}, { virtual: true });

import * as vscode from "vscode";
import * as renameQuery from "../../src/dsl/dslRenameQuery";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";
import {
  createNuiRenameProvider,
  nuiRenameSelector
} from "./renameProvider";

type TestDocument = {
  fileName: string;
  version: number;
  uri: { scheme: string; toString: () => string };
  getText: () => string;
  offsetAt: (position: vscode.Position) => number;
  positionAt: (offset: number) => vscode.Position;
  setSourceText: (text: string) => void;
  onGetText?: () => void;
};

type TestWorkspaceEdit = {
  edits: Array<{ uri: unknown; range: vscode.Range; newText: string }>;
};

const documentFor = (
  initialSource: string,
  fileName = "/tmp/pattern.nui",
  scheme = "file"
): TestDocument => {
  let source = initialSource;
  const document: TestDocument = {
    fileName,
    version: 1,
    uri: { scheme, toString: () => `${scheme}://${fileName}` },
    getText: () => {
      document.onGetText?.();
      return source;
    },
    offsetAt: (position) => {
      const starts = lineStartsFor(source);
      const line = Math.min(Math.max(position.line, 0), starts.length - 1);
      const lineEnd = line + 1 < starts.length ? starts[line + 1]! - 1 : source.length;
      const character = Math.min(Math.max(position.character, 0), lineEnd - starts[line]!);
      return starts[line]! + character;
    },
    positionAt: (offset) => {
      const starts = lineStartsFor(source);
      const clampedOffset = Math.min(Math.max(offset, 0), source.length);
      let line = 0;
      while (line + 1 < starts.length && starts[line + 1]! <= clampedOffset) line += 1;
      return new vscode.Position(line, clampedOffset - starts[line]!);
    },
    setSourceText: (nextSource) => { source = nextSource; }
  };
  return document;
};

const lineStartsFor = (source: string): number[] => {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
};

const positionAtText = (document: TestDocument, source: string, token: string, offset = 0): vscode.Position =>
  document.positionAt(source.indexOf(token) + offset);

const providerFor = (source: string, document: TestDocument = documentFor(source)) => {
  const session = createLanguageAnalysisSession(source);
  return { document, provider: createNuiRenameProvider(() => session), session };
};

const prepareAt = (provider: vscode.RenameProvider, document: TestDocument, position: vscode.Position) =>
  provider.prepareRename!(document as unknown as vscode.TextDocument, position, undefined as never);

const editsAt = (
  provider: vscode.RenameProvider,
  document: TestDocument,
  position: vscode.Position,
  newName: string
) => provider.provideRenameEdits!(
  document as unknown as vscode.TextDocument,
  position,
  newName,
  undefined as never
) as TestWorkspaceEdit | undefined;

describe("VS Code native nui rename provider", () => {
  it("uses the file-scoped selector and rejects unsupported documents", () => {
    expect(nuiRenameSelector).toEqual({ language: "nui", scheme: "file" });

    const source = "nui 4\npoint A = coordinate(x: 0, y: 0)";
    const unsupportedCase = providerFor(source, documentFor(source, "/tmp/pattern.txt"));
    const untitledCase = providerFor(source, documentFor(source, "/tmp/pattern.nui", "untitled"));

    expect(prepareAt(unsupportedCase.provider, unsupportedCase.document, new vscode.Position(1, 6))).toBeUndefined();
    expect(prepareAt(untitledCase.provider, untitledCase.document, new vscode.Position(1, 6))).toBeUndefined();
  });

  it("prepares declaration and reference renames with exact identifier ranges", () => {
    const source = [
      "nui 4",
      "point Base = coordinate(x: 0, y: 0)",
      "point Use = offset(from: @Base, dx: 1, dy: 0)"
    ].join("\n");
    const { document, provider } = providerFor(source);

    const declaration = prepareAt(provider, document, positionAtText(document, source, "Base"));
    const reference = prepareAt(provider, document, positionAtText(document, source, "@Base", 1));

    expect(declaration).toMatchObject({
      range: {
        start: { line: 1, character: "point ".length },
        end: { line: 1, character: "point Base".length }
      },
      placeholder: "Base"
    });
    expect(reference).toMatchObject({
      range: {
        start: { line: 2, character: source.split("\n")[2]!.indexOf("@Base") + 1 },
        end: { line: 2, character: source.split("\n")[2]!.indexOf("@Base") + 1 + "Base".length }
      },
      placeholder: "Base"
    });
  });

  it("keeps @, ::, dot, and property names outside rename ranges", () => {
    const source = [
      "nui 4",
      "group Front {",
      "  point Shoulder = coordinate(x: 0, y: 0)",
      "}",
      "point Use = offset(from: @Front::Shoulder, dx: 1, dy: 0)",
      "point WithProperty = coordinate(x: @Front::Shoulder.x, y: 0)"
    ].join("\n");
    const { document, provider } = providerFor(source);
    const qualified = "@Front::Shoulder";
    const frontOffset = source.indexOf(qualified) + 1;
    const shoulderOffset = source.indexOf(qualified) + "@Front::".length;
    const propertyOffset = source.indexOf(".x") + 1;

    expect(prepareAt(provider, document, document.positionAt(frontOffset))).toMatchObject({ placeholder: "Front" });
    expect(prepareAt(provider, document, document.positionAt(frontOffset))).toMatchObject({
      range: { start: document.positionAt(frontOffset), end: document.positionAt(frontOffset + "Front".length) }
    });
    expect(prepareAt(provider, document, document.positionAt(shoulderOffset))).toMatchObject({ placeholder: "Shoulder" });
    expect(() => prepareAt(provider, document, document.positionAt(propertyOffset))).toThrow(
      "Rename is not available at this position."
    );
  });

  it("projects every Task 7 edit into one same-document WorkspaceEdit", () => {
    const source = [
      "nui 4",
      "point Base = coordinate(",
      "  x: 0,",
      "  y: 0,",
      ")",
      "# Base remains unrelated text",
      "point Use = offset(",
      "  from: @Base,",
      "  dx: 1,",
      "  dy: 0,",
      ")",
      "point BaseCopy = coordinate(",
      "  x: 2,",
      "  y: 0,",
      ")"
    ].join("\n");
    const { document, provider } = providerFor(source);
    const position = positionAtText(document, source, "@Base", 1);
    const edit = editsAt(provider, document, position, "Renamed");

    expect(edit).toBeDefined();
    expect(edit?.edits).toHaveLength(2);
    expect(edit?.edits.every((entry) => entry.uri === document.uri && entry.newText === "Renamed")).toBe(true);
    expect(edit?.edits.map((entry) => source.slice(
      document.offsetAt(entry.range.start),
      document.offsetAt(entry.range.end)
    ))).toEqual(["Base", "Base"]);
    expect(source).toContain("# Base remains unrelated text");
    expect(source).toContain("BaseCopy");
  });

  it("projects Module parameter declaration, references, and call labels", () => {
    const source = [
      "nui 4",
      "module Measure(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "instance Call = Measure(width: 10)"
    ].join("\n");
    const { document, provider } = providerFor(source);
    const edit = editsAt(provider, document, positionAtText(document, source, "width: number"), "length");

    expect(edit).toBeDefined();
    expect(edit?.edits).toHaveLength(3);
    expect(edit?.edits.map((entry) => source.slice(
      document.offsetAt(entry.range.start),
      document.offsetAt(entry.range.end)
    ))).toEqual(["width", "width", "width"]);
    expect(edit?.edits.every((entry) => entry.uri === document.uri)).toBe(true);
  });

  it("keeps UTF-16 ranges exact for CRLF, Japanese identifiers, and an earlier surrogate pair", () => {
    const normalized = [
      "nui 4",
      "# 😀",
      "point 前身頃 = coordinate(",
      "  x: 0,",
      "  y: 0,",
      ")",
      "point 使用 = offset(",
      "  from: @前身頃,",
      "  dx: 1,",
      "  dy: 0,",
      ")"
    ].join("\n");
    const source = normalized.replace(/\n/g, "\r\n");
    const document = documentFor(source);
    const { provider } = providerFor(source, document);
    const referenceLine = normalized.split("\n")[7]!;
    const referenceStart = referenceLine.indexOf("@前身頃");
    const prepared = prepareAt(provider, document, new vscode.Position(7, referenceStart + 1));
    const edit = editsAt(provider, document, new vscode.Position(7, referenceStart + 1), "後身頃");

    expect(prepared).toMatchObject({
      range: {
        start: { line: 7, character: referenceStart + 1 },
        end: { line: 7, character: referenceStart + 1 + "前身頃".length }
      },
      placeholder: "前身頃"
    });
    expect(edit?.edits).toHaveLength(2);
    expect(edit?.edits.map((entry) => ({
      start: entry.range.start,
      end: entry.range.end,
      text: entry.newText
    }))).toEqual([
      {
        start: { line: 2, character: "point ".length },
        end: { line: 2, character: "point 前身頃".length },
        text: "後身頃"
      },
      {
        start: { line: 7, character: referenceStart + 1 },
        end: { line: 7, character: referenceStart + 1 + "前身頃".length },
        text: "後身頃"
      }
    ]);
  });

  it("synchronizes an existing session from the current unsaved TextDocument", () => {
    const initialSource = "nui 4\npoint Old = coordinate(x: 0, y: 0)";
    const currentSource = [
      "nui 4",
      "point Current = coordinate(x: 0, y: 0)",
      "point Use = offset(from: @Current, dx: 1, dy: 0)"
    ].join("\n");
    const session = createLanguageAnalysisSession(initialSource);
    const document = documentFor(currentSource);
    const provider = createNuiRenameProvider(() => session);
    const prepared = prepareAt(provider, document, positionAtText(document, currentSource, "@Current", 1));

    expect(session.getSource()).toBe(currentSource);
    expect(prepared).toMatchObject({ placeholder: "Current" });
  });

  it("fails closed for fatal, invalid, colliding, and module-iteration renames", () => {
    const valid = "nui 4\npoint A = coordinate(x: 0, y: 0)";
    const fatalDocument = documentFor("nui 4\npoint A = coordinate(x: 0, y: ");
    const fatalSession = createLanguageAnalysisSession(valid);
    fatalSession.replaceSource(fatalDocument.getText());
    const fatalProvider = createNuiRenameProvider(() => fatalSession);
    expect(() => prepareAt(fatalProvider, fatalDocument, new vscode.Position(1, 6))).toThrow(
      "Rename is not available at this position."
    );
    expect(() => editsAt(fatalProvider, fatalDocument, new vscode.Position(1, 6), "Renamed")).toThrow(
      "Rename could not be applied."
    );

    const collisionSource = [
      "nui 4",
      "const width: number = 10",
      "const result: number = @width"
    ].join("\n");
    const { document: collisionDocument, provider: collisionProvider } = providerFor(collisionSource);
    expect(() => editsAt(
      collisionProvider,
      collisionDocument,
      positionAtText(collisionDocument, collisionSource, "@width", 1),
      "result"
    )).toThrow("Rename could not be applied.");
    expect(() => editsAt(
      collisionProvider,
      collisionDocument,
      positionAtText(collisionDocument, collisionSource, "@width", 1),
      ""
    )).toThrow("Rename could not be applied.");

    const iterationSource = [
      "nui 4",
      "for i in range(from: 0, count: 1) {",
      "  point P = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n");
    const { document: iterationDocument, provider: iterationProvider } = providerFor(iterationSource);
    expect(() => prepareAt(
      iterationProvider,
      iterationDocument,
      positionAtText(iterationDocument, iterationSource, "i in")
    )).toThrow("Rename is not available at this position.");
    expect(() => editsAt(
      iterationProvider,
      iterationDocument,
      positionAtText(iterationDocument, iterationSource, "i in"),
      "j"
    )).toThrow("Rename could not be applied.");
  });

  it("rejects a stale document and a plan whose expected source text is not exact", () => {
    const source = "nui 4\npoint Base = coordinate(x: 0, y: 0)\npoint Use = offset(from: @Base, dx: 1, dy: 0)";
    const staleDocument = documentFor(source);
    const stale = providerFor(source, staleDocument);
    let reads = 0;
    staleDocument.onGetText = () => {
      reads += 1;
      if (reads === 2) {
        staleDocument.version = 2;
        staleDocument.setSourceText(`${source}\n# changed during rename`);
      }
    };
    expect(() => editsAt(
      stale.provider,
      staleDocument,
      positionAtText(staleDocument, source, "@Base", 1),
      "Renamed"
    )).toThrow("Rename could not be applied.");

    const exactnessDocument = documentFor(source);
    const exactness = providerFor(source, exactnessDocument);
    const planSpy = vi.spyOn(renameQuery, "planDslRenameEdits").mockReturnValue({
      sourceRevision: 1,
      target: { sourceRevision: 1, oldName: "Base", range: { from: 0, to: 4 } },
      edits: [{ from: 0, to: 4, expectedText: "wrong", newText: "Renamed" }]
    });
    try {
      expect(() => editsAt(
        exactness.provider,
        exactnessDocument,
        positionAtText(exactnessDocument, source, "@Base", 1),
        "Renamed"
      )).toThrow("Rename could not be applied.");
    } finally {
      planSpy.mockRestore();
    }
  });

  it("renames ordinary and typed source targets in a mixed Module document", () => {
    const source = [
      "nui 4",
      "const width: number = 10",
      "const result: number = @width + 5",
      "point 前身頃 = coordinate(x: 0, y: 0)",
      "point 使用点 = offset(from: @前身頃, dx: 10, dy: 0)",
      "const 前身頃X: number = @前身頃.x",
      "module Measure(input: point) {",
      "  point P = offset(from: @input, dx: 10, dy: 0)",
      "}",
      "instance Call = Measure(input: @前身頃)"
    ].join("\n");
    const { document, provider } = providerFor(source);
    const elementEdit = editsAt(provider, document, positionAtText(document, source, "@前身頃", 1), "後身頃");
    const widthEdit = editsAt(provider, document, positionAtText(document, source, "@width", 1), "renamedWidth");

    expect(elementEdit?.edits).toHaveLength(4);
    expect(elementEdit?.edits.map((entry) => source.slice(
      document.offsetAt(entry.range.start),
      document.offsetAt(entry.range.end)
    ))).toEqual(["前身頃", "前身頃", "前身頃", "前身頃"]);
    expect(widthEdit?.edits).toHaveLength(2);
    expect(widthEdit?.edits.map((entry) => source.slice(
      document.offsetAt(entry.range.start),
      document.offsetAt(entry.range.end)
    ))).toEqual(["width", "width"]);
  });

  it("does not expose unexpected core errors from prepareRename", () => {
    const source = "nui 4\npoint Base = coordinate(x: 0, y: 0)";
    const { document, provider } = providerFor(source);
    const querySpy = vi.spyOn(renameQuery, "queryDslRenameTarget").mockImplementation(() => {
      throw new Error("bindingResolution: internal invariant");
    });
    try {
      expect(() => prepareAt(provider, document, positionAtText(document, source, "Base"))).toThrow(
        "Rename is not available at this position."
      );
      expect(() => prepareAt(provider, document, positionAtText(document, source, "Base"))).not.toThrow(
        "bindingResolution: internal invariant"
      );
    } finally {
      querySpy.mockRestore();
    }
  });

  it("does not expose unexpected core errors from provideRenameEdits", () => {
    const source = "nui 4\npoint Base = coordinate(x: 0, y: 0)";
    const { document, provider } = providerFor(source);
    const planSpy = vi.spyOn(renameQuery, "planDslRenameEdits").mockImplementation(() => {
      throw new Error("bindingResolution: internal invariant");
    });
    try {
      expect(() => editsAt(provider, document, positionAtText(document, source, "Base"), "Renamed")).toThrow(
        "Rename could not be applied."
      );
      expect(() => editsAt(provider, document, positionAtText(document, source, "Base"), "Renamed")).not.toThrow(
        "bindingResolution: internal invariant"
      );
    } finally {
      planSpy.mockRestore();
    }
  });
});
