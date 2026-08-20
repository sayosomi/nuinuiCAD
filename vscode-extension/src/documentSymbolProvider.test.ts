import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => {
  class Position {
    constructor(public readonly line: number, public readonly character: number) {}
  }
  class Range {
    constructor(public readonly start: Position, public readonly end: Position) {}
  }
  class DocumentSymbol {
    children: DocumentSymbol[] = [];

    constructor(
      public readonly name: string,
      public readonly detail: string,
      public readonly kind: number,
      public readonly range: Range,
      public readonly selectionRange: Range
    ) {}
  }
  return {
    Position,
    Range,
    DocumentSymbol,
    SymbolKind: {
      Module: 1,
      Object: 2,
      Namespace: 3,
      Constant: 4,
      Variable: 5,
      Enum: 6,
      Struct: 7,
      Property: 8,
      Field: 9,
      String: 10,
      File: 11
    }
  };
});

import { parseDslSnapshot } from "../../src/dsl/dslParser";
import {
  createNuiDocumentSymbolProvider,
  nuiDocumentSymbolSelector
} from "./documentSymbolProvider";
import type { NuiLanguageAnalysisSession } from "./languageAnalysisSession";

type TestDocument = {
  fileName: string;
  uri: { scheme: string };
  getText: () => string;
  positionAt: (offset: number) => { line: number; character: number };
};

const documentFor = (source: string, fileName = "/tmp/pattern.nui", scheme = "file"): TestDocument => ({
  fileName,
  uri: { scheme },
  getText: () => source,
  positionAt: (offset) => {
    const prefix = source.slice(0, offset);
    const line = prefix.split("\n").length - 1;
    const lineStart = prefix.lastIndexOf("\n") + 1;
    return { line, character: offset - lineStart };
  }
});

const sessionFor = (initialSource: string) => {
  let currentSource = initialSource;
  const session = {
    getSource: vi.fn(() => currentSource),
    getSourceRevision: vi.fn(() => 1),
    replaceSource: vi.fn((source: string) => { currentSource = source; }),
    documentSymbolSyntaxSnapshot: vi.fn((source: { normalizedSource: string; sourceRevision: number }) => {
      if (source.normalizedSource !== currentSource.replace(/\r\n/g, "\n") || source.sourceRevision !== 1) return undefined;
      const parsed = parseDslSnapshot(source);
      return {
        sourceRevision: source.sourceRevision,
        sourceText: source.normalizedSource,
        statements: parsed.statements,
        sourceMap: parsed.sourceMap
      };
    })
  };
  return session as unknown as NuiLanguageAnalysisSession;
};

type TestDocumentSymbolProvider = {
  provideDocumentSymbols: (document: TestDocument) => Array<{
    name: string;
    detail: string;
    kind: number;
    range: { start: unknown; end: unknown };
    selectionRange: { start: unknown; end: unknown };
    children: Array<{ name: string }>;
  }>;
};

describe("VS Code document symbol provider", () => {
  it("uses the nui/file selector and recursively converts host-neutral symbols", () => {
    const source = [
      "group Outer {",
      "  if (@condition) {",
      "    point P = coordinate(x: 0, y: 0)",
      "  } else {",
      "    line L = segment(start: @P, end: @P)",
      "  }",
      "}"
    ].join("\n");
    const session = sessionFor("nui 4\n");
    const provider = createNuiDocumentSymbolProvider(() => session);
    const symbols = (provider as unknown as TestDocumentSymbolProvider).provideDocumentSymbols(
      documentFor(source)
    );

    expect(nuiDocumentSymbolSelector).toEqual({ language: "nui", scheme: "file" });
    expect(session.replaceSource).toHaveBeenCalledWith(source);
    expect(symbols).toHaveLength(1);
    expect(symbols[0]).toMatchObject({ name: "Outer", kind: 3 });
    expect(symbols[0]?.children[0]).toMatchObject({ name: "if (@condition)", kind: 3 });
    expect(symbols[0]?.range.start).toEqual({ line: 0, character: 0 });
    expect(symbols[0]?.selectionRange.start).toEqual({ line: 0, character: 6 });
  });

  it("synchronizes unsaved CRLF source and converts normalized ranges through the shared adapter", () => {
    const source = "point A = coordinate(x: 0, y: 0)\r\n";
    const session = sessionFor("nui 4\n");
    const provider = createNuiDocumentSymbolProvider(() => session);
    const symbols = (provider as unknown as TestDocumentSymbolProvider).provideDocumentSymbols(documentFor(source));

    expect(session.replaceSource).toHaveBeenCalledWith(source);
    expect(session.documentSymbolSyntaxSnapshot).toHaveBeenCalledWith({
      normalizedSource: source.replace(/\r\n/g, "\n"),
      sourceRevision: 1
    });
    expect(symbols[0]?.selectionRange.start).toEqual({ line: 0, character: 6 });
    expect(symbols[0]?.selectionRange.end).toEqual({ line: 0, character: 7 });
  });

  it("fails closed for unsupported, non-nui, and stale documents", () => {
    const session = sessionFor("nui 4\n");
    const sessionForDocument = vi.fn(() => session);
    const provider = createNuiDocumentSymbolProvider(sessionForDocument);
    const provide = (document: TestDocument) =>
      (provider as unknown as TestDocumentSymbolProvider).provideDocumentSymbols(document);

    expect(provide(documentFor("nui 4\n", "/tmp/pattern.txt"))).toEqual([]);
    expect(provide(documentFor("nui 4\n", "/tmp/pattern.nui", "untitled"))).toEqual([]);
    expect(sessionForDocument).not.toHaveBeenCalled();
  });

  it("fails closed when the exact source structure snapshot is stale", () => {
    const session = sessionFor("nui 4\n");
    session.documentSymbolSyntaxSnapshot = vi.fn(() => undefined);
    const provider = createNuiDocumentSymbolProvider(() => session);

    expect((provider as unknown as TestDocumentSymbolProvider).provideDocumentSymbols(
      documentFor("point A = coordinate(x: 0, y: 0)")
    )).toEqual([]);
  });
});
