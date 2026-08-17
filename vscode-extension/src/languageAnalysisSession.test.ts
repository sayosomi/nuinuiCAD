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
    session.replaceSource("nui 4\npoint B = coordinate(x: 0, y: 1)\n");
    session.getDiagnostics();
    session.completionSemanticSnapshot(sourceSnapshotFor("nui 4\npoint B = coordinate(x: 0, y: 1)\n", 2));

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

    const warning = createLanguageAnalysisSession(warningSource);
    expect(warning.getDiagnostics()).toEqual([
      expect.objectContaining({ severity: "warning" })
    ]);
    expect(warning.completionSemanticSnapshot(sourceSnapshotFor(warningSource, 1))).toMatchObject({
      sourceRevision: 1,
      sourceText: warningSource,
      compiled: expect.any(Object)
    });
  });

  it("fails closed for fatal source without leaking last-good semantics", () => {
    const session = createLanguageAnalysisSession(validSource);
    expect(session.completionSemanticSnapshot(sourceSnapshotFor(validSource, 1))).toBeDefined();

    session.replaceSource(fatalSource);

    expect(session.completionSemanticSnapshot(sourceSnapshotFor(fatalSource, 2))).toBeUndefined();
  });

  it("matches CRLF raw source against the LF-normalized completion snapshot", () => {
    const rawSource = validSource.replace(/\n/g, "\r\n");
    const session = createLanguageAnalysisSession(rawSource);

    expect(session.completionSemanticSnapshot(sourceSnapshotFor(rawSource, 1))).toMatchObject({
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
  });
});
