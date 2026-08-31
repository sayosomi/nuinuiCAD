import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { queryDslDefinition } from "./dslDefinitionQuery";
import { parseDslSnapshot } from "./dslParser";

const compileWithIds = (source: string) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 0 });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `statement:test:${index}`]))
  });
};

describe("nui1 Module shorthand Definition hit testing", () => {
  it("resolves the caller binding when the caret is on the shorthand @ prefix", () => {
    const source = [
      "nui 1",
      "const width: number = 10",
      "module Pocket(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "instance pocket = Pocket(@width)"
    ].join("\n");
    const compiled = compileWithIds(source);
    const shorthandAt = source.indexOf("@width", source.indexOf("instance pocket"));
    const result = queryDslDefinition({
      source: { normalizedSource: source, sourceRevision: 0 },
      position: shorthandAt,
      semantic: { sourceRevision: 0, sourceText: source, compiled }
    });

    expect(result).not.toBeNull();
    expect(source.slice(result!.referenceRange.from, result!.referenceRange.to)).toBe("width");
    expect(result!.declarationRange.from).toBe(source.indexOf("width", source.indexOf("const width")));
  });
});
