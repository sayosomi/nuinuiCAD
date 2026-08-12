import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { createModuleSemanticRangeIndex, moduleSemanticDeclarationRange, moduleSemanticTargetAt } from "../dsl/moduleSemanticEditor";
import { analyzeModuleSemanticRename } from "../document/moduleSemanticRenameAnalysis";

const source = [
  "nui 3",
  "module M(width: number) {",
  "  export point Public = coordinate(x: @width, y: 0)",
  "  point Private = coordinate(x: @width, y: 0)",
  "}",
  "module I = M(width: 1)",
  "point X = offset(from: @I::Public, dx: 1, dy: 0)"
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

  it("uses tokenizer-owned element/property spans for geometry property source targets", () => {
    const propertySource = [
      "nui 3",
      "module M() {",
      "  line lineA = segment(start: (0, 0), end: (10, 0))",
      "  const length: number = @lineA.length",
      "}"
    ].join("\n");
    const parsed = parseDslSnapshot({ normalizedSource: propertySource, sourceRevision: 0 });
    const document = compileDslDocument(propertySource, { preparsed: parsed, assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `statement:property:${index}`])) });
    const index = createModuleSemanticRangeIndex(document);
    const lineReference = index.tokens.find((token) => token.from === propertySource.indexOf("lineA", propertySource.indexOf("@lineA")));
    expect(lineReference && propertySource.slice(lineReference.from, lineReference.to)).toBe("lineA");
    expect(moduleSemanticTargetAt(index, lineReference!.from)?.kind).toBe("moduleSource");
    const rename = analyzeModuleSemanticRename(propertySource, document, { kind: "moduleSource", statementId: "statement:property:2" }, "renamedLine");
    expect(rename.verdict).toBe("ok");
    if (rename.verdict === "ok") expect(rename.entries.map((entry) => entry.oldName)).toEqual(["lineA", "lineA"]);
  });

  it("connects deferred export property instance and member tokens to stable source targets", () => {
    const deferredSource = [
      "nui 3",
      "module Child() {",
      "  export line Output = segment(start: (0, 0), end: (10, 0))",
      "}",
      "module M() {",
      "  module SomeInstance = Child()",
      "  const length: number = @SomeInstance::Output.length",
      "}"
    ].join("\n");
    const parsed = parseDslSnapshot({ normalizedSource: deferredSource, sourceRevision: 0 });
    const document = compileDslDocument(deferredSource, { preparsed: parsed, assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `statement:deferred:${index}`])) });
    const index = createModuleSemanticRangeIndex(document);
    expect(index.tokens.find((token) => deferredSource.slice(token.from, token.to) === "SomeInstance" && token.from > deferredSource.indexOf("@"))?.target).toEqual({ kind: "moduleInstance", statementId: "statement:deferred:5" });
    expect(index.tokens.find((token) => deferredSource.slice(token.from, token.to) === "Output" && token.from > deferredSource.indexOf("@"))?.target).toEqual({ kind: "moduleSource", statementId: "statement:deferred:2" });
  });

  it("connects scalar export declarations and qualified members to one source target", () => {
    const scalarSource = [
      "nui 3",
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
    const parsed = parseDslSnapshot({ normalizedSource: scalarSource, sourceRevision: 0 });
    const document = compileDslDocument(scalarSource, {
      preparsed: parsed,
      assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `statement:scalar:${index}`]))
    });
    expect(document.diagnostics).toEqual([]);
    const index = createModuleSemanticRangeIndex(document);
    const sourceToken = (text: string, from = 0) => index.tokens.find((token) => scalarSource.slice(token.from, token.to) === text && token.from >= from);
    const valueDeclaration = sourceToken("value");
    expect(valueDeclaration?.target).toEqual({ kind: "moduleSource", statementId: "statement:scalar:2" });

    const firstMember = sourceToken("value", scalarSource.indexOf("@a::"));
    const secondMember = sourceToken("value", scalarSource.indexOf("@b::"));
    const childMember = sourceToken("value", scalarSource.indexOf("@child::"));
    expect(firstMember?.target).toEqual(valueDeclaration?.target);
    expect(secondMember?.target).toEqual(valueDeclaration?.target);
    expect(childMember?.target).toEqual(valueDeclaration?.target);

    const firstInstance = sourceToken("a", scalarSource.indexOf("@a::"));
    const childInstance = sourceToken("child", scalarSource.indexOf("@child::"));
    expect(firstInstance?.target).toEqual({ kind: "moduleInstance", statementId: "statement:scalar:5" });
    expect(childInstance?.target).toEqual({ kind: "moduleInstance", statementId: "statement:scalar:10" });
    expect(moduleSemanticTargetAt(index, firstMember!.from)).toEqual(valueDeclaration?.target);
    expect(moduleSemanticTargetAt(index, firstInstance!.from)).toEqual(firstInstance?.target);

    const declaration = moduleSemanticDeclarationRange(index, firstMember!.target);
    expect(declaration && scalarSource.slice(declaration.from, declaration.to)).toBe("value");
  });

  it("collects scalar and geometry-property occurrences from text-template holes", () => {
    const templateSource = [
      "nui 3",
      "module Child() {",
      "  export line Export = segment(start: (0, 0), end: (10, 0))",
      "}",
      "module M(lineParam: line) {",
      "  line lineA = segment(start: (0, 0), end: (10, 0))",
      "  module instance = Child()",
      "  text Label = label(text: \"private={@lineA.length} parameter={@lineParam.length} export={@instance::Export.length}\", anchor: (0, 0))",
      "}"
    ].join("\n");
    const parsed = parseDslSnapshot({ normalizedSource: templateSource, sourceRevision: 0 });
    const document = compileDslDocument(templateSource, { preparsed: parsed, assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `statement:template:${index}`])) });
    const index = createModuleSemanticRangeIndex(document);
    const token = (name: string, from = 0) => index.tokens.find((candidate) => templateSource.slice(candidate.from, candidate.to) === name && candidate.from >= from);
    const privateReference = token("lineA", templateSource.indexOf("private="));
    const parameterReference = token("lineParam", templateSource.indexOf("parameter="));
    const exportInstance = token("instance", templateSource.indexOf("export="));
    const exportMember = token("Export", templateSource.indexOf("export="));
    expect(privateReference?.target).toEqual({ kind: "moduleSource", statementId: "statement:template:5" });
    expect(parameterReference?.target).toEqual({ kind: "moduleParameter", slot: { definitionStatementId: "statement:template:4", parameterIndex: 0 } });
    expect(exportInstance?.target).toEqual({ kind: "moduleInstance", statementId: "statement:template:6" });
    expect(exportMember?.target).toEqual({ kind: "moduleSource", statementId: "statement:template:2" });
    const privateRange = index.tokens.find((candidate) => candidate.target.kind === "moduleSource" && candidate.target.statementId === "statement:template:5" && candidate.from === privateReference?.from);
    expect(privateRange && templateSource.slice(privateRange.from, privateRange.to)).toBe("lineA");
    expect(moduleSemanticTargetAt(index, privateReference!.from)).toEqual({ kind: "moduleSource", statementId: "statement:template:5" });
    const declaration = moduleSemanticDeclarationRange(index, privateReference!.target);
    expect(declaration && templateSource.slice(declaration.from, declaration.to)).toBe("lineA");
    const privateRename = analyzeModuleSemanticRename(templateSource, document, { kind: "moduleSource", statementId: "statement:template:5" }, "renamedLine");
    expect(privateRename.verdict).toBe("ok");
    if (privateRename.verdict === "ok") expect(privateRename.entries.map((entry) => entry.oldName)).toEqual(["lineA", "lineA"]);
    const parameterRename = analyzeModuleSemanticRename(templateSource, document, { kind: "moduleParameter", slot: { definitionStatementId: "statement:template:4", parameterIndex: 0 } }, "path");
    expect(parameterRename.verdict).toBe("ok");
    if (parameterRename.verdict === "ok") expect(parameterRename.entries.map((entry) => entry.oldName)).toEqual(["lineParam", "lineParam"]);
    const exportRename = analyzeModuleSemanticRename(templateSource, document, { kind: "moduleSource", statementId: "statement:template:2" }, "renamedExport");
    expect(exportRename.verdict).toBe("ok");
    if (exportRename.verdict === "ok") expect(exportRename.entries.map((entry) => entry.oldName)).toEqual(["Export", "Export"]);
  });
});
