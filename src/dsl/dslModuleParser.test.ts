import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDsl, parseDslSnapshot } from "./dslParser";
import type { DslStatement } from "./dslTypes";

const errors = (source: string) => parseDsl(source).diagnostics.filter((item) => item.severity === "error");

const moduleDefinition = (statements: readonly DslStatement[]) =>
  statements.find((statement): statement is Extract<DslStatement, { kind: "moduleDefinition" }> => statement.kind === "moduleDefinition");

describe("DSL module source AST", () => {
  it("parses a definition with scalar, geometry, choice, and raw defaults", () => {
    const source = [
      "nui 3",
      "module 凸ノッチ(凸ノッチ高さ: number, 縫い線: line, 縫い代線: line, ノッチ位置: point, 反転: boolean = false, 種別: choice(通常, 反転) = 通常) {",
      "  point P = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n");
    const parsed = parseDsl(source);
    expect(parsed.diagnostics).toEqual([]);

    const definition = moduleDefinition(parsed.statements)!;
    expect(definition).toMatchObject({ kind: "moduleDefinition", name: "凸ノッチ", opensBlock: true });
    expect(definition.parameters).toMatchObject([
      { kind: "moduleParameter", name: "凸ノッチ高さ", type: { kind: "number" }, defaultValue: null },
      { kind: "moduleParameter", name: "縫い線", type: { kind: "line" }, defaultValue: null },
      { kind: "moduleParameter", name: "縫い代線", type: { kind: "line" }, defaultValue: null },
      { kind: "moduleParameter", name: "ノッチ位置", type: { kind: "point" }, defaultValue: null },
      { kind: "moduleParameter", name: "反転", type: { kind: "boolean" }, defaultValue: "false" },
      { kind: "moduleParameter", name: "種別", type: { kind: "choice", options: ["通常", "反転"] }, defaultValue: "通常" }
    ]);
    const logicalDefinition = source.slice(source.indexOf("module"));
    const defaultStart = logicalDefinition.indexOf("false");
    expect(definition.parameters[4].defaultSpan).toEqual({ start: defaultStart, end: defaultStart + "false".length });
    expect(parsed.statements[2].enclosing).toEqual({ statementIndex: 1, branch: "then" });
  });

  it("parses multiline definitions and nested module blocks", () => {
    const parsed = parseDsl([
      "nui 3",
      "module Outer(",
      "  A: number,",
      "  B: boolean = false,",
      "  C: line",
      ") {",
      "  module Inner() {",
      "    point P = coordinate(x: 0, y: 0)",
      "  }",
      "}"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements.map((statement) => statement.kind)).toEqual([
      "version",
      "moduleDefinition",
      "moduleDefinition",
      "element",
      "blockEnd",
      "blockEnd"
    ]);
    expect(parsed.statements[2].enclosing).toEqual({ statementIndex: 1, branch: "then" });
    expect(parsed.statements[3].enclosing).toEqual({ statementIndex: 2, branch: "then" });
  });

  it("keeps module parameter and argument physical spans on multiline source", () => {
    const source = [
      "nui 3",
      "module M(",
      "  A: number = @幅 * 2,",
      "  B: line",
      ") {",
      "}",
      "module X = M(",
      "  A: 10,",
      "  B: 線A",
      ")"
    ].join("\n");
    const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 27 });
    expect(parsed.diagnostics).toEqual([]);
    const definition = moduleDefinition(parsed.statements)!;
    const parameter = definition.parameters[0];
    const instance = parsed.statements.find((statement) => statement.kind === "moduleInstance");
    expect(instance).toMatchObject({ kind: "moduleInstance", name: "X", moduleName: "M" });

    const parameterNameSegment = parameter.namePhysicalSpan!.segments[0];
    const parameterDefaultSegment = parameter.defaultPhysicalSpan!.segments[0];
    expect(source.slice(parameterNameSegment.from, parameterNameSegment.to)).toBe("A");
    expect(source.slice(parameterDefaultSegment.from, parameterDefaultSegment.to)).toBe("@幅 * 2");
    const argument = (instance as Extract<DslStatement, { kind: "moduleInstance" }>).arguments[1];
    const labelSegment = argument.labelPhysicalSpan!.segments[0];
    const valueSegment = argument.valuePhysicalSpan!.segments[0];
    expect(source.slice(labelSegment.from, labelSegment.to)).toBe("B");
    expect(source.slice(valueSegment.from, valueSegment.to)).toBe("線A");
    expect(parameter.namePhysicalSpan?.sourceRevision).toBe(27);
  });

  it("parses named-only module instances and preserves raw argument values", () => {
    const source = "nui 3\nmodule ノッチ = 凸ノッチ(凸ノッチ高さ: @高さ, 縫い線: 縫い線, 縫い代線: 縫い代線, ノッチ位置: ノッチ位置, 反転: false)";
    const parsed = parseDsl(source);
    expect(parsed.diagnostics).toEqual([]);
    const instance = parsed.statements[1];
    expect(instance).toMatchObject({ kind: "moduleInstance", name: "ノッチ", moduleName: "凸ノッチ" });
    if (instance.kind !== "moduleInstance") return;
    expect(instance.arguments.map((argument) => [argument.label, argument.value])).toEqual([
      ["凸ノッチ高さ", "@高さ"],
      ["縫い線", "縫い線"],
      ["縫い代線", "縫い代線"],
      ["ノッチ位置", "ノッチ位置"],
      ["反転", "false"]
    ]);
  });

  it("marks exported geometry without changing its geometry AST", () => {
    const source = "nui 3\nexport line 先に縫う = copy(baseLines: [AB], startPoint: A, endPoint: B)";
    const parsed = parseDsl(source);
    expect(parsed.diagnostics).toEqual([]);
    const statement = parsed.statements[1];
    expect(statement).toMatchObject({
      kind: "element",
      category: "line",
      construction: "copy",
      name: "先に縫う",
      exported: true,
      exportSpan: { start: 0, end: 6 }
    });
    if (statement.kind === "element") {
      const logicalLine = source.slice(source.indexOf("export"));
      const nameStart = logicalLine.indexOf("先に縫う");
      expect(statement.nameSpan).toEqual({ start: nameStart, end: nameStart + "先に縫う".length });
      expect(statement.exportPhysicalSpan?.sourceRevision).toBe(0);
    }
  });
});

