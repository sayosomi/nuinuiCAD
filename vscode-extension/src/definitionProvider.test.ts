import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => {
  class Position {
    constructor(public readonly line: number, public readonly character: number) {}
  }
  class Range {
    constructor(public readonly start: Position, public readonly end: Position) {}
  }
  return { Position, Range };
// @ts-expect-error Vitest's runtime supports the virtual-module options used here.
}, { virtual: true });

import * as vscode from "vscode";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";
import {
  createNuiDefinitionProvider,
  nuiDefinitionSelector
} from "./definitionProvider";

type TestDocument = {
  fileName: string;
  uri: { scheme: string; toString: () => string };
  getText: () => string;
  offsetAt: (position: vscode.Position) => number;
  positionAt: (offset: number) => vscode.Position;
  lineAt: (line: number) => { range: vscode.Range };
};

const documentFor = (
  source: string,
  fileName = "/tmp/pattern.nui",
  scheme = "file"
): TestDocument => {
  const lines = source.split(/\r\n|\n/);
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }

  return {
    fileName,
    uri: { scheme, toString: () => `${scheme}://${fileName}` },
    getText: () => source,
    offsetAt: (position) => {
      const line = Math.min(Math.max(position.line, 0), lines.length - 1);
      const character = Math.min(Math.max(position.character, 0), lines[line]!.length);
      return starts[line]! + character;
    },
    positionAt: (offset) => {
      const clampedOffset = Math.min(Math.max(offset, 0), source.length);
      let line = 0;
      while (line + 1 < starts.length && starts[line + 1]! <= clampedOffset) line += 1;
      return new vscode.Position(line, clampedOffset - starts[line]!);
    },
    lineAt: (line) => new class {
      readonly range = new vscode.Range(
        new vscode.Position(line, 0),
        new vscode.Position(line, lines[line]!.length)
      );
    }()
  };
};

const definitionFor = (source: string, line: number, character: number, document = documentFor(source)) => {
  const session = createLanguageAnalysisSession(source);
  const provider = createNuiDefinitionProvider(() => session);
  return provider.provideDefinition(
    document as vscode.TextDocument,
    new vscode.Position(line, character),
    undefined as never
  ) as vscode.DefinitionLink[] | undefined;
};

