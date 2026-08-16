import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel, type LastGoodDslDocument } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import { canUseRustEvaluationForElements } from "./rustEvaluationEligibility";
import { evaluateElements, type EvaluateElementsOptions } from "./evaluate";
import {
  buildConditionalGroupConditionsByElementId,
  buildControlBooleanRuntimeEntries
} from "./controlBooleanRuntime";
import { buildConditionalMutationOwners, conditionalOwnerIdByElementId } from "../scalars/conditionalMutationControl";
import { buildForGroupMutationOwners, forGroupMutationOwnerByElementId } from "../scalars/forGroupMutationControl";
import { buildTextTemplateEntriesByElementId } from "./textTemplateRuntime";
import { buildNumericBindingRuntimeEntries } from "./numericBindingRuntime";
import { forGroupGeneratedElementId } from "./forGroupExpansion";

const compileCanonical = (source: string): LastGoodDslDocument => {
  const baseline = regenerateCanonicalFromModel(emptyDocument(), 4);
  const result = compileCanonicalText(baseline, source);
  if (result.status === "fatal") throw new Error(JSON.stringify(result.diagnostics));
  return result.doc;
};

const optionsFor = (compiled: LastGoodDslDocument): EvaluateElementsOptions => {
  const textTemplateEntriesByElementId = compiled.textTemplates
    ? buildTextTemplateEntriesByElementId({
        textTemplates: compiled.textTemplates,
        elementIdByStatementIndex: compiled.statementMap.elementIdByStatementIndex
      })
    : undefined;
  return {
    evaluationLimitIndex: compiled.document.evaluationLimitIndex,
    scalarProgram: compiled.scalarProgram,
    bindingVersions: compiled.bindingVersions,
    statementInfoByElementId: compiled.statementMap.byElementId,
    sourceExecutionPositionByElementId: compiled.moduleMaterialization?.sourceExecutionPositionByRuntimeElementId,
    statementIdByStatementIndex: compiled.statementMap.statementIdByStatementIndex,
    conditionalOwnerStatementIdByElementId: compiled.bindingVersions
      ? conditionalOwnerIdByElementId(buildConditionalMutationOwners(
          compiled.bindingVersions, compiled.document.elements, compiled.statementMap.byElementId,
          compiled.statementMap.statementIdByStatementIndex
      ))
      : undefined,
    forGroupMutationOwnerByElementId: compiled.bindingVersions
      ? forGroupMutationOwnerByElementId(buildForGroupMutationOwners(
          compiled.bindingVersions, compiled.document.elements, compiled.statementMap.byElementId,
          compiled.statementMap.statementIdByStatementIndex
        ))
      : undefined,
    conditionalGroupConditionsByElementId: buildConditionalGroupConditionsByElementId(
      compiled.conditionalGroupConditions ?? new Map(),
      compiled.statementMap.elementIdByStatementIndex
    ),
    controlBooleanEntries: buildControlBooleanRuntimeEntries(
      {
        propertyBindings: compiled.propertyBindings ?? new Map(),
        elementIdByStatementIndex: compiled.statementMap.elementIdByStatementIndex
      },
      compiled.document.elements
    ),
    numericBindingEntries: buildNumericBindingRuntimeEntries(
      { numericBindings: compiled.numericBindings ?? new Map(), elementIdByStatementIndex: compiled.statementMap.elementIdByStatementIndex },
      compiled.document.elements
    ),
    ...(textTemplateEntriesByElementId?.size ? { textTemplateEntriesByElementId } : {})
  };
};

const elementId = (compiled: LastGoodDslDocument, name: string): string => {
  const fallbackIndex = name === "Inner" ? 1 : 0;
  const element = compiled.document.elements.find((candidate) => candidate.name === name) ??
    (name === "Outer" || name === "Inner" || name === "Loop"
      ? compiled.document.elements.filter((candidate) => candidate.type === "forGroup")[fallbackIndex]
      : undefined);
  if (!element) throw new Error(`missing ${name}`);
  return element.id;
};

