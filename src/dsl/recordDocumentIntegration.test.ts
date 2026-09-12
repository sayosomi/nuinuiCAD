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

  it("validates generalized immutable record fields and composes nested geometry members", () => {
    const compiled = compile([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "line AB = segment(start: (0, 0), end: (10, 0))",
      "record Metadata(label: string)",
      "record Piece(outline: path, points: point[], tags: string[], related: Metadata[], metadata: Metadata)",
      'const piece: Piece = Piece(outline: @AB, points: [@A], tags: ["body"], related: [Metadata(label: "related")], metadata: Metadata(label: "body"))',
      "const length: number = @piece.outline.length",
      "const startX: number = @piece.outline.startPoint.x",
      "const firstX: number = @piece.points[0].x",
      "const label: string = @piece.metadata.label"
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const value = compiled.moduleSemanticAnalysis?.rootRecordValuesByStatementId.get("stable-5");
    expect(value?.fields.map((field) => [field.fieldName, field.valueExpression?.kind])).toEqual([
      ["outline", "geometry"],
      ["points", "collection"],
      ["tags", "collection"],
      ["related", "collection"],
      ["metadata", "record"]
    ]);
    expect(compiled.moduleSemanticAnalysis?.rootScalarExpressionsByStatementId.size).toBeGreaterThan(0);
  });

  it("reports generalized record constructor mismatches at their authored fields", () => {
    const compiled = compile([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "line AB = segment(start: (0, 0), end: (10, 0))",
      "record Metadata(label: string)",
      "record Other(label: string)",
      "record Piece(edge: line, points: point[], metadata: Metadata)",
      'const broken: Piece = Piece(edge: @A, points: [@AB], metadata: Other(label: "wrong"))'
    ].join("\n"));

    const codes = compiled.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain("module-geometry-type-mismatch");
    expect(codes).toContain("array-member-geometry-mismatch");
    expect(codes).toContain("module-record-reference-invalid");
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error").every((diagnostic) => diagnostic.physicalSpan)).toBe(true);
  });

  it("keeps record Module parameters in the shared semantic model", () => {
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
    expect(compiled.moduleSemanticAnalysis?.definitionsByStatementId.get("stable-2")?.parameters[0]).toMatchObject({
      name: "input",
      recordTypeIdentity: "stable-1"
    });
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

  it("supports optional nominal-record results for omitted-else if and optional match", () => {
    const compiled = compile([
      "nui 1",
      "record Pair(x: number)",
      "const note: string? = \"present\"",
      "const fallback: Pair = Pair(x: 0)",
      "const maybe: Pair? = if (false) { Pair(x: 1) }",
      "const selected: Pair? = match @note { none => none some value => @fallback }"
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.sourceLexicalNamespace?.recordSemanticAnalysis?.valuesByStatementId.get("stable-4")?.valueExpression?.kind).toBe("if");
    expect(compiled.sourceLexicalNamespace?.recordSemanticAnalysis?.valuesByStatementId.get("stable-5")?.valueExpression?.kind).toBe("match");
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

  it("emits one shared-shell diagnostic per root record control-flow error", () => {
    const compileRecord = (initializer: string, extra: readonly string[] = []) => compile([
      "nui 1",
      "record Pair(x: number, label: string)",
      ...extra,
      `const broken: Pair = ${initializer}`
    ].join("\n"));
    const count = (initializer: string, code: string, extra: readonly string[] = []) =>
      compileRecord(initializer, extra).diagnostics.filter((diagnostic) => diagnostic.code === code).length;

    expect(count("if (1) { Pair(x: 1, label: \"a\") } else { Pair(x: 2, label: \"b\") }", "scalar-type-mismatch")).toBe(1);
    expect(count("match @side { left => Pair(x: 1, label: \"a\") }", "missing-match-case", ["const side: choice(left, right) = left"])).toBe(1);
    expect(count("match @side { left => Pair(x: 1, label: \"a\") left => Pair(x: 2, label: \"b\") right => Pair(x: 3, label: \"c\") }", "duplicate-match-case", ["const side: choice(left, right) = left"])).toBe(1);
    expect(count("match @side { left => Pair(x: 1, label: \"a\") right => Pair(x: 2, label: \"b\") other => Pair(x: 3, label: \"c\") }", "impossible-match-case", ["const side: choice(left, right) = left"])).toBe(1);
    expect(count("match 1 { left => Pair(x: 1, label: \"a\") right => Pair(x: 2, label: \"b\") }", "non-choice-match-scrutinee")).toBe(1);
    expect(count("if (if (1) { true } else { false }) { Pair(x: 1, label: \"a\") } else { Pair(x: 2, label: \"b\") }", "scalar-type-mismatch")).toBe(1);
    expect(count("if (true) { match @side { left => Pair(x: 1, label: \"a\") } } else { Pair(x: 2, label: \"b\") }", "missing-match-case", ["const side: choice(left, right) = left"])).toBe(1);
  });

  it("assigns shared-shell ownership to the first projected field", () => {
    const compiled = compile([
      "nui 1",
      "record Pair(x: number, label: string)",
      'const broken: Pair = if (1) { Pair(label: "left") } else { Pair(x: 2, label: "right") }'
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.code === "record-constructor-missing-field")).toHaveLength(1);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.code === "scalar-type-mismatch")).toHaveLength(1);
  });

  it("keeps field-specific errors in projected record branches", () => {
    const compiled = compile([
      "nui 1",
      "record Pair(x: number, label: string)",
      'const broken: Pair = if (1) { Pair(x: 1, label: 2) } else { Pair(x: 2, label: "fallback") }'
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.code === "scalar-type-mismatch")).toHaveLength(2);
  });
});
