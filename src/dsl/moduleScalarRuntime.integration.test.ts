import { describe, expect, it } from "vitest";
import { reconcileStatements } from "../document/statementReconciler";
import { buildNumericBindingRuntimeEntries } from "../geometry/numericBindingRuntime";
import { buildPropertyBindingRuntimeEntries } from "../geometry/propertyBindingRuntime";
import { buildTextPropertyBindingRuntimeEntries, buildTextTemplateEntriesByElementId } from "../geometry/textTemplateRuntime";
import { evaluateElements } from "../geometry/evaluate";
import { buildConditionalMutationOwners, conditionalOwnerIdByElementId } from "../scalars/conditionalMutationControl";
import { buildForGroupMutationOwners, forGroupMutationOwnerByElementId } from "../scalars/forGroupMutationControl";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";

const compileWithIds = (source: string, prefix = "task6") => {
  const parsed = parseDsl(source);
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `${prefix}:${index}`] as const))
  });
};

const evaluateCompiled = (compiled: ReturnType<typeof compileWithIds>) => {
  if (!compiled.document || !compiled.statementMap) throw new Error("expected a compiled document");
  const elements = compiled.document.elements;
  return evaluateElements(elements, {
    evaluationLimitIndex: compiled.document.evaluationLimitIndex,
    scalarProgram: compiled.scalarProgram,
    bindingVersions: compiled.bindingVersions,
    statementInfoByElementId: compiled.statementMap.byElementId,
    statementIdByStatementIndex: compiled.statementMap.statementIdByStatementIndex,
    sourceExecutionPositionByElementId: compiled.moduleMaterialization?.sourceExecutionPositionByRuntimeElementId,
    scalarExecutionPositionByElementId: compiled.scalarExecutionPositionByRuntimeElementId,
    propertyBindingEntries: compiled.scalarProgram && compiled.propertyBindings
      ? buildPropertyBindingRuntimeEntries({
          propertyBindings: compiled.propertyBindings,
          elementIdByStatementIndex: compiled.statementMap.elementIdByStatementIndex,
          materializedPropertyBindings: compiled.materializedPropertyBindings
        }, elements)
      : undefined,
    numericBindingEntries: compiled.scalarProgram
      ? buildNumericBindingRuntimeEntries({
          numericBindings: compiled.numericBindings ?? new Map(),
          elementIdByStatementIndex: compiled.statementMap.elementIdByStatementIndex,
          materializedNumericBindings: compiled.materializedNumericBindings
        }, elements)
      : undefined
    ,textPropertyBindingEntries: compiled.scalarProgram
      ? buildTextPropertyBindingRuntimeEntries({
          propertyBindings: compiled.propertyBindings ?? new Map(),
          elementIdByStatementIndex: compiled.statementMap.elementIdByStatementIndex,
          materializedPropertyBindings: compiled.materializedPropertyBindings
        }, elements)
      : undefined
    ,conditionalGroupConditionsByElementId: compiled.scalarProgram && (compiled.conditionalGroupConditions || compiled.materializedConditionalGroupConditions)
      ? new Map([
          ...(compiled.conditionalGroupConditions
            ? [...compiled.conditionalGroupConditions].flatMap(([key, expression]) => {
                const statementIndex = Number(key.split(":", 1)[0]);
                const elementId = compiled.statementMap!.elementIdByStatementIndex.get(statementIndex);
                return elementId ? [[elementId, expression] as const] : [];
              })
            : []),
          ...(compiled.materializedConditionalGroupConditions ?? []).map((entry) => [entry.elementId, entry.expression] as const)
        ])
      : undefined
    ,textTemplateEntriesByElementId: compiled.textTemplates || compiled.materializedTextTemplates
      ? buildTextTemplateEntriesByElementId({
          textTemplates: compiled.textTemplates ?? new Map(),
          elementIdByStatementIndex: compiled.statementMap.elementIdByStatementIndex,
          materializedTextTemplates: compiled.materializedTextTemplates
        })
      : undefined
    ,conditionalOwnerStatementIdByElementId: compiled.bindingVersions
      ? new Map([
          ...conditionalOwnerIdByElementId(buildConditionalMutationOwners(
            compiled.bindingVersions,
            elements,
            compiled.statementMap.byElementId,
            compiled.statementMap.statementIdByStatementIndex,
            new Set(compiled.moduleConditionalOwnerStatementIdByElementId?.values() ?? [])
          )),
          ...(compiled.moduleConditionalOwnerStatementIdByElementId ? [...compiled.moduleConditionalOwnerStatementIdByElementId] : [])
        ])
      : undefined
    ,forGroupMutationOwnerByElementId: compiled.bindingVersions
      ? new Map([
          ...forGroupMutationOwnerByElementId(buildForGroupMutationOwners(
            compiled.bindingVersions,
            elements,
            compiled.statementMap.byElementId,
            compiled.statementMap.statementIdByStatementIndex,
            new Set(compiled.moduleForGroupMutationOwnerByElementId
              ? [...compiled.moduleForGroupMutationOwnerByElementId.values()].map((owner) => owner.ownerStatementId)
              : [])
          )),
          ...(compiled.moduleForGroupMutationOwnerByElementId ? [...compiled.moduleForGroupMutationOwnerByElementId] : [])
        ])
      : undefined
    ,moduleConditionalOwnerStatementIdByElementId: compiled.moduleConditionalOwnerStatementIdByElementId
    ,moduleForGroupMutationOwnerByElementId: compiled.moduleForGroupMutationOwnerByElementId
  });
};

