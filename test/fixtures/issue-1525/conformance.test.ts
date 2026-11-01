// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { afterAll, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

vi.mock("vscode", () => {
  class Range {
    constructor(public start: unknown, public end: unknown) {}
  }
  class DocumentSymbol {
    children: DocumentSymbol[] = [];
    constructor(public name: string, public detail: string, public kind: number, public range: Range, public selectionRange: Range) {}
  }
  class FoldingRange {
    constructor(public start: number, public end: number, public kind?: string) {}
  }
  return { Range, DocumentSymbol, FoldingRange,
    SymbolKind: { File: 0, Module: 1, Namespace: 2, Property: 6, Field: 7, Enum: 9, Variable: 12, Constant: 13, String: 14, Object: 18, Struct: 22 },
    FoldingRangeKind: { Comment: "comment" }, TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 }
  };
});
import { createNuiLanguageSession, parseDslSnapshot, queryDslDocumentSymbols, queryDslFolding, type DslDocumentSymbol, type DslFoldingRange } from "@nuinuicad/nui-language";
import { createNuiDocumentSymbolProvider } from "../../../vscode-extension/src/documentSymbolProvider";
import { createNuiFoldingProvider } from "../../../vscode-extension/src/foldingProvider";
import { createNuiElementsTreeProvider, type NuiElementsTreeNode } from "../../../vscode-extension/src/elementsTreeProvider";
import { normalizedOffsetFromRaw, rawOffsetFromNormalized, vscodeRangeForNormalized } from "../../../vscode-extension/src/sourceOffsetAdapter";

type State = { rawSource: string; normalizedSource: string; sha256: string; normalizedSha256: string; sourceRevision: number; hostVersion: number; symbols: DslDocumentSymbol[]; hostSymbols: unknown[]; folds: DslFoldingRange[]; hostFolds: { start: number; end: number; kind: string | null }[] };
type Scenario = { id: string; uri: string; states: State[] };
const oracle = JSON.parse(readFileSync(new URL("./oracle.json", import.meta.url), "utf8")) as { scenarios: Scenario[] };
const lifecycle = JSON.parse(readFileSync(new URL("./session-lifecycle-oracle.json", import.meta.url), "utf8")) as { hostSessionRevisions: Record<string, number[]> };
const results: unknown[] = [];
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const doc = (state: State, uri: string): vscode.TextDocument => {
  const scheme = uri.split(":")[0]!;
  return { uri: { scheme, toString: () => uri }, fileName: uri.slice(uri.indexOf(":") + 3), version: state.hostVersion,
    getText: () => state.rawSource,
    positionAt: (offset: number) => {
      const prefix = state.rawSource.slice(0, offset);
      return { line: prefix.split("\n").length - 1, character: offset - prefix.lastIndexOf("\n") - 1 };
    }
  } as vscode.TextDocument;
};
const serial = (x: unknown) => JSON.parse(JSON.stringify(x));
const folds = (x: readonly vscode.FoldingRange[]) => x.map(r => ({ start: r.start, end: r.end, kind: r.kind ?? null }));
const parsedInput = (state: State) => {
  const source = { normalizedSource: state.normalizedSource, sourceRevision: state.sourceRevision };
  const parsed = parseDslSnapshot(source);
  return { source, statements: parsed.statements, sourceMap: parsed.sourceMap };
};
const treeSymbols = (tree: ReturnType<typeof createNuiElementsTreeProvider>, nodes = tree.getChildren()): DslDocumentSymbol[] => nodes.map(node => {
  expect(tree.getTreeItem(node)).toEqual({ label: node.symbol.name, description: node.symbol.detail || undefined, collapsibleState: node.symbol.children.length ? 1 : 0 });
  return { ...node.symbol, children: treeSymbols(tree, tree.getChildren(node)) };
});

