import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "./dslDocument";
import { parseDslSnapshot } from "./dslParser";
import { queryDslReferencePickTarget } from "./dslReferencePickQuery";

const compileWithIds = (source: string, sourceRevision = 17): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `pick-empty-test:${index}`]))
  });
};

const queryAt = (source: string, compiled: CompiledDslDocument, position: number) =>
  queryDslReferencePickTarget({
    source: { normalizedSource: source, sourceRevision: 17 },
    position,
    semantic: { sourceRevision: 17, compiled }
  });

describe("queryDslReferencePickTarget empty values", () => {
  it("accepts an empty known Module geometry argument", () => {
    const source = [
      "nui 4",
      "module M(broad: path) {",
      "}",
      "instance X = M(broad: )"
    ].join("\n");
    const compiled = compileWithIds(source);
    const position = source.lastIndexOf("broad: ") + "broad: ".length;

    expect(queryAt(source, compiled, position)).toMatchObject({
      expectedGeometryInterface: "path",
      role: "geometry",
      multiplicity: "single",
      range: { from: position, to: position }
    });
  });

  it("accepts an empty positional geometry builtin argument", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "const d: number = distance(, @A)"
    ].join("\n");
    const compiled = compileWithIds(source);
    const position = source.lastIndexOf("distance(") + "distance(".length;

    expect(queryAt(source, compiled, position)).toMatchObject({
      expectedGeometryInterface: "point",
      role: "geometry",
      multiplicity: "single",
      range: { from: position, to: position }
    });
  });
});
