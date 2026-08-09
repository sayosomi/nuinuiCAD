import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";

const compileWithStableIds = (source: string) => {
  const parsed = parseDsl(source);
  const assignedStatementIds = new Map(parsed.statements.map((_, index) => [index, `test:${index}`]));
  return { parsed, compiled: compileDslDocument(source, { preparsed: parsed, assignedStatementIds }) };
};

describe("module definition compilation guard", () => {
  it("keeps direct module-body geometry inert while retaining the AST", () => {
    const source = [
      "nui 3",
      "module M() {",
      "  point P = coordinate(x: 10, y: 20)",
      "}",
      "point Root = coordinate(x: 1, y: 2)"
    ].join("\n");
    const { parsed, compiled } = compileWithStableIds(source);

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document?.elements.map((element) => element.name)).toEqual(["Root"]);
    expect(parsed.statements.find((statement) => statement.kind === "element" && statement.name === "P")?.enclosing).toEqual({
      statementIndex: 1,
      branch: "then"
    });
  });

  it("keeps nested module groups and their descendants inert", () => {
    const source = [
      "nui 3",
      "module M() {",
      "  group G {",
      "    point P = coordinate(x: 10, y: 20)",
      "  }",
      "}",
      "point Root = coordinate(x: 1, y: 2)"
    ].join("\n");
    const { compiled } = compileWithStableIds(source);

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document?.elements.map((element) => element.name)).toEqual(["Root"]);
  });

  it("keeps module-body const/let out of scalar analysis but compiles outer declarations", () => {
    const source = [
      "nui 3",
      "module M() {",
      "  const inner: number = 10",
      "  let innerMutable: number = 20",
      "}",
      "const outer: number = 30",
      "let outerMutable: number = 40"
    ].join("\n");
    const { compiled } = compileWithStableIds(source);

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.bindingAnalysis?.catalog.bindings.map((binding) => binding.name)).toEqual(["outer", "outerMutable"]);
    expect(compiled.scalarProgram?.statements.map((statement) => statement.declaration.initializer.kind)).toEqual([
      "numberLiteral",
      "numberLiteral"
    ]);
  });

  it("keeps module AST and enclosing metadata available after compilation", () => {
    const source = "nui 3\nmodule M() {\n  group G {\n    point P = coordinate(x: 10, y: 20)\n  }\n}";
    const { parsed, compiled } = compileWithStableIds(source);
    expect(compiled.statements.map((statement) => statement.kind)).toEqual([
      "version",
      "moduleDefinition",
      "group",
      "element",
      "blockEnd",
      "blockEnd"
    ]);
    expect(compiled.statements[2].enclosing).toEqual({ statementIndex: 1, branch: "then" });
    expect(compiled.statements[3].enclosing).toEqual({ statementIndex: 2, branch: "then" });
    expect(parsed.statements[1].kind).toBe("moduleDefinition");
  });
});
