import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { analyzeModuleSemanticRename } from "./moduleSemanticRenameAnalysis";

const compileWithIds = (source: string) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 0 });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `statement:test:${index}`]))
  });
};

describe("module source-semantic rename analysis", () => {
  const source = [
    "nui 3",
    "module M(width: number) {",
    "  export point Public = coordinate(x: @width, y: 0)",
    "  point Private = coordinate(x: @width, y: 0)",
    "}",
    "module I = M(width: 1)",
    "module J = M(width: 2)",
    "point X = offset(from: @I::Public, dx: 1, dy: 0)"
  ].join("\n");

  it("renames a definition, all resolved calls, a parameter, body references, and matching labels", () => {
    const compiled = compileWithIds(source);
    expect(analyzeModuleSemanticRename(source, compiled, { kind: "moduleDefinition", statementId: "statement:test:1" }, "Renamed")).toMatchObject({ verdict: "ok" });
    const parameter = analyzeModuleSemanticRename(source, compiled, {
      kind: "moduleParameter", slot: { definitionStatementId: "statement:test:1", parameterIndex: 0 }
    }, "widthMm");
    expect(parameter).toMatchObject({ verdict: "ok" });
    if (parameter.verdict === "ok") expect(parameter.entries.map((entry) => entry.oldName)).toEqual(["width", "width", "width", "width", "width"]);
  });

  it("renames one instance and one exported source target without touching unrelated names", () => {
    const compiled = compileWithIds(source);
    const instance = analyzeModuleSemanticRename(source, compiled, { kind: "moduleInstance", statementId: "statement:test:6" }, "Other");
    expect(instance).toMatchObject({ verdict: "ok" });
    const exported = analyzeModuleSemanticRename(source, compiled, { kind: "moduleSource", statementId: "statement:test:2" }, "Visible");
    expect(exported).toMatchObject({ verdict: "ok" });
    if (exported.verdict === "ok") expect(exported.entries.map((entry) => entry.oldName)).toEqual(["Public", "Public"]);
  });

  it("fails closed for collisions, invalid names, and stale source", () => {
    const compiled = compileWithIds(source);
    expect(analyzeModuleSemanticRename(source, compiled, { kind: "moduleInstance", statementId: "statement:test:5" }, "J").verdict).toBe("rejected");
    expect(analyzeModuleSemanticRename(source, compiled, { kind: "moduleDefinition", statementId: "statement:test:1" }, "bad name").verdict).toBe("rejected");
    expect(analyzeModuleSemanticRename(`${source}\n`, compiled, { kind: "moduleDefinition", statementId: "statement:test:1" }, "Renamed").verdict).toBe("rejected");
  });
});