describe("VS Code native nui definition provider", () => {
  it("projects a modifier reference to its exact quoted declaration token", () => {
    const source = [
      "nui 4",
      'modifier "Guide Line" {',
      "  state: visible,",
      "}",
      "point A = coordinate(x: 0, y: 0)",
      'line L ["Guide Line"] = segment(start: @A, end: @A)'
    ].join("\n");
    const line = source.split("\n")[5]!;
    const links = definitionFor(source, 5, line.indexOf("Guide Line") + 2);
    expect(links?.[0]?.originSelectionRange).toMatchObject({
      start: { line: 5, character: line.indexOf('"Guide Line"') },
      end: { line: 5, character: line.indexOf('"Guide Line"') + '"Guide Line"'.length }
    });
    expect(links?.[0]?.targetSelectionRange).toMatchObject({
      start: { line: 1, character: "modifier ".length },
      end: { line: 1, character: "modifier ".length + '"Guide Line"'.length }
    });
  });

  it("uses the file-scoped selector", () => {
    expect(nuiDefinitionSelector).toEqual({ language: "nui", scheme: "file" });
  });

  it("projects an exact reference and declaration into one same-document DefinitionLink", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: @A, dx: 1, dy: 0)"
    ].join("\n");
    const referenceLine = source.split("\n")[2]!;
    const links = definitionFor(source, 2, referenceLine.indexOf("@A") + "@A".length);
    if (!links?.[0]) throw new Error("expected a definition link");
    const link = links[0];

    expect(links).toHaveLength(1);
    expect(link.originSelectionRange).toMatchObject({
      start: { line: 2, character: referenceLine.indexOf("@A") + 1 },
      end: { line: 2, character: referenceLine.indexOf("@A") + 2 }
    });
    expect(link.targetUri.toString()).toBe("file:///tmp/pattern.nui");
    expect(link.targetSelectionRange).toMatchObject({
      start: { line: 1, character: "point ".length },
      end: { line: 1, character: "point A".length }
    });
    expect(link.targetRange).toMatchObject({
      start: { line: 1, character: 0 },
      end: { line: 1, character: source.split("\n")[1]!.length }
    });
  });

  it("keeps UTF-16 ranges exact for CRLF, Japanese identifiers, and an earlier surrogate pair", () => {
    const normalized = [
      "nui 4",
      "// 😀",
      "point 前身頃 = coordinate(x: 0, y: 0)",
      "point 使用 = offset(from: @前身頃, dx: 1, dy: 0)"
    ].join("\n");
    const source = normalized.replace(/\n/g, "\r\n");
    const referenceLine = normalized.split("\n")[3]!;
    const referenceStart = referenceLine.indexOf("@前身頃");
    const links = definitionFor(source, 3, referenceStart + "@前身頃".length);
    if (!links?.[0]) throw new Error("expected a definition link");
    const link = links[0];

    expect(links).toHaveLength(1);
    expect(link.originSelectionRange).toMatchObject({
      start: { line: 3, character: referenceStart + 1 },
      end: { line: 3, character: referenceStart + 1 + "前身頃".length }
    });
    expect(link.targetSelectionRange).toMatchObject({
      start: { line: 2, character: "point ".length },
      end: { line: 2, character: "point 前身頃".length }
    });
    expect(link.targetRange).toMatchObject({
      start: { line: 2, character: 0 },
      end: { line: 2, character: normalized.split("\n")[2]!.length }
    });
  });

  it("follows typed binding shadowing through the semantic identity", () => {
    const source = [
      "nui 4",
      "const value: number = 1",
      "group Inner {",
      "  const value: number = 2",
      "  const result: number = @value",
      "}"
    ].join("\n");
    const referenceLine = source.split("\n")[4]!;
    const links = definitionFor(source, 4, referenceLine.indexOf("@value") + "@value".length);

    expect(links).toHaveLength(1);
    expect(links?.[0]?.targetSelectionRange).toMatchObject({
      start: { line: 3, character: "  const ".length },
      end: { line: 3, character: "  const value".length }
    });
  });

  it("projects a qualified reference to the resolved Module export declaration", () => {
    const source = [
      "nui 4",
      "module Producer() {",
      "  export point Public = coordinate(x: 0, y: 0)",
      "}",
      "instance Source = Producer()",
      "point Use = offset(from: @Source::Public, dx: 1, dy: 0)"
    ].join("\n");
    const referenceLine = source.split("\n")[5]!;
    const memberOffset = referenceLine.indexOf("Public");
    const links = definitionFor(source, 5, memberOffset + "Public".length);

    expect(links).toHaveLength(1);
    expect(links?.[0]?.originSelectionRange).toMatchObject({
      start: { line: 5, character: memberOffset },
      end: { line: 5, character: memberOffset + "Public".length }
    });
    expect(links?.[0]?.targetSelectionRange).toMatchObject({
      start: { line: 2, character: "  export point ".length },
      end: { line: 2, character: "  export point Public".length }
    });
  });

  it("projects a Module callee to its declaration", () => {
    const source = [
      "nui 4",
      "module Measure(width: number) {",
      "}",
      "instance Call = Measure(width: 10)"
    ].join("\n");
    const referenceLine = source.split("\n")[3]!;
    const calleeOffset = referenceLine.indexOf("Measure");
    const links = definitionFor(source, 3, calleeOffset + "Measure".length);

    expect(links).toHaveLength(1);
    expect(links?.[0]?.targetSelectionRange).toMatchObject({
      start: { line: 1, character: "module ".length },
      end: { line: 1, character: "module Measure".length }
    });
  });

  it("returns undefined for unresolved and ambiguous references", () => {
    const unresolved = [
      "nui 4",
      "point B = offset(from: @Missing, dx: 1, dy: 0)"
    ].join("\n");
    const unresolvedLine = unresolved.split("\n")[1]!;
    expect(definitionFor(
      unresolved,
      1,
      unresolvedLine.indexOf("@Missing") + "@Missing".length
    )).toBeUndefined();

    const ambiguous = [
      "nui 4",
      "group One {",
      "  point Same = coordinate(x: 0, y: 0)",
      "}",
      "group Two {",
      "  point Same = coordinate(x: 1, y: 0)",
      "}",
      "point Use = offset(from: @Same, dx: 1, dy: 0)"
    ].join("\n");
    const ambiguousLine = ambiguous.split("\n")[7]!;
    expect(definitionFor(
      ambiguous,
      7,
      ambiguousLine.indexOf("@Same") + "@Same".length
    )).toBeUndefined();
  });

  it("does not jump to a last-good declaration after the current source becomes fatal", () => {
    const initialSource = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: @A, dx: 1, dy: 0)"
    ].join("\n");
    const fatalSource = "nui 4\npoint B = offset(from: @A, dx: 1, dy: 0";
    const session = createLanguageAnalysisSession(initialSource);
    session.replaceSource(fatalSource);
    const provider = createNuiDefinitionProvider(() => session);
    const referenceLine = fatalSource.split("\n")[1]!;
    const links = provider.provideDefinition(
      documentFor(fatalSource) as vscode.TextDocument,
      new vscode.Position(1, referenceLine.indexOf("@A") + "@A".length),
      undefined as never
    ) as vscode.DefinitionLink[] | undefined;

    expect(links).toBeUndefined();
  });

  it("synchronizes the session from the current TextDocument before querying", () => {
    const initialSource = "nui 4\npoint A = coordinate(x: 0, y: 0)";
    const currentSource = [
      "nui 4",
      "point B = coordinate(x: 0, y: 0)",
      "point C = offset(from: @B, dx: 1, dy: 0)"
    ].join("\n");
    const session = createLanguageAnalysisSession(initialSource);
    const document = documentFor(currentSource);
    const provider = createNuiDefinitionProvider(() => session);
    const referenceLine = currentSource.split("\n")[2]!;
    const links = provider.provideDefinition(
      document as vscode.TextDocument,
      new vscode.Position(2, referenceLine.indexOf("@B") + "@B".length),
      undefined as never
    ) as vscode.DefinitionLink[] | undefined;

    expect(session.getSource()).toBe(currentSource);
    expect(links).toHaveLength(1);
    expect(links?.[0]?.targetSelectionRange).toMatchObject({
      start: { line: 1, character: "point ".length },
      end: { line: 1, character: "point B".length }
    });
  });

  it("returns no definition for declarations and unsupported documents", () => {
    const source = "nui 4\npoint A = coordinate(x: 0, y: 0)";
    const declaration = definitionFor(source, 1, "point ".length + 1);
    const unsupported = definitionFor(
      source,
      1,
      "point ".length + 1,
      documentFor(source, "/tmp/pattern.txt", "file")
    );
    const untitled = definitionFor(
      source,
      1,
      "point ".length + 1,
      documentFor(source, "/tmp/pattern.nui", "untitled")
    );

    expect(declaration).toBeUndefined();
    expect(unsupported).toBeUndefined();
    expect(untitled).toBeUndefined();
  });
});
