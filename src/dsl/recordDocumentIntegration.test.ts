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
      "nui 1",
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
      "nui 1",
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
      "nui 1",
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

  it("retains record value control flow in the source semantic model", () => {
    const compiled = compile([
      "nui 1",
      "record Pair(x: number, label: string)",
      "const flag: boolean = true",
      "const side: choice(left, right) = left",
      'const fallback: Pair = Pair(x: 2, label: "right")',
      'const selected: Pair = if (@flag) { Pair(x: 10, label: "left") } else { @fallback }',
      'const matched: Pair = match @side { left => Pair(x: 11, label: "left") right => @fallback }',
      "const selectedX: number = @selected.x"
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const records = compiled.sourceLexicalNamespace?.recordSemanticAnalysis;
    expect(records?.valuesByStatementId.get("stable-5")).toMatchObject({
      typeIdentity: "stable-1",
      valueExpression: {
        kind: "if",
        thenBranch: { kind: "constructor", constructor: { targetTypeIdentity: "stable-1" } },
        elseBranch: { kind: "reference", reference: { targetTypeIdentity: "stable-1" } }
      }
    });
    expect(records?.valuesByStatementId.get("stable-6")?.valueExpression?.kind).toBe("match");
    expect(compiled.scalarProgram?.statements.some((statement) =>
      statement.declaration.initializer.kind === "valueIf"
    )).toBe(true);
  });

  it("accepts a statically indexed record collection member in a record branch", () => {
    const compiled = compile([
      "nui 1",
      "record Pair(x: number, label: string)",
      'const first: Pair = Pair(x: 1, label: "first")',
      'const second: Pair = Pair(x: 2, label: "second")',
      "const pairs: Pair[] = [@first, @second]",
      "const selected: Pair = if (true) { @pairs[1] } else { @first }",
      "const selectedX: number = @selected.x"
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.bindingIssueDiagnostics ?? []).toEqual([]);
    expect(compiled.scalarProgram?.statements.find((statement) => statement.declaration.initializer.kind === "reference" && statement.declaration.initializer.name === "selected.x")?.declaration.initializer).toMatchObject({
      kind: "reference",
      type: { kind: "number" }
    });
  });

  it("reports malformed record control flow through the shared scalar parser", () => {
    const compiled = compile([
      "nui 1",
      "record Pair(x: number)",
      "const flag: boolean = true",
      "const broken: Pair = if (@flag) { Pair(x: 1) } else { Pair(x: 2)"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "value-if-malformed-branch" })
    ]));
    expect(compiled.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "record-constructor-invalid" })
    ]));
  });
});
