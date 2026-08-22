import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import { evaluateElements } from "./evaluate";

const baseElements = (): CadElement[] => [
  { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
  { id: "b", name: "B", type: "freePoint", activity: "visible", x: 10, y: 0 },
  {
    id: "line",
    name: "Line",
    type: "line",
    activity: "visible",
    startPoint: { mode: "reference", pointId: "a" },
    endPoint: { mode: "reference", pointId: "b" }
  }
];

const conditionalReverse = (condition: number, branch: "then" | "else"): CadElement[] => [
  ...baseElements(),
  {
    id: "condition",
    name: "Condition",
    type: "conditionalGroup",
    activity: "visible",
    condition
  },
  {
    id: "reverse",
    name: "",
    type: "pathReverse",
    activity: "visible",
    parentGroupId: "condition",
    conditionalBranch: branch,
    targetLineId: "line"
  }
];

describe("geometry mutation execution eligibility", () => {
  it("does not record a mutation in an inactive conditional branch", () => {
    const evaluation = evaluateElements(conditionalReverse(0, "then"));

    expect(evaluation.errors).toEqual([]);
    expect(evaluation.geometryMutationExecutions).toEqual([]);
    expect(evaluation.conditionInactiveElementIds?.has("reverse")).toBe(true);
  });

  it("records the runtime mutation when its conditional branch is active", () => {
    const evaluation = evaluateElements(conditionalReverse(1, "then"));

    expect(evaluation.errors).toEqual([]);
    expect(evaluation.geometryMutationExecutions).toEqual([
      { mutationElementId: "reverse", targetElementIds: ["line"] }
    ]);
  });

  it("does not record a mutation after the evaluation limit", () => {
    const evaluation = evaluateElements([
      ...baseElements(),
      {
        id: "reverse",
        name: "",
        type: "pathReverse",
        activity: "visible",
        targetLineId: "line"
      }
    ], { evaluationLimitIndex: 3 });

    expect(evaluation.errors).toEqual([]);
    expect(evaluation.geometryMutationExecutions).toEqual([]);
    expect(evaluation.evaluatedElementIds?.has("reverse")).toBe(false);
  });
});
