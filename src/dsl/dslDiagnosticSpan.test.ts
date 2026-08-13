import { describe, expect, it } from "vitest";
import { exactPhysicalSpan, type DiagnosticSpanContext } from "./dslDiagnosticSpan";
import { parseDslSnapshot } from "./dslParser";
import type { DslSpan, DslStatement } from "./dslTypes";

const spansFor = (source: string): { spans: DiagnosticSpanContext; statements: readonly DslStatement[] } => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 0 });
  expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  return {
    spans: { sourceMap: parsed.sourceMap, logicalStatementByRangeFrom: parsed.logicalStatementByRangeFrom },
    statements: parsed.statements
  };
};

const typedDeclaration = (statements: readonly DslStatement[]): Extract<DslStatement, { kind: "typedDeclaration" }> => {
  const statement = statements.find((item) => item.kind === "typedDeclaration");
  if (!statement || statement.kind !== "typedDeclaration") throw new Error("no typedDeclaration statement in fixture");
  return statement;
};

describe("exactPhysicalSpan", () => {
  it("projects a single-line initializer sub-span to its exact real source position, not the whole statement", () => {
    const { spans, statements } = spansFor("nui 4\nconst x: number = 1 + 2");
    const statement = typedDeclaration(statements);
    const initializerSpan = statement.payloadSpans.initializer!;
    // The `2` token: offset within the initializer text "1 + 2".
    const tokenSpan: DslSpan = { start: initializerSpan.start + 4, end: initializerSpan.start + 5 };
    const physical = exactPhysicalSpan(spans, statement, tokenSpan);
    expect(physical).not.toBeNull();
    expect(physical!.segments).toHaveLength(1);
    const [segment] = physical!.segments;
    const projectedText = "nui 4\nconst x: number = 1 + 2".slice(segment.from, segment.to);
    expect(projectedText).toBe("2");
    // Whole-statement span would start at "const", well before the token.
    expect(segment.from).toBeGreaterThan(statement.physicalSpan.segments[0].from);
  });

  it("projects an exact sub-span inside a multi-physical-line (continuation) statement", () => {
    const source = ["nui 4", "point A = coordinate(", "  x: 0,", "  y: 20", ")"].join("\n");
    const { spans, statements } = spansFor(source);
    const elementStatement = statements.find((item) => item.kind === "element")!;
    expect(elementStatement.endLine).toBeGreaterThan(elementStatement.line);
    // Project the "y" attribute's value span (a sub-range well inside the
    // continuation, physically on line 4, not line 2 where the statement starts).
    const yAttr = elementStatement.attrs.find((attr) => attr.key === "y")!;
    const physical = exactPhysicalSpan(spans, elementStatement, { start: yAttr.valueStart, end: yAttr.valueEnd });
    expect(physical).not.toBeNull();
    const [segment] = physical!.segments;
    expect(source.slice(segment.from, segment.to)).toBe("20");
    // The projected physical offset must land on line 4 ("  y: 20"), not on
    // the statement's own header line - proving this is not a whole-statement span.
    const line4Start = source.indexOf("  y: 20");
    expect(segment.from).toBeGreaterThanOrEqual(line4Start);
  });

  it("fails closed (null, never the whole statement) when the logical statement mapping is missing", () => {
    const { spans, statements } = spansFor("nui 4\nconst x: number = 1");
    const statement = typedDeclaration(statements);
    const fabricated = { documentRange: { ...statement.documentRange, from: -999 } };
    const physical = exactPhysicalSpan(spans, fabricated, { start: 0, end: 1 });
    expect(physical).toBeNull();
  });

  it("fails closed (null) on a revision mismatch rather than projecting against stale source", () => {
    const { spans, statements } = spansFor("nui 4\nconst x: number = 1");
    const statement = typedDeclaration(statements);
    const staleSpans: DiagnosticSpanContext = {
      ...spans,
      sourceMap: { ...spans.sourceMap, sourceRevision: spans.sourceMap.sourceRevision + 1 }
    };
    const initializerSpan = statement.payloadSpans.initializer!;
    const physical = exactPhysicalSpan(staleSpans, statement, initializerSpan);
    expect(physical).toBeNull();
  });
});
