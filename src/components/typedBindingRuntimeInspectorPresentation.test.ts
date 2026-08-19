import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel, type LastGoodDslDocument } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import { buildConditionalGroupConditionsByElementId } from "../geometry/controlBooleanRuntime";
import { evaluateElements, type EvaluateElementsOptions } from "../geometry/evaluate";
import { buildConditionalMutationOwners, conditionalOwnerIdByElementId } from "../scalars/conditionalMutationControl";
import { buildForGroupMutationOwners, forGroupMutationOwnerByElementId } from "../scalars/forGroupMutationControl";
import type { BindingId } from "../scalars/bindingCatalog";
import type { ScalarEvaluation } from "../scalars/types";
import type { EvaluationResult } from "../types/geometry";
import {
  typedBindingRuntimeInspectorPresentation,
  type TypedBindingRuntimeConsumerSources
} from "./typedBindingRuntimeInspectorPresentation";

const compileCanonical = (source: string): LastGoodDslDocument => {
  const baseline = regenerateCanonicalFromModel(emptyDocument(), 4);
  const result = compileCanonicalText(baseline, source);
  if (result.status === "fatal") throw new Error(JSON.stringify(result.diagnostics));
  return result.doc;
};

/** Mirrors linearMutationEvaluation.integration.test.ts's own optionsFor - the
 * real production wiring from a compiled document to EvaluateElementsOptions. */
const optionsFor = (compiled: LastGoodDslDocument): EvaluateElementsOptions => ({
  evaluationLimitIndex: compiled.document.evaluationLimitIndex,
  scalarProgram: compiled.scalarProgram,
  bindingVersions: compiled.bindingVersions,
  statementInfoByElementId: compiled.statementMap.byElementId,
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
  )
});

const evaluate = (compiled: LastGoodDslDocument): EvaluationResult =>
  evaluateElements(compiled.document.elements, optionsFor(compiled));

const bindingIdByName = (compiled: LastGoodDslDocument, name: string): BindingId =>
  compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.kind === "typed" && binding.name === name)!.id;

const consumersFor = (compiled: LastGoodDslDocument): TypedBindingRuntimeConsumerSources => ({
  propertyBindings: compiled.propertyBindings,
  conditionalGroupConditions: compiled.conditionalGroupConditions,
  textTemplates: compiled.textTemplates,
  statementMap: compiled.statementMap,
  elements: compiled.document.elements
});

const present = (
  compiled: LastGoodDslDocument,
  bindingId: BindingId,
  evaluation: Pick<EvaluationResult, "computedScalarBindings" | "computedScalarBindingVersions">,
  isFresh = true
) =>
  typedBindingRuntimeInspectorPresentation(
    compiled.bindingAnalysis!,
    compiled.bindingVersions,
    evaluation,
    consumersFor(compiled),
    bindingId,
    isFresh
  );

const valueRow = (presentation: ReturnType<typeof present>) =>
  presentation?.rows.find((row) => row.key === "value")?.value;
const historyRow = (presentation: ReturnType<typeof present>) =>
  presentation?.rows.find((row) => row.key === "history")?.value;

