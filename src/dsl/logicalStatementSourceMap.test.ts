import { describe, expect, it } from "vitest";
import {
  assertSourceMapRevision,
  createLogicalStatementSourceMap,
  logicalOffsetToPhysical,
  physicalSpanForStatement
} from "./logicalStatementSourceMap";
import { parseDslSnapshot } from "./dslParser";

describe("logicalStatementSourceMap", () => {
  it("joins a backslash continuation into one logical statement", () => {
    const snapshot = { normalizedSource: "point A = (0, 0) \\\n  color=main", sourceRevision: 7 };
    const map = createLogicalStatementSourceMap(snapshot);
    expect(map.statements).toHaveLength(1);
    expect(map.statements[0]).toMatchObject({ logicalText: "point A = (0, 0) color=main" });
    expect(map.statements[0].range).toMatchObject({ startLine: 1, endLine: 2, sourceRevision: 7 });
    expect(physicalSpanForStatement(map.statements[0])).toMatchObject({ sourceRevision: 7 });
    expect(logicalOffsetToPhysical(map, map.statements[0], "point A = (0, 0)".length, -1)).toBe("point A = (0, 0)".length);
    expect(logicalOffsetToPhysical(map, map.statements[0], "point A = (0, 0)".length + 1, 1)).toBe(snapshot.normalizedSource.indexOf("color"));
  });

  it("splits the same physical lines without the continuation marker", () => {
    const map = createLogicalStatementSourceMap({ normalizedSource: "point A = (0, 0)\n  color=main", sourceRevision: 8 });
    expect(map.statements).toHaveLength(2);
  });

  it("refuses to project a map onto another revision or source", () => {
    const map = createLogicalStatementSourceMap({ normalizedSource: "point A = (0, 0)", sourceRevision: 2 });
    expect(assertSourceMapRevision(map, { normalizedSource: "point A = (0, 0)", sourceRevision: 3 }, "value"))
      .toEqual({ ok: false, reason: "revision-mismatch" });
    expect(assertSourceMapRevision(map, { normalizedSource: "point A = (1, 0)", sourceRevision: 2 }, "value"))
      .toEqual({ ok: false, reason: "revision-mismatch" });
  });

  it("attaches the source snapshot revision to statements and diagnostics", () => {
    const parsed = parseDslSnapshot({ normalizedSource: "point A = (0, \\\n  20)", sourceRevision: 31 });
    expect(parsed.sourceRevision).toBe(31);
    expect(parsed.statements[0]).toMatchObject({ sourceRevision: 31, documentRange: { startLine: 1, endLine: 2, sourceRevision: 31 } });
    expect(parsed.statements[0].physicalSpan.sourceRevision).toBe(31);
  });
});
