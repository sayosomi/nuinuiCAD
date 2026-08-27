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
  it("requires optional scalar presence proof and narrows a guarded branch", () => {
    const unguarded = compileWithIds([
      "nui 4",
      "module M(value?: number) {",
      "  const copy: number = @value",
      "}",
      "instance Use = M()"
    ].join("\n"));
    expect(unguarded.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-optional-value-required" })
    ]));

    const guarded = compileWithIds([
      "nui 4",
      "module M(value?: number) {",
      "  if (hasValue(@value)) {",
      "    const copy: number = @value",
      "  } else {",
      "    const fallback: number = 0",
      "  }",
      "}",
      "instance Use = M()"
    ].join("\n"));
    expect(guarded.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(guarded.moduleSemanticAnalysis!.definitions[0].bodyStatements.find((statement) => statement.statementIndex === 3)?.presenceParameterKeys).toEqual(["statement:test:1:0"]);
  });

  it("supports hasValue flow for boolean operators without leaking facts", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(value?: number) {",
      "  if (hasValue(@value) and @value > 0) {",
      "    const okay: number = @value",
      "  }",
      "  if (hasValue(@value) or true) {",
      "    const notOkay: number = @value",
      "  }",
      "}",
      "instance Use = M()"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-optional-value-required" })
    ]));
    expect(compiled.moduleSemanticAnalysis!.definitions[0].bodyStatements.find((statement) => statement.statementIndex === 3)?.presenceParameterKeys).toEqual(["statement:test:1:0"]);
    expect(compiled.moduleSemanticAnalysis!.definitions[0].bodyStatements.find((statement) => statement.statementIndex === 6)?.presenceParameterKeys).toEqual([]);
  });

  it("does not narrow an unsafe compound AND false branch", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(value?: number) {",
      "  if (not hasValue(@value) and false) {",
      "  } else {",
      "    const bad: number = @value",
      "  }",
      "}",
      "instance Use = M()"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-optional-value-required" })
    ]));
  });

  it("keeps direct negated hasValue guards narrowing the else branch", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(value?: number) {",
      "  if (not hasValue(@value)) {",
      "  } else {",
      "    const okay: number = @value",
      "  }",
      "}",
      "instance Use = M()"
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("keeps OR RHS short-circuit presence proof and rejects the unsafe direction", () => {
    const valid = compileWithIds([
      "nui 4",
      "module M(value?: number) {",
      "  if (not hasValue(@value) or @value > 0) {",
      "  }",
      "}",
      "instance Use = M()"
    ].join("\n"));
    expect(valid.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const invalid = compileWithIds([
      "nui 4",
      "module M(value?: number) {",
      "  if (hasValue(@value) or @value > 0) {",
      "  }",
      "}",
      "instance Use = M()"
    ].join("\n"));
    expect(invalid.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-optional-value-required" })
    ]));
  });

  it("keeps AND RHS short-circuit presence proof valid", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(value?: number) {",
      "  if (hasValue(@value) and @value > 0) {",
      "  }",
      "}",
      "instance Use = M()"
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("retains a presence fact shared by every compound OR true path", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(value?: number) {",
      "  if (hasValue(@value) or hasValue(@value)) {",
      "    const okay: number = @value",
      "  }",
      "}",
      "instance Use = M()"
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("requires presence when forwarding an optional value to another module", () => {
    const guarded = compileWithIds([
      "nui 4",
      "module Inner(value?: number) {",
      "}",
      "module Outer(value?: number) {",
      "  if (hasValue(@value)) {",
      "    instance child = Inner(value: @value)",
      "  }",
      "}",
      "instance Use = Outer()"
    ].join("\n"));
    expect(guarded.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const unguarded = compileWithIds([
      "nui 4",
      "module Inner(value?: number) {",
      "}",
      "module Outer(value?: number) {",
      "  instance child = Inner(value: @value)",
      "}",
      "instance Use = Outer()"
    ].join("\n"));
    expect(unguarded.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-optional-value-required" })
    ]));
  });

  it("applies the same proof rule to optional geometry properties", () => {
    const compiled = compileWithIds([
      "nui 4",
      "point Input = coordinate(x: 3, y: 4)",
      "module M(anchor?: point) {",
      "  if (hasValue(@anchor)) {",
      "    const x: number = @anchor.x",
      "  }",
      "}",
      "instance Use = M()"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const invalid = compileWithIds([
      "nui 4",
      "module M(anchor?: point) {",
      "  const x: number = @anchor.x",
      "}",
      "instance Use = M()"
    ].join("\n"));
    expect(invalid.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-optional-value-required" })
    ]));
  });

  it("allows hasValue in boolean defaults while rejecting direct optional default reads", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(value?: number, flag: boolean = hasValue(@value)) {",
      "}",
      "instance Use = M()"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.moduleSemanticAnalysis!.definitions[0].parameters[1].defaultExpression).toMatchObject({
      type: { kind: "boolean" },
      hasValueParameters: [{ parameterIndex: 0 }]
    });

    const invalid = compileWithIds([
      "nui 4",
      "module M(value?: number, flag: boolean = @value) {",
      "}",
      "instance Use = M()"
    ].join("\n"));
    expect(invalid.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-optional-value-required" })
    ]));
  });

  it("records required, defaulted, and optional argument states in parameter order", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(required: number, fallback: number = 2, optional?: number) {",
      "}",
      "instance Use = M(required: 1)"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.moduleSemanticAnalysis!.instances[0].parameterBindings.map((binding) => [binding.parameterName, binding.state, binding.usesDefault])).toEqual([
      ["required", "requiredSupplied", false],
      ["fallback", "defaultedOmitted", true],
      ["optional", "optionalOmitted", false]
    ]);
  });

  it("keeps module geometry builtin operands separate from scalar references", () => {
    const compiled = compileWithIds([
      "nui 4",
      "point P = coordinate(x: 3, y: 4)",
      "point O = coordinate(x: 0, y: 0)",
      "line Baseline = segment(start: (0, 0), end: (1, 0))",
      "module Example(p: point, origin: point, baseline: line) {",
      "  const radius: number = distance(@origin, @p)",
      "  const direction: number = angle(@origin, @p)",
      "  const height: number = lineDistance(@p, @baseline)",
      "}",
      "instance Use = Example(p: @P, origin: @O, baseline: @Baseline)"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const definition = compiled.moduleSemanticAnalysis!.definitions.find((candidate) => candidate.name === "Example")!;
    for (const [name, expected] of [["radius", ["point", "point"]], ["direction", ["point", "point"]], ["height", ["point", "line"]]] as const) {
      const expression = definition.localScalars.find((scalar) => scalar.name === name)!.initializer!;
      expect(expression.type).toEqual({ kind: "number" });
      expect(expression.references).toEqual([]);
      expect(expression.geometryBuiltinArguments.map((occurrence) => occurrence.expectedGeometryType)).toEqual(expected);
      expect(expression.geometryBuiltinArguments.every((occurrence) => occurrence.reference.target !== null)).toBe(true);
    }
  });

  it("typechecks derived point geometry builtin operands", () => {
    const compiled = compileWithIds([
      "nui 4",
      "line Baseline = segment(start: (0, 0), end: (10, 0))",
      "point P = coordinate(x: 3, y: 4)",
      "module Example(baseline: line, p: point, delta: number) {",
      "  point Q = coordinate(x: distance(@baseline.start, @p) + @delta, y: 0)",
      "}",
      "instance Use = Example(baseline: @Baseline, p: @P, delta: 2)"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const expression = moduleBodyAt(compiled, 4).scalarExpressions.find((site) => site.parameterKey === "x")!.expression;
    expect(expression.type).toEqual({ kind: "number" });
    expect(expression.geometryBuiltinArguments[0]).toMatchObject({
      expectedGeometryType: "point",
      reference: { target: { kind: "parameter", pointKey: "start" } }
    });
  });

  it("resolves builtin calls through the shared scalar frontend and preserves their argument references", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(a: number, b: number) {",
      "  const value: number = max(@a, @b)",
      "  const check: boolean = isClose(@value, 10, 0.5)",
      "}",
      "instance Use = M(a: 1, b: 2)"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const definition = compiled.moduleSemanticAnalysis!.definitions[0];
    expect(definition.localScalars.find((scalar) => scalar.name === "value")?.initializer).toMatchObject({
      type: { kind: "number" },
      references: [{ name: "a" }, { name: "b" }]
    });
    expect(definition.localScalars.find((scalar) => scalar.name === "check")?.initializer).toMatchObject({
      type: { kind: "boolean" },
      references: [{ name: "value" }]
    });
  });

  it("keeps unknown and arity diagnostics distinct in the module frontend", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M() {",
      "  const unknown: number = unknownFunction(1)",
      "  const wrong: number = abs()",
      "}",
      "instance Use = M()"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-unknown-function" }),
      expect.objectContaining({ code: "module-function-arity-mismatch" })
    ]));
  });

  it("uses the common scalar parser for named syntax and remaps call-style diagnostics", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(a: number, b: number) {",
      "  const wrong: number = atan2(y: max(@a, 1), x: @b)",
      "}",
      "instance Use = M(a: 1, b: 2)"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-function-call-style-mismatch" })
    ]));
    const initializer = compiled.moduleSemanticAnalysis!.definitions[0].localScalars.find((scalar) => scalar.name === "wrong")?.initializer;
    expect(initializer).toMatchObject({
      type: null,
      references: [{ name: "a" }, { name: "b" }]
    });
  });

  it("uses the shared scalar frontend for nui4 word operators in a Module body", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(a: boolean, b: boolean) {",
      "  const both: boolean = @a and not @b",
      "}",
      "instance Instance = M(a: true, b: false)"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const both = compiled.moduleSemanticAnalysis!.definitions[0].localScalars.find((scalar) => scalar.name === "both");
    expect(both?.initializer).toMatchObject({
      type: { kind: "boolean" },
      references: [
        { name: "a", target: { kind: "parameter" } },
        { name: "b", target: { kind: "parameter" } }
      ]
    });
  });

  it("resolves a callee by StatementIdentity and normalizes argument bindings by parameter order", () => {
    const compiled = compileWithIds([
      "nui 4",
      "point InputPoint = coordinate(x: 0, y: 0)",
      "module M(width: number, anchor: point, label: string = \"ok\") {",
      "  const doubled: number = @width + @width",
      "  export point Output = coordinate(x: @doubled, y: 0)",
      "}",
      "instance Instance = M(anchor: @InputPoint, width: 10)"
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

  it("registers exported typed declarations in the shared module member namespace", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M() {",
      "  const privateValue: number = 1",
      "  export const result: number = @privateValue + 1",
      "  export let state: number = @result + 1",
      "}"
    ].join("\n"));
    const definition = compiled.moduleSemanticAnalysis!.definitions[0];

    expect(definition.localScalars.map((local) => local.name)).toEqual(["privateValue", "result", "state"]);
    expect(definition.exports).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "scalar", name: "result", exportedStatementIndex: 3, declaredType: { kind: "number" }, bindingKind: "const" }),
      expect.objectContaining({ kind: "scalar", name: "state", exportedStatementIndex: 4, declaredType: { kind: "number" }, bindingKind: "let" })
    ]));
    expect(definition.exports.some((entry) => entry.name === "privateValue")).toBe(false);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("checks scalar and geometry exports together for duplicate public member names", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M() {",
      "  export const Output: number = 1",
      "  export point Output = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "source-namespace-collision" })
    ]));
  });

  it("keeps definition-site document scalar defaults on the existing binding identity", () => {
    const compiled = compileWithIds([
      "nui 4",
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
    const forward = compileWithIds(["nui 4", "instance Before = Later()", "module Later() {"] .concat(["}"]).join("\n"));
    expect(forward.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "module-forward-callee" })]));

    const shadow = compileWithIds([
      "nui 4",
      "module Target() {",
      "}",
      "module Outer() {",
      "  point Target = coordinate(x: 0, y: 0)",
      "  instance Instance = Target()",
      "}"
    ].join("\n"));
    expect(shadow.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "module-callee-not-definition" })]));
  });

  it("rejects geometry defaults, same-call bindings, outer captures, and recursive calls", () => {
    const compiled = compileWithIds([
      "nui 4",
      "const outer: number = 10",
      "module M(value: number, pointValue: point = @P) {",
      "  const local: number = @outer",
      "  instance Self = M(value: @value, pointValue: @P)",
      "  point P = coordinate(x: 0, y: 0)",
      "}",
      "instance Use = M(value: @missing, pointValue: @P)"
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
      "nui 4",
      "module Outer() {",
      '  role hidden (name: "hidden")',
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
      "nui 4",
      "module M(anchor: point) {",
      "  export point Output = offset(from: @anchor, dx: 1, dy: 0)",
      "}",
      "instance Use = M(anchor: (0, 0))"
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
      "nui 4",
      "module M() {",
      "  group G (roles: [seam]) {",
      "    for i in range(from: 0, count: 3) {",
      "      point P = coordinate(x: i * 10, y: 0)",
      "    }",
      "  }",
      "}"
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("resolves a visible outer module before a later inner declaration", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module Target() {",
      "}",
      "group G {",
      "  instance x = Target()",
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
      "nui 4",
      "module Target() {",
      "}",
      "group G {",
      "  point Target = coordinate(x: 0, y: 0)",
      "  instance x = Target()",
      "}"
    ].join("\n"));
    expect(compiled.moduleSemanticAnalysis?.instances.find((instance) => instance.name === "x")).toMatchObject({
      callee: null,
      calleeResolution: "notModule"
    });
  });

  it("reports a collision between a parameter and a direct body declaration", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(x: number) {",
      "  const x: number = 1",
      "}"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "module-parameter-collision" })]));
  });

  it("allows a child scope declaration to shadow a module parameter", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(x: number) {",
      "  group G {",
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

  it("extracts point and scalar captures from intermediates", () => {
    const compiled = compileWithIds([
      "nui 4",
      "point OuterPoint = coordinate(x: 0, y: 0)",
      "const outer: number = 10",
      "module M() {",
      "  curve C = bezier(start: (0, 0), end: (10, 0), intermediates: [@OuterPoint: @outer: 20: 20])",
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
      "nui 4",
      "const outer: number = 10",
      "module M() {",
      "  text Label = label(text: \"width ${@outer}\", anchor: (0, 0))",
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
      "nui 4",
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
      "nui 4",
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

  it("carries the concrete source geometry choice type through module scalar semantics", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M() {",
      "  arc A = arc(center: (0, 0), radius: 40, start: 15, end: 155, direction: clockwise)",
      "  const direction: choice(counterclockwise, clockwise) = @A.direction",
      "}"
    ].join("\n"));
    const expression = compiled.moduleSemanticAnalysis!.definitions[0].localScalars[0].initializer!;
    expect(expression.type).toEqual({ kind: "choice", options: ["counterclockwise", "clockwise"] });
    expect(expression.geometryProperties[0]).toMatchObject({
      property: "direction",
      type: { kind: "choice", options: ["counterclockwise", "clockwise"] },
      target: { kind: "sourceGeometryProperty", category: "arc" },
      resolution: "resolved"
    });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("does not infer a concrete choice subtype for a generic module geometry parameter", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(base: line) {",
      "  const side: choice(right, left) = @base.side",
      "}"
    ].join("\n"));
    const expression = compiled.moduleSemanticAnalysis!.definitions[0].localScalars[0].initializer!;
    expect(expression.geometryProperties[0]).toMatchObject({ property: "side", type: null, resolution: "invalid" });
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-unknown-geometry-property" })
    ]));
  });

  it("uses the nearest group-local scalar for a nested module default", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module Outer(x: number) {",
      "  group G {",
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
      "nui 4",
      "module Outer(i: number) {",
      "  for i in range(from: 0, count: 3) {",
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
      "nui 4",
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

  it("keeps coordinate point components as scalar semantic expressions", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(dx: number, base: line) {",
      "  line A = segment(start: (@dx, 0), end: (0, 0))",
      "  point B = offset(from: @base.start, dx: 10, dy: 0)",
      "  line Local = segment(start: (0, 0), end: (10, 0))",
      "  point C = offset(from: @Local.end, dx: 10, dy: 0)",
      "}"
    ].join("\n"));
    const a = moduleBodyAt(compiled, 2);
    const b = moduleBodyAt(compiled, 3);
    const c = moduleBodyAt(compiled, 5);
    expect(a.geometryReferences[0].reference.coordinate?.x?.references[0].target).toEqual({
      kind: "parameter",
      definitionStatementId: "statement:test:1",
      parameterIndex: 0
    });
    expect(a.geometryReferences[0].reference.role).toBe("coordinatePoint");
    expect(a.geometryReferences[0].reference.coordinate?.y?.type).toEqual({ kind: "number" });
    expect(b.geometryReferences[0].reference.target).toEqual({
      kind: "parameter",
      definitionStatementId: "statement:test:1",
      parameterIndex: 1,
      geometryKind: "line",
      pointKey: "start"
    });
    expect(b.geometryReferences[0].reference.role).toBe("derivedPoint");
    expect(c.geometryReferences[0].reference.target).toEqual({
      kind: "sourceGeometry",
      statementId: "statement:test:4",
      statementIndex: 4,
      category: "line",
      geometryKind: "line",
      pointKey: "end"
    });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("projects ordinary root geometry references by StatementIdentity without starting Module runtime", () => {
    const compiled = compileWithIds([
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: @A, dx: 1, dy: 0)"
    ].join("\n"));
    const reference = compiled.sourceSemanticAnalysis!.rootGeometryReferencesByStatementId
      .get("statement:test:2")?.[0].reference;

    expect(compiled.sourceSemanticAnalysis!.definitions).toEqual([]);
    expect(compiled.moduleMaterialization).toBeUndefined();
    expect(reference).toMatchObject({
      resolution: "resolved",
      target: {
        kind: "sourceGeometry",
        statementId: "statement:test:1"
      }
    });
  });

  it("projects root parent references by source container StatementIdentity", () => {
    const source = [
      "nui 4",
      "group Front {",
      "}",
      "point Child = coordinate(x: 0, y: 0, parent: @Front)"
    ].join("\n");
    const compiled = compileWithIds(source);
    const reference = compiled.sourceSemanticAnalysis!.rootParentReferencesByStatementId
      .get("statement:test:3")?.reference;

    expect(compiled.sourceSemanticAnalysis!.definitions).toEqual([]);
    expect(compiled.moduleMaterialization).toBeUndefined();
    expect(reference).toMatchObject({
      source: "@Front",
      resolution: "resolved",
      target: {
        kind: "sourceContainer",
        statementId: "statement:test:1",
        statementIndex: 1,
        containerKind: "group"
      }
    });
    expect(reference?.nameSpan).toEqual({ start: 46, end: 51 });
  });

  it("projects root group, conditional, and for parent references without materialization", () => {
    const source = [
      "nui 4",
      "group Outer {",
      "}",
      "group Inner (parent: @Outer) {",
      "}",
      "if (true, parent: @Outer) {",
      "}",
      "for i in range(from: 0, count: 1, parent: @Outer) {",
      "}"
    ].join("\n");
    const compiled = compileWithIds(source);
    const analysis = compiled.sourceSemanticAnalysis!;
    const groupReference = analysis.rootParentReferencesByStatementId.get("statement:test:3")?.reference;
    const conditionalReference = analysis.rootParentReferencesByStatementId.get("statement:test:5")?.reference;
    const forReference = analysis.rootParentReferencesByStatementId.get("statement:test:7")?.reference;

    expect(compiled.moduleMaterialization).toBeUndefined();
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    for (const reference of [groupReference, conditionalReference, forReference]) {
      expect(reference).toMatchObject({
        source: "@Outer",
        resolution: "resolved",
        target: {
          kind: "sourceContainer",
          statementId: "statement:test:1",
          statementIndex: 1,
          containerKind: "group"
        }
      });
    }

  });

  it("does not duplicate ordinary root geometry diagnostics in the source projection", () => {
    const compiled = compileWithIds([
      "nui 4",
      "point B = offset(from: @Missing, dx: 1, dy: 0)"
    ].join("\n"));
    const missing = compiled.diagnostics.filter((diagnostic) => diagnostic.message.includes("@Missing"));
    const reference = compiled.sourceSemanticAnalysis!.rootGeometryReferencesByStatementId
      .get("statement:test:1")?.[0].reference;

    expect(missing).toHaveLength(1);
    expect(reference).toMatchObject({ resolution: "undefined", target: null });
  });

  it("honors allowCoordinate and preserves allowNone behavior from parameter definitions", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(dx: number) {",
      "  point Rejected = offset(from: (@dx, 0), dx: 5, dy: 5)",
      "  line Allowed = segment(start: (@dx, 0), end: (0, 0))",
      "  text Label = label(text: \"ok\", anchor: none, size: 3)",
      "}"
    ].join("\n"));
    const rejected = moduleBodyAt(compiled, 2).geometryReferences[0].reference;
    const allowed = moduleBodyAt(compiled, 3).geometryReferences[0].reference;
    expect(rejected.coordinate).toBeNull();
    expect(rejected.resolution).toBe("invalid");
    expect(allowed.role).toBe("coordinatePoint");
    expect(allowed.coordinate?.x?.references[0].target).toEqual({
      kind: "parameter",
      definitionStatementId: "statement:test:1",
      parameterIndex: 0
    });
    expect(moduleBodyAt(compiled, 4).geometryReferences[0].reference.resolution).toBe("resolved");
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-geometry-type-mismatch" })
    ]));
  });

  it("distinguishes point, line endpoint, plain line, and derived point references", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(lineParam: line, pointParam: point) {",
      "  line Local = segment(start: (0, 0), end: (10, 0))",
      "  arc Arc = arc(center: (0, 0), radius: 10, start: 0, end: 90)",
      "  point FromLine = offset(from: @Local.start, dx: 1, dy: 0)",
      "  point FromArc = offset(from: @Arc.center, dx: 1, dy: 0)",
      "  point Endpoint = onLine(from: @Local.end, distance: 1)",
      "  point ParameterEndpoint = onLine(from: @lineParam.end, distance: 1)",
      "  line Plain = offset(sources: @Local, distance: 1)",
      "  point InvalidPointAccessor = offset(from: @pointParam.start, dx: 1, dy: 0)",
      "  point UnknownAccessor = offset(from: @Local.foo, dx: 1, dy: 0)",
      "}"
    ].join("\n"));
    expect(moduleBodyAt(compiled, 4).geometryReferences[0].reference).toMatchObject({ role: "derivedPoint", resolution: "resolved", target: { kind: "sourceGeometry", pointKey: "start" } });
    expect(moduleBodyAt(compiled, 5).geometryReferences[0].reference).toMatchObject({ role: "derivedPoint", resolution: "resolved", target: { kind: "sourceGeometry", category: "arc", pointKey: "center" } });
    expect(moduleBodyAt(compiled, 6).geometryReferences[0].reference).toMatchObject({ role: "lineEndpointReference", resolution: "resolved", target: { kind: "sourceGeometry", pointKey: "end" } });
    expect(moduleBodyAt(compiled, 7).geometryReferences[0].reference).toMatchObject({ role: "lineEndpointReference", resolution: "resolved", target: { kind: "parameter", pointKey: "end" } });
    expect(moduleBodyAt(compiled, 8).geometryReferences[0].reference).toMatchObject({ role: "lineReferenceList", resolution: "resolved", target: { kind: "sourceGeometry" } });
    expect(moduleBodyAt(compiled, 9).geometryReferences[0].reference.resolution).toBe("invalid");
    expect(moduleBodyAt(compiled, 10).geometryReferences[0].reference.resolution).toBe("invalid");
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-geometry-type-mismatch" })
    ]));
  });

  it("rejects known derived accessors that are invalid for the source geometry category", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M() {",
      "  line L = segment(start: (0, 0), end: (10, 0))",
      "  point P = coordinate(x: 0, y: 0)",
      "  point InvalidLineCenter = offset(from: @L.center, dx: 1, dy: 0)",
      "  point InvalidPointStart = offset(from: @P.start, dx: 1, dy: 0)",
      "}"
    ].join("\n"));
    expect(moduleBodyAt(compiled, 4).geometryReferences[0].reference).toMatchObject({ resolution: "invalid", target: null });
    expect(moduleBodyAt(compiled, 5).geometryReferences[0].reference).toMatchObject({ resolution: "invalid", target: null });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.code === "module-geometry-type-mismatch")).toHaveLength(2);
  });

  it("rejects a line passed to a point position and preserves outer geometry capture", () => {
    const compiled = compileWithIds([
      "nui 4",
      "line Outer = segment(start: (0, 0), end: (10, 0))",
      "module M(base: line) {",
      "  point A = offset(from: @base, dx: 10, dy: 0)",
      "  point B = offset(from: @Outer.start, dx: 10, dy: 0)",
      "}"
    ].join("\n"));
    const body = compiled.moduleSemanticAnalysis!.definitions[0].bodyStatements;
    expect(body.find((statement) => statement.statementIndex === 3)?.geometryReferences[0].reference.resolution).toBe("invalid");
    expect(body.find((statement) => statement.statementIndex === 4)?.geometryReferences[0].reference).toMatchObject({
      resolution: "outerCapture",
      target: null
    });
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-geometry-type-mismatch" }),
      expect.objectContaining({ code: "module-outer-capture" })
    ]));
  });

  it("uses the canonical numeric geometry property vocabulary for parameter and source geometry", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(p: point, l: line) {",
      "  const x: number = @p.x",
      "  const y: number = @p.y",
      "  const len: number = @l.length",
      "  const sx: number = @l.startPoint.x",
      "  line Local = segment(start: (0, 0), end: (10, 0))",
      "  const localLength: number = @Local.length",
      "}"
    ].join("\n"));
    const locals = compiled.moduleSemanticAnalysis!.definitions[0].localScalars;
    expect(locals.map((local) => local.initializer?.geometryProperties[0]?.target?.kind)).toEqual([
      "parameterProperty",
      "parameterProperty",
      "parameterProperty",
      "parameterProperty",
      "sourceGeometryProperty"
    ]);
    expect(locals[3].initializer?.geometryProperties[0]).toMatchObject({ property: "startPoint.x", resolution: "resolved" });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("defers qualified module export geometry references with source identity and spans", () => {
    const source = [
      "nui 4",
      "module Child() {",
      "}",
      "module M() {",
      "  instance SomeInstance = Child()",
      "  point P = offset(from: @SomeInstance::Output, dx: 10, dy: 0)",
      "  const length: number = @SomeInstance::Output.length",
      "}"
    ].join("\n");
    const compiled = compileWithIds(source);
    const module = compiled.moduleSemanticAnalysis!.definitions.find((definition) => definition.name === "M")!;
    const body = module.bodyStatements.find((statement) => statement.statementIndex === 5)!;
    const geometry = body.geometryReferences[0].reference;
    expect(geometry).toMatchObject({ expectedGeometryKind: "point", resolution: "deferred" });
    expect(geometry.target).toMatchObject({
      kind: "deferredModuleExport",
      instanceStatementId: "statement:test:4",
      instanceStatementIndex: 4,
      instanceName: "SomeInstance",
      exportName: "Output",
      expectedGeometryKind: "point"
    });
    expect(geometry.target?.kind === "deferredModuleExport" && source.split("\n")[5].trimStart().slice(geometry.target.memberSpan.start, geometry.target.memberSpan.end)).toBe("Output");
    const expression = module.localScalars[0].initializer!;
    expect(expression.geometryProperties[0]).toMatchObject({
      property: "length",
      resolution: "deferred",
      target: {
        kind: "deferredModuleExportProperty",
        instanceStatementId: "statement:test:4",
        exportName: "Output",
        property: "length"
      }
    });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("carries a choice type through a qualified exported concrete geometry", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module Child() {",
      "  export arc Output = arc(center: (0, 0), radius: 40, start: 15, end: 155, direction: clockwise)",
      "}",
      "module M() {",
      "  instance SomeInstance = Child()",
      "  const direction: choice(counterclockwise, clockwise) = @SomeInstance::Output.direction",
      "}"
    ].join("\n"));
    const module = compiled.moduleSemanticAnalysis!.definitions.find((definition) => definition.name === "M")!;
    const expression = module.localScalars[0].initializer!;
    expect(expression.type).toEqual({ kind: "choice", options: ["counterclockwise", "clockwise"] });
    expect(expression.geometryProperties[0]).toMatchObject({
      property: "direction",
      type: { kind: "choice", options: ["counterclockwise", "clockwise"] },
      resolution: "deferred",
      target: { kind: "deferredModuleExportProperty", exportName: "Output" }
    });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("keeps qualified export derived accessors in the deferred source target", () => {
    const source = [
      "nui 4",
      "module Child() {",
      "}",
      "module M() {",
      "  instance SomeInstance = Child()",
      "  point P = offset(from: @SomeInstance::Output.start, dx: 10, dy: 0)",
      "}"
    ].join("\n");
    const compiled = compileWithIds(source);
    const reference = compiled.moduleSemanticAnalysis!.definitions.find((definition) => definition.name === "M")!.bodyStatements.find((statement) => statement.statementIndex === 5)!.geometryReferences[0].reference;
    expect(reference).toMatchObject({ role: "derivedPoint", resolution: "deferred", target: {
      kind: "deferredModuleExport",
      instanceStatementId: "statement:test:4",
      exportName: "Output",
      expectedGeometryKind: "point",
      pointKey: "start"
    } });
    expect(reference.target).not.toHaveProperty("elementId");
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("keeps text and image geometry properties source-semantic without a fake geometry kind", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M() {",
      "  text T = label(text: \"ok\", anchor: (0, 0), size: 3)",
      "  image I = image(source: \"image.png\", origin: (0, 0))",
      "  const size: number = @T.fontSize",
      "  const width: number = @I.widthMm",
      "}"
    ].join("\n"));
    const locals = compiled.moduleSemanticAnalysis!.definitions[0].localScalars;
    expect(locals[0].initializer?.geometryProperties[0]).toMatchObject({
      property: "fontSize",
      target: { kind: "sourceGeometryProperty", category: "text", property: "fontSize" },
      resolution: "resolved"
    });
    expect(locals[1].initializer?.geometryProperties[0]).toMatchObject({
      property: "widthMm",
      target: { kind: "sourceGeometryProperty", category: "image", property: "widthMm" },
      resolution: "resolved"
    });
    expect(locals[0].initializer?.geometryProperties[0].target).not.toHaveProperty("geometryKind");
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("defers qualified export properties without guessing the exported geometry category", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module Child() {",
      "}",
      "module M() {",
      "  instance SomeInstance = Child()",
      "  const size: number = @SomeInstance::TextExport.fontSize",
      "}"
    ].join("\n"));
    const property = compiled.moduleSemanticAnalysis!.definitions.find((definition) => definition.name === "M")!.localScalars[0].initializer!.geometryProperties[0];
    expect(property).toMatchObject({
      property: "fontSize",
      resolution: "deferred",
      target: {
        kind: "deferredModuleExportProperty",
        instanceStatementId: "statement:test:4",
        exportName: "TextExport",
        property: "fontSize"
      }
    });
    expect(property.target).not.toHaveProperty("expectedGeometryKind");
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("applies the module owner boundary to qualified export geometry and properties", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module Base() {",
      "  export line L = segment(start: (0, 0), end: (10, 0))",
      "}",
      "instance Outside = Base()",
      "module M() {",
      "  line X = offset(sources: @Outside::L, distance: 1)",
      "  const length: number = @Outside::L.length",
      "  instance A = Base()",
      "  line Y = offset(sources: @A::L, distance: 1)",
      "}"
    ].join("\n"));
    const definition = compiled.moduleSemanticAnalysis!.definitions.find((candidate) => candidate.name === "M")!;
    expect(definition.bodyStatements.find((statement) => statement.statementIndex === 6)?.geometryReferences[0].reference.resolution).toBe("outerCapture");
    expect(definition.localScalars[0].initializer?.geometryProperties[0].resolution).toBe("outerCapture");
    expect(definition.bodyStatements.find((statement) => statement.statementIndex === 9)?.geometryReferences[0].reference).toMatchObject({ resolution: "deferred", target: { instanceName: "A" } });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-outer-capture" })
    ]));
  });

  it("reports undefined, forward, and wrong-kind qualified module export instances", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module Child() {",
      "}",
      "module M() {",
      "  point Missing = offset(from: @MissingInstance::Output, dx: 0, dy: 0)",
      "  point Forward = offset(from: @LaterInstance::Output, dx: 0, dy: 0)",
      "  const Wrong: number = 1",
      "  point WrongKind = offset(from: @Wrong::Output, dx: 0, dy: 0)",
      "  instance LaterInstance = Child()",
      "}"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-undefined-instance-reference" }),
      expect.objectContaining({ code: "module-forward-instance-reference" }),
      expect.objectContaining({ code: "module-geometry-type-mismatch" })
    ]));
  });

  it("resolves ordinary qualified source paths for module scalar and geometry consumers", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M() {",
      "  group G {",
      "    const X: number = 1",
      "    point P = coordinate(x: 0, y: 0)",
      "  }",
      "  const value: number = @G::X",
      "  point Use = offset(from: @G::P, dx: 0, dy: 0)",
      "}"
    ].join("\n"));
    const definition = compiled.moduleSemanticAnalysis!.definitions[0];
    const value = definition.localScalars.find((scalar) => scalar.name === "value");
    expect(value?.initializer?.references[0]).toMatchObject({
      name: "G::X",
      target: { kind: "moduleLocal", statementId: "statement:test:3", statementIndex: 3 },
      resolution: "resolved"
    });
    expect(moduleBodyAt(compiled, 7).geometryReferences[0].reference).toMatchObject({
      source: "@G::P",
      target: { kind: "sourceGeometry", statementId: "statement:test:4", statementIndex: 4 },
      resolution: "resolved"
    });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("does not fall through an overlaid module parameter during qualified traversal", () => {
    const compiled = compileWithIds([
      "nui 4",
      "group G {",
      "  point P = coordinate(x: 0, y: 0)",
      "}",
      "module M(G: point) {",
      "  point Use = offset(from: @G::P, dx: 0, dy: 0)",
      "}"
    ].join("\n"));
    const reference = moduleBodyAt(compiled, 5).geometryReferences[0].reference;

    expect(reference).toMatchObject({ resolution: "invalid", target: null });
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-geometry-type-mismatch" })
    ]));
    expect(compiled.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-outer-capture" })
    ]));
  });

  it("keeps qualified module paths fail-closed across scalar and geometry kinds", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M() {",
      "  group G {",
      "    const X: number = 1",
      "    point P = coordinate(x: 0, y: 0)",
      "  }",
      "  const scalarFromGeometry: number = @G::P",
      "  point geometryFromScalar = offset(from: @G::X, dx: 0, dy: 0)",
      "}"
    ].join("\n"));
    const definition = compiled.moduleSemanticAnalysis!.definitions[0];
    expect(definition.localScalars.find((scalar) => scalar.name === "scalarFromGeometry")?.initializer?.references[0]).toMatchObject({
      name: "G::P",
      target: { kind: "sourceGeometry", statementId: "statement:test:4", statementIndex: 4 },
      resolution: "invalid"
    });
    expect(moduleBodyAt(compiled, 7).geometryReferences[0].reference).toMatchObject({
      source: "@G::X",
      target: null,
      resolution: "invalid"
    });
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-geometry-reference-in-scalar" }),
      expect.objectContaining({ code: "module-geometry-type-mismatch" })
    ]));
  });

  it("does not traverse through an iteration overlay that shadows a qualified path", () => {
    const compiled = compileWithIds([
      "nui 4",
      "group G {",
      "  point P = coordinate(x: 0, y: 0)",
      "}",
      "module M() {",
      "  for G in range(from: 0, count: 1) {",
      "    point Use = offset(from: @G::P, dx: 0, dy: 0)",
      "  }",
      "}"
    ].join("\n"));
    const reference = moduleBodyAt(compiled, 6).geometryReferences[0].reference;

    expect(reference).toMatchObject({ resolution: "invalid", target: null });
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-geometry-type-mismatch" })
    ]));
    expect(compiled.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-outer-capture" })
    ]));
  });

  it("reports a qualified path first-segment forward reference without outer fallback", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M() {",
      "  point Use = offset(from: @G::P, dx: 0, dy: 0)",
      "  group G {",
      "    point P = coordinate(x: 0, y: 0)",
      "  }",
      "}"
    ].join("\n"));
    const reference = moduleBodyAt(compiled, 2).geometryReferences[0].reference;

    expect(reference).toMatchObject({ resolution: "forward", target: null });
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-forward-geometry-reference" })
    ]));
    expect(compiled.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-undefined-geometry-reference" }),
      expect.objectContaining({ code: "module-outer-capture" })
    ]));
  });

  it("reports a qualified path nested-member forward after resolving its local container", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M() {",
      "  group G {",
      "    point Use = offset(from: @G::P, dx: 0, dy: 0)",
      "    point P = coordinate(x: 0, y: 0)",
      "  }",
      "}"
    ].join("\n"));
    const reference = moduleBodyAt(compiled, 3).geometryReferences[0].reference;

    expect(reference).toMatchObject({ resolution: "forward", target: null });
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-forward-geometry-reference" })
    ]));
    expect(compiled.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-undefined-geometry-reference" })
    ]));
  });

  it("rejects an ordinary qualified path that captures an outer module geometry", () => {
    const compiled = compileWithIds([
      "nui 4",
      "group G {",
      "  point P = coordinate(x: 0, y: 0)",
      "}",
      "module M() {",
      "  point Use = offset(from: @G::P, dx: 0, dy: 0)",
      "}"
    ].join("\n"));
    const reference = moduleBodyAt(compiled, 5).geometryReferences[0].reference;

    expect(reference).toMatchObject({ resolution: "outerCapture", target: null });
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-outer-capture" })
    ]));
  });

  it("resolves a module scalar qualified geometry property through the source namespace", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M() {",
      "  group G {",
      "    line L = segment(start: (0, 0), end: (10, 0))",
      "  }",
      "  const length: number = @G::L.length",
      "}"
    ].join("\n"));
    const property = compiled.moduleSemanticAnalysis!.definitions[0].localScalars[0].initializer!.geometryProperties[0];

    expect(property).toMatchObject({
      geometryName: "G::L",
      property: "length",
      target: {
        kind: "sourceGeometryProperty",
        statementId: "statement:test:3",
        statementIndex: 3,
        property: "length"
      },
      resolution: "resolved"
    });
    expect(property.target).not.toHaveProperty("kind", "deferredModuleExportProperty");
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("does not create runtime CadElements or runtime IDs for module body statements", () => {
    const compiled = compileWithIds([
      "nui 4",
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
