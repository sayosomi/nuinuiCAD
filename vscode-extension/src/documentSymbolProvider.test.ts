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

import * as vscode from "vscode";
import {
  parseDslSnapshot,
  queryDslDocumentSymbols,
  type DslDocumentSymbol,
  type NuiLanguageSession
} from "@nuinuicad/nui-language";
import {
  createNuiDocumentSymbolProvider,
  nuiDocumentSymbolSelector
} from "./documentSymbolProvider";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";

type TestDocument = {
  fileName: string;
  uri: { scheme: string; toString: () => string };
  version: number;
  getText: () => string;
  positionAt: (offset: number) => { line: number; character: number };
};

const documentFor = (source: string, fileName = "/tmp/pattern.nui", scheme = "file"): TestDocument => {
  const lineStarts = [0];
  for (const ending of source.matchAll(/\r\n|\r|\n/g)) {
    lineStarts.push(ending.index + ending[0].length);
  }
  const lines = source.split(/\r\n|\r|\n/);
  return {
    fileName,
    uri: { scheme, toString: () => `file://${fileName}` },
    version: 1,
    getText: () => source,
    positionAt: (offset) => {
      let line = lineStarts.length - 1;
      while (line > 0 && lineStarts[line]! > offset) line -= 1;
      return { line, character: Math.min(offset - lineStarts[line]!, lines[line]!.length) };
    }
  };
};

const mutableDocumentFor = (source: string, fileName = "/tmp/pattern.nui") => {
  let currentSource = source;
  let version = 1;
  let uri = { scheme: "file", toString: () => `file://${fileName}` };
  const document = {
    fileName,
    get uri() { return uri; },
    get version() { return version; },
    getText: () => currentSource,
    positionAt: (offset: number) => {
      const lineStarts = [0];
      for (const ending of currentSource.matchAll(/\r\n|\r|\n/g)) lineStarts.push(ending.index + ending[0].length);
      let line = lineStarts.length - 1;
      while (line > 0 && lineStarts[line]! > offset) line -= 1;
      return { line, character: offset - lineStarts[line]! };
    }
  };
  return {
    document,
    updateSource(nextSource: string) { currentSource = nextSource; version += 1; },
    updateUri(nextFileName: string) {
      fileName = nextFileName;
      uri = { scheme: "file", toString: () => `file://${fileName}` };
    }
  };
};

const sessionFor = (initialSource: string) => {
  let currentSource = initialSource;
  const session = {
    getSource: vi.fn(() => currentSource),
    getSourceRevision: vi.fn(() => 1),
    replaceSource: vi.fn((source: string) => { currentSource = source; }),
    documentSymbols: vi.fn(() => {
      const source = {
        normalizedSource: currentSource.replace(/\r\n/g, "\n"),
        sourceRevision: 1
      };
      const parsed = parseDslSnapshot(source);
      return queryDslDocumentSymbols({
        source,
        statements: parsed.statements,
        sourceMap: parsed.sourceMap
      });
    })
  };
  return session as unknown as NuiLanguageSession;
};

type TestDocumentSymbolProvider = {
  provideDocumentSymbols: (document: TestDocument, token?: { isCancellationRequested: boolean }) => Array<{
    name: string;
    detail: string;
    kind: number;
    range: { start: unknown; end: unknown };
    selectionRange: { start: unknown; end: unknown };
    children: Array<{ name: string }>;
  }> | undefined;
  invalidateDocument: (document: TestDocument) => void;
};

const nestedSourceLines = (groupCount: number): string[] => {
  const lines = ["nui 1"];
  for (let index = 0; index < groupCount; index += 1) {
    lines.push(
      `group Outer${index} {`,
      `  group Inner${index} {`,
      `    point A${index} = coordinate(x: 0, y: 0)`,
      `    point B${index} = coordinate(x: 1, y: 1)`,
      "  }",
      "}"
    );
  }
  return lines;
};

