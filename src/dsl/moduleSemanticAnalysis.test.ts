import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";

const compileWithIds = (source: string) => {
  const parsed = parseDsl(source);
  const assignedStatementIds = new Map(parsed.statements.map((_, index) => [index, `statement:test:${index}`]));
  return compileDslDocument(source, { preparsed: parsed, assignedStatementIds });
};

const moduleBodyAt = (compiled: ReturnType<typeof compileWithIds>, statementIndex: number) =>
  compiled.moduleSemanticAnalysis!.definitions[0].bodyStatements.find((statement) => statement.statementIndex === statementIndex)!;

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
    expect(analysis.definitions[0]).toMatchObject({
      declarationScopeId: "root",
      bodyScopeId: "module:statement:test:2"
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

  it("resolves a visible outer module before a later inner declaration", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module Target() {",
      "}",
      "group G (printEnabled: true) {",
      "  module x = Target()",
      "  module Target() {",
      "  }",
      "}"
    ].join("\n"));
    expect(compiled.moduleSemanticAnalysis?.instances.find((instance) => instance.name === "x")).toMatchObject({
      callee: { definitionStatementId: "statement:test:1", definitionStatementIndex: 1 },
      calleeResolution: "resolved"
    });
  });

  it("stops at a nearest visible wrong-kind declaration", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module Target() {",
      "}",
      "group G (printEnabled: true) {",
      "  point Target = coordinate(x: 0, y: 0)",
      "  module x = Target()",
      "}"
    ].join("\n"));
    expect(compiled.moduleSemanticAnalysis?.instances.find((instance) => instance.name === "x")).toMatchObject({
      callee: null,
      calleeResolution: "notModule"
    });
  });

  it("reports a collision between a parameter and a direct body declaration", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module M(x: number) {",
      "  const x: number = 1",
      "}"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "module-parameter-collision" })]));
  });

  it("allows a child scope declaration to shadow a module parameter", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module M(x: number) {",
      "  group G (printEnabled: true) {",
      "    const x: number = 1",
      "    const y: number = @x",
      "  }",
      "}"
    ].join("\n"));
    const y = compiled.moduleSemanticAnalysis?.definitions[0].localScalars.find((scalar) => scalar.name === "y");
    expect(y?.initializer?.references[0].target).toEqual({
      kind: "moduleLocal",
      statementId: "statement:test:3",
      statementIndex: 3
    });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("extracts an outer scalar capture from vars without runtime lowering", () => {
    const compiled = compileWithIds([
      "nui 3",
      "const outer: number = 10",
      "module M() {",
      "  point P = coordinate(x: 0, y: 0, vars: [width: @outer])",
      "}"
    ].join("\n"));
    const body = moduleBodyAt(compiled, 3);
    expect(body.scalarExpressions.find((site) => site.parameterKey === "vars")?.expression.references[0]).toMatchObject({
      name: "outer",
      resolution: "outerCapture",
      target: null
    });
    expect(compiled.document).toBeNull();
    expect(compiled.statementMap?.elementIdByStatementIndex.has(3) ?? false).toBe(false);
  });

  it("extracts point and scalar captures from intermediates", () => {
    const compiled = compileWithIds([
      "nui 3",
      "point OuterPoint = coordinate(x: 0, y: 0)",
      "const outer: number = 10",
      "module M() {",
      "  curve C = bezier(start: (0, 0), end: (10, 0), intermediates: [OuterPoint: @outer: 20: 20])",
      "}"
    ].join("\n"));
    const body = moduleBodyAt(compiled, 4);
    expect(body.geometryReferences[0].reference).toMatchObject({ target: null });
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-outer-capture" })
    ]));
    expect(body.scalarExpressions.find((site) => site.parameterKey === "intermediates:handleAngleDeg")?.expression.references[0]).toMatchObject({
      name: "outer",
      resolution: "outerCapture"
    });
  });

  it("keeps text template hole references as module semantic targets", () => {
    const compiled = compileWithIds([
      "nui 3",
      "const outer: number = 10",
      "module M() {",
      "  text Label = label(text: \"width {@outer}\", anchor: (0, 0))",
      "}"
    ].join("\n"));
    const body = moduleBodyAt(compiled, 3);
    expect(body.textTemplateHoles[0]?.expression.references[0]).toMatchObject({
      name: "outer",
      resolution: "outerCapture",
      target: null
    });
  });

  it("keeps a geometry parameter property as a source semantic target", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module M(lineA: line) {",
      "  const length: number = @lineA.length",
      "}"
    ].join("\n"));
    const expression = compiled.moduleSemanticAnalysis!.definitions[0].localScalars[0].initializer!;
    expect(expression.geometryProperties[0]).toMatchObject({
      geometryName: "lineA",
      property: "length",
      target: {
        kind: "parameterProperty",
        definitionStatementId: "statement:test:1",
        parameterIndex: 0,
        property: "length"
      },
      resolution: "resolved"
    });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.code === "module-geometry-property-reference")).toEqual([]);
  });

  it("keeps a module local geometry property as a source semantic target", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module M() {",
      "  line A = segment(start: (0, 0), end: (10, 0))",
      "  const length: number = @A.length",
      "}"
    ].join("\n"));
    const expression = compiled.moduleSemanticAnalysis!.definitions[0].localScalars[0].initializer!;
    expect(expression.geometryProperties[0]).toMatchObject({
      target: {
        kind: "sourceGeometryProperty",
        statementId: "statement:test:2",
        statementIndex: 2,
        property: "length"
      },
      resolution: "resolved"
    });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("uses the nearest group-local scalar for a nested module default", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module Outer(x: number) {",
      "  group G (printEnabled: true) {",
      "    const x: number = 20",
      "    module Inner(value: number = @x) {",
      "    }",
      "  }",
      "}"
    ].join("\n"));
    const inner = compiled.moduleSemanticAnalysis!.definitions.find((definition) => definition.name === "Inner")!;
    expect(inner.parameters[0].defaultExpression?.references[0].target).toEqual({
      kind: "moduleLocal",
      statementId: "statement:test:3",
      statementIndex: 3
    });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("uses the nearest for iteration variable for a nested module default", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module Outer(i: number) {",
      "  for Loop (i, from: 0, count: 3) {",
      "    module Inner(value: number = @i) {",
      "    }",
      "  }",
      "}"
    ].join("\n"));
    const inner = compiled.moduleSemanticAnalysis!.definitions.find((definition) => definition.name === "Inner")!;
    expect(inner.parameters[0].defaultExpression?.references[0].target).toEqual({
      kind: "iteration",
      statementId: "statement:test:2",
      statementIndex: 2,
      name: "i"
    });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("does not fall through to an outer binding for an own later or self parameter", () => {
    const compiled = compileWithIds([
      "nui 3",
      "const later: number = 99",
      "module M(first: number = @later, later: number = @later) {",
      "}"
    ].join("\n"));
    const parameters = compiled.moduleSemanticAnalysis!.definitions[0].parameters;
    expect(parameters.map((parameter) => parameter.defaultExpression?.references[0])).toEqual([
      expect.objectContaining({ resolution: "forward", target: null }),
      expect.objectContaining({ resolution: "forward", target: null })
    ]);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.code === "module-default-parameter-order")).toHaveLength(2);
  });

  it("resolves earlier vars entries as element-local variable targets", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module M() {",
      "  point P = coordinate(x: 0, y: 0, vars: [a: 10; b: @a * 2; c: @b + @a])",
      "}"
    ].join("\n"));
    const body = moduleBodyAt(compiled, 2);
    const varSites = body.scalarExpressions.filter((site) => site.parameterKey === "vars");
    expect(varSites[1].expression.references.map((reference) => reference.target)).toEqual([
      { kind: "elementLocalVariable", statementId: "statement:test:2", statementIndex: 2, variableIndex: 0, name: "a" }
    ]);
    expect(varSites[2].expression.references.map((reference) => reference.target)).toEqual([
      { kind: "elementLocalVariable", statementId: "statement:test:2", statementIndex: 2, variableIndex: 1, name: "b" },
      { kind: "elementLocalVariable", statementId: "statement:test:2", statementIndex: 2, variableIndex: 0, name: "a" }
    ]);
  });

  it("rejects vars forward references", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module M() {",
      "  point P = coordinate(x: 0, y: 0, vars: [a: @b; b: 10])",
      "}"
    ].join("\n"));
    const body = moduleBodyAt(compiled, 2);
    expect(body.scalarExpressions.find((site) => site.parameterKey === "vars")?.expression.references[0]).toMatchObject({
      name: "b",
      resolution: "forward",
      target: null
    });
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-element-local-variable-forward" })
    ]));
  });

  it("rejects vars self references", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module M() {",
      "  point P = coordinate(x: 0, y: 0, vars: [a: @a])",
      "}"
    ].join("\n"));
    const body = moduleBodyAt(compiled, 2);
    expect(body.scalarExpressions.find((site) => site.parameterKey === "vars")?.expression.references[0]).toMatchObject({
      name: "a",
      resolution: "forward",
      target: null
    });
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-element-local-variable-forward" })
    ]));
  });

  it("resolves intermediates numeric fields from the same element vars", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module M() {",
      "  curve C = bezier(start: (0, 0), end: (10, 0), vars: [handle: 20], intermediates: [(0, 0): 45: @handle: @handle])",
      "}"
    ].join("\n"));
    const body = moduleBodyAt(compiled, 2);
    const intermediateSites = body.scalarExpressions.filter((site) => site.parameterKey?.startsWith("intermediates:") && site.expression.references.length > 0);
    expect(intermediateSites.map((site) => site.expression.references[0].target)).toEqual([
      { kind: "elementLocalVariable", statementId: "statement:test:2", statementIndex: 2, variableIndex: 0, name: "handle" },
      { kind: "elementLocalVariable", statementId: "statement:test:2", statementIndex: 2, variableIndex: 0, name: "handle" }
    ]);
  });

  it("does not leak an element-local variable to another statement", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module M() {",
      "  point P = coordinate(x: 0, y: 0, vars: [width: 10])",
      "  point Q = coordinate(x: @width, y: 0)",
      "}"
    ].join("\n"));
    const body = moduleBodyAt(compiled, 3);
    expect(body.scalarExpressions[0].expression.references[0]).toMatchObject({
      name: "width",
      resolution: "undefined",
      target: null
    });
  });

  it("keeps outer capture errors distinct from element-local vars", () => {
    const compiled = compileWithIds([
      "nui 3",
      "const width: number = 10",
      "module M() {",
      "  point P = coordinate(x: 0, y: 0, vars: [local: @width])",
      "}"
    ].join("\n"));
    const body = moduleBodyAt(compiled, 3);
    expect(body.scalarExpressions.find((site) => site.parameterKey === "vars")?.expression.references[0]).toMatchObject({
      name: "width",
      resolution: "outerCapture",
      target: null
    });
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-outer-capture" })
    ]));
  });

  it("keeps element-local variable targets source-only", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module M() {",
      "  point P = coordinate(x: 0, y: 0, vars: [a: 10; b: @a])",
      "}"
    ].join("\n"));
    const body = moduleBodyAt(compiled, 2);
    const site = body.scalarExpressions.find((candidate) => candidate.parameterKey === "vars" && candidate.expression.references.length > 0)!;
    const target = site.expression.references[0].target!;
    expect(target).toMatchObject({ kind: "elementLocalVariable", variableIndex: 0, name: "a" });
    expect(target).not.toHaveProperty("bindingId");
    expect(target).not.toHaveProperty("elementId");
  });

  it("does not create runtime CadElements or runtime IDs for module body statements", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module M() {",
      "  point P = coordinate(x: 0, y: 0)",
      "  const value: number = 1",
      "  module Child() {",
      "  }",
      "}"
    ].join("\n"));
    const moduleDefinition = compiled.moduleSemanticAnalysis!.definitions[0];
    expect(compiled.document?.elements).toEqual([]);
    for (const statementId of moduleDefinition.bodyStatementIds) {
      expect(statementId).toMatch(/^statement:/);
      expect([...compiled.statementMap?.elementIdByStatementIndex.values() ?? []]).not.toContain(statementId);
    }
    expect(moduleDefinition.bodyStatements.flatMap((statement) => [statement.scalarTarget, ...statement.geometryReferences.map((site) => site.reference.target)])
      .filter((target): target is NonNullable<typeof target> => Boolean(target))
      .every((target) => !("bindingId" in target) && !("elementId" in target))).toBe(true);
  });
});
