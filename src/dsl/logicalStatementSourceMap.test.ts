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

  it("keeps a canonical scalar value-if declaration together through its braces", () => {
    const source = [
      "nui 1",
      "const flag: boolean = true",
      "const amount: number =",
      "  if (@flag) {",
      "  10",
      "} else {",
      "  20",
      "}",
      "const after: number = 30"
    ].join("\n");
    const map = createLogicalStatementSourceMap({ normalizedSource: source, sourceRevision: 9 });
    expect(map.statements.map((statement) => statement.logicalText)).toEqual([
      "nui 1",
      "const flag: boolean = true",
      "const amount: number = if (@flag) { 10 } else { 20 }",
      "const after: number = 30"
    ]);
    expect(map.statements[2]).toMatchObject({ range: { startLine: 3, endLine: 8 } });
  });

  it("keeps a canonical multiline exhaustive choice match declaration together", () => {
    const source = [
      "nui 1",
      "const size: choice(small, large) =",
      "  match @size {",
      "  small => 5",
      "  large => 10",
      "}",
      "const after: number = 30"
    ].join("\n");
    const map = createLogicalStatementSourceMap({ normalizedSource: source, sourceRevision: 14 });
    expect(map.statements.map((statement) => statement.logicalText)).toEqual([
      "nui 1",
      "const size: choice(small, large) = match @size { small => 5 large => 10 }",
      "const after: number = 30"
    ]);
  });

  it("keeps canonical multiline exported value-if declarations separate from a following declaration", () => {
    const source = [
      "nui 1",
      "module M() {",
      "  export const amount: number =",
      "    if (true) {",
      "    10",
      "  } else {",
      "    20",
      "  }",
      "  export let side: choice(left, right) =",
      "    if (true) {",
      "    left",
      "  } else {",
      "    right",
      "  }",
      "  const after: number = 30",
      "}"
    ].join("\n");
    const map = createLogicalStatementSourceMap({ normalizedSource: source, sourceRevision: 11 });
    expect(map.statements.map((statement) => statement.logicalText)).toEqual([
      "nui 1",
      "module M() {",
      "export const amount: number = if (true) { 10 } else { 20 }",
      "export let side: choice(left, right) = if (true) { left } else { right }",
      "const after: number = 30",
      "}"
    ]);
  });

  it("does not swallow a following non-value-if statement after a trailing equals", () => {
    const source = "nui 1\nconst amount: number =\nconst after: number = 30";
    const map = createLogicalStatementSourceMap({ normalizedSource: source, sourceRevision: 13 });
    expect(map.statements.map((statement) => statement.logicalText)).toEqual([
      "nui 1",
      "const amount: number =",
      "const after: number = 30"
    ]);
  });

  it("counts braces after a string closing quote with even backslash escape parity", () => {
    const source = [
      "nui 1",
      "const selected: string = if (true) {",
      '  "\\\\"',
      "} else {",
      '  "fallback"',
      "}",
      "const after: number = 30"
    ].join("\n");
    const map = createLogicalStatementSourceMap({ normalizedSource: source, sourceRevision: 12 });
    expect(map.statements.map((statement) => statement.logicalText)).toEqual([
      "nui 1",
      'const selected: string = if (true) { "\\\\" } else { "fallback" }',
      "const after: number = 30"
    ]);
  });

  it("does not swallow a following declaration when value-if framing is incomplete", () => {
    const source = "nui 1\nconst amount: number = if (true) {\n  10\nconst after: number = 30";
    const map = createLogicalStatementSourceMap({ normalizedSource: source, sourceRevision: 10 });
    expect(map.statements.map((statement) => statement.logicalText)).toEqual([
      "nui 1",
      "const amount: number = if (true) { 10",
      "const after: number = 30"
    ]);
  });

  it("refuses to project a map onto another revision or source", () => {
    const map = createLogicalStatementSourceMap({ normalizedSource: "point A = coordinate(x: 0,y: 0)", sourceRevision: 2 });
    expect(assertSourceMapRevision(map, { normalizedSource: "point A = coordinate(x: 0,y: 0)", sourceRevision: 3 }, "value"))
      .toEqual({ ok: false, reason: "revision-mismatch" });
    expect(assertSourceMapRevision(map, { normalizedSource: "point A = coordinate(x: 1,y: 0)", sourceRevision: 2 }, "value"))
      .toEqual({ ok: false, reason: "revision-mismatch" });
  });

  it("attaches the source snapshot revision to statements and diagnostics", () => {
    const parsed = parseDslSnapshot({ normalizedSource: "point A = coordinate(\n, x: 0\n,y: 20\n)", sourceRevision: 31 });
    expect(parsed.sourceRevision).toBe(31);
    expect(parsed.statements[0]).toMatchObject({ sourceRevision: 31, documentRange: { startLine: 1, endLine: 4, sourceRevision: 31 } });
    expect(parsed.statements[0].physicalSpan.sourceRevision).toBe(31);
  });

  it("keeps comment-delimited code spans physical and excludes comment text", () => {
    const source = "point A = coordinate(x: 0, /* ignored { } */ y: 0) // trailing";
    const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 41 });
    const statement = parsed.statements[0]!;
    expect(parsed.diagnostics).toEqual([]);
    expect(statement.physicalSpan.segments).toEqual([
      { from: 0, to: source.indexOf(" /*") },
      { from: source.indexOf(" */") + 4, to: source.indexOf(" //") }
    ]);
    expect(statement.physicalSpan.segments.every((segment) => !source.slice(segment.from, segment.to).includes("ignored"))).toBe(true);
  });
});