describe("Issue #1525 frozen source/Outline/folding/Elements matrix", () => {
  for (const scenario of oracle.scenarios) {
    it(scenario.id, () => {
      const separate = ["H2", "H3"].includes(scenario.id);
      const sessions = new Map<string, ReturnType<typeof createNuiLanguageSession>>();
      const sessionFor = vi.fn((document: vscode.TextDocument) => {
        const session = sessions.get(document.uri.toString());
        if (!session) throw new Error("unsupported or unknown URI was routed");
        return session;
      });
      const symbolsProvider = createNuiDocumentSymbolProvider(sessionFor);
      const foldingProvider = createNuiFoldingProvider(sessionFor);
      let active: vscode.TextDocument | undefined;
      const tree = createNuiElementsTreeProvider(() => active, sessionFor);
      const refreshed = vi.fn();
      const dispose = tree.onDidChangeTreeData(refreshed);
      let previousNodes: NuiElementsTreeNode[] | undefined;
      let previousState: State | undefined;
      let previousRevision = -1;
      for (const [index, state] of scenario.states.entries()) {
        const uri = separate ? scenario.uri.replace("a.nui", `${index}.nui`) : scenario.uri;
        let session = sessions.get(uri);
        if (!session) {
          session = createNuiLanguageSession(state.rawSource);
          sessions.set(uri, session);
        }
        active = doc(state, uri);
        const input = parsedInput(state);
        const actual = { id: scenario.id, index, directSymbols: queryDslDocumentSymbols(input), directFolds: queryDslFolding(input) };
        results.push(actual);
        expect.soft(hash(state.rawSource)).toBe(state.sha256);
        expect.soft(hash(state.normalizedSource)).toBe(state.normalizedSha256);
        expect.soft(state.rawSource.replace(/\r\n/g, "\n")).toBe(state.normalizedSource);
        expect.soft(actual.directSymbols).toEqual(state.symbols);
        expect.soft(actual.directFolds).toEqual(state.folds);
        // Production providers synchronize current TextDocument text into the real session.
        const projected = symbolsProvider.provideDocumentSymbols!(active, {} as vscode.CancellationToken) as vscode.DocumentSymbol[];
        const projectedFolds = foldingProvider.provideFoldingRanges!(active, {}, {} as vscode.CancellationToken) as vscode.FoldingRange[];
        expect.soft(serial(projected)).toEqual(state.hostSymbols);
        expect.soft(folds(projectedFolds)).toEqual(state.hostFolds);
        expect.soft(session.documentSymbols()).toEqual(state.symbols);
        expect.soft(session.foldingRanges()).toEqual(state.folds);
        expect.soft(treeSymbols(tree)).toEqual(state.symbols);
        expect.soft(session.getSource()).toBe(state.rawSource);
        expect.soft(session.getSourceRevision()).toBe(lifecycle.hostSessionRevisions[scenario.id]![index]);
        if (!separate) expect.soft(session.getSourceRevision()).toBeGreaterThan(previousRevision);
        previousRevision = session.getSourceRevision();
        tree.refresh();
        expect.soft(refreshed).toHaveBeenLastCalledWith(undefined);
        if (scenario.id === "H3" && previousNodes && previousState) {
          // Existing nodes retain their snapshot; identity across refresh is not promised.
          expect.soft(treeSymbols(tree, previousNodes)).toEqual(previousState.symbols);
        }
        previousNodes = tree.getChildren(); previousState = state;
        const visit = (symbols: DslDocumentSymbol[]) => {
          for (const symbol of symbols) {
            const { from, to } = symbol.selectionRange;
            const rawFrom = rawOffsetFromNormalized(state.rawSource, from);
            const rawTo = rawOffsetFromNormalized(state.rawSource, to);
            expect.soft(state.rawSource.slice(rawFrom, rawTo)).toBe(state.normalizedSource.slice(from, to));
            expect.soft(normalizedOffsetFromRaw(state.rawSource, rawFrom)).toBe(from);
            expect.soft(normalizedOffsetFromRaw(state.rawSource, rawTo)).toBe(to);
            expect.soft(serial(vscodeRangeForNormalized(active!, state.rawSource, symbol.selectionRange))).toEqual({start: active!.positionAt(rawFrom), end: active!.positionAt(rawTo)});
            expect.soft(symbol.range.from).toBeLessThanOrEqual(from);
            expect.soft(symbol.range.to).toBeGreaterThanOrEqual(to);
            for (const child of symbol.children) {
              expect.soft(child.range.from).toBeGreaterThanOrEqual(symbol.range.from);
              expect.soft(child.range.to).toBeLessThanOrEqual(symbol.range.to);
            }
            visit(symbol.children);
          }
        };
        visit(state.symbols);
        // Negative controls independently corrupt only one exact-source proof at a time.
        for (const stale of [
          { ...input, sourceMap: { ...input.sourceMap, source: "not current" } },
          { ...input, sourceMap: { ...input.sourceMap, sourceRevision: 9999 } }
        ]) {
          expect.soft(queryDslDocumentSymbols(stale)).toEqual([]);
          expect.soft(queryDslFolding(stale)).toEqual([]);
        }
        if (scenario.id === "R2" && index === 2) {
          const obsolete = parsedInput(scenario.states[0]!);
          const stale = { ...input, statements: obsolete.statements };
          expect.soft(queryDslDocumentSymbols(stale)).toEqual([]);
          expect.soft(queryDslFolding(stale)).toEqual([]);
        }
        if (scenario.id === "H4") {
          const stale = { ...input, sourceMap: { ...input.sourceMap, sourceRevision: 9999 } };
          const symbolSpy = vi.spyOn(session, "documentSymbols").mockImplementation(() => queryDslDocumentSymbols(stale));
          const foldSpy = vi.spyOn(session, "foldingRanges").mockImplementation(() => queryDslFolding(stale));
          expect.soft(symbolsProvider.provideDocumentSymbols!(active, {} as vscode.CancellationToken)).toEqual([]);
          expect.soft(foldingProvider.provideFoldingRanges!(active, {}, {} as vscode.CancellationToken)).toEqual([]);
          expect.soft(tree.getChildren()).toEqual([]);
          symbolSpy.mockRestore(); foldSpy.mockRestore();
          expect.soft(treeSymbols(tree)).toEqual(state.symbols);
        }
      }
      if (scenario.id === "H2") {
        for (const [uri, session] of sessions) {
          const state = scenario.states[Number(uri.split("/").at(-1)!.split(".")[0])]!;
          active = doc(state, uri);
          expect.soft(treeSymbols(tree)).toEqual(state.symbols);
          expect.soft(session.getSource()).toBe(state.rawSource);
        }
      }
      if (["H2", "H3", "H4"].includes(scenario.id)) {
        const state = scenario.states[0]!;
        const calls = sessionFor.mock.calls.length;
        for (const uri of ["untitled:///tmp/issue-1525/a.nui", "file:///tmp/issue-1525/a.txt"]) {
          active = doc(state, uri);
          expect.soft(symbolsProvider.provideDocumentSymbols!(active, {} as vscode.CancellationToken)).toEqual([]);
          expect.soft(foldingProvider.provideFoldingRanges!(active, {}, {} as vscode.CancellationToken)).toEqual([]);
          expect.soft(tree.getChildren()).toEqual([]);
        }
        expect.soft(sessionFor.mock.calls.length).toBe(calls);
        active = undefined;
        expect.soft(tree.getChildren()).toEqual([]);
      }
      dispose.dispose();
      const count = refreshed.mock.calls.length;
      tree.refresh(); expect.soft(refreshed).toHaveBeenCalledTimes(count);
    }, 20000);
  }
});
afterAll(() => {
  if (process.env.ISSUE_1525_RESULTS) writeFileSync(process.env.ISSUE_1525_RESULTS, JSON.stringify(results, null, 2) + "\n");
});