const expectedSymbolsFor = (document: TestDocument, symbols: readonly DslDocumentSymbol[]) => {
  // Each token covers one normalized UTF-16 code unit and ends at the corresponding raw boundary.
  const rawOffsets = [0, ...Array.from(
    document.getText().matchAll(/\r\n|./gs),
    (token) => token.index + token[0].length
  )];
  const project = ({ from, to }: DslDocumentSymbol["range"]) => ({
    start: document.positionAt(rawOffsets[from]!),
    end: document.positionAt(rawOffsets[to]!)
  });
  const kinds = { namespace: vscode.SymbolKind.Namespace, property: vscode.SymbolKind.Property };
  const expectedSymbol = ({ name, detail, kind, range, selectionRange, children }: DslDocumentSymbol): unknown => {
    if (kind !== "namespace" && kind !== "property") throw new Error(`Unexpected fixture symbol kind: ${kind}`);
    return {
      name,
      detail,
      kind: kinds[kind],
      range: project(range),
      selectionRange: project(selectionRange),
      children: children.map(expectedSymbol)
    };
  };
  return symbols.map(expectedSymbol);
};

describe("VS Code document symbol provider", () => {
  it.each([4, 50, 250])("preserves the full symbol tree for %i nested group pairs with LF and CRLF", (groupCount) => {
    for (const eol of ["\n", "\r\n"]) {
      const source = nestedSourceLines(groupCount).join(eol);
      const document = documentFor(source);
      const session = createLanguageAnalysisSession(source);
      const productionSymbols = session.documentSymbols();
      const provider = createNuiDocumentSymbolProvider(() => session) as unknown as TestDocumentSymbolProvider;

      expect(productionSymbols).toHaveLength(groupCount);
      expect(productionSymbols.at(-1)?.children[0]?.children).toHaveLength(2);
      expect(provider.provideDocumentSymbols(document)).toEqual(expectedSymbolsFor(document, productionSymbols));
    }
  });

  it("uses the raw source of each document and revision for mixed-newline and malformed outlines", () => {
    const [header, outer, inner, first, second, innerEnd] = nestedSourceLines(1);
    const source = `${header}\r\n# é😀\r\n${outer}\n${inner}\r\n${first}\n${second}\r\n${innerEnd}\n`;
    const editedSource = source.replace("\r\n", "\n").replace(`${outer}\n`, `${outer}\r\n`);
    const otherSource = `${header}\n# 雪😀\n${outer}\n${inner}\r\n${first}\n${second}\n${innerEnd}\n`;
    const session = createLanguageAnalysisSession(source);
    const otherSession = createLanguageAnalysisSession(otherSource);
    const document = documentFor(source);
    const otherDocument = documentFor(otherSource, "/tmp/other.nui");
    const provider = createNuiDocumentSymbolProvider((current) =>
      current.fileName === document.fileName ? session : otherSession
    ) as unknown as TestDocumentSymbolProvider;
    const revision = session.getSourceRevision();

    const originalSymbols = session.documentSymbols();
    expect(originalSymbols[0]?.children[0]?.children).toHaveLength(2);
    expect(originalSymbols[0]?.range.to).toBe(source.replace(/\r\n/g, "\n").length);
    expect(provider.provideDocumentSymbols(document)).toEqual(expectedSymbolsFor(document, originalSymbols));

    const edited = documentFor(editedSource);
    const editedSymbols = provider.provideDocumentSymbols(edited);
    expect(session.getSource()).toBe(editedSource);
    expect(session.getSourceRevision()).toBeGreaterThan(revision);
    expect(editedSymbols).toEqual(expectedSymbolsFor(edited, session.documentSymbols()));

    const otherSymbols = otherSession.documentSymbols();
    expect(otherSymbols[0]?.children[0]?.children).toHaveLength(2);
    expect(provider.provideDocumentSymbols(otherDocument)).toEqual(expectedSymbolsFor(otherDocument, otherSymbols));
  });

  it("preserves the language session's rejection of standalone CR in a raw snapshot", () => {
    const session = createLanguageAnalysisSession("nui 1\n");
    const provider = createNuiDocumentSymbolProvider(() => session) as unknown as TestDocumentSymbolProvider;
    const document = documentFor("nui 1\rpoint A = coordinate(x: 0, y: 0)");

    expect(() => provider.provideDocumentSymbols(document)).toThrow(
      "logicalStatementSourceMap requires LF-normalized source."
    );
  });

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
    const session = sessionFor("nui 1\n");
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
    const session = sessionFor("nui 1\n");
    const provider = createNuiDocumentSymbolProvider(() => session);
    const symbols = (provider as unknown as TestDocumentSymbolProvider).provideDocumentSymbols(documentFor(source));

    expect(session.replaceSource).toHaveBeenCalledWith(source);
    expect(session.documentSymbols).toHaveBeenCalledOnce();
    expect(symbols[0]?.selectionRange.start).toEqual({ line: 0, character: 6 });
    expect(symbols[0]?.selectionRange.end).toEqual({ line: 0, character: 7 });
  });

  it("reuses the exact-current converted tree for repeated same-version requests", () => {
    const source = "nui 1\npoint P = coordinate(x: 0, y: 0)\n";
    const document = documentFor(source);
    const session = createLanguageAnalysisSession(source);
    const query = vi.spyOn(session, "documentSymbols");
    const provider = createNuiDocumentSymbolProvider(() => session) as unknown as TestDocumentSymbolProvider;

    const first = provider.provideDocumentSymbols(document);
    const second = provider.provideDocumentSymbols(document);

    expect(first).toHaveLength(1);
    expect(second).toBe(first);
    expect(query).toHaveBeenCalledOnce();
  });

  it("does not reuse results across A to B to A source revisions", () => {
    const sourceA = "nui 1\npoint A = coordinate(x: 0, y: 0)\n";
    const sourceB = sourceA.replace("point A", "point B");
    const holder = mutableDocumentFor(sourceA);
    const session = createLanguageAnalysisSession(sourceA);
    const query = vi.spyOn(session, "documentSymbols");
    const provider = createNuiDocumentSymbolProvider(() => session) as unknown as TestDocumentSymbolProvider;

    const resultA1 = provider.provideDocumentSymbols(holder.document as TestDocument)!;
    holder.updateSource(sourceB);
    const resultB = provider.provideDocumentSymbols(holder.document as TestDocument)!;
    holder.updateSource(sourceA);
    const resultA2 = provider.provideDocumentSymbols(holder.document as TestDocument)!;

    expect(resultA1.map((symbol) => symbol.name)).toEqual(["A"]);
    expect(resultB.map((symbol) => symbol.name)).toEqual(["B"]);
    expect(resultA2.map((symbol) => symbol.name)).toEqual(["A"]);
    expect(resultA2).not.toBe(resultA1);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("invalidates on raw newline changes, session replacement, and URI changes", () => {
    const source = "nui 1\npoint P = coordinate(x: 0, y: 0)\n";
    const holder = mutableDocumentFor(source);
    let session = createLanguageAnalysisSession(source);
    const firstSessionQuery = vi.spyOn(session, "documentSymbols");
    const provider = createNuiDocumentSymbolProvider(() => session) as unknown as TestDocumentSymbolProvider;

    provider.provideDocumentSymbols(holder.document as TestDocument);
    holder.updateSource(source.replace(/\n/g, "\r\n"));
    provider.provideDocumentSymbols(holder.document as TestDocument);
    session = createLanguageAnalysisSession(holder.document.getText());
    const replacementSessionQuery = vi.spyOn(session, "documentSymbols");
    provider.provideDocumentSymbols(holder.document as TestDocument);
    holder.updateUri("/tmp/renamed-pattern.nui");
    provider.provideDocumentSymbols(holder.document as TestDocument);

    expect(firstSessionQuery).toHaveBeenCalledTimes(2);
    expect(replacementSessionQuery).toHaveBeenCalledTimes(2);
  });

  it("rebuilds after a session revision changes even when its current source matches", () => {
    const source = "nui 1\npoint P = coordinate(x: 0, y: 0)\n";
    const document = documentFor(source);
    const session = createLanguageAnalysisSession(source);
    const query = vi.spyOn(session, "documentSymbols");
    const provider = createNuiDocumentSymbolProvider(() => session) as unknown as TestDocumentSymbolProvider;

    provider.provideDocumentSymbols(document);
    session.replaceSource(`${source}# temporary revision\n`);
    session.replaceSource(source);
    const refreshed = provider.provideDocumentSymbols(document);

    expect(refreshed).toHaveLength(1);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("invalidates a closed document before a same-URI reopen", () => {
    const source = "nui 1\npoint P = coordinate(x: 0, y: 0)\n";
    const document = documentFor(source);
    const reopened = documentFor(source);
    const session = createLanguageAnalysisSession(source);
    const query = vi.spyOn(session, "documentSymbols");
    const provider = createNuiDocumentSymbolProvider(() => session) as unknown as TestDocumentSymbolProvider;

    provider.provideDocumentSymbols(document);
    provider.invalidateDocument(document);
    provider.provideDocumentSymbols(reopened);

    expect(query).toHaveBeenCalledTimes(2);
  });

  it("bounds retained document symbol trees to eight documents", () => {
    const sessions = new Map<string, NuiLanguageSession>();
    const documents = Array.from({ length: 9 }, (_, index) => {
      const source = `nui 1\npoint P${index} = coordinate(x: 0, y: 0)\n`;
      const document = documentFor(source, `/tmp/pattern-${index}.nui`);
      sessions.set(document.fileName, createLanguageAnalysisSession(source));
      return document;
    });
    const queryByDocument = new Map(
      [...sessions].map(([fileName, session]) => [fileName, vi.spyOn(session, "documentSymbols")] as const)
    );
    const provider = createNuiDocumentSymbolProvider((document) => sessions.get(document.fileName)!) as unknown as TestDocumentSymbolProvider;

    for (const document of documents) provider.provideDocumentSymbols(document);
    provider.provideDocumentSymbols(documents[0]!);

    expect(queryByDocument.get(documents[0]!.fileName)).toHaveBeenCalledTimes(2);
  });

  it("returns no result for cancellation before work and discards cancellation during the query", () => {
    const source = "nui 1\npoint P = coordinate(x: 0, y: 0)\n";
    const document = documentFor(source);
    const session = createLanguageAnalysisSession(source);
    const query = vi.spyOn(session, "documentSymbols");
    const provider = createNuiDocumentSymbolProvider(() => session) as unknown as TestDocumentSymbolProvider;
    const cancelled = { isCancellationRequested: true };

    expect(provider.provideDocumentSymbols(document, cancelled)).toBeUndefined();
    expect(query).not.toHaveBeenCalled();

    let cancellationRequested = false;
    query.mockImplementation(() => {
      cancellationRequested = true;
      return [];
    });
    const positionAt = vi.spyOn(document, "positionAt");
    expect(provider.provideDocumentSymbols(document, {
      get isCancellationRequested() { return cancellationRequested; }
    })).toBeUndefined();
    expect(positionAt).not.toHaveBeenCalled();
  });

  it("drops a result when the document advances during a synchronous symbol query", () => {
    const sourceA = "nui 1\npoint A = coordinate(x: 0, y: 0)\n";
    const sourceB = sourceA.replace("point A", "point B");
    const holder = mutableDocumentFor(sourceA);
    const session = createLanguageAnalysisSession(sourceA);
    const query = vi.spyOn(session, "documentSymbols");
    query.mockImplementation(() => {
      session.replaceSource(sourceA);
      holder.updateSource(sourceB);
      return [];
    });
    const provider = createNuiDocumentSymbolProvider(() => session) as unknown as TestDocumentSymbolProvider;

    expect(provider.provideDocumentSymbols(holder.document as TestDocument)).toBeUndefined();
  });

  it("fails closed for unsupported, non-nui, and stale documents", () => {
    const session = sessionFor("nui 1\n");
    const sessionForDocument = vi.fn(() => session);
    const provider = createNuiDocumentSymbolProvider(sessionForDocument);
    const provide = (document: TestDocument) =>
      (provider as unknown as TestDocumentSymbolProvider).provideDocumentSymbols(document);

    expect(provide(documentFor("nui 1\n", "/tmp/pattern.txt"))).toEqual([]);
    expect(provide(documentFor("nui 1\n", "/tmp/pattern.nui", "untitled"))).toEqual([]);
    expect(sessionForDocument).not.toHaveBeenCalled();
  });

  it("fails closed when the exact source structure snapshot is stale", () => {
    const session = sessionFor("nui 1\n");
    session.documentSymbols = vi.fn(() => []);
    const provider = createNuiDocumentSymbolProvider(() => session);

    expect((provider as unknown as TestDocumentSymbolProvider).provideDocumentSymbols(
      documentFor("point A = coordinate(x: 0, y: 0)")
    )).toEqual([]);
  });
});
