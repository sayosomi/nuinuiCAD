import { describe, expect, it } from "vitest";
import {
  createLanguageAnalysisSession,
  currentCompiledSemanticSnapshotFor
} from "./languageAnalysisSession";

const validSource = "nui 1\npoint A = coordinate(x: 0, y: 1)\n";
const warningSource = "nui 1\npoint A = offset(from: @missing, dx: 1, dy: 2)\n";
const fatalSource = "nui 1\npoint A = coordinate(";
const repairedSource = "nui 1\npoint B = coordinate(x: 2, y: 3)\n";

describe("VS Code runtime evaluation semantic snapshot", () => {
  it("exposes a complete exact-current compiled document for valid and warning source", () => {
    const valid = createLanguageAnalysisSession(validSource);
    expect(valid.runtimeEvaluationSnapshot()).toMatchObject({
      sourceRevision: 1,
      sourceText: validSource,
      documentRevision: 0,
      compiledDocumentRevision: 0,
      compiled: expect.any(Object)
    });

    const warning = createLanguageAnalysisSession(warningSource);
    expect(warning.runtimeEvaluationSnapshot()).toMatchObject({
      sourceRevision: 1,
      sourceText: warningSource,
      compiled: expect.any(Object)
    });
  });

  it("keeps fatal current compiled semantics separate from runtime evaluation", () => {
    const session = createLanguageAnalysisSession(validSource);

    expect(session.runtimeEvaluationSnapshot()?.sourceText).toBe(validSource);

    session.replaceSource(fatalSource);
    expect(session.runtimeEvaluationSnapshot()).toBeNull();
    expect(currentCompiledSemanticSnapshotFor(session, {
      normalizedSource: fatalSource,
      sourceRevision: session.getSourceRevision()
    })).toMatchObject({
      sourceText: fatalSource,
      sourceRevision: session.getSourceRevision(),
      compiled: expect.any(Object)
    });
  });

  it("advances document and compiled proof after repairing fatal source", () => {
    const session = createLanguageAnalysisSession(validSource);
    session.replaceSource(fatalSource);
    session.replaceSource(repairedSource);

    // Source revision is reconciler-owned from the last-good compiled document,
    // so repairing a fatal edit reuses the next successful source revision.
    // The AutomationDocument revision still proves that two source replacements
    // occurred, while compiledDocumentRevision proves one new compiled document.
    expect(session.runtimeEvaluationSnapshot()).toMatchObject({
      sourceRevision: 2,
      sourceText: repairedSource,
      documentRevision: 2,
      compiledDocumentRevision: 1,
      compiled: expect.any(Object)
    });
  });

  it("normalizes CRLF only for semantic proof while retaining exact current ownership", () => {
    const rawSource = validSource.replace(/\n/g, "\r\n");
    const session = createLanguageAnalysisSession(rawSource);

    expect(session.runtimeEvaluationSnapshot()).toMatchObject({
      sourceRevision: 1,
      sourceText: validSource,
      documentRevision: 0,
      compiledDocumentRevision: 0
    });
  });
});
