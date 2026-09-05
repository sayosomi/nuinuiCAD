import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => {
  class FoldingRange {
    constructor(
      public readonly start: number,
      public readonly end: number,
      public readonly kind?: unknown
    ) {}
  }
  return { FoldingRange, FoldingRangeKind: { Comment: "comment" } };
});

import { parseDslSnapshot } from "../../src/dsl/dslParser";
import { queryDslFolding } from "../../src/dsl/dslFoldingQuery";
import {
  createNuiFoldingProvider,
  nuiFoldingSelector
} from "./foldingProvider";
import type { NuiLanguageSession } from "@nuinuicad/nui-language";

type TestDocument = {
  fileName: string;
  uri: { scheme: string };
  getText: () => string;
};

const normalizedSourceFor = (source: string): string => source.replace(/\r\n/g, "\n");

const documentFor = (
  source: string,
  fileName = "/tmp/pattern.nui",
  scheme = "file"
): TestDocument => ({
  fileName,
  uri: { scheme },
  getText: () => source
});

const sessionFor = (initialSource: string, options: { stale?: boolean } = {}) => {
  let currentSource = initialSource;
  const session = {
    getSource: vi.fn(() => currentSource),
    getSourceRevision: vi.fn(() => 1),
    replaceSource: vi.fn((source: string) => { currentSource = source; }),
    foldingRanges: vi.fn(() => {
      const source = {
        normalizedSource: normalizedSourceFor(currentSource),
        sourceRevision: 1
      };
      if (options.stale) return [];
      const parsed = parseDslSnapshot({
        normalizedSource: source.normalizedSource,
        sourceRevision: source.sourceRevision
      });
      return queryDslFolding({
        source,
        statements: parsed.statements,
        sourceMap: parsed.sourceMap
      });
    })
  };
  return session as unknown as NuiLanguageSession;
};

type TestFoldingProvider = {
  provideFoldingRanges: (document: TestDocument) => unknown;
};

const provideRanges = (
  provider: ReturnType<typeof createNuiFoldingProvider>,
  document: TestDocument
) => (provider as unknown as TestFoldingProvider).provideFoldingRanges(document);

describe("VS Code structural folding provider", () => {
  it("uses the nui/file selector", () => {
    expect(nuiFoldingSelector).toEqual({ language: "nui", scheme: "file" });
  });

  it("synchronizes unsaved text and converts syntax lines from 1-based to 0-based", () => {
    const oldSource = "nui 1\n";
    const source = [
      "group A {",
      "  point P = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n");
    const session = sessionFor(oldSource);
    const provider = createNuiFoldingProvider(() => session);

    const ranges = provideRanges(provider, documentFor(source));

    expect(session.replaceSource).toHaveBeenCalledWith(source);
    expect(ranges).toEqual([
      expect.objectContaining({ start: 0, end: 2, kind: undefined })
    ]);
  });

  it("normalizes CRLF and returns comment folds with Comment kind", () => {
    const source = "// one\r\n// two\r\npoint P = coordinate(x: 0, y: 0)\r\n";
    const session = sessionFor(source);
    const provider = createNuiFoldingProvider(() => session);

    const ranges = provideRanges(provider, documentFor(source));

    expect(ranges).toEqual([
      expect.objectContaining({ start: 0, end: 1, kind: "comment" })
    ]);
    expect(session.foldingRanges).toHaveBeenCalledOnce();
  });

  it("fails closed for unsupported documents and stale snapshots", () => {
    const session = sessionFor("nui 1\n", { stale: true });
    const sessionForDocument = vi.fn(() => session);
    const provider = createNuiFoldingProvider(sessionForDocument);

    expect(provideRanges(provider, documentFor("nui 1\n", "/tmp/pattern.txt"))).toEqual([]);
    expect(sessionForDocument).not.toHaveBeenCalled();
    expect(provideRanges(provider, documentFor("nui 1\n"))).toEqual([]);
  });

  it("returns safe ranges from a fatal current source without using last-good text", () => {
    const source = [
      "group A {",
      "  point P = coordinate(x: 0, y: 0)",
      "}",
      "point Broken = coordinate(x: )"
    ].join("\n");
    const session = sessionFor("nui 1\n");
    const provider = createNuiFoldingProvider(() => session);

    const ranges = provideRanges(provider, documentFor(source));

    expect(ranges).toEqual([
      expect.objectContaining({ start: 0, end: 2, kind: undefined })
    ]);
  });
});
