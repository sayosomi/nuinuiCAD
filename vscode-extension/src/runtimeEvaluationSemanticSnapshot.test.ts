import { describe, expect, it } from "vitest";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";

const sourceSnapshotFor = (source: string, sourceRevision: number) => ({
  normalizedSource: source.replace(/\r\n/g, "\n"),
  sourceRevision
});

const validSource = "nui 4\npoint A = coordinate(x: 0, y: 1)\n";
const warningSource = "nui 4\npoint A = offset(from: @missing, dx: 1, dy: 2)\n";
const fatalSource = "nui 4\npoint A = coordinate(";
const repairedSource = "nui 4\npoint B = coordinate(x: 2, y: 3)\n";

describe("VS Code runtime evaluation semantic snapshot", () => {
  it("exposes a complete exact-current compiled document for valid and warning source", () => {
    const valid = createLanguageAnalysisSession(validSource);
    expect(valid.runtimeEvaluationSemanticSnapshot(sourceSnapshotFor(validSource, 1))).toMatchObject({
      sourceRevision: 1,
      sourceText: validSource,
      documentRevision: 0,
      compiledDocumentRevision: 0,
      compiled: expect.any(Object)
    });

    const warning = createLanguageAnalysisSession(warningSource);
    expect(warning.runtimeEvaluationSemanticSnapshot(sourceSnapshotFor(warningSource, 1))).toMatchObject({
      sourceRevision: 1,
      sourceText: warningSource,
      compiled: expect.any(Object)
    });
  });

  it("fails closed for stale source/revision and fatal current source without last-good fallback", () => {
    const session = createLanguageAnalysisSession(validSource);

    expect(session.runtimeEvaluationSemanticSnapshot(sourceSnapshotFor(repairedSource, 1))).toBeUndefined();
    expect(session.runtimeEvaluationSemanticSnapshot(sourceSnapshotFor(validSource, 2))).toBeUndefined();

    session.replaceSource(fatalSource);
    expect(session.runtimeEvaluationSemanticSnapshot(sourceSnapshotFor(fatalSource, 2))).toBeUndefined();
  });

  it("advances document and compiled proof after repairing fatal source", () => {
    const session = createLanguageAnalysisSession(validSource);
    session.replaceSource(fatalSource);
    session.replaceSource(repairedSource);

    expect(session.runtimeEvaluationSemanticSnapshot(sourceSnapshotFor(repairedSource, 3))).toMatchObject({
      sourceRevision: 3,
      sourceText: repairedSource,
      documentRevision: 2,
      compiledDocumentRevision: 1,
      compiled: expect.any(Object)
    });
  });

  it("normalizes CRLF only for semantic proof while retaining exact current ownership", () => {
    const rawSource = validSource.replace(/\n/g, "\r\n");
    const session = createLanguageAnalysisSession(rawSource);

    expect(session.runtimeEvaluationSemanticSnapshot(sourceSnapshotFor(rawSource, 1))).toMatchObject({
      sourceRevision: 1,
      sourceText: validSource,
      documentRevision: 0,
      compiledDocumentRevision: 0
    });
  });
});
