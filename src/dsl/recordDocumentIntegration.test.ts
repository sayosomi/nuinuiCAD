import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";

const compile = (source: string) => {
  const parsed = parseDsl(source);
  const assignedStatementIds = new Map(parsed.statements.map((_, index) => [index, `stable-${index}`]));
  return compileDslDocument(source, { preparsed: parsed, assignedStatementIds });
};

describe("record source-semantic document integration", () => {
  it("builds the nominal source-semantic model for a record-definition-only document", () => {
    const compiled = compile([
      "nui 4",
      "record Pair(x: number, label: string)"
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document?.elements).toEqual([]);
    expect(compiled.sourceLexicalNamespace?.recordSemanticAnalysis?.definitionsByStatementId.get("stable-1")).toMatchObject({
      statementId: "stable-1",
      name: "Pair"
    });
    expect(compiled.statementMap?.statementIdByStatementIndex?.get(1)).toBe("stable-1");
  });

  it("compiles record definitions and const constructors without creating runtime elements", () => {
    const compiled = compile([
      "nui 4",
      "record Pair(x: number, label: string)",
      'const pair: Pair = Pair(x: 1, label: "A")'
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document?.elements).toEqual([]);
    expect(compiled.sourceLexicalNamespace?.recordSemanticAnalysis?.valuesByStatementId.get("stable-2")).toMatchObject({
      typeIdentity: "stable-1",
      constructor: { targetTypeIdentity: "stable-1" }
    });
  });

  it("keeps record Module parameters source-semantic-only without enabling runtime pass-through", () => {
    const compiled = compile([
      "nui 4",
      "record Pair(x: number)",
      "module Copy(input: Pair) {",
      "  const copy: Pair = @input",
      "}"
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.sourceLexicalNamespace?.recordSemanticAnalysis?.moduleParameters).toEqual([
      expect.objectContaining({
        definitionStatementId: "stable-2",
        parameterIndex: 0,
        typeIdentity: "stable-1"
      })
    ]);
    expect(compiled.document?.elements).toEqual([]);
    expect(compiled.moduleMaterialization?.executionStatements).toEqual([]);
    expect(compiled.moduleMaterialization?.sourceExecutionUnits).toEqual([]);
  });
});
