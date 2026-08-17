import { describe, expect, it, vi } from "vitest";
import { AutomationDocument } from "../../src/document/automationDocument";
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
    session.renameSemanticSnapshot(sourceSnapshotFor(validSource, 1));
    session.replaceSource("nui 4\npoint B = coordinate(x: 0, y: 1)\n");
    session.getDiagnostics();
    session.completionSemanticSnapshot(sourceSnapshotFor("nui 4\npoint B = coordinate(x: 0, y: 1)\n", 2));
    session.definitionSemanticSnapshot(sourceSnapshotFor("nui 4\npoint B = coordinate(x: 0, y: 1)\n", 2));
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
    expect(session.renameSemanticSnapshot(staleRevision)).toBeUndefined();
  });
});
