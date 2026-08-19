import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => {
  class Position {
    constructor(public readonly line: number, public readonly character: number) {}
  }
  class Range {
    constructor(public readonly start: Position, public readonly end: Position) {}
  }
  class Location {
    constructor(public readonly uri: unknown, public readonly range: Range) {}
  }
  return { Position, Range, Location };
// @ts-expect-error Vitest's runtime supports the virtual-module options used here.
}, { virtual: true });

import * as vscode from "vscode";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";
import {
  createNuiReferenceProvider,
  nuiReferenceSelector
} from "./referenceProvider";

type TestDocument = {
  fileName: string;
  uri: { scheme: string; toString: () => string };
  getText: () => string;
  offsetAt: (position: vscode.Position) => number;
  positionAt: (offset: number) => vscode.Position;
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
      const clamped = Math.min(Math.max(offset, 0), source.length);
      let line = 0;
      while (line + 1 < starts.length && starts[line + 1]! <= clamped) line += 1;
      return new vscode.Position(line, clamped - starts[line]!);
    }
  };
};

const provide = (
  source: string,
  position: number,
  includeDeclaration: boolean,
  document = documentFor(source),
  session = createLanguageAnalysisSession(source)
) => {
  const provider = createNuiReferenceProvider(() => session);
  return provider.provideReferences(
    document as vscode.TextDocument,
    document.positionAt(position),
    { includeDeclaration } as vscode.ReferenceContext
  ) as vscode.Location[];
};

describe("VS Code native nui references provider", () => {
  it("uses the file-scoped nui selector", () => {
    expect(nuiReferenceSelector).toEqual({ language: "nui", scheme: "file" });
  });

  it("returns usages only when includeDeclaration is false", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: @A, dx: 1, dy: 0)"
    ].join("\n");
    const locations = provide(source, source.indexOf("@A") + 2, false);

    expect(locations).toHaveLength(1);
    expect(locations[0]!.range).toMatchObject({
      start: { line: 2, character: source.split("\n")[2]!.indexOf("@A") + 1 },
      end: { line: 2, character: source.split("\n")[2]!.indexOf("@A") + 2 }
    });
  });

  it("includes the declaration only when requested and supports declaration invocation", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: @A, dx: 1, dy: 0)"
    ].join("\n");
    const declarationLocations = provide(source, source.indexOf("A =") + 1, true);
    const referenceLocations = provide(source, source.indexOf("@A") + 2, true);

    expect(declarationLocations).toHaveLength(2);
    expect(declarationLocations.map((location) => location.range.start)).toEqual([
      { line: 1, character: "point ".length },
      { line: 2, character: source.split("\n")[2]!.indexOf("@A") + 1 }
    ]);
    expect(referenceLocations.map((location) => location.range)).toEqual(
      declarationLocations.map((location) => location.range)
    );
  });

  it("maps normalized semantic ranges back to CRLF TextDocument positions", () => {
    const normalized = [
      "nui 4",
      "// 😀",
      "point 前身頃 = coordinate(x: 0, y: 0)",
      "point 使用 = offset(from: @前身頃, dx: 1, dy: 0)"
    ].join("\n");
    const source = normalized.replace(/\n/g, "\r\n");
    const referenceOffset = source.indexOf("@前身頃") + "@前身頃".length;
    const locations = provide(source, referenceOffset, true, documentFor(source));

    expect(locations).toHaveLength(2);
    expect(locations[0]!.range).toMatchObject({
      start: { line: 2, character: "point ".length },
      end: { line: 2, character: "point 前身頃".length }
    });
    expect(locations[1]!.range).toMatchObject({
      start: { line: 3, character: source.split("\r\n")[3]!.indexOf("@前身頃") + 1 },
      end: { line: 3, character: source.split("\r\n")[3]!.indexOf("@前身頃") + 1 + "前身頃".length }
    });
  });

  it("refreshes one URI-scoped session from the dirty TextDocument", () => {
    const initial = "nui 4\npoint A = coordinate(x: 0, y: 0)";
    const current = [
      "nui 4",
      "point B = coordinate(x: 0, y: 0)",
      "point C = offset(from: @B, dx: 1, dy: 0)"
    ].join("\n");
    const session = createLanguageAnalysisSession(initial);
    const document = documentFor(current);
    const locations = provide(current, current.indexOf("@B") + 2, false, document, session);

    expect(session.getSource()).toBe(current);
    expect(locations).toHaveLength(1);
    expect(locations[0]!.range.start).toEqual({
      line: 2,
      character: current.split("\n")[2]!.indexOf("@B") + 1
    });
  });

  it("fails closed for unsupported extension, URI scheme, and no-result positions", () => {
    const source = "nui 4\npoint A = coordinate(x: 0, y: 0)";
    const unsupported = provide(source, source.indexOf("A") + 1, true, documentFor(source, "/tmp/pattern.txt"));
    const untitled = provide(source, source.indexOf("A") + 1, true, documentFor(source, "/tmp/pattern.nui", "untitled"));
    const commentSource = "nui 4\n// @A";
    const noResult = provide(commentSource, commentSource.indexOf("@A") + 2, true);

    expect(unsupported).toEqual([]);
    expect(untitled).toEqual([]);
    expect(noResult).toEqual([]);
  });
});
