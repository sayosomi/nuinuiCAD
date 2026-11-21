import { beforeEach, describe, expect, it, vi } from "vitest";

const definitionProviderMocks = vi.hoisted(() => ({
  multiDocumentHost: null as null | {
    provideDefinition: (document: unknown, position: unknown) => Promise<{ handled: boolean; value?: unknown }>
  },
  textDocuments: [] as Array<unknown>
}));

vi.mock("vscode", () => {
  const disposable = () => ({ dispose: vi.fn() });
  const fileUri = (filePath: string) => {
    const normalized = filePath.startsWith("/") ? filePath : `/${filePath}`;
    return {
      scheme: "file",
      fsPath: normalized,
      toString: () => `file://${normalized}`
    };
  };
  class Position {
    constructor(public readonly line: number, public readonly character: number) {}
  }
  class Range {
    constructor(public readonly start: Position, public readonly end: Position) {}
  }
  return {
    Position,
    Range,
    Uri: {
      file: fileUri,
      parse: (value: string) => value.startsWith("file://")
        ? fileUri(value.slice("file://".length))
        : { scheme: value.split(":", 1)[0] ?? "", fsPath: "", toString: () => value }
    },
    workspace: {
      get textDocuments() {
        return definitionProviderMocks.textDocuments;
      },
      fs: { readFile: vi.fn(async () => { throw new Error("no saved imports in this fixture"); }) },
      findFiles: vi.fn(async () => []),
      onDidOpenTextDocument: vi.fn(() => disposable()),
      onDidChangeTextDocument: vi.fn(() => disposable()),
      onDidSaveTextDocument: vi.fn(() => disposable()),
      onDidCloseTextDocument: vi.fn(() => disposable()),
      createFileSystemWatcher: vi.fn(() => ({
        dispose: vi.fn(),
        onDidChange: vi.fn(() => disposable()),
        onDidCreate: vi.fn(() => disposable()),
        onDidDelete: vi.fn(() => disposable())
      }))
    }
  };
// @ts-expect-error Vitest's runtime supports the virtual-module options used here.
}, { virtual: true });

vi.mock("./multiDocumentHost", async (importOriginal) => ({
  ...await importOriginal<typeof import("./multiDocumentHost")>(),
  activeVscodeMultiDocumentHost: () => definitionProviderMocks.multiDocumentHost
}));

import * as vscode from "vscode";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";
import { createVscodeModuleMultiDocumentHost } from "./moduleMultiDocumentHost";
import {
  createNuiDefinitionProvider,
  nuiDefinitionSelector
} from "./definitionProvider";

type TestDocument = {
  fileName: string;
  version: number;
  isDirty: boolean;
  uri: { scheme: string; fsPath: string; toString: () => string };
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
    version: 1,
    isDirty: false,
    uri: { scheme, fsPath: fileName, toString: () => `${scheme}://${fileName}` },
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

beforeEach(() => {
  definitionProviderMocks.multiDocumentHost = null;
  definitionProviderMocks.textDocuments = [];
});

describe("VS Code native nui definition provider", () => {
  it("projects a style reference to its exact quoted declaration token", () => {
    const source = [
      "nui 1",
      'style "Guide Line" {',
      "  ",
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
      start: { line: 1, character: "style ".length },
      end: { line: 1, character: "style ".length + '"Guide Line"'.length }
    });
  });

  it("uses the file-scoped selector", () => {
    expect(nuiDefinitionSelector).toEqual({ language: "nui", scheme: "file" });
  });

  it("projects an exact reference and declaration into one same-document DefinitionLink", () => {
    const source = [
      "nui 1",
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
      "nui 1",
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
      "nui 1",
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
      "nui 1",
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

  it("routes a non-public group/extract property reference through the single-document session query", async () => {
    const source = [
      "nui 1",
      "group face {",
      "  line original = segment(start: (0,0), end: (80,0))",
      "  extract Extract(source: @original, parts: [side_line: start..end])",
      "}",
      "line Use = segment(start: @face::Extract::side_line.start, end: (100,0))"
    ].join("\n");
    const host = createVscodeModuleMultiDocumentHost();
    const hostDefinition = vi.spyOn(host, "provideDefinition");
    definitionProviderMocks.multiDocumentHost = host;
    const session = createLanguageAnalysisSession(source);
    const definition = vi.spyOn(session, "definition");
    const provider = createNuiDefinitionProvider(() => session);
    const document = documentFor(source);
    definitionProviderMocks.textDocuments = [document];
    const referenceLine = source.split("\n")[5]!;
    const position = new vscode.Position(5, referenceLine.indexOf(".start") + 2);
    host.start();
    let links: vscode.DefinitionLink[] | undefined;
    let hostResult: Awaited<ReturnType<typeof host.provideDefinition>>;
    try {
      links = await provider.provideDefinition(
        document as vscode.TextDocument,
        position,
        undefined as never
      ) as vscode.DefinitionLink[] | undefined;
      const result = hostDefinition.mock.results[0]?.value as Promise<Awaited<ReturnType<typeof host.provideDefinition>>> | undefined;
      if (!result) throw new Error("expected the real multi-document host to receive the definition query");
      hostResult = await result;
    } finally {
      host.dispose();
    }
    const declarationLine = source.split("\n")[3]!;
    const memberStart = declarationLine.indexOf("side_line:");

    expect(hostDefinition).toHaveBeenCalledWith(document, position);
    expect(hostResult).toEqual({ handled: false });
    expect(definition).toHaveBeenCalledWith(document.offsetAt(position));
    expect(links).toHaveLength(1);
    expect(links?.[0]?.targetUri.toString()).toBe("file:///tmp/pattern.nui");
    expect(links?.[0]?.originSelectionRange).toMatchObject({
      start: { line: 5, character: referenceLine.indexOf(".start") + 1 },
      end: { line: 5, character: referenceLine.indexOf(".start") + 1 + "start".length }
    });
    expect(links?.[0]?.targetSelectionRange).toMatchObject({
      start: { line: 3, character: memberStart },
      end: { line: 3, character: memberStart + "side_line".length }
    });
    expect(links?.[0]?.targetRange).toMatchObject({
      start: { line: 3, character: 0 },
      end: { line: 3, character: declarationLine.length }
    });
  });

  it("projects a Module callee to its declaration", () => {
    const source = [
      "nui 1",
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
      "nui 1",
      "point B = offset(from: @Missing, dx: 1, dy: 0)"
    ].join("\n");
    const unresolvedLine = unresolved.split("\n")[1]!;
    expect(definitionFor(
      unresolved,
      1,
      unresolvedLine.indexOf("@Missing") + "@Missing".length
    )).toBeUndefined();

    const ambiguous = [
      "nui 1",
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
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: @A, dx: 1, dy: 0)"
    ].join("\n");
    const fatalSource = "nui 1\npoint B = offset(from: @A, dx: 1, dy: 0";
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
    const initialSource = "nui 1\npoint A = coordinate(x: 0, y: 0)";
    const currentSource = [
      "nui 1",
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
    const source = "nui 1\npoint A = coordinate(x: 0, y: 0)";
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
