import { describe, expect, it } from "vitest";
import { reconcileStatements } from "../document/statementReconciler";
import { buildNumericBindingRuntimeEntries } from "../geometry/numericBindingRuntime";
import { buildPropertyBindingRuntimeEntries } from "../geometry/propertyBindingRuntime";
import { buildTextPropertyBindingRuntimeEntries, buildTextTemplateEntriesByElementId } from "../geometry/textTemplateRuntime";
import { evaluateElements } from "../geometry/evaluate";
import { buildConditionalMutationOwners, conditionalOwnerIdByElementId } from "../scalars/conditionalMutationControl";
import { buildForGroupMutationOwners, forGroupMutationOwnerByElementId } from "../scalars/forGroupMutationControl";
import { isGroupPrintEnabled } from "../geometry/groupPrintEnabledRuntime";
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
  it("publishes one instance-local scalar export binding for each module call", () => {
    const compiled = compileWithIds([
      "nui 3",
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
      "nui 3",
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
      "nui 3",
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
      "nui 3",
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
      "nui 3",
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
      "nui 3",
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
      "nui 3",
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
      "nui 3",
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
      "nui 3",
      "module M(width: number) {",
      "  const doubled: number = @width + 1",
      "  point P = coordinate(x: @doubled, y: 0)",
      "}",
      "module A = M(width: 10)",
      "module B = M(width: 20)"
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
      "nui 3",
      "module M(side: choice(right, left) = left) {",
      "  point A = coordinate(x: 0, y: 0)",
      "  point B = coordinate(x: 10, y: 0)",
      "  line AB = segment(start: @A, end: @B)",
      "  line Off = offset(sources: [@AB], distance: 5, side: @side, closed: false, suppressTrimWarnings: false)",
      "}",
      "module Instance = M()"
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
      "nui 3",
      "module M(value: number) {",
      "  let local: number = @value",
      "  point Before = coordinate(x: @local, y: 0)",
      "  set local = @local + 1",
      "  point After = coordinate(x: @local, y: 0)",
      "}",
      "module A = M(value: 10)",
      "module B = M(value: 20)"
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
      "nui 3",
      "module M(label: string) {",
      "  text T = label(text: @label, anchor: none, size: 3)",
      "}",
      'module A = M(label: "A")',
      'module B = M(label: "B")'
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
      "nui 3",
      "let value: number = 1",
      "module M(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "module First = M(width: @value)",
      "set value = 10",
      "module Second = M(width: @value)"
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
      "nui 3",
      "module Inner(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "module Outer(width: number) {",
      "  module Nested = Inner(width: @width)",
      "}",
      "module First = Outer(width: 3)",
      "@stop",
      "module Second = Outer(width: 7)"
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
      "nui 3",
      "module Inner(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "module Outer(width: number) {",
      "  let local: number = @width + 2",
      "  module Nested = Inner(width: @local)",
      "}",
      "module First = Outer(width: 3)",
      "module Second = Outer(width: 7)"
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
      "nui 3",
      "module M(width: number) {",
      "  let local: number = @width",
      "  set local = @local + 1",
      "  point P = coordinate(x: @local, y: 0)",
      "}",
      "module Instance = M(width: 10)"
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
      "nui 3",
      "module M(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "module A = M(width: 10)",
      "module B = M(width: 20)",
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
      "nui 3",
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
      "module A = M()"
    ].join("\n"));
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(elementNamed(compiled, "P").id)).toMatchObject({ x: 1 });
    expect(result.computedGeometry.get(elementNamed(compiled, "Q").id)).toMatchObject({ x: 2 });
  });

  it("does not execute an inactive module conditional set", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module M(enabled: boolean) {",
      "  let value: number = 1",
      "  if Branch (@enabled) {",
      "    set value = 2",
      "  }",
      "  point P = coordinate(x: @value, y: 0)",
      "}",
      "module A = M(enabled: false)",
      "module B = M(enabled: true)"
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
      "nui 3",
      "module M() {",
      "  for Loop (i, from: 1, count: 2, step: 1) {",
      "    const local: number = @i",
      "    point P = coordinate(x: @local, y: 0)",
      "  }",
      "}",
      "module A = M()"
    ].join("\n"));
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.forGroupGeneratedRows).toHaveLength(2);
    expect([...result.computedGeometry.values()].filter((value) => value.kind === "point").map((value) => value.x)).toEqual([1, 2]);
  });

  it("inherits a document forGroup caller and its iteration binding into a root module call", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module M(x: number) {",
      "  point P = coordinate(x: @x, y: 0)",
      "}",
      "for Loop (i, from: 1, count: 2, step: 1) {",
      "  module A = M(x: @i)",
      "}"
    ].join("\n"));
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect([...result.computedGeometry.values()].filter((value) => value.kind === "point").map((value) => value.x)).toEqual([1, 2]);
  });

  it("activates only the module call in the active document conditional", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module M(x: number) {",
      "  point P = coordinate(x: @x, y: 0)",
      "}",
      "if Disabled (false) {",
      "  module Off = M(x: 1)",
      "}",
      "if Enabled (true) {",
      "  module On = M(x: 2)",
      "}"
    ].join("\n"));
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect([...result.computedGeometry.values()].filter((value) => value.kind === "point").map((value) => value.x)).toEqual([2]);
  });

  it("keeps typed module bindings in a mixed module numeric expression", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module M(base: number) {",
      "  for Loop (i, from: 1, count: 2, step: 1) {",
      "    const local: number = @base",
      "    point P = coordinate(x: @local + @i, y: 0)",
      "  }",
      "}",
      "module A = M(base: 10)"
    ].join("\n"));
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect([...result.computedGeometry.values()].filter((value) => value.kind === "point").map((value) => value.x)).toEqual([11, 12]);
  });

  it("maps a module scalar in a materialized element-local vars expression", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module M(width: number) {",
      "  point P = coordinate(x: @width + @local, y: 0, vars: [local: 5])",
      "}",
      "module A = M(width: 10)"
    ].join("\n"));
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(elementNamed(compiled, "P").id)).toMatchObject({ kind: "point", x: 15 });
  });

  it("materializes a module scalar in an element-local vars initializer", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module M(width: number) {",
      "  point P = coordinate(x: @local, y: 0, vars: [local: @width + 5])",
      "}",
      "module A = M(width: 10)"
    ].join("\n"));
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(elementNamed(compiled, "P").id)).toMatchObject({ kind: "point", x: 15 });
  });

  it("passes an iteration-local scalar into a nested module call", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module Inner(width: number = 9) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "module Outer() {",
      "  for Loop (i, from: 1, count: 2, step: 1) {",
      "    module Nested = Inner(width: @i)",
      "  }",
      "}",
      "module A = Outer()"
    ].join("\n"));
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect([...result.computedGeometry.values()].filter((value) => value.kind === "point").map((value) => value.x)).toEqual([1, 2]);
  });

  it("lowers module geometry properties to fixed runtime targets", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module M() {",
      "  line A = segment(start: (0, 0), end: (10, 0))",
      "  const length: number = @A.length",
      "  point P = coordinate(x: @length, y: 0)",
      "}",
      "module X = M()"
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
      "nui 3",
      "point Base = coordinate(x: 10, y: 0)",
      "module M(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "module X = M(width: @Base.x)"
    ].join("\n"));
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(elementNamed(compiled, "P").id)).toMatchObject({ x: 10 });
  });

  it("materializes quoted module text templates from resolved semantic holes", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module M(label: string) {",
      '  text T = label(text: "value={@label}", anchor: none, size: 3)',
      "}",
      'module A = M(label: "A")',
      'module B = M(label: "B")'
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

  it("applies materialized group.printEnabled per module instance", () => {
    const compiled = compileWithIds([
      "nui 3",
      "module M(enabled: boolean) {",
      "  group G (printEnabled: @enabled) {",
      "    point P = coordinate(x: 0, y: 0)",
      "  }",
      "}",
      "module A = M(enabled: false)",
      "module B = M(enabled: true)"
    ].join("\n"));
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    const groups = compiled.document!.elements.filter((element): element is Extract<typeof element, { type: "group" }> => element.type === "group");
    const lookup = { propertyBindings: compiled.propertyBindings, byElementId: compiled.statementMap!.byElementId, materializedPropertyBindings: compiled.materializedPropertyBindings, materializedBindingsByElementId: compiled.materializedGroupPrintEnabledBindings };
    expect(groups.map((group) => isGroupPrintEnabled(group, lookup, result.computedScalarBindings))).toEqual([false, true]);
  });
});
