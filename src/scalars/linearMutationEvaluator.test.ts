import { describe, expect, it } from "vitest";
import type { BindingVersion, BindingVersionGraph } from "@nuinuicad/nui-language";
import { createIncrementalLinearMutationEvaluator } from "./linearMutationEvaluator";

const numberType = { kind: "number" } as const;
const span = { start: 0, end: 1 } as const;

const declaration = (
  id: string,
  bindingId: string,
  sourceOrder: number,
  initializer: NonNullable<BindingVersion["initializer"]>
): BindingVersion => ({
  id,
  kind: "declare",
  bindingId,
  bindingKind: "const",
  declaredType: numberType,
  sourceOrder,
  scopeId: "scope:root",
  scopeExitSourceOrder: Number.POSITIVE_INFINITY,
  control: {
    scopeId: "scope:root",
    scopeExitSourceOrder: Number.POSITIVE_INFINITY,
    ownerChain: [],
    kind: "linear"
  },
  initialState: { kind: "uncomputed" },
  initializer
});

const graphFor = (versions: readonly BindingVersion[]): BindingVersionGraph => ({
  versions,
  versionsById: new Map(versions.map((version) => [version.id, version])),
  versionIdsByBindingId: new Map(versions.map((version) => [version.bindingId, [version.id]])),
  timelinesByBindingId: new Map(versions.map((version) => [version.bindingId, {
    sourceOrders: [version.sourceOrder],
    versionIds: [version.id]
  }])),
  requiresExecutionOrdering: true
});

describe("createIncrementalLinearMutationEvaluator dependency schedule", () => {
  it("holds a dependent version until its canonical prerequisite is ready, then follows dependency rank", () => {
    const child = declaration("child-version", "child-binding", 2, {
      kind: "numberLiteral",
      span,
      value: 20,
      type: numberType
    });
    const outer = declaration("outer-version", "outer-binding", 1, {
      kind: "reference",
      span,
      nameSpan: span,
      name: "Child",
      bindingId: child.bindingId,
      type: numberType
    });
    const evaluator = createIncrementalLinearMutationEvaluator(graphFor([outer, child]));
    const dependencyRank = new Map([[child.id, 0], [outer.id, 1]]);

    evaluator.advanceTo({ kind: "afterStatement", sourceOrder: 1, dependencyExecutionPosition: 1 }, dependencyRank, false, new Set());
    expect(evaluator.resolveCurrent(outer.bindingId)).toMatchObject({
      status: "error",
      issueCode: "evaluation-binding-unavailable"
    });

    evaluator.advanceTo(
      { kind: "afterStatement", sourceOrder: 2, dependencyExecutionPosition: 0 },
      dependencyRank,
      false,
      new Set([child.id])
    );
    expect(evaluator.resolveCurrent(child.bindingId)).toMatchObject({ status: "ok", value: { kind: "number", value: 20 } });

    evaluator.advanceTo(
      { kind: "afterStatement", sourceOrder: 2, dependencyExecutionPosition: 1 },
      dependencyRank,
      false,
      new Set([child.id, outer.id])
    );
    const evaluation = evaluator.finalize({ kind: "beforeStatement", sourceOrder: 2 });
    expect([...evaluation.historyByVersionId.keys()]).toEqual([child.id, outer.id]);
    expect(evaluation.resultsByBindingId.get(outer.bindingId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 20 }
    });
  });
});