const elementNamed = (compiled: ReturnType<typeof compileWithIds>, name: string) => {
  const element = compiled.document?.elements.find((candidate) => candidate.name === name);
  if (!element) throw new Error(`missing element ${name}`);
  return element;
};

const expectValid = (compiled: ReturnType<typeof compileWithIds>) => {
  expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  expect(compiled.document).not.toBeNull();
};

describe("module scalar runtime integration", () => {
  it("keeps omitted optional scalars absent and materializes supplied values", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(value?: number) {",
      "  if (hasValue(@value)) {",
      "    point P = coordinate(x: @value, y: 0)",
      "  }",
      "}",
      "instance Absent = M()",
      "instance Present = M(value: 4)"
    ].join("\n"));
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    const points = compiled.document!.elements.filter((element) => element.name === "P");
    expect(points).toHaveLength(2);
    expect(points.map((point) => result.computedGeometry.get(point.id))).toEqual([
      undefined,
      expect.objectContaining({ kind: "point", x: 4, y: 0 })
    ]);
    const parameterBindings = compiled.bindingAnalysis!.catalog.bindings.filter((binding) => binding.name === "value");
    expect(parameterBindings).toHaveLength(1);
  });

  it("evaluates hasValue in a boolean default per concrete module instance", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(value?: number, enabled: boolean = hasValue(@value)) {",
      "  let marker: number = 0",
      "  if (@enabled) {",
      "    set marker = 1",
      "    point P = coordinate(x: @marker, y: 0)",
      "  }",
      "}",
      "instance Absent = M()",
      "instance Present = M(value: 4)"
    ].join("\n"));
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    const points = compiled.document!.elements.filter((element) => element.name === "P");
    expect(points.map((point) => result.computedGeometry.get(point.id))).toEqual([
      undefined,
      expect.objectContaining({ kind: "point", x: 1, y: 0 })
    ]);
  });

  it("carries lowered module numeric expressions through typed runtime materialization", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module Example(seed: number) {",
      "  point P = coordinate(x: @seed ^ 2, y: 5 % 3)",
      "}",
      "instance A = Example(seed: 3)"
    ].join("\n"));
    expectValid(compiled);
    const p = elementNamed(compiled, "P");
    const numericBindings = (compiled.materializedNumericBindings ?? [])
      .filter((entry) => entry.elementId === p.id);
    expect(numericBindings).toHaveLength(2);
    expect(numericBindings.every((entry) => entry.binding.typedExpression)).toBe(true);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(p.id)).toMatchObject({ kind: "point", x: 9, y: 2 });
  });

  it("keeps an empty scalar program for ref-free typed numeric module expressions", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module Example() {",
      "  point P = coordinate(x: 2 ^ 3, y: 5 % 3)",
      "}",
      "instance A = Example()"
    ].join("\n"));
    expectValid(compiled);
    expect(compiled.scalarProgram).toBeDefined();
    expect(compiled.scalarProgram?.statements).toEqual([]);
    expect(compiled.numericBindings).toBeDefined();

    const p = elementNamed(compiled, "P");
    const numericBindings = (compiled.materializedNumericBindings ?? [])
      .filter((entry) => entry.elementId === p.id);
    expect(numericBindings).toHaveLength(2);
    expect(numericBindings.every((entry) => entry.binding.typedExpression)).toBe(true);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(p.id)).toMatchObject({ kind: "point", x: 8, y: 2 });
  });

  it("evaluates module geometry builtin operands through the production lowered path", () => {
    const compiled = compileWithIds([
      "nui 4",
      "point P = coordinate(x: 3, y: 4)",
      "line Baseline = segment(start: (0, 0), end: (1, 0))",
      "module Example(baseline: line, p: point, delta: number) {",
      "  let measured: number = 0",
      "  set measured = distance(@baseline.start, @p)",
      "  export point Q = coordinate(",
      "    x: @measured + @delta,",
      "    y: lineDistance(@p, @baseline)",
      "  )",
      "}",
      "instance Use = Example(baseline: @Baseline, p: @P, delta: 2)",
      "point ExpectedModuleQ = coordinate(x: 7, y: 4)",
      "const moduleCheck: number = distance(@Use::Q, @ExpectedModuleQ)"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    const modulePoint = elementNamed(compiled, "Q");
    expect(result.computedGeometry.get(modulePoint.id)).toMatchObject({ kind: "point", x: 7, y: 4 });
    const moduleCheck = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "moduleCheck");
    expect(moduleCheck).toBeDefined();
    expect(result.computedScalarBindings?.get(moduleCheck!.id)).toEqual({
      status: "ok",
      type: { kind: "number" },
      value: { kind: "number", value: 0 }
    });
  });

  it("lowers module geometry builtin operands to each materialized runtime target", () => {
    const compiled = compileWithIds([
      "nui 4",
      "point P = coordinate(x: 3, y: 4)",
      "point O = coordinate(x: 0, y: 0)",
      "line Baseline = segment(start: (0, 0), end: (1, 0))",
      "module Example(p: point, origin: point, baseline: line) {",
      "  const radius: number = distance(@origin, @p)",
      "  const direction: number = angle(@origin, @p)",
      "  const height: number = lineDistance(@p, @baseline)",
      "  let measured: number = 0",
      "  set measured = distance(@origin, @p)",
      "}",
      "instance A = Example(p: @P, origin: @O, baseline: @Baseline)",
      "instance B = Example(p: @P, origin: @O, baseline: @Baseline)"
    ].join("\n"));
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    const valuesByName = new Map<string, number[]>();
    for (const binding of compiled.bindingAnalysis!.catalog.bindings) {
      if (binding.kind !== "typed" || !["radius", "direction", "height", "measured"].includes(binding.name)) continue;
      const value = result.computedScalarBindings?.get(binding.id);
      if (value?.status !== "ok" || value.value.kind !== "number") continue;
      valuesByName.set(binding.name, [...(valuesByName.get(binding.name) ?? []), value.value.value]);
    }
    expect(valuesByName.get("radius")).toEqual([5, 5]);
    expect(valuesByName.get("direction")).toHaveLength(2);
    expect(valuesByName.get("direction")?.[0]).toBeCloseTo(Math.atan2(4, 3) * 180 / Math.PI, 10);
    expect(valuesByName.get("direction")?.[1]).toBeCloseTo(Math.atan2(4, 3) * 180 / Math.PI, 10);
    expect(valuesByName.get("height")).toEqual([4, 4]);
    expect(valuesByName.get("measured")).toEqual([5, 5]);
    expect(compiled.bindingAnalysis!.initializerReferences.some((reference) =>
      ["p", "origin", "baseline"].includes(reference.name)
    )).toBe(false);

    const geometryTargets: string[] = [];
    for (const statement of compiled.scalarProgram?.statements ?? []) {
      if (!statement.bindingId.includes("module-binding")) continue;
      const initializer = statement.declaration.initializer;
      if (initializer.kind !== "call") continue;
      for (const argument of initializer.args) {
        if (argument.kind === "geometryReference" && argument.target) geometryTargets.push(argument.target.statementId);
      }
    }
    expect(new Set(geometryTargets).size).toBeGreaterThan(1);
    const runtimeElementIds = new Set(compiled.document!.elements.map((element) => element.id));
    expect(geometryTargets.every((id) => runtimeElementIds.has(id))).toBe(true);
    for (const statement of compiled.scalarProgram?.statements ?? []) {
      if (!statement.bindingId.includes("module-binding") || statement.declaration.initializer.kind !== "call") continue;
      for (const argument of statement.declaration.initializer.args) {
        if (argument.kind !== "geometryReference" || !argument.target) continue;
        expect(argument.target.statementIndex).toBe(compiled.scalarExecutionPositionByRuntimeElementId?.get(argument.target.statementId));
        expect(["point", "line"]).toContain(argument.target.geometryType);
      }
    }
  });

  it("preserves root geometry builtin resolution for set statements when a module is present", () => {
    const rootSource = [
      "nui 4",
      "point Origin = coordinate(x: 0, y: 0)",
      "point DistancePoint = coordinate(x: 3, y: 4)",
      "point Up = coordinate(x: 0, y: 1)",
      "point MeasurePoint = coordinate(x: 10, y: 3)",
      "line Horizontal = segment(start: (0, 0), end: (10, 0))",
      "line Vertical = segment(start: (0, 0), end: (0, 10))",
      "let distanceValue: number = 0",
      "let angleValue: number = 0",
      "let lineDistanceValue: number = 0",
      "let lineAngleValue: number = 0",
      "set distanceValue = distance(@Origin, @DistancePoint)",
      "set angleValue = angle(@Origin, @Up)",
      "set lineDistanceValue = lineDistance(@MeasurePoint, @Horizontal)",
      "set lineAngleValue = lineAngle(@Horizontal, @Vertical)"
    ];
    const sources = [
      rootSource.join("\n"),
      [
        ...rootSource,
        "",
        "module Unrelated(baseline: line) {",
        "  line Local = segment(start: (0, 0), end: (0, 10))",
        "}"
      ].join("\n")
    ];
    const expectedValues = new Map([
      ["distanceValue", 5],
      ["angleValue", 90],
      ["lineDistanceValue", 3],
      ["lineAngleValue", 90]
    ]);
    const expectedGeometryNamesBySetName = new Map([
      ["distanceValue", ["Origin", "DistancePoint"]],
      ["angleValue", ["Origin", "Up"]],
      ["lineDistanceValue", ["MeasurePoint", "Horizontal"]],
      ["lineAngleValue", ["Horizontal", "Vertical"]]
    ]);

    for (const [sourceIndex, source] of sources.entries()) {
      const compiled = compileWithIds(source);
      expectValid(compiled);
      const result = evaluateCompiled(compiled);
      expect(result.errors).toEqual([]);

      for (const [name, expected] of expectedValues) {
        const binding = compiled.bindingAnalysis!.catalog.bindings.find((candidate) =>
          candidate.kind === "typed" && candidate.name === name
        );
        expect(binding).toBeDefined();
        expect(result.computedScalarBindings?.get(binding!.id)).toMatchObject({
          status: "ok",
          value: { kind: "number", value: expected }
        });
      }

      if (sourceIndex !== 1) continue;
      const setStatements = [...(compiled.setStatements?.values() ?? [])];
      expect(setStatements.map((statement) => statement.targetName)).toEqual([...expectedValues.keys()]);
      for (const statement of setStatements) {
        const expectedGeometryNames = expectedGeometryNamesBySetName.get(statement.targetName);
        if (!expectedGeometryNames) throw new Error(`unexpected set target ${statement.targetName}`);
        expect(statement.expression.kind).toBe("call");
        if (statement.expression.kind !== "call") throw new Error("expected geometry builtin call");
        const targets = statement.expression.args.map((argument) => {
          expect(argument.kind).toBe("geometryReference");
          if (argument.kind !== "geometryReference") throw new Error("expected geometry reference argument");
          expect(argument.target).not.toBeNull();
          if (!argument.target) throw new Error("expected resolved geometry target");
          return argument.target.statementId;
        });
        expect(targets).toEqual(expectedGeometryNames.map((name) => elementNamed(compiled, name).id));
      }
    }
  });

  it("retains geometry builtin type mismatch diagnostics for root set statements with a module", () => {
    const compiled = compileWithIds([
      "nui 4",
      "line Horizontal = segment(start: (0, 0), end: (10, 0))",
      "point Origin = coordinate(x: 0, y: 0)",
      "let value: number = 0",
      "set value = distance(@Horizontal, @Origin)",
      "module Unrelated() {",
      "}"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "builtin-geometry-type-mismatch" })
    ]));
    expect(compiled.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "builtin-geometry-argument-invalid" })
    ]));
    expect(compiled.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "set-rhs-unresolved" })
    ]));
  });

  it("accepts line parameter and module-local derived point operands", () => {
    const compiled = compileWithIds([
      "nui 4",
      "line Baseline = segment(start: (0, 0), end: (10, 0))",
      "module Example(baseline: line) {",
      "  line Local = segment(start: (0, 0), end: (0, 2))",
      "  const angleValue: number = lineAngle(@baseline, @Local)",
      "  const parameterStart: number = distance(@baseline.start, @Local.end)",
      "  const parameterEnd: number = angle(@baseline.end, @Local.start)",
      "  const localEndDistance: number = lineDistance(@Local.end, @baseline)",
      "}",
      "instance A = Example(baseline: @Baseline)"
    ].join("\n"));
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    const valueFor = (name: string) => {
      const binding = compiled.bindingAnalysis!.catalog.bindings.find((candidate) => candidate.kind === "typed" && candidate.name === name);
      return binding ? result.computedScalarBindings?.get(binding.id) : undefined;
    };
    expect(valueFor("parameterStart")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
    expect(valueFor("angleValue")).toMatchObject({ status: "ok", value: { kind: "number", value: 90 } });
    expect(valueFor("parameterEnd")).toMatchObject({ status: "ok", value: { kind: "number", value: 180 } });
    expect(valueFor("localEndDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
  });

  it("lowers derived point builtin operands mixed with module scalar references in geometry", () => {
    const compiled = compileWithIds([
      "nui 4",
      "line Baseline = segment(start: (0, 0), end: (10, 0))",
      "point P = coordinate(x: 3, y: 4)",
      "module Example(baseline: line, p: point, delta: number) {",
      "  const derivedDistance: number = distance(@baseline.start, @p)",
      "  point Q = coordinate(x: @derivedDistance + @delta, y: 0)",
      "}",
      "instance Use = Example(baseline: @Baseline, p: @P, delta: 2)"
    ].join("\n"));
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(elementNamed(compiled, "Q").id)).toMatchObject({ kind: "point", x: 7, y: 0 });
  });

  it("bridges root typed declarations through module geometry exports", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module Source() {",
      "  export point P = coordinate(x: 3, y: 4)",
      "  export line L = segment(start: (0, 0), end: (1, 0))",
      "}",
      "instance A = Source()",
      "point Origin = coordinate(x: 0, y: 0)",
      "const distanceValue: number = distance(@A::P, @Origin)",
      "const lineValue: number = lineDistance(@A::P, @A::L)"
    ].join("\n"));
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    const scalarValue = (name: string) => {
      const binding = compiled.bindingAnalysis!.catalog.bindings.find((candidate) => candidate.kind === "typed" && candidate.name === name);
      return binding ? result.computedScalarBindings?.get(binding.id) : undefined;
    };
    expect(scalarValue("distanceValue")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
    expect(scalarValue("lineValue")).toMatchObject({ status: "ok", value: { kind: "number", value: 4 } });
    for (const name of ["distanceValue", "lineValue"]) {
      const binding = compiled.bindingAnalysis!.catalog.bindings.find((candidate) => candidate.kind === "typed" && candidate.name === name)!;
      const initializer = compiled.scalarProgram!.statements.find((statement) => statement.bindingId === binding.id)!.declaration.initializer;
      expect(initializer).toMatchObject({ kind: "call" });
      expect((initializer as Extract<typeof initializer, { kind: "call" }>).args.every((argument) =>
        argument.kind !== "geometryReference" || argument.target?.statementId.startsWith("module-runtime:") || compiled.document!.elements.some((element) => element.id === argument.target?.statementId)
      )).toBe(true);
    }
  });

  it("lowers module-local and child-module geometry exports through the same builtin target", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module Child() {",
      "  export point P = coordinate(x: 3, y: 4)",
      "  export line L = segment(start: (0, 0), end: (1, 0))",
      "}",
      "module Parent() {",
      "  point Origin = coordinate(x: 0, y: 0)",
      "  point P = coordinate(x: 3, y: 4)",
      "  line LocalLine = segment(start: (0, 0), end: (0, 1))",
      "  instance Kid = Child()",
      "  const localDistance: number = distance(@Origin, @P)",
      "  const childDistance: number = distance(@Kid::P, @Origin)",
      "  const childLineDistance: number = lineDistance(@P, @Kid::L)",
      "  const childLineAngle: number = lineAngle(@LocalLine, @Kid::L)",
      "}",
      "instance Use = Parent()"
    ].join("\n"));
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    const valueFor = (name: string) => {
      const bindings = compiled.bindingAnalysis!.catalog.bindings.filter((candidate) => candidate.kind === "typed" && candidate.name === name);
      return bindings.map((binding) => result.computedScalarBindings?.get(binding.id));
    };
    expect(valueFor("localDistance")).toEqual([expect.objectContaining({ status: "ok", value: { kind: "number", value: 5 } })]);
    expect(valueFor("childDistance")).toEqual([expect.objectContaining({ status: "ok", value: { kind: "number", value: 5 } })]);
    expect(valueFor("childLineDistance")).toEqual([expect.objectContaining({ status: "ok", value: { kind: "number", value: 4 } })]);
    expect(valueFor("childLineAngle")).toEqual([expect.objectContaining({ status: "ok", value: { kind: "number", value: 90 } })]);
  });

  it("publishes one instance-local scalar export binding for each module call", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module Child(input: number) {",
      "  const twice: number = @input * 2",
      "  export const value: number = @twice + 1",
      "}",
      "module Consumer(seed: number) {",
      "  instance child = Child(input: @seed)",
      "  const exported: number = @child::value",
      "  point Result = coordinate(x: @exported, y: 0)",
      "}",
      "instance A = Consumer(seed: 10)",
      "instance B = Consumer(seed: 20)"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(compiled.document!.elements.filter((element) => element.name === "Result").map((element) =>
      result.computedGeometry.get(element.id)
    )).toEqual([
      expect.objectContaining({ kind: "point", x: 21, y: 0 }),
      expect.objectContaining({ kind: "point", x: 41, y: 0 })
    ]);

    const exported = compiled.moduleSemanticAnalysis!.definitions.find((definition) => definition.name === "Consumer")!.localScalars
      .find((local) => local.name === "exported");
    expect(exported?.initializer?.references[0]).toMatchObject({
      name: "child::value",
      resolution: "resolved",
      target: {
        kind: "deferredModuleScalarExport",
        exportName: "value",
        declaredType: { kind: "number" }
      }
    });
  });

  it("resolves an exported scalar from a module instance in a root scalar initializer", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(input: number) {",
      "  export let result: number = 0",
      "  set result = @input * 2",
      "}",
      "instance A = M(input: 10)",
      "instance B = M(input: 20)",
      "const valueA: number = @A::result",
      "const valueB: number = @B::result",
      "point ResultA = coordinate(x: @valueA, y: 0)",
      "point ResultB = coordinate(x: @valueB, y: 0)"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(elementNamed(compiled, "ResultA").id)).toMatchObject({ kind: "point", x: 20, y: 0 });
    expect(result.computedGeometry.get(elementNamed(compiled, "ResultB").id)).toMatchObject({ kind: "point", x: 40, y: 0 });
  });

  it("resolves a root sibling scalar export when it is used as a module argument", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module Producer(input: number) {",
      "  export const value: number = @input * 2",
      "}",
      "module Consumer(input: number) {",
      "  export const result: number = @input + 1",
      "}",
      "instance A = Producer(input: 10)",
      "instance B = Consumer(input: @A::value)",
      "const result: number = @B::result",
      "point Result = coordinate(x: @result, y: 0)"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(elementNamed(compiled, "Result").id)).toMatchObject({ kind: "point", x: 21, y: 0 });
  });

  it("keeps visible and hidden scalar exports usable but disables later references from disabled instances", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(input: number) {",
      "  export const value: number = @input * 2",
      "  export point P = coordinate(x: @value, y: 0)",
      "}",
      "instance Default = M(input: 3)",
      "instance Hidden(state: hidden) = M(input: 4)",
      "instance Disabled(state: disabled) = M(input: 5)",
      "const defaultValue: number = @Default::value",
      "const hiddenValue: number = @Hidden::value",
      "const disabledValue: number = @Disabled::value",
      "point DefaultResult = coordinate(x: @defaultValue, y: 0)",
      "point HiddenResult = coordinate(x: @hiddenValue, y: 0)",
      "point DisabledResult = coordinate(x: @disabledValue, y: 0)"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    const bindingValue = (name: string) => {
      const binding = compiled.bindingAnalysis?.catalog.bindings.find((candidate) => candidate.name === name);
      return binding ? result.computedScalarBindings?.get(binding.id) : undefined;
    };
    expect(bindingValue("Default::value")).toMatchObject({ status: "ok", value: { value: 6 } });
    expect(bindingValue("Hidden::value")).toMatchObject({ status: "ok", value: { value: 8 } });
    expect(bindingValue("Disabled::value")).toMatchObject({ status: "error" });
    expect(result.computedGeometry.get(elementNamed(compiled, "DefaultResult").id)).toMatchObject({ kind: "point", x: 6 });
    expect(result.computedGeometry.get(elementNamed(compiled, "HiddenResult").id)).toMatchObject({ kind: "point", x: 8 });
    expect(result.computedGeometry.has(elementNamed(compiled, "DisabledResult").id)).toBe(false);
    expect(result.errors.some((error) => error.elementName === "DisabledResult")).toBe(true);
  });

  it("resolves nested sibling scalar exports per repeated parent instance", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module Producer(input: number) {",
      "  export const value: number = @input * 2",
      "}",
      "module Consumer(input: number) {",
      "  export const result: number = @input + 1",
      "}",
      "module Parent(seed: number) {",
      "  instance a = Producer(input: @seed)",
      "  instance b = Consumer(input: @a::value)",
      "  export const result: number = @b::result",
      "}",
      "instance A = Parent(seed: 10)",
      "instance B = Parent(seed: 20)",
      "const resultA: number = @A::result",
      "const resultB: number = @B::result",
      "point ResultA = coordinate(x: @resultA, y: 0)",
      "point ResultB = coordinate(x: @resultB, y: 0)"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(elementNamed(compiled, "ResultA").id)).toMatchObject({ kind: "point", x: 21, y: 0 });
    expect(result.computedGeometry.get(elementNamed(compiled, "ResultB").id)).toMatchObject({ kind: "point", x: 41, y: 0 });
  });

  it("resolves same-named module instances within their own lexical groups", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module Producer(input: number) {",
      "  export const value: number = @input * 2",
      "}",
      "group Left {",
      "  instance foo = Producer(input: 10)",
      "  const value: number = @foo::value",
      "  point ResultLeft = coordinate(x: @value, y: 0)",
      "}",
      "group Right {",
      "  instance foo = Producer(input: 20)",
      "  const value: number = @foo::value",
      "  point ResultRight = coordinate(x: @value, y: 0)",
      "}"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(elementNamed(compiled, "ResultLeft").id)).toMatchObject({ kind: "point", x: 20, y: 0 });
    expect(result.computedGeometry.get(elementNamed(compiled, "ResultRight").id)).toMatchObject({ kind: "point", x: 40, y: 0 });
  });

  it("diagnoses private members without publishing them as scalar bindings", () => {
    const scoped = compileWithIds([
      "nui 4",
      "module Producer(input: number) {",
      "  const privateValue: number = @input * 3",
      "  export const value: number = @input * 2",
      "}",
      "group Inside {",
      "  instance localFoo = Producer(input: 10)",
      "  const local: number = @localFoo::value",
      "}",
      "const outside: number = @localFoo::value",
      "instance foo = Producer(input: 20)",
      "const privateOutside: number = @foo::privateValue",
      "const unknownOutside: number = @foo::doesNotExist"
    ].join("\n"));
    const references = scoped.bindingAnalysis?.initializerReferences.filter((reference) =>
      reference.name === "localFoo::value" || reference.name === "foo::privateValue" || reference.name === "foo::doesNotExist"
    ) ?? [];
    expect(references).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "localFoo::value", resolution: expect.objectContaining({ kind: "undefined" }) }),
      expect.objectContaining({ name: "foo::privateValue", resolution: expect.objectContaining({ kind: "namespace", reason: "private" }) }),
      expect.objectContaining({ name: "foo::doesNotExist", resolution: expect.objectContaining({ kind: "namespace", reason: "incompatible" }) })
    ]));
    expect(scoped.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-private-member" })
    ]));
    expect(scoped.bindingAnalysis?.catalog.bindings.some((binding) => binding.name === "foo::privateValue")).toBe(false);

    const unknown = compileWithIds([
      "nui 4",
      "module Producer(input: number) {",
      "  const privateValue: number = @input * 3",
      "  export const value: number = @input * 2",
      "}",
      "instance foo = Producer(input: 20)",
      "const unknown: number = @foo::doesNotExist"
    ].join("\n"));
    expect(unknown.diagnostics.some((diagnostic) => diagnostic.code === "module-private-member")).toBe(false);
  });

  it("materializes parameter and local numeric bindings independently for repeated instances", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(width: number) {",
      "  const doubled: number = @width + 1",
      "  point P = coordinate(x: @doubled, y: 0)",
      "}",
      "instance A = M(width: 10)",
      "instance B = M(width: 20)"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(elementNamed(compiled, "P").id)).toMatchObject({ kind: "point" });
    const points = compiled.document!.elements
      .filter((element) => element.name === "P")
      .map((element) => result.computedGeometry.get(element.id));
    expect(points).toEqual([
      expect.objectContaining({ kind: "point", x: 11, y: 0 }),
      expect.objectContaining({ kind: "point", x: 21, y: 0 })
    ]);

    const moduleBindings = compiled.bindingAnalysis!.catalog.bindings.filter((binding) => binding.id.startsWith("module-binding:"));
    expect(moduleBindings).toHaveLength(4);
    expect(new Set(moduleBindings.map((binding) => binding.id)).size).toBe(4);
  });

  it("uses a default scalar parameter and connects a materialized choice property", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(side: choice(right, left) = left) {",
      "  point A = coordinate(x: 0, y: 0)",
      "  point B = coordinate(x: 10, y: 0)",
      "  line AB = segment(start: @A, end: @B)",
      "  line Off = offset(sources: [@AB], distance: 5, side: @side, closed: false, suppressTrimWarnings: false)",
      "}",
      "instance Instance = M()"
    ].join("\n"));
    expectValid(compiled);
    expect(compiled.materializedPropertyBindings).toHaveLength(1);

    const result = evaluateCompiled(compiled);
    const offset = elementNamed(compiled, "Off");
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(offset.id)).toBeDefined();
  });

  it("evaluates instance-local let/set chains in body source order", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(value: number) {",
      "  let local: number = @value",
      "  point Before = coordinate(x: @local, y: 0)",
      "  set local = @local + 1",
      "  point After = coordinate(x: @local, y: 0)",
      "}",
      "instance A = M(value: 10)",
      "instance B = M(value: 20)"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(compiled.document!.elements.filter((element) => element.name === "Before").map((element) =>
      result.computedGeometry.get(element.id)
    )).toEqual([
      expect.objectContaining({ x: 10 }),
      expect.objectContaining({ x: 20 })
    ]);
    expect(compiled.document!.elements.filter((element) => element.name === "After").map((element) =>
      result.computedGeometry.get(element.id)
    )).toEqual([
      expect.objectContaining({ x: 11 }),
      expect.objectContaining({ x: 21 })
    ]);
    expect(compiled.bindingVersions?.versions.filter((version) => version.kind === "set")).toHaveLength(2);
  });

  it("connects a materialized string property through the text binding runtime", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(label: string) {",
      "  text T = label(text: @label, anchor: none, size: 3)",
      "}",
      'instance A = M(label: "A")',
      'instance B = M(label: "B")'
    ].join("\n"));
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(compiled.document!.elements.filter((element) => element.name === "T").map((element) =>
      result.computedGeometry.get(element.id)
    )).toEqual([
      expect.objectContaining({ kind: "text", text: "A" }),
      expect.objectContaining({ kind: "text", text: "B" })
    ]);
  });

  it("captures caller scalar state at each call position", () => {
    const compiled = compileWithIds([
      "nui 4",
      "let value: number = 1",
      "module M(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "instance First = M(width: @value)",
      "set value = 10",
      "instance Second = M(width: @value)"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(compiled.document!.elements.filter((element) => element.name === "P").map((element) =>
      result.computedGeometry.get(element.id)
    )).toEqual([
      expect.objectContaining({ x: 1 }),
      expect.objectContaining({ x: 10 })
    ]);
  });

  it("keeps nested module instances independent and stops at the outer call boundary", () => {
    const source = [
      "nui 4",
      "module Inner(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "module Outer(width: number) {",
      "  instance Nested = Inner(width: @width)",
      "}",
      "instance First = Outer(width: 3)",
      "stop",
      "instance Second = Outer(width: 7)"
    ].join("\n");
    const compiled = compileWithIds(source);
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    const points = compiled.document!.elements.filter((element) => element.name === "P");
    expect(points).toHaveLength(2);
    expect(result.computedGeometry.get(points[0].id)).toMatchObject({ x: 3 });
    expect(result.computedGeometry.has(points[1].id)).toBe(false);
    expect(compiled.bindingVersions?.requiresExecutionOrdering).toBe(true);
  });

  it("lowers an outer module local directly into a nested call argument", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module Inner(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "module Outer(width: number) {",
      "  let local: number = @width + 2",
      "  instance Nested = Inner(width: @local)",
      "}",
      "instance First = Outer(width: 3)",
      "instance Second = Outer(width: 7)"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(compiled.document!.elements.filter((element) => element.name === "P").map((element) =>
      result.computedGeometry.get(element.id)
    )).toEqual([
      expect.objectContaining({ x: 5 }),
      expect.objectContaining({ x: 9 })
    ]);
  });

  it("preserves module binding identities through a reconciled body edit", () => {
    const beforeSource = [
      "nui 4",
      "module M(width: number) {",
      "  let local: number = @width",
      "  set local = @local + 1",
      "  point P = coordinate(x: @local, y: 0)",
      "}",
      "instance Instance = M(width: 10)"
    ].join("\n");
    const before = compileWithIds(beforeSource, "stable");
    expectValid(before);
    const parsed = parseDsl(beforeSource.replace("+ 1", "+ 2"));
    const reconciled = reconcileStatements({
      oldStatements: before.statements,
      oldLines: before.sourceLines,
      oldElementIds: before.statementMap!.elementIdByStatementIndex,
      oldStatementIds: before.statementMap!.statementIdByStatementIndex,
      newStatements: parsed.statements,
      newLines: beforeSource.replace("+ 1", "+ 2").split("\n")
    });
    const after = compileDslDocument(beforeSource.replace("+ 1", "+ 2"), {
      preparsed: parsed,
      assignedStatementIds: reconciled.assignedIds
    });
    expectValid(after);

    const beforeIds = before.bindingAnalysis!.catalog.bindings
      .filter((binding) => binding.id.startsWith("module-binding:"))
      .map((binding) => binding.id);
    const afterIds = after.bindingAnalysis!.catalog.bindings
      .filter((binding) => binding.id.startsWith("module-binding:"))
      .map((binding) => binding.id);
    expect(afterIds).toEqual(beforeIds);
    expect(after.bindingVersions?.versions.filter((version) => version.kind === "set").map((version) => version.id)).toEqual(
      before.bindingVersions?.versions.filter((version) => version.kind === "set").map((version) => version.id)
    );
  });

  it("does not leak private module parameters into caller source lookup", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "instance A = M(width: 10)",
      "instance B = M(width: 20)",
      "point Q = coordinate(x: @width, y: 0)"
    ].join("\n"));
    expect(compiled.diagnostics.some((diagnostic) => diagnostic.code === "numeric-binding-unresolved")).toBe(true);
    expect(compiled.diagnostics.some((diagnostic) => diagnostic.code === "duplicate-binding" && diagnostic.message.includes("module-binding:"))).toBe(false);
    const moduleBindings = compiled.bindingAnalysis?.catalog.bindings.filter((binding) => binding.id.startsWith("module-binding:")) ?? [];
    expect(moduleBindings).toHaveLength(2);
    expect(compiled.bindingAnalysis?.catalog.declarationDuplicateBuckets.flat().some((binding) => binding.id.startsWith("module-binding:"))).toBe(false);
    expect(moduleBindings.every((binding) => binding.resolutionMode === "preResolvedOnly")).toBe(true);
  });

  it("keeps child and sibling module lexical scopes independent", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M() {",
      "  group First {",
      "    const x: number = 1",
      "    const y: number = @x",
      "    point P = coordinate(x: @y, y: 0)",
      "  }",
      "  group Second {",
      "    const x: number = 2",
      "    const y: number = @x",
      "    point Q = coordinate(x: @y, y: 0)",
      "  }",
      "}",
      "instance A = M()"
    ].join("\n"));
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(elementNamed(compiled, "P").id)).toMatchObject({ x: 1 });
    expect(result.computedGeometry.get(elementNamed(compiled, "Q").id)).toMatchObject({ x: 2 });
  });

  it("does not execute an inactive module conditional set", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(enabled: boolean) {",
      "  let value: number = 1",
      "  if (@enabled) {",
      "    set value = 2",
      "  }",
      "  point P = coordinate(x: @value, y: 0)",
      "}",
      "instance A = M(enabled: false)",
      "instance B = M(enabled: true)"
    ].join("\n"));
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(compiled.document!.elements.filter((element) => element.name === "P").map((element) => result.computedGeometry.get(element.id))).toEqual([
      expect.objectContaining({ x: 1 }),
      expect.objectContaining({ x: 2 })
    ]);
  });

  it("runs module forGroup scalar locals per iteration", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M() {",
      "  for i in range(from: 1, count: 2, step: 1) {",
      "    const local: number = @i",
      "    point P = coordinate(x: @local, y: 0)",
      "  }",
      "}",
      "instance A = M()"
    ].join("\n"));
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.forGroupGeneratedRows).toHaveLength(2);
    expect([...result.computedGeometry.values()].filter((value) => value.kind === "point").map((value) => value.x)).toEqual([1, 2]);
  });

  it("inherits a document forGroup caller and its iteration binding into a root module call", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(x: number) {",
      "  point P = coordinate(x: @x, y: 0)",
      "}",
      "for i in range(from: 1, count: 2, step: 1) {",
      "  instance A = M(x: @i)",
      "}"
    ].join("\n"));
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect([...result.computedGeometry.values()].filter((value) => value.kind === "point").map((value) => value.x)).toEqual([1, 2]);
  });

  it("activates only the module call in the active document conditional", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(x: number) {",
      "  point P = coordinate(x: @x, y: 0)",
      "}",
      "if (false) {",
      "  instance Off = M(x: 1)",
      "}",
      "if (true) {",
      "  instance On = M(x: 2)",
      "}"
    ].join("\n"));
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect([...result.computedGeometry.values()].filter((value) => value.kind === "point").map((value) => value.x)).toEqual([2]);
  });

  it("keeps typed module bindings in a mixed module numeric expression", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(base: number) {",
      "  for i in range(from: 1, count: 2, step: 1) {",
      "    const local: number = @base",
      "    point P = coordinate(x: @local + @i, y: 0)",
      "  }",
      "}",
      "instance A = M(base: 10)"
    ].join("\n"));
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect([...result.computedGeometry.values()].filter((value) => value.kind === "point").map((value) => value.x)).toEqual([11, 12]);
  });

  it("passes an iteration-local scalar into a nested module call", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module Inner(width: number = 9) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "module Outer() {",
      "  for i in range(from: 1, count: 2, step: 1) {",
      "    instance Nested = Inner(width: @i)",
      "  }",
      "}",
      "instance A = Outer()"
    ].join("\n"));
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect([...result.computedGeometry.values()].filter((value) => value.kind === "point").map((value) => value.x)).toEqual([1, 2]);
  });

  it("lowers module geometry properties to fixed runtime targets", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M() {",
      "  line A = segment(start: (0, 0), end: (10, 0))",
      "  const length: number = @A.length",
      "  point P = coordinate(x: @length, y: 0)",
      "}",
      "instance X = M()"
    ].join("\n"));
    expectValid(compiled);
    const initializer = compiled.scalarProgram?.statements.find((statement) => statement.bindingId.includes("module-binding"))?.declaration.initializer;
    expect(initializer).toEqual(expect.objectContaining({ kind: "geometryProperty", elementId: expect.any(String), targetSourceOrder: expect.any(Number) }));
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(elementNamed(compiled, "P").id)).toMatchObject({ x: 10 });
  });

  it("lowers an ordinary document geometry property in a module argument", () => {
    const compiled = compileWithIds([
      "nui 4",
      "point Base = coordinate(x: 10, y: 0)",
      "module M(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "instance X = M(width: @Base.x)"
    ].join("\n"));
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(elementNamed(compiled, "P").id)).toMatchObject({ x: 10 });
  });

  it("materializes quoted module text templates from resolved semantic holes", () => {
    const compiled = compileWithIds([
      "nui 4",
      "module M(label: string) {",
      '  text T = label(text: "value=${@label}", anchor: none, size: 3)',
      "}",
      'instance A = M(label: "A")',
      'instance B = M(label: "B")'
    ].join("\n"));
    expectValid(compiled);
    expect(compiled.materializedTextTemplates).toHaveLength(2);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(compiled.document!.elements.filter((element) => element.name === "T").map((element) => result.computedGeometry.get(element.id))).toEqual([
      expect.objectContaining({ kind: "text", text: "value=A" }),
      expect.objectContaining({ kind: "text", text: "value=B" })
    ]);
  });

});
