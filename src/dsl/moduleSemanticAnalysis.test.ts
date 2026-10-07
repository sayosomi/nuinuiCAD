import { describe, expect, it } from "vitest";
import { compileDslDocument } from "@nuinuicad/nui-language";
import { parseDsl } from "@nuinuicad/nui-language";

const compileWithIds = (source: string) => {
  const parsed = parseDsl(source);
  const assignedStatementIds = new Map(parsed.statements.map((_, index) => [index, `statement:test:${index}`]));
  return compileDslDocument(source, { preparsed: parsed, assignedStatementIds });
};

const moduleBodyAt = (compiled: ReturnType<typeof compileWithIds>, statementIndex: number) =>
  compiled.moduleSemanticAnalysis!.definitions[0].bodyStatements.find((statement) => statement.statementIndex === statementIndex)!;

describe("module semantic analysis", () => {
  it("rejects construction-valued declarations in root and Module control flow", () => {
    const rootCases = [
      ["if (true) {", "  const P: point = coordinate(x: 1, y: 2)", "}"],
      ["if (false) {", "} else {", "  const P: point = coordinate(x: 1, y: 2)", "}"],
      ["for i in range(min: 0, max: 1, step: 1) {", "  const P: point = coordinate(x: 1, y: 2)", "}"],
    ];
    for (const body of rootCases) {
      const compiled = compileWithIds(["nui 1", ...body].join("\n"));
      expect(compiled.diagnostics.filter((diagnostic) => diagnostic.code === "geometry-value-construction-control-flow-unsupported")).toHaveLength(1);
      expect(compiled.moduleSemanticAnalysis?.geometryValues.every((value) => value.construction === null)).toBe(true);
    }

    const moduleCases = [
      ["if (true) {", "    const P: point = coordinate(x: 1, y: 2)", "  }"],
      ["if (false) {", "  } else {", "    const P: point = coordinate(x: 1, y: 2)", "  }"],
      ["for i in range(min: 0, max: 1, step: 1) {", "    const P: point = coordinate(x: 1, y: 2)", "  }"],
    ];
    for (const body of moduleCases) {
      const compiled = compileWithIds([
        "nui 1",
        "module M(source: point) {",
        ...body,
        "}",
        "instance Use = M(source: (0, 0))"
      ].join("\n"));
      expect(compiled.diagnostics.filter((diagnostic) => diagnostic.code === "geometry-value-construction-control-flow-unsupported")).toHaveLength(1);
      expect(compiled.moduleSemanticAnalysis?.geometryValues.every((value) => value.construction === null)).toBe(true);
    }
  });

  it("keeps reference-valued aliases valid in equivalent control scopes", () => {
    const root = compileWithIds([
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "if (true) {",
      "  const Alias: point = @Base",
      "}"
    ].join("\n"));
    expect(root.diagnostics).toEqual([]);

    const module = compileWithIds([
      "nui 1",
      "module M(source: point) {",
      "  if (true) {",
      "    const Alias: point = @source",
      "  }",
      "}",
      "instance Use = M(source: (0, 0))"
    ].join("\n"));
    expect(module.diagnostics).toEqual([]);
  });

  it("selects compatible overloads for pure offset and polar constructions", () => {
    const pointOffset = compileWithIds([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "const P: point = offset(from: @A, dx: 1, dy: 2)"
    ].join("\n"));
    expect(pointOffset.diagnostics).toEqual([]);

    const pathOffset = compileWithIds([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line L = segment(start: @A, end: @B)",
      "const P: path = offset(sources: [@L], distance: 1, side: right)"
    ].join("\n"));
    expect(pathOffset.diagnostics).toEqual([]);

    const linePolar = compileWithIds([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "const L: line = polar(start: @A, angle: 0, length: 10)"
    ].join("\n"));
    expect(linePolar.diagnostics).toEqual([]);
  });

  it("uses the general optional value model in Module bodies", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module M(value: number?) {",
      "  const fallback: number = @value ?? 4",
      "  const matched: number = match @value { none => 0 some present => @present }",
      "}",
      "instance Use = M()"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.moduleSemanticAnalysis!.definitions[0].bodyStatements
      .filter((statement) => statement.scalarExpressions.length > 0)
      .flatMap((statement) => statement.scalarExpressions.map((site) => site.expression.type?.kind)))
      .toEqual(expect.arrayContaining(["number"]));
  });

  it("rejects direct use of an unresolved optional Module value", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module M(value: number?) {",
      "  const copy: number = @value",
      "}",
      "instance Use = M()"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-scalar-type-mismatch" })
    ]));
  });

  it("keeps indexed optional record field diagnostics on their existing owners", () => {
    const compiled = compileWithIds([
      "nui 1",
      "record R(x: number?)",
      "const first: R = R(x: 7)",
      "module Select(items: R[]) {",
      "  const selected: R = @items[0]",
      "  const required: number = @selected.x",
      "  const unknown: number = @selected.missing",
      "}",
      "instance Use = Select(items: [@first])"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-scalar-type-mismatch" }),
      expect.objectContaining({ code: "module-record-field-unknown" })
    ]));
  });

  it("resolves Module collection carry indexes and lengths through their lexical carry identity", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module M() {",
      "  for i in range(min: 0, max: 0, step: 1) carry items: number[] = [1] {",
      "    next items = @items",
      "  }",
      "  export const selected: number = @items[0]",
      "  export const itemCount: number = @items.length",
      "}",
      "instance Use = M()"
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const definition = compiled.moduleSemanticAnalysis!.definitions.find((candidate) => candidate.name === "M")!;
    const carryValueId = "carry-collection:binding:statement:test:2:carry:0:items";
    const selected = definition.localScalars.find((candidate) => candidate.name === "selected")!.initializer!;
    const itemCount = definition.localScalars.find((candidate) => candidate.name === "itemCount")!.initializer!;
    expect(selected.references[0]).toMatchObject({
      name: "items",
      resolution: "resolved",
      target: {
        kind: "collectionValue",
        statementId: "statement:test:2:carry:0:items",
        statementIndex: 2,
        valueType: { kind: "array", elementType: { kind: "number" } }
      },
      collectionValueId: carryValueId,
      collectionLength: null,
      targetSourceOrder: -1,
      collectionElementType: { kind: "number" }
    });
    expect(itemCount.geometryProperties[0]).toMatchObject({
      property: "length",
      resolution: "resolved",
      target: {
        kind: "collectionValueLength",
        statementId: "statement:test:2:carry:0:items",
        valueId: carryValueId,
        valueType: { kind: "array", elementType: { kind: "number" } },
        length: null
      }
    });
  });

  it("preserves undefined, forward, wrong-type, and outer-capture collection diagnostics", () => {
    const cases = [
      {
        source: [
          "nui 1",
          "module M() {",
          "  const selected: number = @missing[0]",
          "}",
          "instance Use = M()"
        ].join("\n"),
        code: "module-undefined-reference"
      },
      {
        source: [
          "nui 1",
          "module M() {",
          "  const selected: number = @later[0]",
          "  for i in range(min: 0, max: 0, step: 1) carry later: number[] = [1] {",
          "    next later = @later",
          "  }",
          "}",
          "instance Use = M()"
        ].join("\n"),
        code: "module-forward-reference"
      },
      {
        source: [
          "nui 1",
          "module M() {",
          "  for i in range(min: 0, max: 0, step: 1) carry value: number = 1 {",
          "    next value = @i",
          "  }",
          "  const selected: number = @value[0]",
          "}",
          "instance Use = M()"
        ].join("\n"),
        code: "module-collection-index-type"
      },
      {
        source: [
          "nui 1",
          "const values: number[] = [1]",
          "module M() {",
          "  const selected: number = @values[0]",
          "}",
          "instance Use = M()"
        ].join("\n"),
        code: "module-outer-capture"
      }
    ];

    for (const testCase of cases) {
      const compiled = compileWithIds(testCase.source);
      expect(compiled.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: testCase.code, severity: "error" })
      ]));
    }
  });

  it("preserves authored optional scalar types while analyzing Module carries", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module M(seed: number?) {",
      "  for i in range(min: 0, max: 0, step: 1) carry empty: number? = none carry present: number? = 7 carry alias: number? = @seed {",
      "    next empty = @i",
      "    next present = none",
      "    next alias = @i",
      "  }",
      "}",
      "instance Use = M(seed: 8)"
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const carries = compiled.moduleSemanticAnalysis!.definitions.find((definition) => definition.name === "M")!.immutableCarries!;
    const optionalNumber = { kind: "optional", valueType: { kind: "number" } };
    expect(carries).toHaveLength(3);
    for (const carry of carries) {
      expect(carry.valueType).toEqual(optionalNumber);
      expect(carry.type).toEqual(optionalNumber);
    }
    expect(carries.map((carry) => [carry.name, carry.initializer?.type, carry.next?.type])).toEqual([
      ["empty", optionalNumber, { kind: "number" }],
      ["present", { kind: "number" }, optionalNumber],
      ["alias", optionalNumber, { kind: "number" }]
    ]);
  });

  it("rejects optional geometry carry initialization at the required geometry boundary", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module M(seed: point?) {",
      "  for i in range(min: 0, max: 0, step: 1) carry cursor: point? = none {",
      "    next cursor = @seed",
      "  }",
      "}",
      "instance Use = M()"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "optional-value-required" })
    ]));
    const carries = compiled.moduleSemanticAnalysis!.definitions.find((definition) => definition.name === "M")!.immutableCarries ?? [];
    expect(carries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "cursor" })
    ]));
  });

  it("does not implicitly unwrap an optional Module carry for a required scalar", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module M() {",
      "  for i in range(min: 0, max: 0, step: 1) carry maybe: number? = none {",
      "    next maybe = @i",
      "  }",
      "  const required: number = @maybe",
      "}",
      "instance Use = M()"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-scalar-type-mismatch" })
    ]));
    expect(compiled.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "none-requires-optional-type" })
    ]));
  });

  it("rejects hasValue instead of creating a Module presence proof", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module M(value: number?) {",
      "  const flag: boolean = hasValue(@value)",
      "}",
      "instance Use = M()"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-unknown-function" })
    ]));
  });

  it("uses optional member access for geometry Module values", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module M(anchor: point?) {",
      "  const x: number = @anchor?.x ?? 0",
      "}",
      "instance Use = M()"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("records required, defaulted, and optional argument states in parameter order", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module M(required: number, fallback: number = 2, optional: number?) {",
      "}",
      "instance Use = M(required: 1)"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.moduleSemanticAnalysis!.instances[0].parameterBindings.map((binding) => [binding.parameterName, binding.state, binding.usesDefault])).toEqual([
      ["required", "supplied", false],
      ["fallback", "defaulted", true],
      ["optional", "omitted", false]
    ]);
  });

  it("resolves exact nominal record arguments, shorthand, inline constructors, and nested exports", () => {
    const compiled = compileWithIds([
      "nui 1",
      "record Pair(x: number, label: string)",
      "record Other(x: number, label: string)",
      "const settings: Pair = Pair(x: 3, label: \"root\")",
      "const wrong: Other = Other(x: 8, label: \"wrong\")",
      "module Inner(settings: Pair) {",
      "  const copy: Pair = @settings",
      "  const x: number = @settings.x",
      "  export const output: Pair = @copy",
      "}",
      "module Outer(settings: Pair) {",
      "  const local: Pair = Pair(x: 4, label: \"local\")",
      "  instance child = Inner(settings: @local)",
      "  export const output: Pair = @child::output",
      "}",
      "module WrongOuter(settings: Other) {",
      "  instance bad = Inner(@settings)",
      "}",
      "instance Root = Inner(@settings)",
      "instance Inline = Inner(settings: Pair(x: 5, label: \"inline\"))",
      "instance Parent = Outer(settings: @settings)",
      "instance Wrong = WrongOuter(@wrong)"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-record-reference-invalid" })
    ]));
    expect(compiled.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "scalar-type-mismatch" }),
      expect.objectContaining({ code: "module-record-value-in-scalar" })
    ]));

    const recordType = compiled.sourceLexicalNamespace?.recordSemanticAnalysis?.moduleParameters.find((parameter) =>
      parameter.name === "settings"
    );
    expect(recordType?.typeIdentity).toBe("statement:test:1");

    const analysis = compiled.moduleSemanticAnalysis!;
    const instanceByName = new Map(analysis.instances.map((instance) => [instance.name, instance]));
    expect(analysis.definitions.find((definition) => definition.name === "Inner")?.parameters[0]?.recordTypeIdentity).toBe("statement:test:1");
    expect(analysis.definitions.find((definition) => definition.name === "WrongOuter")?.parameters[0]?.recordTypeIdentity).toBe("statement:test:2");
    expect(analysis.definitions.find((definition) => definition.name === "Inner")?.parameters[0]?.recordTypeIdentity).not.toBe(
      analysis.definitions.find((definition) => definition.name === "WrongOuter")?.parameters[0]?.recordTypeIdentity
    );
    for (const name of ["Root", "Inline", "Parent"]) {
      expect(instanceByName.get(name)?.parameterBindings[0]?.state).toBe("supplied");
    }
    expect(instanceByName.get("Wrong")?.parameterBindings[0]?.state).toBe("omitted");
    expect(instanceByName.get("bad")?.parameterBindings[0]?.value).toMatchObject({
      kind: "record",
      reference: { resolution: "invalid", typeIdentity: null }
    });
    expect(instanceByName.get("Root")?.parameterBindings[0]?.value).toMatchObject({
      kind: "record",
      reference: { resolution: "resolved", typeIdentity: "statement:test:1", target: { kind: "recordValue" } }
    });
    expect(instanceByName.get("Inline")?.parameterBindings[0]?.value).toMatchObject({
      kind: "record",
      reference: { resolution: "resolved", typeIdentity: "statement:test:1", constructor: { targetTypeIdentity: "statement:test:1" } }
    });

    const outer = analysis.definitions.find((definition) => definition.name === "Outer")!;
    expect(outer.recordValues.find((value) => value.value.name === "local")?.target).toMatchObject({ kind: "recordValue" });
    expect(outer.recordValues.find((value) => value.value.name === "output")?.target).toMatchObject({ kind: "deferredModuleRecordExport", exportName: "output" });
    expect(outer.exports).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "record", name: "output", typeIdentity: "statement:test:1" })
    ]));
  });

  it("retains deferred Module record export targets for caller-side collection fields", () => {
    const compiled = compileWithIds([
      "nui 1",
      "record Bundle(xs: number[])",
      "module M() {",
      "  export const output: Bundle = Bundle(xs: [5, 11])",
      "}",
      "instance Use = M()",
      "const first: number = @Use::output.xs[0]",
      "const second: number = @Use::output.xs[1]",
      "const length: number = @Use::output.xs.length"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) =>
      diagnostic.severity === "error" && diagnostic.code !== "geometry-property-invalid"
    )).toEqual([]);

    const analysis = compiled.moduleSemanticAnalysis!;
    const first = analysis.rootScalarExpressionsByStatementId.get("statement:test:6")!.expression.geometryProperties.find((property) => property.property === "xs[0]");
    const second = analysis.rootScalarExpressionsByStatementId.get("statement:test:7")!.expression.geometryProperties.find((property) => property.property === "xs[1]");
    const length = analysis.rootScalarExpressionsByStatementId.get("statement:test:8")!.expression.geometryProperties.find((property) =>
      property.target?.kind === "recordField" && property.target.record.kind === "deferredModuleRecordExport" && property.target.property === "length"
    );
    for (const [property, collectionIndex] of [[first, 0], [second, 1]] as const) {
      expect(property?.target).toMatchObject({
        kind: "recordField",
        record: { kind: "deferredModuleRecordExport", exportName: "output" },
        fieldName: "xs",
        collectionIndex
      });
    }
    expect(length?.target).toMatchObject({
      kind: "recordField",
      record: { kind: "deferredModuleRecordExport", exportName: "output" },
      fieldName: "xs",
      property: "length"
    });
  });

  it("resolves optional record values through coalescing and member access", () => {
    const compiled = compileWithIds([
      "nui 1",
      "record Pair(x: number)",
      "module M(settings: Pair?) {",
      "  const copy: Pair = @settings ?? Pair(x: 0)",
      "  const x: number = @settings?.x ?? 0",
      "}",
      "instance Absent = M()",
      "instance Present = M(settings: Pair(x: 6))"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.moduleSemanticAnalysis!.instances.map((instance) => instance.parameterBindings[0]?.state)).toEqual([
      "omitted",
      "supplied"
    ]);
  });

  it("rejects direct optional record member use without resolution", () => {
    const unguarded = compileWithIds([
      "nui 1",
      "record Pair(x: number)",
      "module M(settings: Pair?) {",
      "  const x: number = @settings.x",
      "}",
      "instance Use = M()"
    ].join("\n"));
    expect(unguarded.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-optional-value-required" })
    ]));
    expect(unguarded.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "scalar-type-mismatch" }),
      expect.objectContaining({ code: "geometry-property-invalid" })
    ]));
  });

  it("keeps module geometry builtin operands separate from scalar references", () => {
    const compiled = compileWithIds([
      "nui 1",
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
    expect(definition.parameters.map((parameter) => parameter.recordTypeIdentity)).toEqual([null, null, null]);
    for (const [name, expected] of [["radius", ["point", "point"]], ["direction", ["point", "point"]], ["height", ["point", "line"]]] as const) {
      const expression = definition.localScalars.find((scalar) => scalar.name === name)!.initializer!;
      expect(expression.type).toEqual({ kind: "number" });
      expect(expression.references).toEqual([]);
      expect(expression.geometryBuiltinArguments.map((occurrence) => occurrence.expectedGeometryType)).toEqual(expected);
      expect(expression.geometryBuiltinArguments.every((occurrence) => occurrence.reference.target !== null)).toBe(true);
    }
  });

  it("keeps scalar and geometry parameter metadata separate from nominal record identity", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module M(width: number, anchor: point, label: string) {",
      "}",
      "instance Use = M(width: 10, anchor: (0, 0), label: \"ok\")"
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.moduleSemanticAnalysis!.definitions[0].parameters.map((parameter) => ({
      name: parameter.name,
      recordTypeIdentity: parameter.recordTypeIdentity
    }))).toEqual([
      { name: "width", recordTypeIdentity: null },
      { name: "anchor", recordTypeIdentity: null },
      { name: "label", recordTypeIdentity: null }
    ]);
    expect(compiled.moduleSemanticAnalysis!.instances[0].parameterBindings.map((binding) => binding.value?.kind ?? null)).toEqual([
      "scalar",
      "geometry",
      "scalar"
    ]);
  });

  it("typechecks derived point geometry builtin operands", () => {
    const compiled = compileWithIds([
      "nui 1",
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
      "nui 1",
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
      "nui 1",
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
      "nui 1",
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

  it("uses the shared scalar frontend for nui1 word operators in a Module body", () => {
    const compiled = compileWithIds([
      "nui 1",
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
      "nui 1",
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
      "nui 1",
      "module M() {",
      "  const privateValue: number = 1",
      "  export const result: number = @privateValue + 1",
      "  export const state: number = @result + 1",
      "}"
    ].join("\n"));
    const definition = compiled.moduleSemanticAnalysis!.definitions[0];

    expect(definition.localScalars.map((local) => local.name)).toEqual(["privateValue", "result", "state"]);
    expect(definition.exports).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "scalar", name: "result", exportedStatementIndex: 3, declaredType: { kind: "number" }, bindingKind: "const" }),
      expect.objectContaining({ kind: "scalar", name: "state", exportedStatementIndex: 4, declaredType: { kind: "number" }, bindingKind: "const" })
    ]));
    expect(definition.exports.some((entry) => entry.name === "privateValue")).toBe(false);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("checks scalar and geometry exports together for duplicate public member names", () => {
    const compiled = compileWithIds([
      "nui 1",
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
      "nui 1",
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

  it("resolves later module callees and does not fall through a shadowing declaration", () => {
    const forward = compileWithIds(["nui 1", "instance Before = Later()", "module Later() {"] .concat(["}"]).join("\n"));
    expect(forward.diagnostics).not.toEqual(expect.arrayContaining([expect.objectContaining({ code: "module-forward-callee" })]));

    const shadow = compileWithIds([
      "nui 1",
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
      "nui 1",
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
      "module-undefined-geometry-reference",
      "module-recursion"
    ]));
    expect(compiled.moduleSemanticAnalysis?.callEdges[0]).toMatchObject({
      callerModuleDefinitionStatementId: "statement:test:2",
      calleeModuleDefinitionStatementId: "statement:test:2"
    });
  });

  it("keeps forbidden global statements and nested module bodies out of the outer body analysis", () => {
    const compiled = compileWithIds([
      "nui 1",
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
      "nui 1",
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
      "nui 1",
      "module M() {",
      "  group G (roles: [seam]) {",
      "    for i in range(min: 0, max: 2, step: 1) {",
      "      point P = coordinate(x: i * 10, y: 0)",
      "    }",
      "  }",
      "}"
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("resolves a visible outer module before a later inner declaration", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module Target() {",
      "}",
      "group G {",
      "  instance x = Target()",
      "  module Target() {",
      "  }",
      "}"
    ].join("\n"));
    expect(compiled.moduleSemanticAnalysis?.instances.find((instance) => instance.name === "x")).toMatchObject({
      callee: { definitionStatementId: "statement:test:5", definitionStatementIndex: 5 },
      calleeResolution: "resolved"
    });
  });

  it("stops at a nearest visible wrong-kind declaration", () => {
    const compiled = compileWithIds([
      "nui 1",
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
      "nui 1",
      "module M(x: number) {",
      "  const x: number = 1",
      "}"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "module-parameter-collision" })]));
  });

  it("allows a child scope declaration to shadow a module parameter", () => {
    const compiled = compileWithIds([
      "nui 1",
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
      "nui 1",
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
      "nui 1",
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
      "nui 1",
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
      "nui 1",
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

  it("uses the declared common path surface for Module materializations", () => {
    const compiled = compileWithIds([
      "nui 1",
      "arc Arc = arc(center: (0, 0), radius: 40, start: 15, end: 155, direction: clockwise)",
      "module Local() {",
      "  line A = segment(start: (0, 0), end: (9, 12))",
      "  line L = from(source: @A)",
      "  const directLength: number = @L.length",
      "  const Alias: line = @L",
      "  const aliasLength: number = @Alias.length",
      "  line Ordinary = segment(start: (0, 0), end: (9, 12))",
      "  const ordinaryLength: number = @Ordinary.length",
      "}",
      "module Parameter(source: path) {",
      "  const forwardLength: number = @Material.length",
      "  path Material = from(source: @source)",
      "  const startAngle: number = @Material.startAngleDeg",
      "  const endAngle: number = @Material.endAngleDeg",
      "  const startX: number = @Material.startPoint.x",
      "  const startY: number = @Material.startPoint.y",
      "  const endX: number = @Material.endPoint.x",
      "  const endY: number = @Material.endPoint.y",
      "  const PathAlias: path = @Material",
      "  const aliasPathLength: number = @PathAlias.length",
      "  const unsupportedRadius: number = @Material.radius",
      "  const unsupportedSweep: number = @Material.sweepAngleDeg",
      "  const unsupportedHandle: number = @Material.startHandleLength",
      "}",
      "instance LocalUse = Local()",
      "instance ParameterUse = Parameter(source: @Arc)"
    ].join("\n"));

    const local = compiled.moduleSemanticAnalysis!.definitions.find((definition) => definition.name === "Local")!;
    const parameter = compiled.moduleSemanticAnalysis!.definitions.find((definition) => definition.name === "Parameter")!;
    const localProperty = (name: string) => local.localScalars.find((scalar) => scalar.name === name)!.initializer!.geometryProperties[0]!;
    const parameterProperty = (name: string) => parameter.localScalars.find((scalar) => scalar.name === name)!.initializer!.geometryProperties[0]!;

    expect(localProperty("directLength")).toMatchObject({ property: "length", resolution: "resolved" });
    expect(localProperty("aliasLength")).toMatchObject({ property: "length", resolution: "resolved" });
    expect(localProperty("ordinaryLength")).toMatchObject({ property: "length", resolution: "resolved" });
    expect(parameter.localScalars.slice(1, 7).map((scalar) => scalar.initializer?.geometryProperties[0]?.property)).toEqual([
      "startAngleDeg",
      "endAngleDeg",
      "startPoint.x",
      "startPoint.y",
      "endPoint.x",
      "endPoint.y"
    ]);
    expect(parameter.localScalars.slice(0, 7).every((scalar) =>
      scalar.initializer?.geometryProperties[0]?.resolution === "resolved"
    )).toBe(true);
    expect(parameterProperty("forwardLength")).toMatchObject({ property: "length", resolution: "resolved" });
    expect(parameterProperty("aliasPathLength")).toMatchObject({ property: "length", resolution: "resolved" });
    expect(parameterProperty("unsupportedRadius")).toMatchObject({ property: "radius", resolution: "invalid" });
    expect(parameterProperty("unsupportedSweep")).toMatchObject({ property: "sweepAngleDeg", resolution: "invalid" });
    expect(parameterProperty("unsupportedHandle")).toMatchObject({ property: "startHandleLength", resolution: "invalid" });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.code === "module-unknown-geometry-property")).toHaveLength(3);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toHaveLength(3);
  });

  it("carries the concrete source geometry choice type through module scalar semantics", () => {
    const compiled = compileWithIds([
      "nui 1",
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
      "nui 1",
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

  it("keeps Module line/path parameters and exports on the common path surface", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module Child() {",
      "  export arc Output = arc(center: (0, 0), radius: 40, start: 15, end: 155, direction: clockwise)",
      "}",
      "module M(base: path) {",
      "  instance ChildInstance = Child()",
      "  const pathLength: number = @base.length",
      "  const pathRadius: number = @base.radius",
      "  const exportLength: number = @ChildInstance::Output.length",
      "  const exportRadius: number = @ChildInstance::Output.radius",
      "}"
    ].join("\n"));
    const locals = compiled.moduleSemanticAnalysis!.definitions.find((definition) => definition.name === "M")!.localScalars;
    expect(locals.map((local) => local.initializer?.geometryProperties[0]?.resolution)).toEqual([
      "resolved",
      "invalid",
      "deferred",
      "invalid"
    ]);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.code === "module-unknown-geometry-property")).toHaveLength(2);
  });

  it("preserves a concrete split family for module-local source geometry", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module M() {",
      "  arc A = arc(center: (0, 0), radius: 40, start: 15, end: 155, direction: clockwise)",
      "  line Split = split(source: @A, at: @A.start)",
      "  const radius: number = @Split.radius",
      "}"
    ].join("\n"));
    const property = compiled.moduleSemanticAnalysis!.definitions[0].localScalars[0].initializer!.geometryProperties[0];
    expect(property).toMatchObject({ property: "radius", resolution: "resolved" });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("uses the nearest group-local scalar for a nested module default", () => {
    const compiled = compileWithIds([
      "nui 1",
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
      "nui 1",
      "module Outer(i: number) {",
      "  for i in range(min: 0, max: 2, step: 1) {",
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
      name: "i",
      valueType: { kind: "number" }
    });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("does not fall through to an outer binding for an own later or self parameter", () => {
    const compiled = compileWithIds([
      "nui 1",
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
      "nui 1",
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
      pointKey: "end",
      stagePath: ["final"]
    });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("projects ordinary root geometry references by StatementIdentity without starting Module runtime", () => {
    const compiled = compileWithIds([
      "nui 1",
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
      "nui 1",
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
      "nui 1",
      "group Outer {",
      "}",
      "group Inner (parent: @Outer) {",
      "}",
      "if (true, parent: @Outer) {",
      "}",
      "for i in range(min: 0, max: 0, step: 1, parent: @Outer) {",
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
      "nui 1",
      "point B = offset(from: @Missing, dx: 1, dy: 0)"
    ].join("\n"));
    const missing = compiled.diagnostics.filter((diagnostic) => diagnostic.message.includes("@Missing"));
    const reference = compiled.sourceSemanticAnalysis!.rootGeometryReferencesByStatementId
      .get("statement:test:1")?.[0].reference;

    expect(missing).toHaveLength(1);
    expect(reference).toMatchObject({ resolution: "undefined", target: null });
  });

  it("honors coordinate policy and canonical optional anchor types", () => {
    const compiled = compileWithIds([
      "nui 1",
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

  it("uses the canonical optional value expectation for root and Module construction arguments", () => {
    const rootOptional = compileWithIds([
      "nui 1",
      "text Label = label(text: \"ok\", anchor: none, size: 3)"
    ].join("\n"));
    expect(rootOptional.diagnostics).toEqual([]);

    const rootRequired = compileWithIds([
      "nui 1",
      "point Rejected = offset(from: none, dx: 1, dy: 1)"
    ].join("\n"));
    expect(rootRequired.diagnostics.filter((diagnostic) => diagnostic.code === "optional-value-required")).toHaveLength(1);

    const module = compileWithIds([
      "nui 1",
      "module M() {",
      "  text Label = label(text: \"ok\", anchor: none, size: 3)",
      "  point Rejected = offset(from: none, dx: 1, dy: 1)",
      "}",
      "instance Use = M()"
    ].join("\n"));
    expect(moduleBodyAt(module, 2).geometryReferences[0].reference).toMatchObject({ resolution: "resolved", valueType: { kind: "optional", valueType: { kind: "point" } } });
    expect(module.diagnostics.filter((diagnostic) => diagnostic.code === "optional-value-required")).toHaveLength(1);
  });

  it("distinguishes point, line endpoint, plain line, and derived point references", () => {
    const compiled = compileWithIds([
      "nui 1",
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

  it("splits Module named-stage paths before validating the remaining geometry property", () => {
    const compiled = compileWithIds([
      "nui 1",
      "line Root = segment(start: (0, 0), end: (10, 0))",
      "move Root as rootShifted(from: (0, 0), to: (2, 0))",
      "const RootOut: line = @Root.rootShifted",
      "module M() {",
      "  line L = segment(start: (11, 23), end: (20, 35))",
      "  move L as shifted(from: (0, 0), to: (7, -3))",
      "  curve P = bezier(start: (3, 9), end: (13, 9), startAngle: 45, startLength: 3, endAngle: 135, endLength: 3)",
      "  move P as pathShifted(from: (0, 0), to: (4, -2))",
      "  line BranchLine = segment(start: (2, 4), end: (12, 4))",
      "  move BranchLine as first(from: (0, 0), to: (2, 0))",
      "  move BranchLine.first as branch(from: (0, 0), to: (1, 1))",
      "  const Out: line = @L.shifted",
      "  const BaseOut: line = @L.base",
      "  const FinalOut: line = @L.final",
      "  const ImplicitFinalOut: line = @L",
      "  const PathOut: path = @P.pathShifted",
      "  const NestedOut: line = @BranchLine.first.branch",
      "  point Start = offset(from: @L.shifted.start, dx: 1, dy: 0)",
      "}",
      "instance I = M()"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const definition = compiled.moduleSemanticAnalysis!.definitions.find((candidate) => candidate.name === "M")!;
    const localValue = (name: string) => definition.localGeometryValues.find((candidate) => candidate.name === name)!;
    expect(localValue("Out").initializer?.target).toMatchObject({
      kind: "sourceGeometry",
      statementId: "statement:test:5",
      stagePath: ["shifted"]
    });
    expect(localValue("BaseOut").initializer?.target).toMatchObject({ kind: "sourceGeometry", stagePath: ["base"] });
    expect(localValue("FinalOut").initializer?.target).toMatchObject({ kind: "sourceGeometry", stagePath: ["final"] });
    expect(localValue("ImplicitFinalOut").initializer?.target).toMatchObject({ kind: "sourceGeometry", stagePath: ["final"] });
    expect(localValue("PathOut").initializer?.target).toMatchObject({
      kind: "sourceGeometry",
      statementId: "statement:test:7",
      stagePath: ["pathShifted"]
    });
    expect(localValue("NestedOut").initializer?.target).toMatchObject({
      kind: "sourceGeometry",
      statementId: "statement:test:9",
      stagePath: ["first", "branch"]
    });
    expect(moduleBodyAt(compiled, 18).geometryReferences[0]?.reference).toMatchObject({
      resolution: "resolved",
      target: { kind: "sourceGeometry", pointKey: "start", stagePath: ["shifted"] }
    });
    expect(compiled.moduleSemanticAnalysis!.geometryValues.find((candidate) => candidate.name === "RootOut")?.initializer?.target).toMatchObject({
      kind: "sourceGeometry",
      stagePath: ["rootShifted"]
    });
  });

  it("keeps Module-local whole-geometry stages in the line-list role after stage selection", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module M() {",
      "  line L = segment(start: (0, 0), end: (20, 0))",
      "  move L as shifted(from: (0, 0), to: (5, 0))",
      "  line BaseOffset = offset(sources: [@L.base], distance: 2, side: left)",
      "  line NamedOffset = offset(sources: [@L.shifted], distance: 2, side: left)",
      "  const Selected: line = @L.base",
      "  line AliasOffset = offset(sources: [@Selected], distance: 2, side: left)",
      "  line UnselectedOffset = offset(sources: [@L], distance: 2, side: left)",
      "  point Start = offset(from: @L.start, dx: 0, dy: 0)",
      "}",
      "instance I = M()"
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const definition = compiled.moduleSemanticAnalysis!.definitions.find((candidate) => candidate.name === "M")!;
    const references = definition.bodyStatements.flatMap((statement) => statement.geometryReferences.map((site) => site.reference));
    const lineListReferenceFor = (source: string) => references.find((reference) =>
      reference.role === "lineReferenceList" && reference.source.includes(source)
    );

    expect(lineListReferenceFor("@L.base")).toMatchObject({
      role: "lineReferenceList",
      resolution: "resolved",
      target: { kind: "sourceGeometry", stagePath: ["base"] }
    });
    expect(lineListReferenceFor("@L.shifted")).toMatchObject({
      role: "lineReferenceList",
      resolution: "resolved",
      target: { kind: "sourceGeometry", stagePath: ["shifted"] }
    });
    expect(lineListReferenceFor("@Selected")).toMatchObject({ role: "lineReferenceList", resolution: "resolved" });
    expect(definition.localGeometryValues.find((value) => value.name === "Selected")?.initializer?.target).toMatchObject({
      kind: "sourceGeometry",
      stagePath: ["base"]
    });
    expect(references.find((reference) => reference.source.includes("@L.start"))).toMatchObject({
      role: "derivedPoint",
      resolution: "resolved",
      target: { kind: "sourceGeometry", pointKey: "start" }
    });
  });

  it("resolves forward Module named-stage dependencies independent of declaration order", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module M() {",
      "  line L = segment(start: (11, 23), end: (20, 35))",
      "  const Out: line = @L.first.branch",
      "  move L.first as branch(from: (0, 0), to: (1, 1))",
      "  move L as first(from: (0, 0), to: (2, 0))",
      "}",
      "instance I = M()"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.moduleSemanticAnalysis!.definitions[0]!.localGeometryValues.find((value) => value.name === "Out")?.initializer?.target).toMatchObject({
      kind: "sourceGeometry",
      stagePath: ["first", "branch"]
    });
  });

  it("keeps invalid suffix validation after a Module named stage", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module M() {",
      "  line L = segment(start: (0, 0), end: (10, 0))",
      "  move L as shifted(from: (0, 0), to: (1, 0))",
      "  point InvalidPoint = offset(from: @L.shifted.unknown, dx: 1, dy: 0)",
      "  const InvalidProperty: number = @L.shifted.length.unknown",
      "}"
    ].join("\n"));
    expect(moduleBodyAt(compiled, 4).geometryReferences[0]?.reference).toMatchObject({ resolution: "invalid", target: null });
    expect(compiled.moduleSemanticAnalysis!.definitions[0]!.localScalars.find((value) => value.name === "InvalidProperty")?.initializer?.geometryProperties[0]).toMatchObject({
      property: "shifted.length.unknown",
      resolution: "invalid",
      target: null
    });
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-geometry-type-mismatch" }),
      expect.objectContaining({ code: "module-unknown-geometry-property" })
    ]));
  });

  it("rejects known derived accessors that are invalid for the source geometry category", () => {
    const compiled = compileWithIds([
      "nui 1",
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
      "nui 1",
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
      "nui 1",
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
      "nui 1",
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
      "nui 1",
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
      "nui 1",
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

  it("classifies caller-qualified exported geometry stages before derived accessors", () => {
    const compiled = compileWithIds([
      "nui 1",
      "line Root = segment(start: (0, 0), end: (9, 12))",
      "move Root as rootShifted(from: (0, 0), to: (2, 3))",
      "const RootBase: line = @Root.base",
      "const RootNamed: line = @Root.rootShifted",
      "module Child() {",
      "  export line L = segment(start: (0, 0), end: (9, 12))",
      "  move L as shifted(from: (0, 0), to: (5, 7))",
      "  export curve P = bezier(start: (1, 2), end: (7, 2), startAngle: 45, startLength: 2, endAngle: 135, endLength: 2)",
      "  move P as pathShifted(from: (1, 2), to: (3, 4))",
      "  const LocalNamed: line = @L.shifted",
      "  export const Selected: line = @L.shifted",
      "}",
      "instance I = Child()",
      "const PlainLine: line = @I::L",
      "const BaseLine: line = @I::L.base",
      "const FinalLine: line = @I::L.final",
      "const NamedLine: line = @I::L.shifted",
      "const BasePath: path = @I::P.base",
      "const FinalPath: path = @I::P.final",
      "const NamedPath: path = @I::P.pathShifted",
      "const SelectedLine: line = @I::Selected",
      "point Start = offset(from: @I::L.start, dx: 0, dy: 0)",
      "point End = offset(from: @I::L.end, dx: 0, dy: 0)",
      "point BaseStart = offset(from: @I::L.base.start, dx: 0, dy: 0)",
      "point ShiftedStart = offset(from: @I::L.shifted.start, dx: 0, dy: 0)",
      "point SelectedStart = offset(from: @I::Selected.start, dx: 0, dy: 0)",
      "point SelectedEnd = offset(from: @I::Selected.end, dx: 0, dy: 0)"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const analysis = compiled.moduleSemanticAnalysis!;
    const targetFor = (name: string) => analysis.geometryValues.find((value) => value.name === name)?.initializer?.target;
    const rootReferences = [...analysis.rootGeometryReferencesByStatementId.values()].flat().map((site) => site.reference);
    expect(targetFor("PlainLine")).toMatchObject({ kind: "deferredModuleExport", exportName: "L" });
    expect(targetFor("PlainLine")).not.toHaveProperty("pointKey");
    expect(targetFor("PlainLine")).not.toHaveProperty("stagePath");
    for (const [name, stagePath] of [
      ["BaseLine", ["base"]],
      ["FinalLine", ["final"]],
      ["NamedLine", ["shifted"]],
      ["BasePath", ["base"]],
      ["FinalPath", ["final"]],
      ["NamedPath", ["pathShifted"]]
    ] as const) {
      expect(targetFor(name)).toMatchObject({ kind: "deferredModuleExport", stagePath });
      expect(targetFor(name)).not.toHaveProperty("pointKey");
    }
    expect(rootReferences.find((reference) => reference.source.includes("@I::L.start"))).toMatchObject({
      role: "derivedPoint",
      target: { kind: "deferredModuleExport", exportName: "L", pointKey: "start" }
    });
    expect(rootReferences.find((reference) => reference.source.includes("@I::L.start"))?.target).not.toHaveProperty("stagePath");
    expect(rootReferences.find((reference) => reference.source.includes("@I::L.end"))).toMatchObject({
      role: "derivedPoint",
      target: { kind: "deferredModuleExport", exportName: "L", pointKey: "end" }
    });
    expect(rootReferences.find((reference) => reference.source.includes("@I::L.end"))?.target).not.toHaveProperty("stagePath");
    expect(rootReferences.find((reference) => reference.source.includes("@I::L.base.start"))).toMatchObject({
      role: "derivedPoint",
      target: { kind: "deferredModuleExport", exportName: "L", pointKey: "start", stagePath: ["base"] }
    });
    expect(rootReferences.find((reference) => reference.source.includes("@I::L.shifted.start"))).toMatchObject({
      role: "derivedPoint",
      target: { kind: "deferredModuleExport", exportName: "L", pointKey: "start", stagePath: ["shifted"] }
    });
    for (const [source, pointKey] of [["@I::Selected.start", "start"], ["@I::Selected.end", "end"]] as const) {
      const reference = rootReferences.find((candidate) => candidate.source.includes(source));
      expect(reference).toMatchObject({
        role: "derivedPoint",
        target: { kind: "deferredModuleExport", exportName: "Selected", pointKey }
      });
      expect(reference?.target).not.toHaveProperty("stagePath");
    }
    expect(targetFor("RootBase")).toMatchObject({ kind: "sourceGeometry", stagePath: ["base"] });
    expect(targetFor("RootNamed")).toMatchObject({ kind: "sourceGeometry", stagePath: ["rootShifted"] });
    expect(targetFor("SelectedLine")).toMatchObject({ kind: "deferredModuleExport", exportName: "Selected" });

    const definition = analysis.definitions.find((candidate) => candidate.name === "Child")!;
    expect(definition.localGeometryValues.find((value) => value.name === "LocalNamed")?.initializer?.target).toMatchObject({
      kind: "sourceGeometry",
      stagePath: ["shifted"]
    });
    expect(targetFor("SelectedLine")).not.toHaveProperty("stagePath");
  });

  it("keeps category-invalid and unknown qualified suffixes as structured geometry diagnostics", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module Child() {",
      "  export line L = segment(start: (0, 0), end: (9, 12))",
      "  export point P = coordinate(x: 3, y: 4)",
      "}",
      "instance I = Child()",
      "point InvalidLineCenter = offset(from: @I::L.center, dx: 1, dy: 0)",
      "point InvalidPointStart = offset(from: @I::P.start, dx: 1, dy: 0)",
      "point UnknownAccessor = offset(from: @I::L.missing, dx: 1, dy: 0)"
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.code === "module-geometry-type-mismatch")).toHaveLength(3);
  });

  it("keeps text and image geometry properties source-semantic without a fake geometry kind", () => {
    const compiled = compileWithIds([
      "nui 1",
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

  it("rejects category-specific properties on an unknown broad module export", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module Child() {",
      "}",
      "module M() {",
      "  instance SomeInstance = Child()",
      "  const size: number = @SomeInstance::TextExport.fontSize",
      "}"
    ].join("\n"));
    const property = compiled.moduleSemanticAnalysis!.definitions.find((definition) => definition.name === "M")!.localScalars[0].initializer!.geometryProperties[0];
    expect(property).toMatchObject({ property: "fontSize", resolution: "invalid", target: null });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).not.toEqual([]);
  });

  it("applies the module owner boundary to qualified export geometry and properties", () => {
    const compiled = compileWithIds([
      "nui 1",
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
      "nui 1",
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
      expect.objectContaining({ code: "module-geometry-type-mismatch" })
    ]));
  });

  it("resolves ordinary qualified source paths for module scalar and geometry consumers", () => {
    const compiled = compileWithIds([
      "nui 1",
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
      "nui 1",
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
      "nui 1",
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
      "nui 1",
      "group G {",
      "  point P = coordinate(x: 0, y: 0)",
      "}",
      "module M() {",
      "  for G in range(min: 0, max: 0, step: 1) {",
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

  it("resolves a qualified path first segment declared later in the module", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module M() {",
      "  point Use = offset(from: @G::P, dx: 0, dy: 0)",
      "  group G {",
      "    point P = coordinate(x: 0, y: 0)",
      "  }",
      "}"
    ].join("\n"));
    const reference = moduleBodyAt(compiled, 2).geometryReferences[0].reference;

    expect(reference).toMatchObject({ resolution: "resolved", target: { kind: "sourceGeometry" } });
    expect(compiled.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-forward-geometry-reference" })
    ]));
    expect(compiled.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-undefined-geometry-reference" }),
      expect.objectContaining({ code: "module-outer-capture" })
    ]));
  });

  it("resolves a qualified path nested member declared later in its container", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module M() {",
      "  group G {",
      "    point Use = offset(from: @G::P, dx: 0, dy: 0)",
      "    point P = coordinate(x: 0, y: 0)",
      "  }",
      "}"
    ].join("\n"));
    const reference = moduleBodyAt(compiled, 3).geometryReferences[0].reference;

    expect(reference).toMatchObject({ resolution: "resolved", target: { kind: "sourceGeometry" } });
    expect(compiled.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-forward-geometry-reference" })
    ]));
    expect(compiled.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-undefined-geometry-reference" })
    ]));
  });

  it("rejects an ordinary qualified path that captures an outer module geometry", () => {
    const compiled = compileWithIds([
      "nui 1",
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
      "nui 1",
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
      "nui 1",
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
