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
      "nui 4",
      "module 凸ノッチ(凸ノッチ高さ: number, 縫い線: line, 縫い代線: path, ノッチ位置: point, 反転: boolean = false, 種別: choice(通常, 反転) = 通常) {",
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
      { kind: "moduleParameter", name: "縫い代線", type: { kind: "path" }, defaultValue: null },
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
      "nui 4",
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

  it("parses path as a real geometry interface and keeps geometry defaults invalid", () => {
    const parsed = parseDsl([
      "nui 4",
      "module M(straight: line, broad: path = @Line) {",
      "}"
    ].join("\n"));
    expect(parsed.statements[1]).toMatchObject({
      kind: "moduleDefinition",
      parameters: [
        { name: "straight", type: { kind: "line" } },
        { name: "broad", type: { kind: "path" }, defaultValue: "@Line" }
      ]
    });
    expect(parsed.diagnostics).toEqual([]);
    const compiled = compileDslDocument([
      "nui 4",
      "module M(straight: line, broad: path = @Line) {",
      "}"
    ].join("\n"), {
      preparsed: parsed,
      assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `statement:path:${index}`]))
    });
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-geometry-default" })
    ]));
  });

  it("keeps module parameter and argument physical spans on multiline source", () => {
    const source = [
      "nui 4",
      "module M(",
      "  A: number = @幅 * 2,",
      "  B: line",
      ") {",
      "}",
      "instance X = M(",
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
    const source = "nui 4\ninstance ノッチ = 凸ノッチ(凸ノッチ高さ: @高さ, 縫い線: 縫い線, 縫い代線: 縫い代線, ノッチ位置: ノッチ位置, 反転: false)";
    const parsed = parseDsl(source);
    expect(parsed.diagnostics).toEqual([]);
    const instance = parsed.statements[1];
    expect(instance).toMatchObject({ kind: "moduleInstance", name: "ノッチ", moduleName: "凸ノッチ" });
    if (instance.kind !== "moduleInstance") return;
    expect(instance.options).toEqual([]);
    expect(instance.arguments.map((argument) => [argument.label, argument.value])).toEqual([
      ["凸ノッチ高さ", "@高さ"],
      ["縫い線", "縫い線"],
      ["縫い代線", "縫い代線"],
      ["ノッチ位置", "ノッチ位置"],
      ["反転", "false"]
    ]);
  });

  it("parses the nui4 instance keyword into the existing module instance AST", () => {
    const parsed = parseDsl([
      "nui 4",
      "module M(base: point, seam: number) {",
      "}",
      "instance foo = M(base: @A, seam: @seam,)",
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements[3]).toMatchObject({
      kind: "moduleInstance",
      name: "foo",
      moduleName: "M",
      keywordSpan: { start: 0, end: "instance".length }
    });
    if (parsed.statements[3].kind !== "moduleInstance") return;
    expect(parsed.statements[3].arguments.map((argument) => [argument.label, argument.value])).toEqual([
      ["base", "@A"],
      ["seam", "@seam"]
    ]);
  });

  it.each(["visible", "hidden", "disabled"] as const)("parses nui4 instance state option: %s", (state) => {
    const parsed = parseDsl(`nui 4\ninstance foo(state: ${state}) = M(value: 1)`);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements[1]).toMatchObject({
      kind: "moduleInstance",
      options: [{ name: "state", value: state }],
      arguments: [{ label: "value", value: "1" }]
    });
  });

  it.each(["visible", "hidden", "disabled"] as const)("parses module instance state option: %s", (state) => {
    const parsed = parseDsl(`nui 4\ninstance X(state: ${state}) = M(state: true)`);
    expect(parsed.diagnostics).toEqual([]);
    const instance = parsed.statements[1];
    expect(instance).toMatchObject({ kind: "moduleInstance", name: "X", moduleName: "M" });
    if (instance.kind !== "moduleInstance") return;
    const logicalText = `instance X(state: ${state}) = M(state: true)`;
    expect(instance.options).toMatchObject([
      { kind: "moduleInstanceOption", name: "state", value: state }
    ]);
    expect(instance.arguments).toMatchObject([
      { kind: "moduleArgument", label: "state", value: "true" }
    ]);
    expect(instance.payloadSpans.options).toBeDefined();
    expect(instance.payloadSpans.arguments).toBeDefined();
    expect(logicalText.slice(instance.payloadSpans.options!.start, instance.payloadSpans.options!.end)).toBe(`state: ${state}`);
    expect(logicalText.slice(instance.payloadSpans.arguments!.start, instance.payloadSpans.arguments!.end)).toBe("state: true");
  });

  it("mentions path in invalid Module parameter type guidance", () => {
    const diagnostic = errors("nui 4\nmodule M(input: unknown) {\n}").find((item) => item.message.includes("unknown"));
    expect(diagnostic?.message).toContain("point/line/path");
  });

  it("keeps a module parameter named state separate from the instance option", () => {
    const parsed = parseDsl([
      "nui 4",
      "module M(state: boolean) {",
      "}",
      "instance X(state: hidden) = M(state: true)"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements[1]).toMatchObject({
      kind: "moduleDefinition",
      parameters: [{ name: "state", type: { kind: "boolean" } }]
    });
    expect(parsed.statements[3]).toMatchObject({
      kind: "moduleInstance",
      options: [{ name: "state", value: "hidden" }],
      arguments: [{ label: "state", value: "true" }]
    });
  });

  it("parses multiline instance options and projects logical and physical spans", () => {
    const source = [
      "nui 4",
      "instance X(",
      "  state: hidden",
      ") = M(",
      "  state: true",
      ")"
    ].join("\n");
    const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 31 });
    expect(parsed.diagnostics).toEqual([]);
    const instance = parsed.statements[1];
    expect(instance.kind).toBe("moduleInstance");
    if (instance.kind !== "moduleInstance") return;
    const option = instance.options[0];
    expect(option.nameSpan).not.toBeNull();
    expect(option.valueSpan.start).toBeLessThan(option.valueSpan.end);
    expect(source.slice(
      option.namePhysicalSpan!.segments[0].from,
      option.namePhysicalSpan!.segments[0].to
    )).toBe("state");
    expect(source.slice(
      option.valuePhysicalSpan!.segments[0].from,
      option.valuePhysicalSpan!.segments[0].to
    )).toBe("hidden");
    expect(instance.payloadSpans.options).toBeDefined();
    expect(instance.payloadPhysicalSpans?.options?.segments.map((segment) => source.slice(segment.from, segment.to)).join(""))
      .toContain("state: hidden");
    expect(instance.payloadPhysicalSpans?.arguments?.segments.map((segment) => source.slice(segment.from, segment.to)).join(""))
      .toContain("state: true");
    expect(option.namePhysicalSpan?.sourceRevision).toBe(31);
  });

  it("marks exported geometry without changing its geometry AST", () => {
    const source = "nui 4\nexport line 先に縫う = copy(baseLines: [AB], startPoint: A, endPoint: B)";
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
  type DiagnosticCase = {
    source: string;
    label: string;
    message: string;
    code?: string;
    spanText: string;
  };
  const diagnosticCases: DiagnosticCase[] = [
    { source: "module (A: number) {\n}", label: "definition name", message: "module definition には名前が必要です。", spanText: "module" },
    { source: "instance = M(A: 1)", label: "instance name", message: "module instance にはインスタンス名が必要です。", spanText: "instance" },
    { source: "module M(A: number\n}", label: "unclosed parameter list", message: "module parameter list の「(」が閉じられていません。", spanText: "(" },
    { source: "module M(: number) {\n}", label: "parameter name", message: "module parameter は `名前: 型` の形式で指定してください。", spanText: ": number" },
    { source: "module M(A number) {\n}", label: "missing parameter colon", message: "module parameter は `名前: 型` の形式で指定してください。", spanText: "A number" },
    { source: "module M(A:) {\n}", label: "missing parameter type", message: "module parameter には型注釈が必要です。", spanText: "" },
    { source: "module M(A: unknown) {\n}", label: "unknown parameter type", message: "不明な型注釈です: unknown", spanText: "unknown" },
    { source: "module M(A: choice()) {\n}", label: "malformed choice", message: "choice 型には少なくとも1つの option が必要です。", spanText: "()" },
    { source: "module M(A: number =) {\n}", label: "empty default", message: "module parameter の default には `=` の後に値が必要です。", spanText: "" },
    { source: "module M(A: number B: boolean) {\n}", label: "missing parameter comma", message: "引数「B」の前に「,」が必要です。", code: "missing-argument-comma", spanText: "B" },
    { source: "instance X M(A: number)", label: "missing instance equals", message: "module instance には「=」が必要です。", code: "missing-module-instance-equals", spanText: "instance" },
    { source: "instance X = (A: number)", label: "missing module name", message: "module instance には呼び出すmodule名が必要です。", spanText: "" },
    { source: "instance X = M(A: 1", label: "unclosed argument list", message: "module argument list の「(」が閉じられていません。", spanText: "(" },
    { source: "instance X = M(10)", label: "argument label", message: "module argument は名前付き引数で指定してください。", spanText: "10" },
    { source: "instance X = M(A:)", label: "argument value", message: "引数「A」の値がありません。", code: "missing-attribute-value", spanText: "" },
    { source: "instance X(state: nope) = M()", label: "nui4 invalid instance state", message: "state は visible/hidden/disabled のいずれかで指定してください。", spanText: "nope" },
    { source: "instance X(foo: hidden) = M()", label: "nui4 invalid instance option", message: "module instance option「foo」", spanText: "foo" },
  ] as const;

  for (const testCase of diagnosticCases) {
    it(`reports ${testCase.label} with its own span`, () => {
      const fullSource = `nui 4\n${testCase.source}`;
      const diagnostic = errors(fullSource).find((item) =>
        item.message.includes(testCase.message) && (!testCase.code || item.code === testCase.code)
      );
      expect(diagnostic, testCase.source).toBeDefined();
      if (!diagnostic) return;
      if ("spanText" in testCase) {
        const segments = diagnostic.physicalSpan?.segments ?? [];
        if (testCase.spanText === "") {
          expect(diagnostic.physicalSpan).toBeDefined();
          expect(segments).toEqual([]);
        } else {
          expect(segments).toHaveLength(1);
          expect(fullSource.slice(segments[0].from, segments[0].to)).toBe(testCase.spanText);
        }
      }
    });
  }

  it("requires commas for module parameters and arguments in nui 4", () => {
    const parsed = parseDsl([
      "nui 4",
      "module M(A: number B: boolean) {",
      "}",
      "instance X = M(A: 1 B: false)"
    ].join("\n"));
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.code === "missing-argument-comma")).toHaveLength(2);
  });

  it("applies named-only, duplicate, unknown, and state-literal validation to instance options", () => {
    const cases = [
      {
        source: "instance X(hidden) = M()",
        message: "module instance option は名前付き引数で指定してください。"
      },
      {
        source: "instance X(foo: hidden) = M()",
        message: "module instance option「foo」"
      },
      {
        source: "instance X(state: nope) = M()",
        message: "state は visible/hidden/disabled のいずれかで指定してください。"
      },
      {
        source: "instance X(state:) = M()",
        message: "引数「state」の値がありません。"
      },
      {
        source: "instance X(state: hidden, state: visible) = M()",
        message: "引数「state」が重複しています。"
      }
    ] as const;

    for (const testCase of cases) {
      const diagnostic = errors(`nui 4\n${testCase.source}`).find((item) => item.message.includes(testCase.message));
      expect(diagnostic, testCase.source).toBeDefined();
    }
  });

  it("requires commas between instance options", () => {
    const parsed = parseDsl("nui 4\ninstance X(state: hidden foo: visible) = M()");
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.code === "missing-argument-comma")).toHaveLength(1);
  });

  it("accepts export as a modifier on a typed scalar declaration", () => {
    const source = "nui 4\nexport const length: number = 1";
    const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 9 });
    expect(parsed.diagnostics).toEqual([]);
    const statement = parsed.statements[1];
    expect(statement).toMatchObject({
      kind: "typedDeclaration",
      name: "length",
      declaredType: { kind: "number" },
      initializer: "1",
      exported: true,
      exportSpan: { start: 0, end: 6 }
    });
    if (statement.kind !== "typedDeclaration") return;
    expect(source.slice(statement.exportPhysicalSpan!.segments[0].from, statement.exportPhysicalSpan!.segments[0].to)).toBe("export");
  });

  it("projects a multiline malformed diagnostic to the exact physical token", () => {
    const source = [
      "nui 4",
      "module M(",
      "  A: number",
      "  B: boolean",
      ") {",
      "}"
    ].join("\n");
    const diagnostic = errors(source).find((item) => item.code === "missing-argument-comma");
    expect(diagnostic).toBeDefined();
    const segments = diagnostic?.physicalSpan?.segments ?? [];
    expect(segments).toHaveLength(1);
    expect(source.slice(segments[0].from, segments[0].to)).toBe("B");
  });

  it("keeps existing supported-version validation unchanged", () => {
    const compiled = compileDslDocument("nui 2\npoint A = coordinate(x: 0, y: 0)");
    expect(compiled.majorVersion).toBeNull();
    expect(compiled.diagnostics.some((diagnostic) => diagnostic.message.includes("未対応のDSLバージョン"))).toBe(true);
  });
});
