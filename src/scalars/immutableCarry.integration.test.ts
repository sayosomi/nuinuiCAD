import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel, type LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import { emptyDocument } from "@nuinuicad/nui-language";
import { evaluateElements } from "../geometry/evaluate";
import { buildForGroupExecutionOwners, forGroupMutationOwnerByElementId } from "./forGroupMutationControl";

const compile = (source: string): LastGoodDslDocument => {
  const result = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), source);
  if (result.status === "fatal") throw new Error(JSON.stringify(result.diagnostics));
  return result.doc;
};

const optionsFor = (compiled: LastGoodDslDocument) => ({
  scalarProgram: compiled.scalarProgram,
  geometryValueProgram: compiled.geometryValueProgram,
  geometryInputTargetsByElementId: new Map([
    ...(compiled.geometryInputTargetsByElementId ?? []),
    ...(compiled.moduleGeometryRuntime?.geometryInputTargetsByRuntimeElementId ?? [])
  ]),
  geometryCollectionNodesByValueId: compiled.moduleGeometryRuntime?.geometryCollectionNodesByValueId,
  typedDependencyGraph: compiled.typedDependencyGraph,
  evaluationOrder: compiled.typedDependencyGraph?.evaluationOrder,
  transformationDependencyPlans: compiled.typedDependencyGraph?.transformationPlans,
  moduleMaterialization: compiled.moduleMaterialization,
  bindingVersions: compiled.bindingVersions,
  statementInfoByElementId: compiled.statementMap.byElementId,
  statementIdByStatementIndex: compiled.statementMap.statementIdByStatementIndex,
  sourceExecutionPositionByElementId: compiled.moduleMaterialization?.sourceExecutionPositionByRuntimeElementId,
  scalarExecutionPositionByElementId: compiled.scalarExecutionPositionByRuntimeElementId,
  forGroupMutationOwnerByElementId: compiled.bindingVersions
    ? new Map([
        ...forGroupMutationOwnerByElementId(buildForGroupExecutionOwners(
          compiled.bindingVersions,
          compiled.document.elements,
          compiled.statementMap.byElementId,
          compiled.statementMap.statementIdByStatementIndex,
          new Set(compiled.moduleForGroupExecutionOwnerByElementId
            ? [...compiled.moduleForGroupExecutionOwnerByElementId.values()].map((owner) => owner.ownerStatementId)
            : [])
        )),
        ...(compiled.moduleForGroupExecutionOwnerByElementId ? [...compiled.moduleForGroupExecutionOwnerByElementId] : [])
      ])
    : undefined,
  moduleForGroupExecutionOwnerByElementId: compiled.moduleForGroupExecutionOwnerByElementId
});

const scalarFor = (
  compiled: LastGoodDslDocument,
  evaluation: ReturnType<typeof evaluateElements>,
  name: string
) => {
  const binding = compiled.bindingAnalysis?.catalog.bindings.find(
    (candidate) => candidate.kind === "typed" && candidate.name === name
  );
  if (!binding) throw new Error(`typed binding ${name} not found`);
  return evaluation.computedScalarBindings?.get(binding.id);
};