describe("Task 31 linear mutation production wiring", () => {
  it("evaluates an earlier geometry property in a number set RHS", () => {
    const compiled = compileCanonical([
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "let x: number = 0",
      "set x = @AB.length",
      "point C = coordinate(x: @x, y: 0)"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    const bindingId = compiled.bindingVersions!.versions[0].bindingId;
    expect(result.computedScalarBindings?.get(bindingId)).toMatchObject({ status: "ok", value: { value: 10 } });
  });

  it("does not let a delayed read make a later geometry property valid in a set RHS", () => {
    const compiled = compileCanonical([
      "nui 4",
      "let x: number = 0",
      "set x = @Later.length",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Later = segment(start: @A, end: @B)",
      "point C = coordinate(x: @x, y: 0)"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    const bindingId = compiled.bindingVersions!.versions[0].bindingId;
    expect(result.computedScalarBindings?.get(bindingId)).toMatchObject({ status: "error", issueCode: "evaluation-geometry-property-unavailable" });
  });
  it("keeps hidden generated metadata and mutation carry while removing generated clones from the draw mask", () => {
    const compiled = compileCanonical([
      "nui 4",
      "let flag: boolean = true",
      "let total: number = 0",
      "let show: boolean = false",
      "if (@flag) {",
      "  set total = @total + 3",
      "} else {",
      "  set total = 99",
      "}",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "for i in range(from: 0, count: 2, step: 1, showGenerated: @show) {",
      "  set total = @total + 1",
      "  line Copy = copy(startPoint: @A, endPoint: @B, scale: 1, angleDeg: 90, mirrorX: false, baseLines: [@AB])",
      "}",
      'text Final = label(text: "${@total}", anchor: none, size: 3)'
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    const loopId = elementId(compiled, "Loop");
    const copyId = elementId(compiled, "Copy");
    const finalId = elementId(compiled, "Final");
    const rows = (result.forGroupGeneratedRows ?? []).filter((row) => row.templateElementId === copyId);

    expect(result.errors).toEqual([]);
    expect([...result.computedScalarBindings!.values()].some((evaluation) =>
      evaluation.status === "ok" &&
      evaluation.value.kind === "number" &&
      evaluation.value.value === 5
    )).toBe(true);
    expect(result.computedGeometry.get(finalId)).toMatchObject({ kind: "text", text: "5" });
    expect(rows).toHaveLength(2);
    expect(result.forGroupEffectiveShowGeneratedIds?.has(loopId)).toBe(false);
    for (const row of rows) {
      expect(result.computedGeometry.has(row.generatedElementId)).toBe(true);
      expect(result.effectiveEnabledElementIds?.has(row.generatedElementId)).toBe(true);
      expect(result.effectiveVisibleElementIds?.has(row.generatedElementId)).toBe(false);
    }
  });

  it("keeps versions before an in-loop stop and excludes later loop work", () => {
    const compiled = compileCanonical([
      "nui 4",
      "let total: number = 0",
      "for i in range(from: 0, count: 3, step: 1) {",
      "  set total = @total + 1",
      "  stop",
      "  point P = coordinate(x: @total, y: 0)",
      "}"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    const [declaration, set] = compiled.bindingVersions!.versions;

    expect(result.computedScalarBindings?.get(declaration.bindingId)).toMatchObject({ value: { value: 1 } });
    expect(result.computedScalarBindingVersions?.get(set.id)).toMatchObject({ status: "executed" });
    expect(result.computedGeometry.has(elementId(compiled, "P"))).toBe(false);
  });

  it("keeps a one-iteration loop version scheduler-owned", () => {
    const compiled = compileCanonical([
      "nui 4",
      "let total: number = 0",
      "for i in range(from: 0, count: 1, step: 1) {",
      "  set total = @total + 1",
      "  point P = coordinate(x: @total, y: 0)",
      "}"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    const [declaration, set] = compiled.bindingVersions!.versions;

    expect(result.computedScalarBindings?.get(declaration.bindingId)).toMatchObject({ value: { value: 1 } });
    expect(result.computedScalarBindingVersions?.get(set.id)).toMatchObject({ status: "executed" });
  });

  it("records a disabled loop version as skipped-control", () => {
    const compiled = compileCanonical([
      "nui 4",
      "let total: number = 0",
      "for i in range(from: 0, count: 2, step: 1, state: disabled) {",
      "  set total = @total + 1",
      "  point P = coordinate(x: @total, y: 0)",
      "}"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    const [declaration, set] = compiled.bindingVersions!.versions;

    expect(result.computedScalarBindings?.get(declaration.bindingId)).toMatchObject({ value: { value: 0 } });
    expect(result.computedScalarBindingVersions?.get(set.id)).toMatchObject({ status: "skipped-control" });
  });

  it("drives loop versions at generated-element boundaries without retroactive property reads", () => {
    const compiled = compileCanonical([
      "nui 4",
      "let value: number = 0",
      "for i in range(from: 0, count: 3, step: 1) {",
      "  set value = @value + 1",
      "  point P = coordinate(x: 0, y: 0)",
      "  set value = @value + 10",
      "}",
      "point After = coordinate(x: 0, y: 0)"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    const value = compiled.bindingVersions!.versions[0].bindingId;
    const points = [...result.computedGeometry.values()].filter((geometry) => geometry.kind === "point");

    expect(points).toHaveLength(4);
    expect(points[0]).toMatchObject({ x: 0 });
    expect(result.computedScalarBindings?.get(value)).toMatchObject({ value: { value: 33 } });
  });
  it("enables Rust for canonical controlled and forGroup mutation graphs only", () => {
    const linear = compileCanonical([
      "nui 4",
      "let value: number = 1",
      "point Marker = coordinate(x: 0, y: 0)",
      "set value = 2"
    ].join("\n"));
    const controlled = compileCanonical([
      "nui 4",
      "let value: number = 1",
      "if (true) {",
      "  set value = 2",
      "}"
    ].join("\n"));
    const loop = compileCanonical([
      "nui 4",
      "let value: number = 0",
      "for i in range(from: 0, count: 2, step: 1) {",
      "  set value = @value + 1",
      "  point P = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n"));
    const loopWithNestedControl = compileCanonical([
      "nui 4",
      "let value: number = 0",
      "for i in range(from: 0, count: 2, step: 1) {",
      "  if (true) {",
      "    set value = @value + 1",
      "  }",
      "  point P = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n"));
    const loopOptions = optionsFor(loop);

    expect(canUseRustEvaluationForElements(linear.document.elements, optionsFor(linear))).toBe(true);
    expect(canUseRustEvaluationForElements(controlled.document.elements, optionsFor(controlled))).toBe(true);
    expect(canUseRustEvaluationForElements(loop.document.elements, loopOptions)).toBe(true);
    expect(canUseRustEvaluationForElements(
      loopWithNestedControl.document.elements, optionsFor(loopWithNestedControl)
    )).toBe(true);
    expect(canUseRustEvaluationForElements(loop.document.elements, {
      ...loopOptions,
      forGroupMutationOwnerByElementId: undefined
    })).toBe(false);
  });

  it("keeps nested conditional results iteration-local while nested loops carry outer slots", () => {
    const compiled = compileCanonical([
      "nui 4",
      "let total: number = 0",
      "for i in range(from: 0, count: 2, step: 1) {",
      "  if (@total == 0) {",
      "    let scratch: number = 1",
      "    set total = @total + @scratch",
      "  } else {",
      "    set total = @total + 10",
      "  }",
      "  for j in range(from: 0, count: 2, step: 1) {",
      "    set total = @total + 1",
      "    point P = coordinate(x: 0, y: 0)",
      "  }",
      "}"
    ].join("\n"));
    const options = optionsFor(compiled);
    const result = evaluateElements(compiled.document.elements, options);
    const total = compiled.bindingVersions!.versions[0].bindingId;

    expect(canUseRustEvaluationForElements(compiled.document.elements, options)).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.computedScalarBindings?.get(total)).toMatchObject({ value: { value: 15 } });
    // The loop/conditional-local declaration has retired && is not a final binding.
    expect(result.computedScalarBindings?.size).toBe(1);
  });

  it("lets a mutation-owned nested forGroup body reference geometry generated by an outer iteration", () => {
    const compiled = compileCanonical([
      "nui 4",
      "let total: number = 0",
      "point B = coordinate(x: 10, y: 0)",
      "for i in range(from: 0, count: 2, step: 1) {",
      "  point A = coordinate(x: @i, y: 0)",
      "  for j in range(from: 0, count: 2, step: 1) {",
      "    set total = @total + 1",
      "    line L = segment(start: @A, end: @B)",
      "  }",
      "}"
    ].join("\n"));
    const options = optionsFor(compiled);
    const result = evaluateElements(compiled.document.elements, options);
    const outerId = elementId(compiled, "Outer");
    const innerId = elementId(compiled, "Inner");
    const aId = elementId(compiled, "A");
    const bId = elementId(compiled, "B");
    const lId = elementId(compiled, "L");

    expect(canUseRustEvaluationForElements(compiled.document.elements, options)).toBe(true);
    expect(result.errors).toEqual([]);
    for (let i = 0; i < 2; i += 1) {
      const generatedInnerId = forGroupGeneratedElementId({ forGroupId: outerId, templateElementId: innerId, iterationIndex: i });
      const generatedAId = forGroupGeneratedElementId({ forGroupId: outerId, templateElementId: aId, iterationIndex: i });
      for (let j = 0; j < 2; j += 1) {
        const generatedLId = forGroupGeneratedElementId({ forGroupId: generatedInnerId, templateElementId: lId, iterationIndex: j });
        expect(result.computedGeometry.get(generatedLId)).toMatchObject({
          kind: "line", startPointId: generatedAId, endPointId: bId
        });
      }
    }
  });

  it("gives a mutation-owned nested forGroup's geometry body access to both the outer and inner iteration variables", () => {
    const compiled = compileCanonical([
      "nui 4",
      "let total: number = 0",
      "for i in range(from: 0, count: 2, step: 1) {",
      "  for j in range(from: 0, count: 3, step: 1) {",
      "    set total = @total + 1",
      "    point P = coordinate(x: @i, y: @j)",
      "  }",
      "}"
    ].join("\n"));
    const options = optionsFor(compiled);
    const result = evaluateElements(compiled.document.elements, options);
    const outerId = elementId(compiled, "Outer");
    const innerId = elementId(compiled, "Inner");
    const pId = elementId(compiled, "P");

    expect(canUseRustEvaluationForElements(compiled.document.elements, options)).toBe(true);
    expect(result.errors).toEqual([]);
    const expectedCoordinates: Array<[number, number]> = [
      [0, 0], [0, 1], [0, 2],
      [1, 0], [1, 1], [1, 2]
    ];
    let index = 0;
    const generatedIds = new Set<string>();
    for (let i = 0; i < 2; i += 1) {
      const generatedInnerId = forGroupGeneratedElementId({ forGroupId: outerId, templateElementId: innerId, iterationIndex: i });
      for (let j = 0; j < 3; j += 1) {
        const generatedPId = forGroupGeneratedElementId({ forGroupId: generatedInnerId, templateElementId: pId, iterationIndex: j });
        generatedIds.add(generatedPId);
        const [x, y] = expectedCoordinates[index];
        expect(result.computedGeometry.get(generatedPId)).toMatchObject({ kind: "point", x, y });
        index += 1;
      }
    }
    expect(generatedIds.size).toBe(6);
    expect(result.forGroupGeneratedRows!.filter((row) => row.templateElementId === pId)).toHaveLength(6);
  });

  it("resolves a nested forGroup's bound showGenerated by its source template id, not the runtime generated instance id", () => {
    const compiled = compileCanonical([
      "nui 4",
      "let showInner: boolean = true",
      "for i in range(from: 0, count: 2, step: 1) {",
      "  for j in range(from: 0, count: 1, step: 1, showGenerated: @showInner) {",
      "    point P = coordinate(x: 0, y: 0)",
      "  }",
      "}"
    ].join("\n"));
    const options = optionsFor(compiled);
    const result = evaluateElements(compiled.document.elements, options);
    const outerId = elementId(compiled, "Outer");
    const innerId = elementId(compiled, "Inner");

    expect(result.errors).toEqual([]);
    const generatedInnerId0 = forGroupGeneratedElementId({ forGroupId: outerId, templateElementId: innerId, iterationIndex: 0 });
    const generatedInnerId1 = forGroupGeneratedElementId({ forGroupId: outerId, templateElementId: innerId, iterationIndex: 1 });
    // The bound showGenerated (true) resolves against the source template id
    // ("Inner"); the recorded ids are the runtime generated instances, never
    // the source template id itself.
    expect(result.forGroupEffectiveShowGeneratedIds?.has(generatedInnerId0)).toBe(true);
    expect(result.forGroupEffectiveShowGeneratedIds?.has(generatedInnerId1)).toBe(true);
    expect(result.forGroupEffectiveShowGeneratedIds?.has(innerId)).toBe(false);
  });

  it("advances binding slots with source order: A sees old value, B sees set value, and set reads the live measurement", () => {
    const compiled = compileCanonical([
      "nui 4",
      "point P = coordinate(x: 0, y: 0)",
      "point Q = coordinate(x: 3, y: 4)",
      "line D = segment(start: @P, end: @Q, state: hidden)",
      "let value: number = @D.length",
      'text A = label(text: "A=${@value}", anchor: none, size: 3)',
      "set value = @D.length + 1",
      'text B = label(text: "B=${@value}", anchor: none, size: 3)'
    ].join("\n"));
    const options = optionsFor(compiled);
    const result = evaluateElements(compiled.document.elements, options);

    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(elementId(compiled, "A"))).toMatchObject({ kind: "text", text: "A=5" });
    expect(result.computedGeometry.get(elementId(compiled, "B"))).toMatchObject({ kind: "text", text: "B=6" });
    const [declaration, set] = compiled.bindingVersions!.versions;
    expect(result.computedScalarBindings?.get(declaration.bindingId)).toMatchObject({ status: "ok", value: { value: 6 } });
    expect(result.computedScalarBindingVersions?.get(declaration.id)).toMatchObject({ status: "executed", bindingId: declaration.bindingId });
    expect(result.computedScalarBindingVersions?.get(set.id)).toMatchObject({
      status: "executed", statementId: set.id, bindingId: declaration.bindingId, evaluation: { value: { value: 6 } }
    });
    expect(canUseRustEvaluationForElements(compiled.document.elements, options)).toBe(true);
  });

  it("does not execute a set at or after stop, including during finalization", () => {
    const compiled = compileCanonical([
      "nui 4",
      "let value: number = 1",
      'text A = label(text: "A=${@value}", anchor: none, size: 3)',
      "stop",
      "set value = 2",
      'text B = label(text: "B=${@value}", anchor: none, size: 3)'
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    const declaration = compiled.bindingVersions!.versions[0];
    const set = compiled.bindingVersions!.versions[1];

    expect(result.computedGeometry.get(elementId(compiled, "A"))).toMatchObject({ kind: "text", text: "A=1" });
    expect(result.computedGeometry.has(elementId(compiled, "B"))).toBe(false);
    expect(result.computedScalarBindings?.get(declaration.bindingId)).toMatchObject({ value: { value: 1 } });
    expect(result.computedScalarBindingVersions?.has(set.id)).toBe(false);
  });

  it("executes a set before stop but excludes declarations after the cutoff", () => {
    const compiled = compileCanonical([
      "nui 4",
      "let value: number = 1",
      "set value = 2",
      "stop",
      "const later: number = 3",
      'text A = label(text: "A=${@value}", anchor: none, size: 3)'
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    const [declaration, set, later] = compiled.bindingVersions!.versions;

    expect(result.computedGeometry.get(elementId(compiled, "A"))).toBeUndefined();
    expect(result.computedScalarBindings?.get(declaration.bindingId)).toMatchObject({ value: { value: 2 } });
    expect(result.computedScalarBindingVersions?.get(set.id)).toMatchObject({ status: "executed" });
    expect(result.computedScalarBindings?.has(later.bindingId)).toBe(false);
  });

  it("finalizes the same one-way stream after the last element and preserves declaration map order", () => {
    const compiled = compileCanonical([
      "nui 4",
      "let x: number = 1",
      "let y: number = 2",
      "point Marker = coordinate(x: 0, y: 0)",
      "set x = @y",
      "set y = @x"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(Array.from(result.computedScalarBindings?.keys() ?? [])).toEqual(
      compiled.bindingVersions!.versions.filter((version) => version.kind === "declare").map((version) => version.bindingId)
    );
    expect(Array.from(result.computedScalarBindingVersions?.keys() ?? [])).toEqual(
      compiled.bindingVersions!.versions.map((version) => version.id)
    );
    expect(result.computedScalarBindings?.get(compiled.bindingVersions!.versions[0].bindingId)).toMatchObject({ value: { value: 2 } });
  });

  it("resolves typed conditional controls from the current slot at each group statement", () => {
    const compiled = compileCanonical([
      "nui 4",
      "let flag: boolean = false",
      "if (@flag) {",
      "  point ThenBefore = coordinate(x: 0, y: 0)",
      "} else {",
      "  point ElseBefore = coordinate(x: 1, y: 0)",
      "}",
      "set flag = true",
      "if (@flag) {",
      "  point ThenAfter = coordinate(x: 2, y: 0)",
      "} else {",
      "  point ElseAfter = coordinate(x: 3, y: 0)",
      "}"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));

    expect(result.computedGeometry.has(elementId(compiled, "ElseBefore"))).toBe(true);
    expect(result.computedGeometry.has(elementId(compiled, "ThenBefore"))).toBe(false);
    expect(result.computedGeometry.has(elementId(compiled, "ThenAfter"))).toBe(true);
    expect(result.computedGeometry.has(elementId(compiled, "ElseAfter"))).toBe(false);
  });

  it("uses the just-advanced slot and live measurement once at the conditional opener", () => {
    const compiled = compileCanonical([
      "nui 4",
      "point P = coordinate(x: 0, y: 0)",
      "point Q = coordinate(x: 3, y: 4)",
      "line D = segment(start: @P, end: @Q, state: hidden)",
      "let flag: boolean = false",
      "let result: number = 0",
      "set flag = @D.length == 5",
      "if (@flag) {",
      "  set result = @D.length + 2",
      "} else {",
      "  set result = 99",
      "}"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    const resultBinding = compiled.bindingVersions!.versions.find((version) =>
      version.kind === "declare" && version.bindingId !== compiled.bindingVersions!.versions[0].bindingId
    )!;

    expect(result.errors).toEqual([]);
    expect(result.computedScalarBindings?.get(resultBinding.bindingId)).toMatchObject({ value: { value: 7 } });
    const inactive = compiled.bindingVersions!.versions.find((version) => version.kind === "set" && version.expression.kind === "numberLiteral" && version.expression.value === 99)!;
    expect(result.computedScalarBindingVersions?.get(inactive.id)).toMatchObject({ status: "inactive-control" });
  });
});
