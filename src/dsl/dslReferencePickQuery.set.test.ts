import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "./dslDocument";
import { parseDslSnapshot } from "./dslParser";
import { queryDslReferencePickTarget } from "./dslReferencePickQuery";

const compileWithIds = (source: string, sourceRevision = 17): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `pick-set-test:${index}`]))
  });
};

const queryAt = (source: string, compiled: CompiledDslDocument, position: number) =>
  queryDslReferencePickTarget({
    source: { normalizedSource: source, sourceRevision: 17 },
    position,
    semantic: { sourceRevision: 17, compiled }
  });

describe("queryDslReferencePickTarget set RHS", () => {
  it("uses the resolved number let type and targets the complete numeric property operand", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "let width: number = 10",
      "set width = @Base.length"
    ].join("\n");
    const compiled = compileWithIds(source);
    const baseFrom = source.lastIndexOf("@Base.length");
    const result = queryAt(source, compiled, baseFrom + 3);

    expect(result).toMatchObject({
      expectedGeometryInterface: "path",
      role: "numericPropertyBase",
      multiplicity: "single",
      numericProperty: { kind: "propertySelectionRequired" }
    });
    expect(result && source.slice(result.range.from, result.range.to)).toBe("@Base.length");
  });

  it("fails closed when the resolved set target is not number", () => {
    const source = [
      "nui 4",
      "let enabled: boolean = false",
      "set enabled = true"
    ].join("\n");
    const compiled = compileWithIds(source);
    const position = source.lastIndexOf("true") + 2;

    expect(queryAt(source, compiled, position)).toBeNull();
  });
});
