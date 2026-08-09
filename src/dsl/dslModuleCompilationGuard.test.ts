import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";
import { isCompilableDslStatement } from "./dslCompilationGuard";

const compileWithStableIds = (source: string) => {
  const parsed = parseDsl(source);
  const assignedStatementIds = new Map(parsed.statements.map((_, index) => [index, `test:${index}`]));
  return { parsed, compiled: compileDslDocument(source, { preparsed: parsed, assignedStatementIds }) };
};

const compileWithRootStableIds = (source: string) => {
  const parsed = parseDsl(source);
  const assignedStatementIds = new Map(
    parsed.statements
      .map((_, index) => index)
      .filter((index) => isCompilableDslStatement(parsed.statements, index))
      .map((index) => [index, `root:${index}`] as const)
  );
  return { parsed, assignedStatementIds, compiled: compileDslDocument(source, { preparsed: parsed, assignedStatementIds }) };
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

  it("keeps option-bearing module instances inert until module materialization exists", () => {
    const source = [
      "nui 3",
      "module X(state: hidden) = M(state: true)",
      "point Root = coordinate(x: 1, y: 2)"
    ].join("\n");
    const { parsed, compiled } = compileWithStableIds(source);

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document?.elements.map((element) => element.name)).toEqual(["Root"]);
    expect(parsed.statements[1]).toMatchObject({
      kind: "moduleInstance",
      options: [{ name: "state", value: "hidden" }],
      arguments: [{ label: "state", value: "true" }]
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
    const point = parsed.statements[3];
    const physicalSegment = point.physicalSpan.segments[0];
    expect(source.slice(physicalSegment.from, physicalSegment.to)).toContain("point P = coordinate");
    expect(compiled.statementMap?.statements.map((info) => info.statementIndex)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("does not let a module-body set mutate an outer binding or start set compilation", () => {
    const source = [
      "nui 3",
      "module M() {",
      "  set x = 20",
      "}",
      "let x: number = 10"
    ].join("\n");
    const { compiled } = compileWithRootStableIds(source);

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document?.elements).toEqual([]);
    expect(compiled.bindingAnalysis?.catalog.bindings.map((binding) => binding.name)).toEqual(["x"]);
    expect(compiled.scalarProgram?.statements[0].declaration.initializer).toMatchObject({ kind: "numberLiteral", value: 10 });
    expect(compiled.setStatements).toBeUndefined();
  });

  it("does not start document scalar or print-layout infrastructure for module-only statements", () => {
    const source = [
      "nui 3",
      "module M() {",
      "  const inner: number = 10",
      "  set inner = 20",
      "  printLayout innerLayout (output: pdf) {",
      "  }",
      "}"
    ].join("\n");
    const compiled = compileDslDocument(source);

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.bindingAnalysis).toBeUndefined();
    expect(compiled.scalarProgram).toBeUndefined();
    expect(compiled.setStatements).toBeUndefined();
    expect(compiled.document?.printLayouts).toEqual([]);
  });

  it("uses the first compilable @stop and keeps module-body @stop inert", () => {
    const source = [
      "nui 3",
      "module M() {",
      "  @stop",
      "}",
      "point Root = coordinate(x: 0, y: 0)"
    ].join("\n");
    const { parsed, compiled } = compileWithRootStableIds(source);

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document?.elements.map((element) => element.name)).toEqual(["Root"]);
    expect(compiled.document?.evaluationLimitIndex).toBeUndefined();
    expect(compiled.statementMap?.byKey.has("atStop")).toBe(false);
    expect(parsed.statements.some((statement) => statement.kind === "atStop")).toBe(true);
  });

  it("does not apply module-body global settings or treat module nui as a duplicate header", () => {
    const source = [
      "nui 3",
      "module M() {",
      "  nui 3",
      "  color hidden (\"#ff0000\", default: true)",
      "  role inner (name: \"Inner\")",
      "  view hiddenView (default: false)",
      "  activeView hiddenView",
      "  printLayout hiddenLayout (output: pdf) {",
      "  }",
      "  activePrintLayout hiddenLayout",
      "}",
      "point Root = coordinate(x: 0, y: 0)"
    ].join("\n");
    const { compiled } = compileWithRootStableIds(source);

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.diagnostics.some((diagnostic) => diagnostic.message.includes("文書の先頭に1つだけ"))).toBe(false);
    expect(compiled.document?.palette.colors.some((color) => color.id === "hidden")).toBe(false);
    expect(compiled.document?.palette.defaultColorId).toBe("pattern-black");
    expect(compiled.document?.visibilityRoles).toEqual([]);
    expect(compiled.document?.visibilityProfiles).toHaveLength(1);
    expect(compiled.document?.printLayouts).toEqual([]);
    expect(compiled.document?.activePrintLayoutId).toBe("");
  });

  it("does not leak module text-template or property-reference errors into runtime compilation", () => {
    const source = [
      "nui 3",
      "module M() {",
      "  text Hidden = label(text: \"{\", anchor: none)",
      "  point HiddenPoint = coordinate(x: Other.x, y: 0)",
      "}",
      "point Root = coordinate(x: 0, y: 0)"
    ].join("\n");
    const { compiled } = compileWithRootStableIds(source);

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.diagnostics.some((diagnostic) => diagnostic.code?.startsWith("text-template-") || diagnostic.code?.startsWith("property-reference-") || diagnostic.code === "property-binding-invalid")).toBe(false);
  });

  it("does not require stable IDs for excluded nested module statements", () => {
    const source = [
      "nui 3",
      "module M() {",
      "  group G {",
      "    const inner: number = 1",
      "  }",
      "}",
      "const outer: number = 2"
    ].join("\n");
    const { parsed, assignedStatementIds, compiled } = compileWithRootStableIds(source);
    const excludedIndices = parsed.statements
      .map((_, index) => index)
      .filter((index) => !isCompilableDslStatement(parsed.statements, index));

    expect(excludedIndices.length).toBeGreaterThan(0);
    expect(excludedIndices.every((index) => !assignedStatementIds.has(index))).toBe(true);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.bindingAnalysis?.catalog.bindings.map((binding) => binding.name)).toEqual(["outer"]);
    expect([...compiled.bindingAnalysis!.catalog.scopeIndex.scopeOfStatement.keys()]).not.toEqual(
      expect.arrayContaining(excludedIndices)
    );
    expect([...compiled.bindingAnalysis!.catalog.scopeIndex.statementRankByIndex.keys()]).not.toEqual(
      expect.arrayContaining(excludedIndices)
    );
    expect([...compiled.statementMap!.statementIdByStatementIndex!.keys()]).not.toEqual(
      expect.arrayContaining(excludedIndices)
    );
  });
});
