import { describe, expect, it } from "vitest";
import {
  assertSourceMapRevision,
  createLogicalStatementSourceMap,
  logicalOffsetToPhysical,
  physicalSpanForStatement,
  physicalToLogicalOffset
} from "./logicalStatementSourceMap";
import { parseDslSnapshot } from "./dslParser";

describe("logicalStatementSourceMap", () => {
  it("joins an unclosed-call continuation into one logical statement", () => {
    const snapshot = { normalizedSource: "point A = coordinate(x: 0\n  y: 0)", sourceRevision: 7 };
    const map = createLogicalStatementSourceMap(snapshot);
    expect(map.statements).toHaveLength(1);
    expect(map.statements[0]).toMatchObject({ logicalText: "point A = coordinate(x: 0 y: 0)" });
    expect(map.statements[0].range).toMatchObject({ startLine: 1, endLine: 2, sourceRevision: 7 });
    expect(physicalSpanForStatement(map.statements[0])).toMatchObject({ sourceRevision: 7 });
    expect(logicalOffsetToPhysical(map, map.statements[0], "point A = coordinate(x: 0".length, -1)).toBe("point A = coordinate(x: 0".length);
    expect(logicalOffsetToPhysical(map, map.statements[0], "point A = coordinate(x: 0".length + 1, 1)).toBe(snapshot.normalizedSource.indexOf("y: 0)"));
  });

  it("maps physical offsets in the first (verbatim) fragment to identical logical offsets", () => {
    const snapshot = { normalizedSource: "point A = coordinate(x: 0\n  y: 0)", sourceRevision: 7 };
    const map = createLogicalStatementSourceMap(snapshot);
    const physicalOffset = snapshot.normalizedSource.indexOf("A");
    expect(physicalToLogicalOffset(map, map.statements[0], physicalOffset)).toBe(physicalOffset);
  });

  it("maps physical offsets in a continuation fragment to the joined logical offset", () => {
    const snapshot = { normalizedSource: "point A = coordinate(x: 0\n  y: 0)", sourceRevision: 7 };
    const map = createLogicalStatementSourceMap(snapshot);
    const physicalOffset = snapshot.normalizedSource.indexOf("y: 0)");
    const logicalOffset = map.statements[0].logicalText.indexOf("y: 0)");
    expect(physicalToLogicalOffset(map, map.statements[0], physicalOffset)).toBe(logicalOffset);
  });

  it("returns null for physical offsets in the fragment gap (unclosed-call newline/trimmed indentation)", () => {
    const snapshot = { normalizedSource: "point A = coordinate(x: 0\n  y: 0)", sourceRevision: 7 };
    const map = createLogicalStatementSourceMap(snapshot);
    const statement = map.statements[0];
    const [firstSegment, secondSegment] = statement.segments;
    expect(firstSegment.to).toBeLessThan(secondSegment.from);
    expect(physicalToLogicalOffset(map, statement, firstSegment.to + 1)).toBeNull();
  });

  it("splits the same physical lines without an unclosed call", () => {
    const map = createLogicalStatementSourceMap({ normalizedSource: "point A = coordinate(x: 0 y: 0)\n  point B = coordinate(x: 1 y: 1)", sourceRevision: 8 });
    expect(map.statements).toHaveLength(2);
  });

  it("refuses to project a map onto another revision or source", () => {
    const map = createLogicalStatementSourceMap({ normalizedSource: "point A = coordinate(x: 0 y: 0)", sourceRevision: 2 });
    expect(assertSourceMapRevision(map, { normalizedSource: "point A = coordinate(x: 0 y: 0)", sourceRevision: 3 }, "value"))
      .toEqual({ ok: false, reason: "revision-mismatch" });
    expect(assertSourceMapRevision(map, { normalizedSource: "point A = coordinate(x: 1 y: 0)", sourceRevision: 2 }, "value"))
      .toEqual({ ok: false, reason: "revision-mismatch" });
  });

  it("attaches the source snapshot revision to statements and diagnostics", () => {
    const parsed = parseDslSnapshot({ normalizedSource: "point A = coordinate(\n  x: 0\n  y: 20\n)", sourceRevision: 31 });
    expect(parsed.sourceRevision).toBe(31);
    expect(parsed.statements[0]).toMatchObject({ sourceRevision: 31, documentRange: { startLine: 1, endLine: 4, sourceRevision: 31 } });
    expect(parsed.statements[0].physicalSpan.sourceRevision).toBe(31);
  });
});