describe("typedBindingRuntimeInspectorPresentation: declaration-only (no set)", () => {
  it("shows a const number's final value && no history row", () => {
    const compiled = compileCanonical(["nui 4", "const width: number = 12"].join("\n"));
    const bindingId = bindingIdByName(compiled, "width");
    const presentation = present(compiled, bindingId, evaluate(compiled));
    expect(presentation?.status).toBe("ok");
    expect(valueRow(presentation)).toBe("12");
    expect(historyRow(presentation)).toBeUndefined();
    expect(presentation?.invalidMessage).toBeNull();
  });

  it("formats a non-integer number with the same rule text templates use", () => {
    const compiled = compileCanonical(["nui 4", "const ratio: number = 1 / 3"].join("\n"));
    const bindingId = bindingIdByName(compiled, "ratio");
    expect(valueRow(present(compiled, bindingId, evaluate(compiled)))).toBe("0.333");
  });

  it("formats a boolean value", () => {
    const compiled = compileCanonical(["nui 4", "const shown: boolean = true"].join("\n"));
    const bindingId = bindingIdByName(compiled, "shown");
    expect(valueRow(present(compiled, bindingId, evaluate(compiled)))).toBe("true");
  });

  it("formats a string value", () => {
    const compiled = compileCanonical(["nui 4", 'const label: string = "front piece"'].join("\n"));
    const bindingId = bindingIdByName(compiled, "label");
    expect(valueRow(present(compiled, bindingId, evaluate(compiled)))).toBe("front piece");
  });

  it("formats a choice value", () => {
    const compiled = compileCanonical(["nui 4", "const side: choice(right, left) = right"].join("\n"));
    const bindingId = bindingIdByName(compiled, "side");
    expect(valueRow(present(compiled, bindingId, evaluate(compiled)))).toBe("right");
  });

  it("surfaces a runtime failure (no sets) as poisoned with an explanatory message && no history row", () => {
    const compiled = compileCanonical(["nui 4", "const bad: number = 1 / 0"].join("\n"));
    const bindingId = bindingIdByName(compiled, "bad");
    const presentation = present(compiled, bindingId, evaluate(compiled));
    expect(presentation?.status).toBe("poisoned");
    expect(valueRow(presentation)).toBe("無効(poisoned)");
    expect(presentation?.invalidMessage).toBeTruthy();
    expect(historyRow(presentation)).toBeUndefined();
  });

  it("uses the resolved disabled geometry target name, including derived points", () => {
    const compiled = compileCanonical([
      "nui 4",
      "point Shoulder = coordinate(x: 0, y: 0)",
      "const measured: number = 1"
    ].join("\n"));
    const bindingId = bindingIdByName(compiled, "measured");
    const target = compiled.document.elements.find((element) => element.name === "Shoulder");
    expect(target).toBeDefined();
    const evaluation = {
      computedScalarBindings: new Map<BindingId, ScalarEvaluation>([
        [bindingId, {
          status: "error",
          type: { kind: "number" },
          issueCode: "evaluation-geometry-builtin-disabled",
          context: { kind: "geometryBuiltinTarget", targetElementId: target!.id, pointKey: "start" }
        }]
      ]),
      computedScalarBindingVersions: new Map()
    } satisfies Pick<EvaluationResult, "computedScalarBindings" | "computedScalarBindingVersions">;
    const presentation = present(compiled, bindingId, evaluation);
    expect(presentation?.invalidMessage).toBe(
      "「Shoulder.start」は評価OFFのためgeometry引数として利用できません。「Shoulder」を評価ONにするか、参照先を変更してください。"
    );
  });
});

describe("typedBindingRuntimeInspectorPresentation: linear set", () => {
  it("shows the final value after a set, with a history summary", () => {
    const compiled = compileCanonical(["nui 4", "let total: number = 1", "set total = 5"].join("\n"));
    const bindingId = bindingIdByName(compiled, "total");
    const presentation = present(compiled, bindingId, evaluate(compiled));
    expect(presentation?.status).toBe("ok");
    expect(valueRow(presentation)).toBe("5");
    expect(historyRow(presentation)).toBe("set 1件・すべて成功");
  });

  it("recovers after an earlier poisoned set: final ok, history notes the recovery", () => {
    const compiled = compileCanonical(
      ["nui 4", "let value: number = 1 / 0", "set value = 5"].join("\n")
    );
    const bindingId = bindingIdByName(compiled, "value");
    const presentation = present(compiled, bindingId, evaluate(compiled));
    expect(presentation?.status).toBe("ok");
    expect(valueRow(presentation)).toBe("5");
    expect(historyRow(presentation)).toBe("set 1件・一時無効化後に回復");
    expect(presentation?.invalidMessage).toBeNull();
  });

  it("stays poisoned when a later set also fails", () => {
    const compiled = compileCanonical(
      ["nui 4", "let value: number = 1 / 0", "set value = 1 / 0"].join("\n")
    );
    const bindingId = bindingIdByName(compiled, "value");
    const presentation = present(compiled, bindingId, evaluate(compiled));
    expect(presentation?.status).toBe("poisoned");
    expect(historyRow(presentation)).toBe("set 1件・現在無効(poisoned)");
  });
});

