import { describe, expect, it } from "vitest";
import { UNCLOSED_CALL_CODE } from "./dslCallParser";
import { parseDsl, parseDslSnapshot } from "./dslParser";
import { createLogicalStatementSourceMap } from "./logicalStatementSourceMap";

describe("blank lines inside multiline calls", () => {
  it("parses a balanced construction call with a blank line before the closer", () => {
    const source = [
      "nui 4",
      "point A = coordinate(",
      "  x: 0,",
      "  y: 0,",
      "",
      ")"
    ].join("\n");
    const parsed = parseDsl(source);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements[1]).toMatchObject({
      kind: "element",
      name: "A",
      documentRange: { startLine: 2, endLine: 6 }
    });
  });

  it("keeps blank and whitespace-only lines between named arguments inside the same statement", () => {
    const source = [
      "nui 4",
      "point A = coordinate(",
      "  x: 10,",
      "",
      "   ",
      "\t",
      "  y: 20",
      ")"
    ].join("\n");
    const parsed = parseDsl(source);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements[1]).toMatchObject({
      kind: "element",
      name: "A",
      documentRange: { startLine: 2, endLine: 8 }
    });
  });

  it("preserves module definitions, module instances, and builtin scalar calls across safe blanks", () => {
    const source = [
      "nui 4",
      "module M(",
      "  value: number,",
      "",
      "  flag: boolean = false",
      ") {",
      "}",
      "instance X = M(",
      "  value: 1,",
      "",
      "  flag: true",
      ")",
      "const angle: number = spreadAngle(",
      "  length: 10,",
      "",
      "  spread: 5",
      ")"
    ].join("\n");
    const parsed = parseDsl(source);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements.some((statement) => statement.kind === "moduleDefinition")).toBe(true);
    expect(parsed.statements.some((statement) => statement.kind === "moduleInstance")).toBe(true);
    expect(parsed.statements.some((statement) =>
      statement.kind === "typedDeclaration" && statement.name === "angle"
    )).toBe(true);
  });

  it("keeps unrelated assignments fail-closed even inside a module parameter recovery window", () => {
    const source = [
      "module M(",
      "  value: number,",
      "",
      "const next: number = 1",
      ") {",
      "}"
    ].join("\n");
    const map = createLogicalStatementSourceMap({ normalizedSource: source, sourceRevision: 13 });

    expect(map.invalidContinuationLines).toContain(2);
    expect(map.statements[0]?.range.endLine).toBe(2);
    expect(map.statements.some((statement) => statement.logicalText.startsWith("const next"))).toBe(true);
  });

  it("keeps nested parenthesis/list delimiters quote-safe across a blank line", () => {
    const source = [
      "line L = offset(",
      "  sources: [",
      "    A,",
      "",
      "    B",
      "  ],",
      "  distance: abs(",
      "    10",
      "  ),",
      "  side: left",
      ")"
    ].join("\n");
    const map = createLogicalStatementSourceMap({ normalizedSource: source, sourceRevision: 12 });

    expect(map.invalidContinuationLines).toEqual([]);
    expect(map.statements).toHaveLength(1);
    expect(map.statements[0]).toMatchObject({
      range: { startLine: 1, endLine: 11, sourceRevision: 12 }
    });
  });

  it("keeps an argument after the blank line mapped to its exact physical token", () => {
    const source = [
      "nui 4",
      "point A = coordinate(",
      "  x: 10,",
      "",
      "  y: 20",
      ")"
    ].join("\n");
    const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 44 });
    const point = parsed.statements.find((statement) => statement.kind === "element");
    expect(point?.kind).toBe("element");
    if (!point || point.kind !== "element") return;
    const y = point.attrs.find((attr) => attr.key === "y");
    const valueFrom = source.indexOf("20");

    expect(y?.physicalSpan).toEqual({
      segments: [{ from: valueFrom, to: valueFrom + 2 }],
      sourceRevision: 44
    });
  });

  it("keeps a genuinely unterminated call as unclosed-call without blaming blank lines", () => {
    const source = [
      "nui 4",
      "point A = coordinate(",
      "  x: 0"
    ].join("\n");
    const parsed = parseDsl(source);
    const unclosed = parsed.diagnostics.filter((diagnostic) => diagnostic.code === UNCLOSED_CALL_CODE);

    expect(unclosed.length).toBeGreaterThan(0);
    expect(unclosed.every((diagnostic) => !diagnostic.message.includes("空行"))).toBe(true);
  });

  it("does not swallow an unrelated top-level statement after a blank line", () => {
    const source = [
      "point A = coordinate(",
      "  x: 0,",
      "",
      "point B = coordinate(x: 1, y: 1)",
      ")"
    ].join("\n");
    const map = createLogicalStatementSourceMap({ normalizedSource: source, sourceRevision: 5 });

    expect(map.invalidContinuationLines).toContain(2);
    expect(map.statements[0]?.range.endLine).toBe(2);
    expect(map.statements.some((statement) => statement.logicalText.startsWith("point B = coordinate"))).toBe(true);
  });

  it("keeps structural block lines as containment stops", () => {
    const source = [
      "point A = coordinate(",
      "  x: 0,",
      "",
      "{",
      ")"
    ].join("\n");
    const map = createLogicalStatementSourceMap({ normalizedSource: source, sourceRevision: 6 });

    expect(map.invalidContinuationLines).toContain(2);
    expect(map.statements[0]?.range.endLine).toBe(2);
    expect(map.statements.some((statement) => statement.structural === "open")).toBe(true);
  });
});