describe("DSL module syntax diagnostics", () => {
  const diagnosticCases = [
    ["module (A: number) {\n}", "definition name"],
    ["module = M(A: 1)", "instance name"],
    ["module M(A: number\n}", "unclosed parameter list"],
    ["module M(: number) {\n}", "parameter name"],
    ["module M(A number) {\n}", "missing parameter colon"],
    ["module M(A:) {\n}", "missing parameter type"],
    ["module M(A: unknown) {\n}", "unknown parameter type"],
    ["module M(A: choice()) {\n}", "malformed choice"],
    ["module M(A: number =) {\n}", "empty default"],
    ["module M(A: number B: boolean) {\n}", "missing parameter comma"],
    ["module X M(A: number)", "missing instance equals"],
    ["module X = (A: number)", "missing module name"],
    ["module X = M(A: 1", "unclosed argument list"],
    ["module X = M(10)", "argument label"],
    ["module X = M(A:)", "argument value"],
    ["export const x: number = 1", "export target"]
  ] as const;

  for (const [source, label] of diagnosticCases) {
    it(`reports ${label}`, () => {
      expect(errors(`nui 3\n${source}`).length, source).toBeGreaterThan(0);
    });
  }

  it("requires commas for module parameters and arguments in nui 3", () => {
    const parsed = parseDsl([
      "nui 3",
      "module M(A: number B: boolean) {",
      "}",
      "module X = M(A: 1 B: false)"
    ].join("\n"));
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.code === "missing-argument-comma")).toHaveLength(2);
  });

  it("keeps existing supported-version validation unchanged", () => {
    const compiled = compileDslDocument("nui 2\npoint A = coordinate(x: 0, y: 0)");
    expect(compiled.majorVersion).toBeNull();
    expect(compiled.diagnostics.some((diagnostic) => diagnostic.message.includes("未対応のDSLバージョン"))).toBe(true);
  });
});
