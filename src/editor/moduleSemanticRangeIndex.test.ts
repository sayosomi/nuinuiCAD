import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { createModuleSemanticRangeIndex, moduleSemanticTargetAt } from "../dsl/moduleSemanticEditor";

const source = [
  "nui 3",
  "module M(width: number) {",
  "  export point Public = coordinate(x: @width, y: 0)",
  "  point Private = coordinate(x: @width, y: 0)",
  "}",
  "module I = M(width: 1)",
  "point X = offset(from: I::Public, dx: 1, dy: 0)"
].join("\n");

const compiled = () => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 0 });
  return compileDslDocument(source, { preparsed: parsed, assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `statement:test:${index}`])) });
};

describe("module semantic editor range view", () => {
  it("uses stable definition/parameter/instance/source targets and exact qualified spans", () => {
    const index = createModuleSemanticRangeIndex(compiled());
    const token = (text: string) => index.tokens.find((candidate) => source.slice(candidate.from, candidate.to) === text);
    expect(token("M")?.target).toEqual({ kind: "moduleDefinition", statementId: "statement:test:1" });
    expect(token("width")?.target).toEqual({ kind: "moduleParameter", slot: { definitionStatementId: "statement:test:1", parameterIndex: 0 } });
    expect(token("I")?.target).toEqual({ kind: "moduleInstance", statementId: "statement:test:5" });
    expect(index.tokens.filter((candidate) => source.slice(candidate.from, candidate.to) === "Public").map((candidate) => candidate.target)).toContainEqual({ kind: "moduleSource", statementId: "statement:test:2" });
    const qualifiedMember = index.tokens.find((candidate) => candidate.from === source.indexOf("Public", source.indexOf("I::")));
    expect(qualifiedMember?.to).toBe(qualifiedMember!.from + "Public".length);
    expect(moduleSemanticTargetAt(index, source.indexOf("Private"))).toEqual({ kind: "moduleSource", statementId: "statement:test:3" });
  });
});
