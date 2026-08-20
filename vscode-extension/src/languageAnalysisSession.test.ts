import { describe, expect, it, vi } from "vitest";
import { AutomationDocument } from "../../src/document/automationDocument";
import { queryDslDocumentSymbols } from "../../src/dsl/dslDocumentSymbolQuery";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";

const sourceSnapshotFor = (source: string, sourceRevision: number) => ({
  normalizedSource: source.replace(/\r\n/g, "\n"),
  sourceRevision
});

const validSource = "nui 4\npoint A = coordinate(x: 0, y: 1)\n";
const fatalSource = "nui 4\npoint A = coordinate(";
const warningSource = "nui 4\npoint A = offset(from: @missing, dx: 1, dy: 2)\n";

describe("VS Code document-scoped language analysis session", () => {
  it("uses one AutomationDocument lifecycle for diagnostics and completion", () => {
    const fromSource = vi.spyOn(AutomationDocument, "fromSource");
    const session = createLanguageAnalysisSession(validSource);

    session.getDiagnostics();
    session.completionSemanticSnapshot(sourceSnapshotFor(validSource, 1));
    session.definitionSemanticSnapshot(sourceSnapshotFor(validSource, 1));
    session.referencesSemanticSnapshot(sourceSnapshotFor(validSource, 1));
    session.renameSemanticSnapshot(sourceSnapshotFor(validSource, 1));
    session.replaceSource("nui 4\npoint B = coordinate(x: 0, y: 1)\n");
    session.getDiagnostics();
    session.completionSemanticSnapshot(sourceSnapshotFor("nui 4\npoint B = coordinate(x: 0, y: 1)\n", 2));
    session.definitionSemanticSnapshot(sourceSnapshotFor("nui 4\npoint B = coordinate(x: 0, y: 1)\n", 2));
    session.referencesSemanticSnapshot(sourceSnapshotFor("nui 4\npoint B = coordinate(x: 0, y: 1)\n", 2));
    session.renameSemanticSnapshot(sourceSnapshotFor("nui 4\npoint B = coordinate(x: 0, y: 1)\n", 2));

    expect(fromSource).toHaveBeenCalledTimes(1);
    fromSource.mockRestore();
  });

  it("updates diagnostics and source for unsaved text", () => {
    const session = createLanguageAnalysisSession(fatalSource);
    expect(session.getDiagnostics().length).toBeGreaterThan(0);

    session.replaceSource(validSource);

    expect(session.getSource()).toBe(validSource);
    expect(session.getDiagnostics()).toEqual([]);
  });

  it("returns current semantic data for valid and warning source", () => {
    const valid = createLanguageAnalysisSession(validSource);
    expect(valid.completionSemanticSnapshot(sourceSnapshotFor(validSource, 1))).toMatchObject({
      sourceRevision: 1,
      sourceText: validSource,
      compiled: expect.any(Object)
    });
    expect(valid.definitionSemanticSnapshot(sourceSnapshotFor(validSource, 1))).toMatchObject({
      sourceRevision: 1,
      sourceText: validSource,
      compiled: expect.any(Object)
    });
    expect(valid.referencesSemanticSnapshot(sourceSnapshotFor(validSource, 1))).toMatchObject({
      sourceRevision: 1,
      sourceText: validSource,
      compiled: expect.any(Object)
    });
    expect(valid.renameSemanticSnapshot(sourceSnapshotFor(validSource, 1))).toMatchObject({
      sourceRevision: 1,
      sourceText: validSource,
      compiled: expect.any(Object)
    });

    const warning = createLanguageAnalysisSession(warningSource);
    expect(warning.getDiagnostics()).toEqual([
      expect.objectContaining({ severity: "warning" })
    ]);
    expect(warning.completionSemanticSnapshot(sourceSnapshotFor(warningSource, 1))).toMatchObject({
      sourceRevision: 1,
      sourceText: warningSource,
      compiled: expect.any(Object)
    });
    expect(warning.definitionSemanticSnapshot(sourceSnapshotFor(warningSource, 1))).toMatchObject({
      sourceRevision: 1,
      sourceText: warningSource,
      compiled: expect.any(Object)
    });
  });

  it("returns a folding snapshot for the exact current source and revision", () => {
    const session = createLanguageAnalysisSession(validSource);
    const snapshot = session.foldingSyntaxSnapshot(sourceSnapshotFor(validSource, 1));

    expect(snapshot).toMatchObject({
      sourceRevision: 1,
      sourceText: validSource,
      statements: expect.any(Array),
      sourceMap: expect.objectContaining({
        source: validSource,
        sourceRevision: 1
      })
    });
  });

  it("fails closed for stale folding source or revision", () => {
    const session = createLanguageAnalysisSession(validSource);

    expect(session.foldingSyntaxSnapshot(sourceSnapshotFor(
      "nui 4\npoint Other = coordinate(x: 0, y: 1)\n",
      1
    ))).toBeUndefined();
    expect(session.foldingSyntaxSnapshot(sourceSnapshotFor(validSource, 2))).toBeUndefined();
  });

  it("exposes an exact-current document symbol structure snapshot", () => {
    const session = createLanguageAnalysisSession(validSource);
    const snapshot = session.documentSymbolSyntaxSnapshot(sourceSnapshotFor(validSource, 1));

    expect(snapshot).toMatchObject({
      sourceRevision: 1,
      sourceText: validSource,
      statements: expect.any(Array),
      sourceMap: expect.objectContaining({ source: validSource, sourceRevision: 1 })
    });
    expect(session.documentSymbolSyntaxSnapshot(sourceSnapshotFor(validSource, 2))).toBeUndefined();
    expect(session.documentSymbolSyntaxSnapshot(sourceSnapshotFor("nui 4\npoint Other = coordinate(x: 0, y: 1)\n", 1))).toBeUndefined();
  });

  it("does not leak last-good document symbol statements after a fatal edit", () => {
    const session = createLanguageAnalysisSession("nui 4\nconst old: number = 1\n");
    const currentSource = "nui 4\npoint Current = coordinate(";
    session.replaceSource(currentSource);

    const snapshot = session.documentSymbolSyntaxSnapshot(sourceSnapshotFor(currentSource, 2));

    expect(snapshot?.statements ?? []).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "old" })])
    );
    expect(snapshot?.sourceMap.source).toBe(currentSource);
    const symbols = snapshot
      ? queryDslDocumentSymbols({
          source: sourceSnapshotFor(currentSource, 2),
          statements: snapshot.statements,
          sourceMap: snapshot.sourceMap
        })
      : [];
    expect(symbols.map((symbol) => symbol.name)).toEqual(["Current"]);
    expect(symbols[0]?.range.from).toBe(currentSource.indexOf("point Current"));
  });

  it("keeps document symbols on the exact current revision after repairing and refailing", () => {
    const initialSource = "nui 4\nconst old: number = 1\n";
    const firstFatalSource = "nui 4\npoint First = coordinate(";
    const repairedSource = "nui 4\npoint Repaired = coordinate(x: 0, y: 0)\n";
    const laterFatalSource = `${repairedSource}group Scratch {\npoint live = coordinate(x: 1, y: 1)\n`;
    const session = createLanguageAnalysisSession(initialSource);

    session.replaceSource(firstFatalSource);
    const firstFatalRevision = session.getSourceRevision();
    const firstFatalSnapshot = session.documentSymbolSyntaxSnapshot(
      sourceSnapshotFor(firstFatalSource, firstFatalRevision)
    );
    expect(firstFatalSnapshot).toMatchObject({
      sourceText: firstFatalSource,
      sourceMap: expect.objectContaining({
        source: firstFatalSource,
        sourceRevision: firstFatalRevision
      })
    });
    expect(firstFatalSnapshot?.statements ?? []).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "old" })])
    );

    session.replaceSource(repairedSource);
    session.replaceSource(laterFatalSource);

    const currentSourceRevision = session.getSourceRevision();
    const snapshot = session.documentSymbolSyntaxSnapshot(
      sourceSnapshotFor(laterFatalSource, currentSourceRevision)
    );

    expect(snapshot).toBeDefined();
    expect(currentSourceRevision).toBe(snapshot?.sourceMap.sourceRevision);
    expect(snapshot?.sourceMap.source).toBe(laterFatalSource);
    expect(snapshot?.statements ?? []).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "old" })])
    );

    const symbols = snapshot
      ? queryDslDocumentSymbols({
          source: sourceSnapshotFor(laterFatalSource, currentSourceRevision),
          statements: snapshot.statements,
          sourceMap: snapshot.sourceMap
        })
      : [];
    expect(symbols).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "Scratch",
        children: expect.arrayContaining([expect.objectContaining({ name: "live" })])
      })
    ]));
  });

  it("normalizes CRLF source for the document symbol snapshot", () => {
    const rawSource = validSource.replace(/\n/g, "\r\n");
    const session = createLanguageAnalysisSession(rawSource);

    expect(session.documentSymbolSyntaxSnapshot(sourceSnapshotFor(rawSource, 1))).toMatchObject({
      sourceText: validSource,
      sourceMap: expect.objectContaining({ source: validSource })
    });
  });

  it("returns current parse-only folding data for fatal source without last-good fallback", () => {
    const session = createLanguageAnalysisSession("nui 4\nconst old: number = 1\n");
    const currentSource = "nui 4\npoint A = coordinate(";
    session.replaceSource(currentSource);

    const snapshot = session.foldingSyntaxSnapshot(sourceSnapshotFor(currentSource, 2));

    expect(snapshot).toMatchObject({
      sourceRevision: 2,
      sourceText: currentSource,
      sourceMap: expect.objectContaining({ source: currentSource })
    });
    expect(snapshot?.statements ?? []).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "old" })])
    );
  });

  it("uses exact current partial semantics for fatal source without leaking last-good data", () => {
    const session = createLanguageAnalysisSession("nui 4\nconst old: number = 1\nconst value: number = @old");
    expect(session.completionSemanticSnapshot(sourceSnapshotFor(
      "nui 4\nconst old: number = 1\nconst value: number = @old",
      1
    ))).toBeDefined();

    session.replaceSource(fatalSource);

    const snapshot = session.completionSemanticSnapshot(sourceSnapshotFor(fatalSource, 2));
    expect(snapshot).toMatchObject({
      sourceRevision: 2,
      sourceText: fatalSource,
      compiled: expect.objectContaining({
        spans: expect.objectContaining({
          sourceMap: expect.objectContaining({ source: fatalSource })
        })
      })
    });
    expect(snapshot?.bindingAnalysis?.catalog.bindings ?? []).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "old" })])
    );

    expect(session.definitionSemanticSnapshot(sourceSnapshotFor(fatalSource, 2))).toMatchObject({
      sourceRevision: 2,
      sourceText: fatalSource,
      compiled: expect.objectContaining({
        spans: expect.objectContaining({
          sourceMap: expect.objectContaining({ source: fatalSource })
        })
      })
    });
    const definitionSnapshot = session.definitionSemanticSnapshot(sourceSnapshotFor(fatalSource, 2));
    expect(definitionSnapshot?.bindingAnalysis?.catalog.bindings ?? []).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "old" })])
    );
    expect(definitionSnapshot?.compiled?.sourceLexicalNamespace?.allDeclarations ?? []).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "old" })])
    );
  });

  it("matches CRLF raw source against the LF-normalized completion snapshot", () => {
    const rawSource = validSource.replace(/\n/g, "\r\n");
    const session = createLanguageAnalysisSession(rawSource);

    expect(session.completionSemanticSnapshot(sourceSnapshotFor(rawSource, 1))).toMatchObject({
      sourceRevision: 1,
      sourceText: validSource
    });
    expect(session.definitionSemanticSnapshot(sourceSnapshotFor(rawSource, 1))).toMatchObject({
      sourceRevision: 1,
      sourceText: validSource
    });
  });

  it("fails closed when the requested source does not match the session", () => {
    const session = createLanguageAnalysisSession(validSource);

    expect(session.completionSemanticSnapshot(sourceSnapshotFor(
      "nui 4\npoint Other = coordinate(x: 0, y: 1)\n",
      1
    ))).toBeUndefined();
    expect(session.definitionSemanticSnapshot(sourceSnapshotFor(
      "nui 4\npoint Other = coordinate(x: 0, y: 1)\n",
      1
    ))).toBeUndefined();
  });

  it("fails closed when only the requested source revision is stale", () => {
    const session = createLanguageAnalysisSession(validSource);
    const staleRevision = sourceSnapshotFor(validSource, 2);

    expect(session.completionSemanticSnapshot(staleRevision)).toBeUndefined();
    expect(session.definitionSemanticSnapshot(staleRevision)).toBeUndefined();
    expect(session.referencesSemanticSnapshot(staleRevision)).toBeUndefined();
    expect(session.renameSemanticSnapshot(staleRevision)).toBeUndefined();
  });

  it("exposes only the current source choice Quick Fix semantic snapshot", () => {
    const session = createLanguageAnalysisSession(validSource);
    const current = session.choiceQuickFixSemanticSnapshot(sourceSnapshotFor(validSource, 1));

    expect(current).toMatchObject({
      sourceRevision: 1,
      sourceText: validSource,
      currentCompiled: expect.objectContaining({
        spans: expect.objectContaining({
          sourceMap: expect.objectContaining({ source: validSource })
        })
      })
    });
    expect(session.choiceQuickFixSemanticSnapshot(sourceSnapshotFor(
      "nui 4\npoint Other = coordinate(x: 0, y: 1)\n",
      1
    ))).toBeUndefined();
    expect(session.choiceQuickFixSemanticSnapshot(sourceSnapshotFor(validSource, 2))).toBeUndefined();
  });

  it("invalidates the old choice Quick Fix snapshot after replaceSource", () => {
    const session = createLanguageAnalysisSession(validSource);
    const oldSnapshot = sourceSnapshotFor(validSource, 1);
    const nextSource = "nui 4\npoint B = coordinate(x: 0, y: 1)\n";

    session.replaceSource(nextSource);

    expect(session.choiceQuickFixSemanticSnapshot(oldSnapshot)).toBeUndefined();
    expect(session.choiceQuickFixSemanticSnapshot(sourceSnapshotFor(nextSource, 2))).toBeDefined();
  });

  it("does not fall back to last-good compiled data for fatal choice Quick Fix source", () => {
    const session = createLanguageAnalysisSession("nui 4\nconst old: number = 1\n");
    session.replaceSource(fatalSource);

    const snapshot = session.choiceQuickFixSemanticSnapshot(sourceSnapshotFor(fatalSource, 2));
    expect(snapshot).toMatchObject({
      sourceText: fatalSource,
      currentCompiled: expect.objectContaining({
        spans: expect.objectContaining({
          sourceMap: expect.objectContaining({ source: fatalSource })
        })
      })
    });
    expect(snapshot?.currentCompiled.sourceLexicalNamespace?.allDeclarations ?? []).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "old" })])
    );
  });
});
