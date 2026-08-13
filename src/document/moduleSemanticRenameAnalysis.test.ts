import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { createModuleSemanticRangeIndex } from "../dsl/moduleSemanticEditor";
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
    "nui 4",
    "module M(width: number) {",
    "  export point Public = coordinate(x: @width, y: 0)",
    "  point Private = coordinate(x: @width, y: 0)",
    "}",
    "instance I = M(width: 1)",
    "instance J = M(width: 2)",
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

  it("renames exported scalar declarations and all instance members without crossing segments", () => {
    const scalarSource = [
      "nui 4",
      "module M() {",
      "  export const value: number = 1",
      "  export let label: string = \"\"",
      "}",
      "instance a = M()",
      "instance b = M()",
      "const rootA: number = @a::value",
      "const rootB: number = @b::value",
      "module Consumer() {",
      "  instance child = M()",
      "  const inside: number = @child::value",
      "}"
    ].join("\n");
    const compiled = compileWithIds(scalarSource);
    const declarationRename = analyzeModuleSemanticRename(scalarSource, compiled, { kind: "moduleSource", statementId: "statement:test:2" }, "height");
    expect(declarationRename.verdict).toBe("ok");
    if (declarationRename.verdict === "ok") {
      expect(declarationRename.entries.map((entry) => entry.oldName)).toEqual(["value", "value", "value", "value"]);
    }

    const referenceOffset = scalarSource.indexOf("value", scalarSource.indexOf("@a::"));
    const referenceTarget = createModuleSemanticRangeIndex(compiled).tokens.find((token) => token.from === referenceOffset)?.target;
    expect(referenceTarget).toEqual({ kind: "moduleSource", statementId: "statement:test:2" });
    const referenceRename = analyzeModuleSemanticRename(scalarSource, compiled, referenceTarget!, "height");
    expect(referenceRename.verdict).toBe("ok");
    if (referenceRename.verdict === "ok") expect(referenceRename.entries.map((entry) => entry.oldName)).toEqual(["value", "value", "value", "value"]);

    const instanceRename = analyzeModuleSemanticRename(scalarSource, compiled, { kind: "moduleInstance", statementId: "statement:test:5" }, "renamedA");
    expect(instanceRename.verdict).toBe("ok");
    if (instanceRename.verdict === "ok") {
      expect(instanceRename.entries.map((entry) => entry.oldName)).toEqual(["a", "a"]);
      expect(instanceRename.entries.map((entry) => entry.newName)).toEqual(["renamedA", "renamedA"]);
    }
  });
});
