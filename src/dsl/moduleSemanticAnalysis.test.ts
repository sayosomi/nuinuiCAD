import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";

const compileWithIds = (source: string) => {
  const parsed = parseDsl(source);
  const assignedStatementIds = new Map(parsed.statements.map((_, index) => [index, `statement:test:${index}`]));
  return compileDslDocument(source, { preparsed: parsed, assignedStatementIds });
};

describe("module semantic analysis", () => {
  it("resolves a callee by StatementIdentity and normalizes argument bindings by parameter order", () => {
    const compiled = compileWithIds([
      "nui 3",
      "point InputPoint = coordinate(x: 0, y: 0)",
      "module M(width: number, anchor: point, label: string = \"ok\") {",
      "  const doubled: number = @width + @width",
      "  export point Output = coordinate(x: @doubled, y: 0)",
      "}",
      "module Instance = M(anchor: InputPoint, width: 10)"
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const analysis = compiled.moduleSemanticAnalysis!;
    expect(analysis.instances[0].callee).toEqual({
      definitionStatementId: "statement:test:2",
      definitionStatementIndex: 2,
      name: "M"
    });
    expect(analysis.instances[0].parameterBindings.map((binding) => [binding.parameterName, binding.argumentIndex])).toEqual([
      ["width", 1],
      ["anchor", 0],
      ["label", null]
    ]);
    expect(analysis.definitions[0].exports[0]).toMatchObject({
      ownerModuleDefinitionStatementId: "statement:test:2",
      exportedStatementId: "statement:test:4",
      category: "point"
    });
    expect(analysis.definitions[0].localScalars[0].initializer?.references[0].target).toEqual({
      kind: "parameter",
      definitionStatementId: "statement:test:2",
      parameterIndex: 0
    });
    expect(analysis.definitions[0].bodyStatements.find((statement) => statement.statementIndex === 4)?.scalarExpressions[0]).toMatchObject({
      parameterKey: "x",
      expression: { type: { kind: "number" } }
    });
  });

  it("keeps definition-site document scalar defaults on the existing binding identity", () => {
    const compiled = compileWithIds([
      "nui 3",
      "const documentWidth: number = 10",
      "module Outer() {",
      "  module Inner(width: number = @documentWidth) {",
      "  }",
      "}"
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const defaultExpression = compiled.moduleSemanticAnalysis?.definitions.find((definition) => definition.name === "Inner")?.parameters[0].defaultExpression;
    expect(defaultExpression?.references[0].target).toEqual({
      kind: "documentBinding",
      bindingId: "binding:statement:test:1",
      statementId: "statement:test:1",
      statementIndex: 1
    });
  });

  it("reports forward/non-module callees and does not fall through a shadowing declaration", () => {
    const forward = compileWithIds(["nui 3", "module Before = Later()", "module Later() {"] .concat(["}"]).join("\n"));
    expect(forward.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "module-forward-callee" })]));

    const shadow = compileWithIds([
      "nui 3",
      "module Target() {",
      "}",
      "module Outer() {",
      "  point Target = coordinate(x: 0, y: 0)",
      "  module Instance = Target()",
      "}"
    ].join("\n"));
    expect(shadow.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "module-callee-not-definition" })]));
  });

  it("rejects geometry defaults, same-call bindings, outer captures, and recursive calls", () => {
    const compiled = compileWithIds([
      "nui 3",
      "const outer: number = 10",
      "module M(value: number, pointValue: point = P) {",
      "  const local: number = @outer",
      "  module Self = M(value: @value, pointValue: P)",
      "  point P = coordinate(x: 0, y: 0)",
      "}",
      "module Use = M(value: @missing, pointValue: P)"
    ].join("\n"));
    const codes = compiled.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toEqual(expect.arrayContaining([
      "module-geometry-default",
      "module-outer-capture",
      "module-undefined-reference",
      "module-forward-geometry-reference",
      "module-recursion"
    ]));
    expect(compiled.moduleSemanticAnalysis?.callEdges[0]).toMatchObject({
      callerModuleDefinitionStatementId: "statement:test:2",
      calleeModuleDefinitionStatementId: "statement:test:2"
    });
  });

  it("keeps forbidden global statements and nested module bodies out of the outer body analysis", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module Outer() {",
      "  color hidden (\"#ff0000\")",
      "  module Inner() {",
      "    const value: number = 1",
      "  }",
      "}",
      "point Root = coordinate(x: 1, y: 1)"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "module-forbidden-body-statement" })]));
    const definitions = compiled.moduleSemanticAnalysis!.definitions;
    expect(definitions.find((definition) => definition.name === "Outer")?.localScalars).toEqual([]);
    expect(definitions.find((definition) => definition.name === "Inner")?.localScalars).toHaveLength(1);
    expect(compiled.document).toBeNull();
  });

  it("resolves source geometry in a module body without creating runtime IDs", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module M(anchor: point) {",
      "  export point Output = offset(from: anchor, dx: 1, dy: 0)",
      "}",
      "module Use = M(anchor: (0, 0))"
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const body = compiled.moduleSemanticAnalysis?.definitions[0].bodyStatements.find((statement) => statement.statementKind === "element");
    expect(body?.geometryReferences[0].reference.target).toEqual({
      kind: "parameter",
      definitionStatementId: "statement:test:1",
      parameterIndex: 0,
      geometryKind: "point"
    });
    expect(body?.geometryReferences[0].reference.target).not.toHaveProperty("elementId");
  });

  it("accepts group and for constructions as module body statements", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module M() {",
      "  group G (printEnabled: true, printAnchor: (0, 0)) {",
      "    for Loop (i, from: 0, count: 3) {",
      "      point P = coordinate(x: i * 10, y: 0)",
      "    }",
      "  }",
      "}"
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });
});
