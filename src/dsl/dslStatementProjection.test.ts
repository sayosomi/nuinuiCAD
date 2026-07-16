import { describe, expect, it } from "vitest";
import { dslDocumentValueSpansAt } from "./dslValueSpans";
import { singlePhysicalSegment, statementProjectionAt } from "./dslStatementProjection";

describe("statement source projection", () => {
  it("projects second-line values to their physical positions", () => {
    const source = "point A = (0, 0) \\\n  color=main locked=true";
    const color = source.indexOf("main");
    const values = dslDocumentValueSpansAt({ normalizedSource: source, sourceRevision: 9 }, color);
    expect(values).toEqual(expect.objectContaining({ ok: true }));
    if (values.ok) expect(values.value.map((span) => source.slice(span.from, span.to))).toEqual(expect.arrayContaining(["main", "true"]));
  });

  it("does not use a span from another snapshot revision", () => {
    const source = "point A = (0, 0)";
    const projection = statementProjectionAt({ normalizedSource: source, sourceRevision: 5 }, 0);
    expect(projection.ok).toBe(true);
    if (projection.ok && projection.value) {
      expect(singlePhysicalSegment({ normalizedSource: source, sourceRevision: 6 }, projection.value.statement.physicalSpan))
        .toEqual({ ok: false, reason: "revision-mismatch" });
    }
  });
});
