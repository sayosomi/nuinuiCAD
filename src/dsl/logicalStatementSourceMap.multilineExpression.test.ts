import { describe, expect, it } from "vitest";
import { createLogicalStatementSourceMap, logicalOffsetToPhysical, physicalToLogicalOffset, physicalSpanForLogicalRange, parseDslSnapshot } from "@nuinuicad/nui-language";

const mapFor = (normalizedSource: string) => createLogicalStatementSourceMap({ normalizedSource, sourceRevision: 1535 });
describe("#1535 bare RHS logical boundaries", () => {
  it.each(["+", "-", "*", "/", "%", "^", "<", "<=", ">", ">=", "==", "!=", "??", "and", "or"])("uses tokenized binary %s", op => {
    expect(mapFor(`const result: number = 1\n  ${op} 2`).statements.map(s => s.logicalText)).toEqual([`const result: number = 1 ${op} 2`]);
    expect(mapFor(`next result = 1 ${op}\n2`).statements.map(s => s.logicalText)).toEqual([`next result = 1 ${op} 2`]);
  });
  it.each([
    ["\t ", "\t  ", true], [" \t", " \t\t", true], ["\t", "  ", false], ["  ", "\t  ", false], ["  ", "  ", false]
  ])("compares exact declaration prefix %j with %j", (owner, continuation, joins) => {
    const map = mapFor(`${owner}const result: number = 1\n${continuation}+ 2`);
    expect(map.statements.length).toBe(joins ? 1 : 2);
  });
  it("compares every continuation to its declaration, not the preceding line", () => {
    expect(mapFor("  const result: number =\n8\n   + 2\n    * 3").statements).toHaveLength(1);
  });
  it.each(["const next: number = 2", "bogus statement", "=", "+", "}", "/// doc", "", "andromeda 2"])("preserves containment at %j", boundary => {
    const map = mapFor(`const bad: number = 1 +\n${boundary}\nconst intact: number = 20`);
    expect(map.statements[0].logicalText).toBe("const bad: number = 1 +");
    expect(map.statements.at(-1)?.logicalText).toBe("const intact: number = 20");
  });
  it("does not treat unary operators or literal contents as continuation triggers", () => {
    for (const rhs of ["-", "not", '"+"', '"and"', "@brand"]) {
      expect(mapFor(`const result: number = ${rhs}\n2`).statements).toHaveLength(2);
    }
  });
  it("does not consume comments unless code really continues, or cross a blank/doc barrier", () => {
    for (const gap of ["\n\n", "\n/// doc\n", "\n// ordinary\n\n"]) {
      expect(mapFor(`const result: number = 1${gap}  + 2`).statements[0].range.endLine).toBe(1);
    }
    expect(mapFor("const result: number = 1\n// keep separate\nconst intact: number = 20").statements[0].range.endLine).toBe(1);
  });
  it("maps only real code through ordinary comments, including block comment fragments", () => {
    const source = "const result: number = // equals\n// ordinary\n  8 /* inline */ +\n  2";
    const map = mapFor(source), statement = map.statements[0];
    expect(statement.logicalText).toBe("const result: number = 8 + 2");
    expect(statement.range).toMatchObject({ startLine: 1, endLine: 4, sourceRevision: 1535 });
    expect(statement.continuationLines).toEqual([1, 2, 3]);
    for (const segment of statement.segments) for (let physical = segment.from; physical < segment.to; physical++) {
      const logical = physicalToLogicalOffset(map, statement, physical)!;
      expect(logicalOffsetToPhysical(map, statement, logical, 1)).toBe(physical);
      expect(statement.logicalText[logical]).toBe(source[physical]);
    }
    for (const text of ["equals", "ordinary", "inline", "\n", "  2"]) expect(physicalToLogicalOffset(map, statement, source.indexOf(text))).toBeNull();
    const span = physicalSpanForLogicalRange(map, statement, { start: 0, end: statement.logicalText.length })!;
    expect(span.segments).toEqual(statement.segments);
    expect(logicalOffsetToPhysical({ ...map, sourceRevision: 1536 }, statement, 0)).toBeNull();
  });
  it("retains dedicated control flow, array and Module ownership after equals", () => {
    const source = "nui 1\nmodule M() {\n  const result: number =\n    if (true) {\n      1\n    } else {\n      2\n    }\n  const values: number[] =\n    [1,\n     2]\n}";
    const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 1535 });
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements.filter(s => s.kind === "typedDeclaration").map(s => [s.line, s.endLine])).toEqual([[3, 8], [9, 11]]);
  });
});