describe("Issue #1525 evidence-triggered obsolete-statement controls", () => {
  for (const id of ["X1", "D1"]) {
    it(id, () => {
      const frozen = JSON.parse(readFileSync(new URL(`./${id}-oracle.json`, import.meta.url), "utf8")) as {
        rawSource: string; normalizedSource: string; sha256: string; oldRevision: number; currentRevision: number;
        expectedCurrentFolds: DslFoldingRange[]; expectedStaleFolds: DslFoldingRange[]; expectedStaleSymbols: DslDocumentSymbol[];
      };
      expect(hash(frozen.rawSource)).toBe(frozen.sha256);
      const source = { normalizedSource: frozen.normalizedSource, sourceRevision: frozen.currentRevision };
      const current = parseDslSnapshot(source);
      const old = parseDslSnapshot({ ...source, sourceRevision: frozen.oldRevision });
      const positive = { source, statements: current.statements, sourceMap: current.sourceMap };
      expect(queryDslFolding(positive)).toEqual(frozen.expectedCurrentFolds);
      const stale = { ...positive, statements: old.statements };
      const actual = { id, currentFolds: queryDslFolding(positive), staleFolds: queryDslFolding(stale), staleSymbols: queryDslDocumentSymbols(stale) };
      results.push(actual);
      expect.soft(actual.staleSymbols).toEqual(frozen.expectedStaleSymbols);
      expect.soft(actual.staleFolds).toEqual(frozen.expectedStaleFolds);
      // A stale documentRange is independently invalid even with a current top-level revision.
      const staleRange = { ...positive, statements: current.statements.map(statement => ({ ...statement, documentRange: { ...statement.documentRange, sourceRevision: frozen.oldRevision } })) };
      expect.soft(queryDslDocumentSymbols(staleRange)).toEqual([]);
      expect.soft(queryDslFolding(staleRange)).toEqual([]);
    });
  }
});