describe("immutable statement-for carries", () => {
  it("compiles and evaluates the normative multiline carry header", () => {
    const compiled = compile([
      "nui 1",
      "for i in range(min: 0, max: 2, step: 1)",
      "carry total: number = 0",
      "carry count: number = 0 {",
      "  next total = @total + @i",
      "  next count = @count + 1",
      "}",
      "const result: number = @total"
    ].join("\n"));
    const carries = [...(compiled.bindingVersions?.immutableForGroups?.values() ?? [])]
      .flatMap((plan) => plan.carries);
    expect(carries).toHaveLength(2);
    expect(carries.every((carry) => carry.nextBindingId?.startsWith("binding:next:") && !carry.nextBindingId.startsWith("module-binding:"))).toBe(true);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 3 }
    });
  });

  it("swaps multiple carries from one iteration-start snapshot and escapes the final value", () => {
    const compiled = compile([
      "nui 1",
      "for i in range(min: 0, max: 2, step: 1) carry a: number = 0 carry b: number = 1 {",
      "  next a = @b",
      "  next b = @a",
      "}",
      "const result: number = @a"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 1 }
    });
  });

  it("iterates scalar collection members with their exact binder type", () => {
    const compiled = compile([
      "nui 1",
      "const items: string[] = [\"a\", \"b\"]",
      "for item in @items carry last: string = \"\" {",
      "  next last = @item",
      "}",
      "const result: string = @last"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);
    const forGroup = compiled.document.elements.find((element) => element.type === "forGroup");
    expect(forGroup).toMatchObject({ iterationElementType: { kind: "string" } });
    expect(forGroup && forGroup.type === "forGroup" ? forGroup.iterationSourceValueId : undefined).toMatch(/^statement:typedDeclaration:/);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "string", value: "b" }
    });
  });

  it("keeps the carry initializer outside the per-iteration frame", () => {
    const compiled = compile([
      "nui 1",
      "for i in range(min: 0, max: 2, step: 1) carry total: number = 0 {",
      "  next total = @total + 1",
      "}",
      "const result: number = @total"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 3 }
    });
  });

  it("preserves optional scalar types for root carries and escaped values", () => {
    const initializedWithNone = compile([
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) carry maybe: number? = none {",
      "  next maybe = 3",
      "}",
      "const resolved: number = @maybe ?? 0"
    ].join("\n"));
    expect(initializedWithNone.diagnostics).toEqual([]);
    const initialPlan = [...(initializedWithNone.bindingVersions?.immutableForGroups?.values() ?? [])]
      .flatMap((plan) => plan.carries)[0];
    expect(initialPlan?.declaredType).toEqual({ kind: "optional", valueType: { kind: "number" } });
    const initialEvaluation = evaluateElements(initializedWithNone.document.elements, optionsFor(initializedWithNone));
    expect(initialEvaluation.errors).toEqual([]);
    const initialResultId = initializedWithNone.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "resolved")!.id;
    expect(initialEvaluation.computedScalarBindings?.get(initialResultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 3 }
    });

    const transitioned = compile([
      "nui 1",
      "const start: number? = none",
      "for i in range(min: 0, max: 2, step: 1) carry maybe: number? = @start {",
      "  next maybe = if (@i == 0) { 9 } else { if (@i == 1) { none } else { 12 } }",
      "}",
      "const resolved: number = @maybe ?? 0"
    ].join("\n"));
    expect(transitioned.diagnostics).toEqual([]);
    const transitionPlan = [...(transitioned.bindingVersions?.immutableForGroups?.values() ?? [])]
      .flatMap((plan) => plan.carries)[0];
    expect(transitionPlan?.declaredType).toEqual({ kind: "optional", valueType: { kind: "number" } });
    const maybeBindings = transitioned.bindingAnalysis!.catalog.bindings.filter((binding) =>
      binding.name === "maybe" || binding.name === "maybe:next"
    );
    expect(maybeBindings).toHaveLength(2);
    expect(maybeBindings.map((binding) => binding.declaredType)).toEqual([
      { kind: "optional", valueType: { kind: "number" } },
      { kind: "optional", valueType: { kind: "number" } }
    ]);
    const transitionEvaluation = evaluateElements(transitioned.document.elements, optionsFor(transitioned));
    expect(transitionEvaluation.errors).toEqual([]);
    const transitionResultId = transitioned.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "resolved")!.id;
    expect(transitionEvaluation.computedScalarBindings?.get(transitionResultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 12 }
    });

    const presentInitializer = compile([
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) carry maybe: number? = 5 {",
      "  next maybe = 6",
      "}",
      "const resolved: number = @maybe ?? 0"
    ].join("\n"));
    expect(presentInitializer.diagnostics).toEqual([]);

    const requiredUse = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) carry maybe: number? = none {",
      "  next maybe = 6",
      "}",
      "const invalid: number = @maybe"
    ].join("\n"));
    expect(requiredUse.status).toBe("fatal");
  });

  it("swaps collection carries through the shared collection runtime", () => {
    const compiled = compile([
      "nui 1",
      "const first: number[] = [1, 2]",
      "const second: number[] = [3, 4]",
      "for i in range(min: 0, max: 1, step: 1) carry a: number[] = @first carry b: number[] = @second {",
      "  next a = @b",
      "  next b = @a",
      "}",
      "const result: number = @a[0] + @b[1]"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 5 }
    });
  });

  it("resolves an inline optional collection match in a carry next at its source position", () => {
    const compiled = compile([
      "nui 1",
      "const p: number? = 1",
      "for i in range(min: 0, max: 0, step: 1) carry a: number[] = [0] {",
      "  next a = match @p { none => [2] some x => [1] }",
      "}",
      "const result: number = @a[0]"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 1 }
    });
  });

  it("selects the none arm of an inline optional collection match carry next", () => {
    const compiled = compile([
      "nui 1",
      "const p: number? = none",
      "for i in range(min: 0, max: 0, step: 1) carry a: number[] = [0] {",
      "  next a = match @p { none => [31, 32] some x => [@x] }",
      "}",
      "const first: number = @a[0]",
      "const second: number = @a[1]",
      "const length: number = @a.length"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    for (const [name, expected] of [["first", 31], ["second", 32], ["length", 2]] as const) {
      const bindingId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === name)!.id;
      expect(evaluation.computedScalarBindings?.get(bindingId)).toMatchObject({
        status: "ok",
        value: { kind: "number", value: expected }
      });
    }
  });

  it("keeps an error-producing unselected inline collection match arm lazy", () => {
    const compiled = compile([
      "nui 1",
      "const p: number? = 5",
      "for i in range(min: 0, max: 0, step: 1) carry a: number[] = [0] {",
      "  next a = match @p { none => if (1 / 0 > 0) { [90] } else { [91] } some x => [@x] }",
      "}",
      "const result: number = @a[0]"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 5 }
    });
  });

  it("preserves nominal record element identity through an inline collection carry match", () => {
    const compiled = compile([
      "nui 1",
      "record Pair(x: number, label: string)",
      'const first: Pair = Pair(x: 1, label: "first")',
      'const fallback: Pair = Pair(x: 2, label: "fallback")',
      "const p: number? = 1",
      "for i in range(min: 0, max: 0, step: 1) carry items: Pair[] = [@fallback] {",
      "  next items = match @p { none => [@fallback] some x => [@first] }",
      "}",
      "const result: number = @items.length"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 1 }
    });
  });

  it("resolves inline optional collection carry matches inside isolated Module instances", () => {
    const compiled = compile([
      "nui 1",
      "module Select(p: number?, items: number[]) {",
      "  const selector: number? = @p",
      "  const localItems: number[] = @items",
      "  for i in range(min: 0, max: 0, step: 1) carry selected: number[] = [] {",
      "    next selected = match @selector { none => @localItems some x => [@x] }",
      "  }",
      "  export const first: number = @selected[0]",
      "  export const length: number = @selected.length",
      "}",
      "instance Absent = Select(p: none, items: [9, 8])",
      "const absentFirst: number = @Absent::first",
      "const absentLength: number = @Absent::length"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    for (const [name, expected] of [
      ["absentFirst", 9],
      ["absentLength", 2]
    ] as const) {
      expect(scalarFor(compiled, evaluation, name)).toMatchObject({
        status: "ok",
        value: { kind: "number", value: expected }
      });
    }
  });

  it("preserves inline optional-match collection carries across Module instances in either declaration order", () => {
    const module = [
      "module Select(p: number?, items: number[]) {",
      "  const selector: number? = @p",
      "  const localItems: number[] = @items",
      "  for i in range(min: 0, max: 0, step: 1) carry selected: number[] = [] {",
      "    next selected = match @selector { none => @localItems some x => [@x] }",
      "  }",
      "  export const first: number = @selected[0]",
      "  export const length: number = @selected.length",
      "}"
    ];
    const outputs = [
      "const presentFirst: number = @Present::first",
      "const presentLength: number = @Present::length",
      "const absentFirst: number = @Absent::first",
      "const absentLength: number = @Absent::length"
    ];
    const expected = { presentFirst: 4, presentLength: 1, absentFirst: 9, absentLength: 2 };
    const cases = [
      {
        name: "present then absent",
        instances: [
          "instance Present = Select(p: 4, items: [7])",
          "instance Absent = Select(p: none, items: [9, 8])"
        ]
      },
      {
        name: "absent then present",
        instances: [
          "instance Absent = Select(p: none, items: [9, 8])",
          "instance Present = Select(p: 4, items: [7])"
        ]
      }
    ];

    for (const testCase of cases) {
      const compiled = compile(["nui 1", ...module, ...testCase.instances, ...outputs].join("\n"));
      expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error"), testCase.name).toEqual([]);
      const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
      expect(evaluation.errors, testCase.name).toEqual([]);
      for (const [name, value] of Object.entries(expected)) {
        expect(scalarFor(compiled, evaluation, name), `${testCase.name}: ${name}`).toMatchObject({
          status: "ok",
          value: { kind: "number", value }
        });
      }
    }
  });

  it("keeps Module optional collection carry values isolated across different parameter inputs", () => {
    const compiled = compile([
      "nui 1",
      "module Select(p: number?) {",
      "  for i in range(min: 0, max: 0, step: 1) carry selected: number[] = [] {",
      "    next selected = match @p { none => [31, 32] some x => [@x] }",
      "  }",
      "  export const first: number = @selected[0]",
      "  export const length: number = @selected.length",
      "}",
      "instance Present = Select(p: 4)",
      "instance Absent = Select(p: none)",
      "const presentFirst: number = @Present::first",
      "const presentLength: number = @Present::length",
      "const absentFirst: number = @Absent::first",
      "const absentLength: number = @Absent::length"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    for (const [name, expected] of [
      ["presentFirst", 4],
      ["presentLength", 1],
      ["absentFirst", 31],
      ["absentLength", 2]
    ] as const) {
      expect(scalarFor(compiled, evaluation, name)).toMatchObject({
        status: "ok",
        value: { kind: "number", value: expected }
      });
    }
  });

  it("keeps an unselected error-producing Module collection carry arm lazy", () => {
    const compiled = compile([
      "nui 1",
      "module Select(p: number?) {",
      "  for i in range(min: 0, max: 0, step: 1) carry selected: number[] = [] {",
      "    next selected = match @p { none => if (1 / 0 > 0) { [90] } else { [91] } some x => [@x] }",
      "  }",
      "  export const result: number = @selected[0]",
      "}",
      "instance Present = Select(p: 5)",
      "const result: number = @Present::result"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    expect(scalarFor(compiled, evaluation, "result")).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 5 }
    });
  });

  it("preserves nominal record collection types through Module carry matches", () => {
    const compiled = compile([
      "nui 1",
      "record Pair(value: number)",
      "record Other(value: number)",
      "const pair: Pair = Pair(value: 12)",
      "module Select(p: number?) {",
      "  for i in range(min: 0, max: 0, step: 1) carry selected: Pair[] = [] {",
      "    next selected = match @p { none => [] some x => [@pair] }",
      "  }",
      "  export const length: number = @selected.length",
      "}",
      "instance Present = Select(p: 1)",
      "const length: number = @Present::length"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    expect(scalarFor(compiled, evaluation, "length")).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 1 }
    });
  });

  it("resolves a completed nested collection carry at the outer next statement", () => {
    const compiled = compile([
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) carry outer: number[] = [1] {",
      "for j in range(min: 0, max: 0, step: 1) carry inner: number[] = @outer {",
      "next inner = [2]",
      "}",
      "next outer = @inner",
      "}",
      "const result: number = @outer[0]"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 2 }
    });
  });

  it("propagates named collection replacements through nested carries", () => {
    const compiled = compile([
      "nui 1",
      "const initial: number[] = [1]",
      "const replacement: number[] = [2]",
      "for i in range(min: 0, max: 0, step: 1) carry outer: number[] = @initial {",
      "  for j in range(min: 0, max: 0, step: 1) carry inner: number[] = @outer {",
      "    next inner = @replacement",
      "  }",
      "  next outer = @inner",
      "}",
      "const result: number = @outer[0]"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 2 }
    });
  });

  it("keeps next-expression resolution stable across comments, blank lines, and renamed carries", () => {
    const compiled = compile([
      "nui 1",
      "// Named collection inputs stay visible in the nested next scopes.",
      "const seed: number[] = [1]",
      "const replacement: number[] = [2]",
      "const unrelated: number = 99",
      "",
      "for i in range(min: 0, max: 0, step: 1) carry outerItems: number[] = @seed {",
      "  // The inner final collection escapes before the outer transition.",
      "  for j in range(min: 0, max: 0, step: 1) carry innerItems: number[] = @outerItems {",
      "    next innerItems = @replacement",
      "  }",
      "",
      "  next outerItems = @innerItems",
      "}",
      "const result: number = @outerItems[0] + @unrelated - 99"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 2 }
    });
  });

  it("resolves carry references used as collection literal members at the next statement", () => {
    const compiled = compile([
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) carry outer: number[] = [1] {",
      "  for j in range(min: 0, max: 0, step: 1) carry inner: number = 1 {",
      "    next inner = 2",
      "  }",
      "  next outer = [@inner]",
      "}",
      "const result: number = @outer[0]"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 2 }
    });
  });

  it("does not propagate a nested collection carry unless the outer next consumes it", () => {
    const compiled = compile([
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) carry outer: number[] = [1] {",
      "  for j in range(min: 0, max: 0, step: 1) carry inner: number[] = @outer {",
      "    next inner = [2]",
      "  }",
      "  next outer = @outer",
      "}",
      "const result: number = @outer[0]"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 1 }
    });
  });

  it("rejects branch-local next instead of compiling an unconditional update", () => {
    const result = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "for i in range(min: 0, max: 1, step: 1) carry total: number = 0 {",
      "  if (true) {",
      "    next total = 1",
      "  }",
      "}",
      "const result: number = @total"
    ].join("\n"));
    expect(result.status).toBe("fatal");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "next-inside-conditional")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "missing-next")).toBe(false);
  });

  it("requires the canonical @reference form for collection sources", () => {
    const result = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "const items: number[] = [1, 2]",
      "for item in items {",
      "}"
    ].join("\n"));
    expect(result.status).toBe("fatal");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-for-source-reference")).toBe(true);
  });

  it("rejects a descending numeric range instead of returning its carry initializer", () => {
    const compiled = compile([
      "nui 1",
      "for i in range(min: 2, max: 1, step: 1) carry total: number = 7 {",
      "  next total = @total + 1",
      "}",
      "const result: number = @total"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    const forGroupId = compiled.document.elements.find((element) => element.type === "forGroup")!.id;
    expect(evaluation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        elementId: forGroupId,
        missingDependencyId: forGroupId,
        message: expect.stringContaining("min は max 以下")
      })
    ]));
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)?.status).not.toBe("ok");
  });

  it("keeps the carry initializer for a genuinely empty collection source", () => {
    const compiled = compile([
      "nui 1",
      "const items: number[] = []",
      "for item in @items carry total: number = 7 {",
      "  next total = @total + 1",
      "}",
      "const result: number = @total"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 7 }
    });
  });

  it("keeps a Module collection carry initializer when the source is empty", () => {
    const compiled = compile([
      "nui 1",
      "module M() {",
      "  const items: number[] = []",
      "  for item in @items carry total: number = 7 {",
      "    next total = @total + 1",
      "    point Mark = coordinate(x: 0, y: 0)",
      "  }",
      "  export const output: number = @total",
      "}",
      "instance A = M()",
      "const result: number = @A::output"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);
    const loop = compiled.document.elements.find((element) => element.type === "forGroup");
    expect(loop).toMatchObject({ iterationElementValueType: { kind: "number" } });

    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.kind === "typed" && binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 7 }
    });
    expect(evaluation.forGroupGeneratedRows?.filter((row) => row.forGroupId === loop?.id) ?? []).toEqual([]);
  });

  it("uses a required Module collection parameter directly as a carry initializer", () => {
    const compiled = compile([
      "nui 1",
      "module M(items: number[]) {",
      "  for i in range(min: 0, max: 0, step: 1) carry a: number[] = @items {",
      "    next a = @a",
      "  }",
      "  export const output: number = @a[0]",
      "}",
      "instance A = M(items: [1])",
      "const result: number = @A::output"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.diagnostics.some((diagnostic) => diagnostic.code === "carry-collection-expression-invalid")).toBe(false);

    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 1 }
    });
  });

  it("prefers a same-named Module collection parameter over an outer root collection", () => {
    const compiled = compile([
      "nui 1",
      "const items: number[] = [99]",
      "module M(items: number[]) {",
      "  for i in range(min: 0, max: 0, step: 1) carry a: number[] = @items {",
      "    next a = @a",
      "  }",
      "  export const output: number = @a[0]",
      "}",
      "instance A = M(items: [1])",
      "const result: number = @A::output"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 1 }
    });
  });

  it("matches a local collection alias for a direct Module parameter carry initializer", () => {
    const source = (initializer: string) => [
      "nui 1",
      "module M(items: number[]) {",
      ...(initializer === "alias"
        ? ["  const localItems: number[] = @items"]
        : []),
      `  for i in range(min: 0, max: 0, step: 1) carry a: number[] = @${initializer === "alias" ? "localItems" : "items"} {`,
      "    next a = @a",
      "  }",
      "  export const output: number = @a[0]",
      "}",
      "instance A = M(items: [1])",
      "const result: number = @A::output"
    ].join("\n");
    const direct = compile(source("direct"));
    const aliased = compile(source("alias"));
    const resultValue = (compiled: LastGoodDslDocument) => {
      const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
      expect(evaluation.errors).toEqual([]);
      const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
      const result = evaluation.computedScalarBindings?.get(resultId);
      expect(result?.status).toBe("ok");
      if (!result || result.status !== "ok") throw new Error("result binding did not evaluate successfully");
      return result.value;
    };

    expect(direct.diagnostics).toEqual([]);
    expect(aliased.diagnostics).toEqual([]);
    expect(resultValue(direct)).toEqual(resultValue(aliased));
    expect(resultValue(direct)).toEqual({ kind: "number", value: 1 });
  });

  it("accepts inline literal and named root collection arguments for a direct carry initializer", () => {
    const compileModule = (argument: string, root = "") => compile([
      "nui 1",
      ...(root ? [root] : []),
      "module M(items: number[]) {",
      "  for i in range(min: 0, max: 0, step: 1) carry a: number[] = @items {",
      "    next a = @a",
      "  }",
      "  export const output: number = @a[0]",
      "}",
      `instance A = M(items: ${argument})`,
      "const result: number = @A::output"
    ].join("\n"));
    const inline = compileModule("[1]");
    const named = compileModule("@initial", "const initial: number[] = [9, 2]");
    for (const [compiled, expected] of [[inline, 1], [named, 9]] as const) {
      expect(compiled.diagnostics).toEqual([]);
      const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
      expect(evaluation.errors).toEqual([]);
      const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
      expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
        status: "ok",
        value: { kind: "number", value: expected }
      });
    }
  });

  it("keeps direct Module parameter carry state isolated across asymmetric instances", () => {
    const compiled = compile([
      "nui 1",
      "module M(items: number[]) {",
      "  for i in range(min: 0, max: 0, step: 1) carry a: number[] = @items {",
      "    next a = @a",
      "  }",
      "  export const first: number = @a[0]",
      "  export const itemCount: number = @a.length",
      "}",
      "const longer: number[] = [20, 21, 22]",
      "instance A = M(items: [10, 11])",
      "instance B = M(items: @longer)",
      "const firstA: number = @A::first",
      "const countA: number = @A::itemCount",
      "const firstB: number = @B::first",
      "const countB: number = @B::itemCount"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    for (const [name, expected] of [["firstA", 10], ["countA", 2], ["firstB", 20], ["countB", 3]] as const) {
      const bindingId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === name)!.id;
      expect(evaluation.computedScalarBindings?.get(bindingId)).toMatchObject({
        status: "ok",
        value: { kind: "number", value: expected }
      });
    }
  });

  it("preserves carry shadowing over a same-named Module parameter", () => {
    const compiled = compile([
      "nui 1",
      "module M(items: number[]) {",
      "  group DeclarationShadow {",
      "    const items: number[] = [2]",
      "    for i in range(min: 0, max: 0, step: 1) carry a: number[] = @items {",
      "      next a = @a",
      "    }",
      "    const value: number = @a[0]",
      "  }",
      "  group CarryShadow {",
      "    for i in range(min: 0, max: 0, step: 1) carry items: number[] = [3] {",
      "      next items = @items",
      "    }",
      "    for j in range(min: 0, max: 0, step: 1) carry a: number[] = @items {",
      "      next a = @a",
      "    }",
      "    const value: number = @a[0]",
      "  }",
      "  export const output: number = @DeclarationShadow::value + @CarryShadow::value",
      "}",
      "instance A = M(items: [1])",
      "const carryResult: number = @A::output"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "carryResult")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 5 }
    });
  });

  it("retains invalid Module parameter initializer diagnostics", () => {
    const nonCollection = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "module M(item: number) {",
      "  for i in range(min: 0, max: 0, step: 1) carry a: number[] = @item {",
      "    next a = @a",
      "  }",
      "  export const output: number = @a[0]",
      "}",
      "instance A = M(item: 1)",
      "const result: number = @A::output"
    ].join("\n"));
    expect(nonCollection.status).toBe("fatal");
    expect(nonCollection.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "carry-collection-expression-invalid" })
    ]));

    const mismatchedCollection = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "module M(items: choice(up, down)[]) {",
      "  for i in range(min: 0, max: 0, step: 1) carry a: choice(left, right)[] = @items {",
      "    next a = @a",
      "  }",
      "  export const output: number = @a[0]",
      "}",
      "instance A = M(items: [up])",
      "const result: number = @A::output"
    ].join("\n"));
    expect(mismatchedCollection.status).toBe("fatal");
    expect(mismatchedCollection.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "carry-collection-expression-invalid" })
    ]));
  });

  it("preserves named root and Module-local collection carry initializers", () => {
    const rootCompiled = compile([
      "nui 1",
      "const rootItems: number[] = [4, 5]",
      "for i in range(min: 0, max: 0, step: 1) carry rootCarry: number[] = @rootItems {",
      "  next rootCarry = @rootCarry",
      "}",
      "const rootResult: number = @rootCarry[0]"
    ].join("\n"));
    const moduleCompiled = compile([
      "nui 1",
      "module M() {",
      "  const localItems: number[] = [7, 8]",
      "  for j in range(min: 0, max: 0, step: 1) carry localCarry: number[] = @localItems {",
      "    next localCarry = @localCarry",
      "  }",
      "  export const output: number = @localCarry[1]",
      "}",
      "instance A = M()",
      "const moduleResult: number = @A::output"
    ].join("\n"));
    for (const [compiled, name, expected] of [[rootCompiled, "rootResult", 4], [moduleCompiled, "moduleResult", 8]] as const) {
      expect(compiled.diagnostics).toEqual([]);
      const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
      expect(evaluation.errors).toEqual([]);
      const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === name)!.id;
      expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
        status: "ok",
        value: { kind: "number", value: expected }
      });
    }
  });

  it("preserves named optional-match carry snapshots for each Module instance", () => {
    const module = [
      "module Select(p: number?, items: number[]) {",
      "  const selector: number? = @p",
      "  const localItems: number[] = @items",
      "  for i in range(min: 0, max: 0, step: 1) carry selected: number[] = [] {",
      "    const chosen: number[] = match @selector {",
      "      none => @localItems",
      "      some x => [@x]",
      "    }",
      "    next selected = @chosen",
      "  }",
      "  export const first: number = @selected[0]",
      "  export const length: number = @selected.length",
      "}"
    ];
    const document = (instances: string[], outputs: string[], someArm = "some x => [@x]") => [
      "nui 1",
      ...module.map((line) => line.replace("some x => [@x]", someArm)),
      ...instances,
      ...outputs
    ].join("\n");
    const cases = [
      {
        source: document([
          "instance Present = Select(p: 4, items: [7])",
          "instance Absent = Select(p: none, items: [9, 8])"
        ], [
          "const presentFirst: number = @Present::first",
          "const presentLength: number = @Present::length",
          "const absentFirst: number = @Absent::first",
          "const absentLength: number = @Absent::length"
        ]),
        expected: { presentFirst: 4, presentLength: 1, absentFirst: 9, absentLength: 2 }
      },
      {
        source: document([
          "instance Absent = Select(p: none, items: [9, 8])",
          "instance Present = Select(p: 4, items: [7])"
        ], [
          "const presentFirst: number = @Present::first",
          "const presentLength: number = @Present::length",
          "const absentFirst: number = @Absent::first",
          "const absentLength: number = @Absent::length"
        ]),
        expected: { presentFirst: 4, presentLength: 1, absentFirst: 9, absentLength: 2 }
      },
      {
        source: document(
          ["instance Present = Select(p: 4, items: [7])"],
          [
            "const presentFirst: number = @Present::first",
            "const presentLength: number = @Present::length"
          ]
        ),
        expected: { presentFirst: 4, presentLength: 1 }
      },
      {
        source: document(
          ["instance Absent = Select(p: none, items: [9, 8])"],
          [
            "const absentFirst: number = @Absent::first",
            "const absentLength: number = @Absent::length"
          ],
          "some x => @failingItems"
        ).replace(
          "const localItems: number[] = @items",
          "const localItems: number[] = @items\n  const failingItems: number[] = for y in @localItems { @y / 0 }"
        ),
        expected: { absentFirst: 9, absentLength: 2 }
      }
    ];

    for (const [index, testCase] of cases.entries()) {
      const compiled = compile(testCase.source);
      expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error"), `case ${index + 1}`).toEqual([]);
      const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
      expect(evaluation.errors, `case ${index + 1}`).toEqual([]);
      for (const [name, value] of Object.entries(testCase.expected)) {
        expect(scalarFor(compiled, evaluation, name), `case ${index + 1}: ${name}`).toMatchObject({
          status: "ok",
          value: { kind: "number", value }
        });
      }
    }
  });

  it("propagates state through an inner carry and rejects direct outer next", () => {
    const valid = compile([
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) carry outer: number = 0 {",
      "  for j in range(min: 0, max: 1, step: 1) carry inner: number = @outer {",
      "    next inner = @inner + 1",
      "  }",
      "  next outer = @inner",
      "}",
      "const result: number = @outer"
    ].join("\n"));
    expect(valid.diagnostics).toEqual([]);
    const validEvaluation = evaluateElements(valid.document.elements, optionsFor(valid));
    expect(validEvaluation.errors).toEqual([]);
    const validResultId = valid.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(validEvaluation.computedScalarBindings?.get(validResultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 2 }
    });

    const invalidResult = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) carry outer: number = 0 {",
      "  for j in range(min: 0, max: 0, step: 1) {",
      "    next outer = 1",
      "  }",
      "  next outer = @outer",
      "}"
    ].join("\n"));
    expect(invalidResult.status).toBe("fatal");
    expect(invalidResult.diagnostics.some((diagnostic) => diagnostic.code === "next-outer-carry")).toBe(true);
  });

  it("carries a nominal record through a loop", () => {
    const compiled = compile([
      "nui 1",
      "record Pair(x: number, label: string)",
      'const first: Pair = Pair(x: 1, label: "ok")',
      "for i in range(min: 0, max: 0, step: 1) carry last: Pair = @first {",
      '  next last = Pair(x: @last.x + 1, label: @last.label)',
      "}",
      "const result: number = @last.x"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 2 }
    });
  });

  it("preserves generalized record geometry, collection, and nested fields", () => {
    const compiled = compile([
      "nui 1",
      "point A = coordinate(x: 3, y: 4)",
      "line Edge = segment(start: (0, 0), end: (10, 0))",
      "record Metadata(label: string)",
      "record Piece(count: number, edge: line, points: point[], metadata: Metadata)",
      'const first: Piece = Piece(count: 1, edge: @Edge, points: [@A], metadata: Metadata(label: "ok"))',
      "for i in range(min: 0, max: 0, step: 1) carry last: Piece = @first {",
      '  next last = Piece(count: @last.count + 1, edge: @last.edge, points: @last.points, metadata: @last.metadata)',
      "}",
      "const count: number = @last.count",
      "const pointCount: number = @last.points.length",
      "const edgeLength: number = @last.edge.length",
      "const label: string = @last.metadata.label"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const value = (name: string) => {
      const id = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === name)!.id;
      return evaluation.computedScalarBindings?.get(id);
    };
    expect(value("count")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
    expect(value("pointCount")).toMatchObject({ status: "ok", value: { kind: "number", value: 1 } });
    expect(value("edgeLength")).toMatchObject({ status: "ok", value: { kind: "number", value: 10 } });
    expect(value("label")).toMatchObject({ status: "ok", value: { kind: "string", value: "ok" } });
  });

  it("iterates nominal record collection members through their field bindings", () => {
    const compiled = compile([
      "nui 1",
      "record Pair(x: number, label: string)",
      'const first: Pair = Pair(x: 1, label: "ok")',
      "const items: Pair[] = [@first]",
      "for item in @items carry total: number = 0 {",
      "  next total = @item.x",
      "}",
      "const result: number = @total"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 1 }
    });
  });

  it("feeds same-iteration geometry into a geometry carry next", () => {
    const compiled = compile([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "for i in range(min: 0, max: 1, step: 1) carry cursor: point = @A {",
      "  line Edge = segment(start: @cursor, end: @A)",
      "  next cursor = @Edge.end",
      "}",
      "const result: number = @cursor.x"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 0 }
    });
  });

  it("iterates immutable geometry collection members", () => {
    const compiled = compile([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 2, y: 0)",
      "const items: point[] = [@A, @B]",
      "for item in @items carry cursor: point = @A {",
      "  next cursor = @item",
      "}",
      "const result: number = @cursor.x"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 2 }
    });
  });

  it("materializes an identity-mapped point collection before statement-for geometry binding", () => {
    const compiled = compile([
      "nui 1",
      "point Seed = coordinate(x: 0, y: 0)",
      "const points: point[] = [(1, 2)]",
      "const mapped: point[] = for p in @points { @p }",
      "for p in @mapped carry last: point = @Seed {",
      "  next last = @p",
      "}",
      "const result: number = @last.x"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);

    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 1 }
    });
  });

  it("preserves both mapped point members and carries the exact final member", () => {
    const compiled = compile([
      "nui 1",
      "point Seed = coordinate(x: 0, y: 0)",
      "const points: point[] = [(1, 2), (3, 4)]",
      "const mapped: point[] = for p in @points { @p }",
      "for p in @mapped carry last: point = @Seed {",
      "  next last = @p",
      "}",
      "const resultX: number = @last.x",
      "const resultY: number = @last.y"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);

    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const scalarValue = (name: string) => {
      const id = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === name)!.id;
      return evaluation.computedScalarBindings?.get(id);
    };
    expect(scalarValue("resultX")).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 3 }
    });
    expect(scalarValue("resultY")).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 4 }
    });
    expect([...(evaluation.computedGeometryValues?.values() ?? [])]
      .filter((entry) => entry.occurrence.mappedMemberIndex !== undefined)
      .sort((left, right) => left.occurrence.mappedMemberIndex! - right.occurrence.mappedMemberIndex!)
      .map((entry) => entry.value))
      .toEqual([
        { kind: "point", x: 1, y: 2 },
        { kind: "point", x: 3, y: 4 }
      ]);
  });

  it("keeps an unavailable mapped geometry member unavailable instead of binding the carry initializer", () => {
    const compiled = compile([
      "nui 1",
      "point Seed = coordinate(x: 0, y: 0)",
      "point Missing = coordinate(x: 7, y: 9, enabled: false)",
      "const points: point[] = [@Missing]",
      "const mapped: point[] = for p in @points { @p }",
      "for p in @mapped carry last: point = @Seed {",
      "  next last = @p",
      "}",
      "const result: number = @last.x"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);

    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.geometryValueErrors).not.toEqual([]);
    expect(Array.from(evaluation.computedScalarBindings?.values() ?? [])).toContainEqual(expect.objectContaining({
      status: "error",
      issueCode: "evaluation-geometry-property-unavailable"
    }));
  });

  it("uses the exact choice type for scalar carries and accepts value-if next", () => {
    const compiled = compile([
      "nui 1",
      "const side: choice(left, right) = left",
      "for i in range(min: 0, max: 1, step: 1) carry last: choice(left, right) = @side {",
      "  next last = if (true) { right } else { left }",
      "}",
      "const result: choice(left, right) = @last"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "choice", value: "right", options: ["left", "right"] }
    });
  });

  it("accepts exhaustive choice match as a carry next RHS", () => {
    const compiled = compile([
      "nui 1",
      "const side: choice(left, right) = left",
      "for i in range(min: 0, max: 1, step: 1) carry last: choice(left, right) = @side {",
      "  next last = match @side { left => right right => left }",
      "}",
      "const result: choice(left, right) = @last"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    const resultId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "result")!.id;
    expect(evaluation.computedScalarBindings?.get(resultId)).toMatchObject({
      status: "ok",
      value: { kind: "choice", value: "right", options: ["left", "right"] }
    });
  });

  it("keeps missing, duplicate, unknown, and wrong-type next diagnostics deterministic", () => {
    const source = (body: string) => [
      "nui 1",
      "for i in range(min: 0, max: 1, step: 1) carry total: number = 0 {",
      body,
      "}"
    ].join("\n");
    const diagnostics = (body: string) => compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), source(body)).diagnostics;
    expect(diagnostics("")).toEqual(expect.arrayContaining([expect.objectContaining({ code: "missing-next" })]));
    expect(diagnostics("  next total = 1\n  next total = 2")).toEqual(expect.arrayContaining([expect.objectContaining({ code: "duplicate-next" })]));
    expect(diagnostics("  next missing = 1")).toEqual(expect.arrayContaining([expect.objectContaining({ code: "unknown-next-carry" })]));
    expect(diagnostics('  next total = "wrong"')).not.toEqual([]);
  });

  it("uses canonical assignability for scalar choice and nominal record collections", () => {
    const choiceMismatch = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "const left: choice(left, right)[] = [left]",
      "const other: choice(up, down)[] = [up]",
      "for i in range(min: 0, max: 1, step: 1) carry values: choice(left, right)[] = @other {",
      "  next values = @left",
      "}"
    ].join("\n"));
    expect(choiceMismatch.status).toBe("fatal");
    expect(choiceMismatch.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "carry-collection-expression-invalid" })]));

    const recordMismatch = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "record Foo(value: number)",
      "record Bar(value: number)",
      "const bar: Bar = Bar(value: 1)",
      "const bars: Bar[] = [@bar]",
      "for i in range(min: 0, max: 1, step: 1) carry foos: Foo[] = @bars {",
      "  next foos = @bars",
      "}"
    ].join("\n"));
    expect(recordMismatch.status).toBe("fatal");
    expect(recordMismatch.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "carry-collection-expression-invalid" })]));
  });

  it("applies directional canonical assignability to geometry carries", () => {
    const lineToPath = compile([
      "nui 1",
      "line L = segment(start: (0, 0), end: (10, 0))",
      "for i in range(min: 0, max: 1, step: 1) carry pathValue: path = @L {",
      "  next pathValue = @L",
      "}"
    ].join("\n"));
    expect(lineToPath.diagnostics).toEqual([]);

    const pathToLine = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "curve C = bezier(start: (0, 0), end: (10, 0))",
      "for i in range(min: 0, max: 1, step: 1) carry lineValue: line = @C {",
      "  next lineValue = @C",
      "}"
    ].join("\n"));
    expect(pathToLine.status).toBe("fatal");
    expect(pathToLine.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "carry-geometry-type-mismatch" })]));
  });

  it("applies directional canonical assignability to geometry collection carries", () => {
    const lineToPath = compile([
      "nui 1",
      "line L = segment(start: (0, 0), end: (10, 0))",
      "const lines: line[] = [@L]",
      "for i in range(min: 0, max: 1, step: 1) carry paths: path[] = @lines {",
      "  next paths = @lines",
      "}"
    ].join("\n"));
    expect(lineToPath.diagnostics).toEqual([]);

    const pathToLine = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "curve C = bezier(start: (0, 0), end: (10, 0))",
      "const paths: path[] = [@C]",
      "for i in range(min: 0, max: 1, step: 1) carry lines: line[] = @paths {",
      "  next lines = @paths",
      "}"
    ].join("\n"));
    expect(pathToLine.status).toBe("fatal");
    expect(pathToLine.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "carry-collection-expression-invalid" })]));

    const pointLineMismatch = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "point P = coordinate(x: 0, y: 0)",
      "const points: point[] = [@P]",
      "for i in range(min: 0, max: 1, step: 1) carry lines: line[] = @points {",
      "  next lines = @points",
      "}"
    ].join("\n"));
    expect(pointLineMismatch.status).toBe("fatal");
    expect(pointLineMismatch.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "carry-collection-expression-invalid" })]));
  });

  it("evaluates the reduced root collection-if statement-for reproducer", () => {
    const compiled = compile([
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) carry a: number[] = [1] {",
      "  const selected: number[] = if (@i == 0) { [2] } else { [3] }",
      "  next a = @selected",
      "}",
      "const result: number = @a[0]"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    expect(scalarFor(compiled, evaluation, "result")).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 2 }
    });
  });

  it("selects the current iteration's asymmetric collection branch and preserves its cardinality", () => {
    const compiled = compile([
      "nui 1",
      "for i in range(min: 0, max: 2, step: 1) carry a: number[] = [0] {",
      "  const selected: number[] = if (@i == 2) { [8, 9] } else { [3, 4, 5] }",
      "  next a = @selected",
      "}",
      "const first: number = @a[0]",
      "const second: number = @a[1]",
      "const length: number = @a.length"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    expect(scalarFor(compiled, evaluation, "first")).toMatchObject({ status: "ok", value: { kind: "number", value: 8 } });
    expect(scalarFor(compiled, evaluation, "second")).toMatchObject({ status: "ok", value: { kind: "number", value: 9 } });
    expect(scalarFor(compiled, evaluation, "length")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
  });

  it("preserves the exact mapped iteration environment after a collection carry escapes", () => {
    const compiled = compile([
      "nui 1",
      "const nums: number[] = [2]",
      "for i in range(min: 0, max: 0, step: 1) carry a: number[] = [0] {",
      " const mapped: number[] = for x in @nums { @i }",
      " next a = @mapped",
      "}",
      "const result: number = @a[0]"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);

    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    expect(scalarFor(compiled, evaluation, "result")).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 0 }
    });
  });

  it("captures the final mapped iteration, local scalar, and iteration-start carry values", () => {
    const compiled = compile([
      "nui 1",
      "const nums: number[] = [2, 4]",
      "for i in range(min: 0, max: 2, step: 1) carry state: number = 10 carry values: number[] = [0] {",
      "  const offset: number = @i + 10",
      "  const mapped: number[] = for x in @nums { @state + @i + @offset + @x }",
      "  next state = @state + 100",
      "  next values = @mapped",
      "}",
      "const first: number = @values[0]",
      "const second: number = @values[1]",
      "const length: number = @values.length",
      "const finalState: number = @state"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);

    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    expect(scalarFor(compiled, evaluation, "first")).toMatchObject({ status: "ok", value: { kind: "number", value: 226 } });
    expect(scalarFor(compiled, evaluation, "second")).toMatchObject({ status: "ok", value: { kind: "number", value: 228 } });
    expect(scalarFor(compiled, evaluation, "length")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
    expect(scalarFor(compiled, evaluation, "finalState")).toMatchObject({ status: "ok", value: { kind: "number", value: 310 } });
  });

  it("leaves ordinary mapped collections outside collection carry unchanged", () => {
    const compiled = compile([
      "nui 1",
      "const nums: number[] = [2, 4]",
      "const mapped: number[] = for x in @nums { @x * 2 }",
      "const first: number = @mapped[0]",
      "const second: number = @mapped[1]",
      "const length: number = @mapped.length"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);

    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    expect(scalarFor(compiled, evaluation, "first")).toMatchObject({ status: "ok", value: { kind: "number", value: 4 } });
    expect(scalarFor(compiled, evaluation, "second")).toMatchObject({ status: "ok", value: { kind: "number", value: 8 } });
    expect(scalarFor(compiled, evaluation, "length")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
  });

  it("keeps an iteration-dependent mapped collection lazy through scalar next", () => {
    const compiled = compile([
      "nui 1",
      "const nums: number[] = [2]",
      "for i in range(min: 0, max: 2, step: 1) carry answer: number = 0 {",
      "  const mapped: number[] = for x in @nums { @i + @x }",
      "  next answer = @mapped[0]",
      "}",
      "const result: number = @answer"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);

    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    expect(scalarFor(compiled, evaluation, "result")).toMatchObject({ status: "ok", value: { kind: "number", value: 4 } });
  });

  it("keeps a static mapped collection unchanged when committed through collection carry", () => {
    const compiled = compile([
      "nui 1",
      "const nums: number[] = [2, 4]",
      "const mapped: number[] = for x in @nums { @x + 1 }",
      "for i in range(min: 0, max: 1, step: 1) carry values: number[] = [0] {",
      "  next values = @mapped",
      "}",
      "const first: number = @values[0]",
      "const second: number = @values[1]",
      "const length: number = @values.length"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);

    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    expect(scalarFor(compiled, evaluation, "first")).toMatchObject({ status: "ok", value: { kind: "number", value: 3 } });
    expect(scalarFor(compiled, evaluation, "second")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
    expect(scalarFor(compiled, evaluation, "length")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
  });

  it("maps an incoming collection carry and advances through multiple snapshot generations", () => {
    const cases = [
      {
        source: [
          "nui 1",
          "for i in range(min: 0, max: 0, step: 1) carry a: number[] = [1] {",
          "  const mapped: number[] = for x in @a { @x }",
          "  next a = @mapped",
          "}",
          "const result: number = @a[0]"
        ].join("\n"),
        expected: 1
      },
      {
        source: [
          "nui 1",
          "for i in range(min: 0, max: 2, step: 1) carry a: number[] = [1] {",
          "  const mapped: number[] = for x in @a { @x + 1 }",
          "  next a = @mapped",
          "}",
          "const result: number = @a[0]"
        ].join("\n"),
        expected: 4
      }
    ];

    for (const testCase of cases) {
      const compiled = compile(testCase.source);
      expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
      const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
      expect(evaluation.errors).toEqual([]);
      expect(scalarFor(compiled, evaluation, "result")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: testCase.expected }
      });
    }
  });

  it("retains the shared incoming collection snapshot alongside captured scalar bindings", () => {
    const compiled = compile([
      "nui 1",
      "for i in range(min: 0, max: 2, step: 1) carry a: number[] = [1] carry b: number[] = [10] {",
      "  const mappedA: number[] = for x in @a { @x + @b[0] + @i }",
      "  const mappedB: number[] = for y in @b { @y + 1 }",
      "  next a = @mappedA",
      "  next b = @mappedB",
      "}",
      "const resultA: number = @a[0]",
      "const resultB: number = @b[0]"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    expect(scalarFor(compiled, evaluation, "resultA")).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 37 }
    });
    expect(scalarFor(compiled, evaluation, "resultB")).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 13 }
    });
  });

  it("keeps collection-if behavior under binder, carry, declaration, and source-padding changes", () => {
    const evaluateResults = (source: string, resultName: string, lengthName: string) => {
      const compiled = compile(source);
      expect(compiled.diagnostics).toEqual([]);
      const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
      expect(evaluation.errors).toEqual([]);
      return [scalarFor(compiled, evaluation, resultName), scalarFor(compiled, evaluation, lengthName)];
    };
    const baseline = [
      "nui 1",
      "for i in range(min: 0, max: 2, step: 1) carry a: number[] = [0] {",
      "  const selected: number[] = if (@i == 2) { [8, 9] } else { [3, 4, 5] }",
      "  next a = @selected",
      "}",
      "const result: number = @a[0]",
      "const length: number = @a.length"
    ].join("\n");
    const renamedAndPadded = [
      "nui 1",
      "// inert padding before the statement-for",
      "",
      "const unrelated: number = 99",
      "for stepIndex in range(min: 0, max: 2, step: 1) carry escaped: number[] = [0] {",
      "  const branchItems: number[] = if (@stepIndex == 2) { [8, 9] } else { [3, 4, 5] }",
      "  next escaped = @branchItems",
      "}",
      "const renamedResult: number = @escaped[0]",
      "const renamedLength: number = @escaped.length"
    ].join("\n");

    const expected = evaluateResults(baseline, "result", "length");
    expect(expected).toEqual([
      expect.objectContaining({ status: "ok", value: { kind: "number", value: 8 } }),
      expect.objectContaining({ status: "ok", value: { kind: "number", value: 2 } })
    ]);
    expect(evaluateResults(renamedAndPadded, "renamedResult", "renamedLength")).toEqual(expected);
  });

  it("keeps constant collection-if and scalar-if controls correct inside statement-for", () => {
    const compiled = compile([
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) carry values: number[] = [0] carry answer: number = 0 {",
      "  const selected: number[] = if (true) { [2, 3] } else { [4] }",
      "  const scalarSelected: number = if (@i == 0) { 6 } else { 7 }",
      "  next values = @selected",
      "  next answer = @scalarSelected",
      "}",
      "const result: number = @values[0]",
      "const length: number = @values.length",
      "const scalarResult: number = @answer"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    expect(scalarFor(compiled, evaluation, "result")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
    expect(scalarFor(compiled, evaluation, "length")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
    expect(scalarFor(compiled, evaluation, "scalarResult")).toMatchObject({ status: "ok", value: { kind: "number", value: 6 } });
  });

  it("does not evaluate a failing mapped collection in an unselected collection-if branch", () => {
    const compiled = compile([
      "nui 1",
      "const source: number[] = [1]",
      "for i in range(min: 0, max: 0, step: 1) carry values: number[] = [0] {",
      "  const failing: number[] = for x in @source { @x / 0 }",
      "  const selected: number[] = if (@i == 0) { [2] } else { @failing }",
      "  next values = @selected",
      "}",
      "const result: number = @values[0]"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    expect(scalarFor(compiled, evaluation, "result")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
  });

  it("reports the mapped-collection failure when the collection-if selects that branch", () => {
    const compiled = compile([
      "nui 1",
      "const source: number[] = [1]",
      "for i in range(min: 0, max: 0, step: 1) carry values: number[] = [0] {",
      "  const failing: number[] = for x in @source { @x / 0 }",
      "  const selected: number[] = if (@i == 0) { @failing } else { [2] }",
      "  next values = @selected",
      "}",
      "const result: number = @values[0]"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(scalarFor(compiled, evaluation, "result")).toMatchObject({
      status: "error",
      issueCode: "evaluation-divide-by-zero"
    });
  });

  it("preserves a selected collection-if decision error in the committed carry snapshot", () => {
    const compiled = compile([
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) carry a: number[] = [0] {",
      "  const b: number[] = if (5 % 0 > 0) { [1] } else { [2] }",
      "  const alias: number[] = @b",
      "  next a = @alias",
      "}",
      "const result: number = @a[0]",
      "const length: number = @a.length"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(scalarFor(compiled, evaluation, "result")).toMatchObject({
      status: "error",
      issueCode: "evaluation-remainder-by-zero"
    });
    expect(scalarFor(compiled, evaluation, "length")).toMatchObject({
      status: "error",
      issueCode: "evaluation-remainder-by-zero"
    });
    expect(JSON.stringify(evaluation.computedScalarBindings)).not.toContain("evaluation-collection-index-unavailable");
  });

  it("keeps the selected collection-if diagnostic unchanged without a carry", () => {
    const compiled = compile([
      "nui 1",
      "const b: number[] = if (5 % 0 > 0) { [1] } else { [2] }",
      "const result: number = @b[0]"
    ].join("\n"));
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(scalarFor(compiled, evaluation, "result")).toMatchObject({
      status: "error",
      issueCode: "evaluation-remainder-by-zero"
    });
  });

  it("preserves selected optional and choice match decision errors through carry", () => {
    const fixtures = [
      {
        selector: "const selector: number? = 5 % 0",
        match: "match @selector { none => [0] some value => [@value] }"
      },
      {
        selector: "const selector: choice(left, right) = if (5 % 0 > 0) { left } else { right }",
        match: "match @selector { left => [1] right => [2] }"
      }
    ];
    for (const fixture of fixtures) {
      const compiled = compile([
        "nui 1",
        fixture.selector,
        "for i in range(min: 0, max: 0, step: 1) carry selected: number[] = [] {",
        `  const branch: number[] = ${fixture.match}`,
        "  next selected = @branch",
        "}",
        "const result: number = @selected[0]"
      ].join("\n"));
      expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
      const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
      expect(scalarFor(compiled, evaluation, "result")).toMatchObject({
        status: "error",
        issueCode: "evaluation-remainder-by-zero"
      });
    }
  });

  it("propagates a committed nested collection decision failure to an outer carry", () => {
    const compiled = compile([
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) carry outer: number[] = [] {",
      "  for j in range(min: 0, max: 0, step: 1) carry inner: number[] = [] {",
      "    const branch: number[] = if (5 % 0 > 0) { [4] } else { [5] }",
      "    next inner = @branch",
      "  }",
      "  next outer = @inner",
      "}",
      "const result: number = @outer[0]"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(scalarFor(compiled, evaluation, "result")).toMatchObject({
      status: "error",
      issueCode: "evaluation-remainder-by-zero"
    });
  });

  it("keeps Module-local optional match binders in successful collection carry snapshots", () => {
    const compiled = compile([
      "nui 1",
      "module Select(p: number?) {",
      "  const localSelector: number? = @p",
      "  for i in range(min: 0, max: 0, step: 1) carry selected: number[] = [] {",
      "    const branch: number[] = match @localSelector { none => [0] some value => [@value] }",
      "    next selected = @branch",
      "  }",
      "  export const first: number = @selected[0]",
      "}",
      "instance Example = Select(p: 17)",
      "const moduleObserved: number = @Example::first"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const evaluation = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(evaluation.errors).toEqual([]);
    expect(scalarFor(compiled, evaluation, "moduleObserved")).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 17 }
    });
  });
});
