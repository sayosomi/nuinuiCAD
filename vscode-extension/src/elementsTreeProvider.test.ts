import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
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
  },
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2
  }
}));

import { parseDslSnapshot } from "../../src/dsl/dslParser";
import {
  createNuiElementsTreeProvider,
  NUI_ELEMENTS_VIEW_ID
} from "./elementsTreeProvider";
import type { NuiLanguageAnalysisSession } from "./languageAnalysisSession";

type TestDocument = {
  fileName: string;
  uri: { scheme: string };
  getText: () => string;
};

const documentFor = (source: string, fileName = "/tmp/pattern.nui", scheme = "file"): TestDocument => ({
  fileName,
  uri: { scheme },
  getText: () => source
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

describe("VS Code Elements tree provider", () => {
  it("projects the exact-current Document Symbols hierarchy and source order", () => {
    const source = [
      "nui 1",
      "group Outer {",
      "  point First = coordinate(x: 0, y: 0)",
      "  if (@condition) {",
      "    point ThenPoint = coordinate(x: 1, y: 1)",
      "  } else {",
      "    line ElseLine = segment(start: @First, end: @ThenPoint)",
      "  }",
      "  point Last = coordinate(x: 2, y: 2)",
      "}"
    ].join("\n");
    const session = sessionFor("nui 1\n");
    const provider = createNuiElementsTreeProvider(
      () => documentFor(source) as never,
      () => session
    );

    expect(NUI_ELEMENTS_VIEW_ID).toBe("nuinuiCAD.elements");
    const roots = provider.getChildren();
    expect(roots.map(({ symbol }) => symbol.name)).toEqual(["Outer"]);
    expect(provider.getTreeItem(roots[0]!)).toMatchObject({
      label: "Outer",
      description: "group",
      collapsibleState: 1
    });

    const groupChildren = provider.getChildren(roots[0]!);
    expect(groupChildren.map(({ symbol }) => symbol.name)).toEqual(["First", "if (@condition)", "Last"]);
    const conditionalChildren = provider.getChildren(groupChildren[1]!);
    expect(conditionalChildren.map(({ symbol }) => symbol.name)).toEqual(["THEN", "ELSE"]);
    expect(provider.getChildren(conditionalChildren[0]!).map(({ symbol }) => symbol.name)).toEqual(["ThenPoint"]);
    expect(provider.getChildren(conditionalChildren[1]!).map(({ symbol }) => symbol.name)).toEqual(["ElseLine"]);
    expect(session.replaceSource).toHaveBeenCalledWith(source);
  });

  it("fails closed for unsupported and stale source instead of showing last-good structure", () => {
    const session = sessionFor("nui 1\n");
    const unsupported = createNuiElementsTreeProvider(
      () => documentFor("nui 1\npoint A = coordinate(x: 0, y: 0)", "/tmp/pattern.txt") as never,
      () => session
    );
    expect(unsupported.getChildren()).toEqual([]);

    session.documentSymbolSyntaxSnapshot = vi.fn(() => undefined);
    const stale = createNuiElementsTreeProvider(
      () => documentFor("nui 1\npoint A = coordinate(x: 0, y: 0)") as never,
      () => session
    );
    expect(stale.getChildren()).toEqual([]);
  });

  it("fires a root refresh without adding row commands or runtime presentation", () => {
    const provider = createNuiElementsTreeProvider(() => undefined, () => sessionFor("nui 1\n"));
    const listener = vi.fn();
    const disposable = provider.onDidChangeTreeData!(listener);

    provider.refresh();
    expect(listener).toHaveBeenCalledWith(undefined);

    disposable.dispose();
    provider.refresh();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