describe("typedBindingRuntimeInspectorPresentation: conditional branch", () => {
  it("reflects only the active branch's set", () => {
    const compiled = compileCanonical(
      ["nui 4", "let value: number = 0", "if (true) {", "  set value = 1", "} else {", "  set value = 2", "}"].join("\n")
    );
    const bindingId = bindingIdByName(compiled, "value");
    const presentation = present(compiled, bindingId, evaluate(compiled));
    expect(valueRow(presentation)).toBe("1");
  });

  it("reflects the else branch when the condition is false, never the inactive then-branch value", () => {
    const compiled = compileCanonical(
      ["nui 4", "let value: number = 0", "if (false) {", "  set value = 1", "} else {", "  set value = 2", "}"].join("\n")
    );
    const bindingId = bindingIdByName(compiled, "value");
    const presentation = present(compiled, bindingId, evaluate(compiled));
    expect(valueRow(presentation)).toBe("2");
  });
});

describe("typedBindingRuntimeInspectorPresentation: forGroup loop", () => {
  it("shows the final (last-iteration) value, never an intermediate iteration's value", () => {
    const compiled = compileCanonical(
      [
        "nui 4",
        "let total: number = 0",
        "for i in range(from: 0, count: 3, step: 1) {",
        "  set total = @total + 1",
        "  point P = coordinate(x: 0, y: 0)",
        "}"
      ].join("\n")
    );
    const bindingId = bindingIdByName(compiled, "total");
    const presentation = present(compiled, bindingId, evaluate(compiled));
    expect(valueRow(presentation)).toBe("3");
    // One static `set` statement in source - the loop ran it 3 times, but the
    // version-level history is last-iteration-only (Map/Vec upsert by
    // versionId), so the summary must still read as a single successful set,
    // not 3.
    expect(historyRow(presentation)).toBe("set 1件・すべて成功");
  });
});

describe("typedBindingRuntimeInspectorPresentation: freshness gate", () => {
  it("shows unknown instead of the last value when isFresh is false", () => {
    const compiled = compileCanonical(["nui 4", "const width: number = 12"].join("\n"));
    const bindingId = bindingIdByName(compiled, "width");
    const presentation = present(compiled, bindingId, evaluate(compiled), false);
    expect(presentation?.status).toBe("unknown");
    expect(valueRow(presentation)).toBe("不明(評価待ち)");
    expect(presentation?.consumerRows).toEqual([]);
  });

  it("shows unknown when the binding has no entry in this evaluation at all", () => {
    const compiled = compileCanonical(["nui 4", "const width: number = 12"].join("\n"));
    const bindingId = bindingIdByName(compiled, "width");
    const presentation = present(compiled, bindingId, { computedScalarBindings: new Map(), computedScalarBindingVersions: new Map() });
    expect(presentation?.status).toBe("unknown");
    expect(valueRow(presentation)).toBe("不明(この評価には含まれていません)");
  });
});

describe("typedBindingRuntimeInspectorPresentation: selection guard", () => {
  it("returns null for a non-typed (forGroup iteration) binding kind", () => {
    const compiled = compileCanonical(
      ["nui 4", "for i in range(from: 0, count: 3, step: 1) {", "  const y: number = 1", "}"].join("\n")
    );
    const iterationBinding = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.kind === "iteration");
    expect(iterationBinding).toBeTruthy();
    expect(present(compiled, iterationBinding!.id, evaluate(compiled))).toBeNull();
  });

  it("returns null for an unknown binding id", () => {
    const compiled = compileCanonical(["nui 4", "const width: number = 12"].join("\n"));
    expect(present(compiled, "binding:does-not-exist", evaluate(compiled))).toBeNull();
  });
});
