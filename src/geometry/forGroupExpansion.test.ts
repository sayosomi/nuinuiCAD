import { describe, expect, it } from "vitest";
import { elementDisplayName } from "../model/elementNames";
import type { CadElement, ForGroupElement, FreePointElement } from "../types/geometry";
import { expandForGroupIteration, forGroupGeneratedElementId, forGroupRangeValues } from "./forGroupExpansion";
import { makeNumericExpression } from "./numericExpressions";

// 04/05: DivisionPlacement characterization。expandForGroupIterationは専用のforGroup clone
// pathを持たず、structuredClone + remapElementReferencesでtemplate要素全体を複製する。
// つまりplacementの値はiterationごとに無条件で複製される。

const forGroup: ForGroupElement = {
  id: "loop",
  name: "Loop",
  type: "forGroup",
  activity: "visible",
  variableName: "i",
  min: 0,
  max: 1,
  step: 1,
  showGenerated: true
};

const basePoints: CadElement[] = [
  { id: "point-a", name: "点A", type: "freePoint", activity: "visible", x: 0, y: 0 },
  { id: "point-b", name: "点B", type: "freePoint", activity: "visible", x: 10, y: 0 }
];

describe("forGroupRangeValues", () => {
  it("generates min plus exact step values without clamping", () => {
    expect(forGroupRangeValues(0, 10, 3)).toEqual({ values: [0, 3, 6, 9] });
    expect(forGroupRangeValues(0, 10, 5)).toEqual({ values: [0, 5, 10] });
  });

  it("includes min when it equals max or the step exceeds the interval", () => {
    expect(forGroupRangeValues(5, 5, 1)).toEqual({ values: [5] });
    expect(forGroupRangeValues(5, 6, 10)).toEqual({ values: [5] });
  });

  it("rejects non-ascending and non-positive ranges", () => {
    expect(forGroupRangeValues(6, 5, 1)).toEqual({ error: "min-greater-than-max" });
    expect(forGroupRangeValues(0, 1, 0)).toEqual({ error: "non-positive-step" });
    expect(forGroupRangeValues(0, 1, -1)).toEqual({ error: "non-positive-step" });
  });

  it("enforces the 1000-generated-value safety limit", () => {
    expect(forGroupRangeValues(0, 999, 1)).toEqual({ values: Array.from({ length: 1000 }, (_, index) => index) });
    expect(forGroupRangeValues(0, 1000, 1)).toEqual({ error: "iteration-limit" });
  });
});

describe("expandForGroupIteration (DivisionPlacement characterization)", () => {
  it("clones divisionPoint placement verbatim across iterations", () => {
    const division: CadElement = {
      id: "division",
      name: "分点",
      type: "divisionPoint",
      activity: "visible",
      parentGroupId: forGroup.id,
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" },
      placement: { kind: "distance", value: 7 }
    };
    const elements = [...basePoints, forGroup, division];

    for (const iterationIndex of [0, 1]) {
      const { generatedElements } = expandForGroupIteration({
        elements,
        forGroup,
        iterationIndex,
        variableValue: iterationIndex
      });
      const generatedDivision = generatedElements.find((element) => element.type === "divisionPoint");

      expect(generatedDivision).toMatchObject({
        placement: { kind: "distance", value: 7 },
        startPoint: { mode: "reference", pointId: "point-a" },
        endPoint: { mode: "reference", pointId: "point-b" }
      });
    }
  });

  it("clones lineDivisionPoint placement verbatim across iterations", () => {
    const line: CadElement = {
      id: "line-ab",
      name: "線AB",
      type: "line",
      activity: "visible",
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" }
    };
    const division: CadElement = {
      id: "division",
      name: "線上分点",
      type: "lineDivisionPoint",
      activity: "visible",
      parentGroupId: forGroup.id,
      endpoint: { lineId: "line-ab", endpointKey: "start" },
      placement: { kind: "ratio", value: 0.2 }
    };
    const elements = [...basePoints, line, forGroup, division];

    for (const iterationIndex of [0, 1]) {
      const { generatedElements } = expandForGroupIteration({
        elements,
        forGroup,
        iterationIndex,
        variableValue: iterationIndex
      });
      const generatedDivision = generatedElements.find((element) => element.type === "lineDivisionPoint");

      expect(generatedDivision).toMatchObject({
        placement: { kind: "ratio", value: 0.2 },
        // line-ab is a document-level sibling, not a forGroup descendant, so it is
        // outside the template idMap && its reference is left unchanged.
        endpoint: { lineId: "line-ab", endpointKey: "start" }
      });
    }
  });
});

describe("expandForGroupIteration (anonymous mutation name invariant)", () => {
  it("keeps a generated pathReverse clone's name empty instead of a bracket-labeled string", () => {
    const line: CadElement = {
      id: "line-ab",
      name: "線AB",
      type: "line",
      activity: "visible",
      parentGroupId: forGroup.id,
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" }
    };
    const reverse: CadElement = {
      id: "reverse",
      name: "",
      type: "pathReverse",
      activity: "visible",
      parentGroupId: forGroup.id,
      targetLineId: "line-ab"
    };
    const elements = [...basePoints, forGroup, line, reverse];

    const { generatedElements } = expandForGroupIteration({
      elements,
      forGroup,
      iterationIndex: 0,
      variableValue: 0
    });
    const generatedReverse = generatedElements.find((element) => element.type === "pathReverse")!;

    expect(generatedReverse.name).toBe("");
    // The model invariant (name === "") must not remove the presentation
    // fallback: diagnostics/UI labels still resolve to the type label.
    expect(elementDisplayName(generatedReverse)).toBe("反転");
  });

  it("still generates a bracket-labeled name for an ordinary (non-mutation) generated clone", () => {
    const line: CadElement = {
      id: "line-ab",
      name: "線AB",
      type: "line",
      activity: "visible",
      parentGroupId: forGroup.id,
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" }
    };
    const elements = [...basePoints, forGroup, line];

    const { generatedElements } = expandForGroupIteration({
      elements,
      forGroup,
      iterationIndex: 0,
      variableValue: 0
    });
    const generatedLine = generatedElements.find((element) => element.type === "line")!;

    expect(generatedLine.name).toBe("[i=0] 線AB");
  });

  it("does not add element-local numeric variables to generated clones", () => {
    const line: CadElement = {
      id: "line-ab",
      name: "線AB",
      type: "line",
      activity: "visible",
      parentGroupId: forGroup.id,
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" }
    };

    const { generatedElements } = expandForGroupIteration({
      elements: [...basePoints, forGroup, line],
      forGroup,
      iterationIndex: 0,
      variableValue: 0
    });
    const generatedLine = generatedElements.find((element) => element.type === "line");

    expect(generatedLine).toBeDefined();
    expect(generatedLine).not.toHaveProperty("numericVariables");
  });
});

describe("expandForGroupIteration occurrence provenance", () => {
  it("stamps generated rows with the source/template path without changing generated ids", () => {
    const point: FreePointElement = {
      id: "generated-point",
      name: "Generated point",
      type: "freePoint",
      activity: "visible",
      parentGroupId: forGroup.id,
      x: 0,
      y: 0
    };
    const { rows } = expandForGroupIteration({
      elements: [...basePoints, forGroup, point],
      forGroup,
      iterationIndex: 2,
      variableValue: 2
    });

    expect(rows).toEqual([
      expect.objectContaining({
        generatedElementId: "generated-point@loop:2",
        occurrencePath: [{ templateForGroupId: "loop", iterationIndex: 2 }]
      })
    ]);
    expect(rows[0].generatedElementId).toBe(forGroupGeneratedElementId({
      forGroupId: "loop",
      templateElementId: "generated-point",
      iterationIndex: 2
    }));
  });
});

describe("expandForGroupIteration (nested forGroup ownership and iteration context)", () => {
  const outerForGroup: ForGroupElement = {
    id: "outer",
    name: "Outer",
    type: "forGroup",
    activity: "visible",
    variableName: "i",
    min: 0,
    max: 1,
    step: 1,
    showGenerated: false
  };
  const innerForGroupTemplate: ForGroupElement = {
    id: "inner",
    name: "Inner",
    type: "forGroup",
    activity: "visible",
    variableName: "j",
    min: 0,
    max: 2,
    step: 1,
    showGenerated: false,
    parentGroupId: "outer"
  };
  const pointTemplate: FreePointElement = {
    id: "p",
    name: "P",
    type: "freePoint",
    activity: "visible",
    parentGroupId: "inner",
    x: makeNumericExpression("@i"),
    y: makeNumericExpression("@j")
  };
  const elements: CadElement[] = [outerForGroup, innerForGroupTemplate, pointTemplate];

  it("remaps a direct child's parentGroupId to the runtime forGroup instance, not the source template id", () => {
    const outerExpanded = expandForGroupIteration({
      elements,
      forGroup: outerForGroup,
      iterationIndex: 0,
      variableValue: 0
    });
    const generatedInner = outerExpanded.generatedElements.find(
      (element) => element.type === "forGroup"
    ) as ForGroupElement;
    const expectedGeneratedInnerId = forGroupGeneratedElementId({
      forGroupId: outerForGroup.id,
      templateElementId: innerForGroupTemplate.id,
      iterationIndex: 0
    });
    expect(generatedInner.id).toBe(expectedGeneratedInnerId);
    // The generated Inner instance is a direct child of Outer: its
    // parentGroupId must point at Outer's own (stable, top-level) id, not be
    // left dangling.
    expect(generatedInner.parentGroupId).toBe(outerForGroup.id);

    const innerExpanded = expandForGroupIteration({
      elements,
      forGroup: generatedInner,
      templateForGroupId: innerForGroupTemplate.id,
      iterationIndex: 0,
      variableValue: 0
    });
    const generatedP = innerExpanded.generatedElements.find(
      (element) => element.type === "freePoint"
    )!;
    // The generated P is a direct child of the generated Inner *instance* -
    // its parentGroupId must be the runtime instance id, never the
    // source-authored "inner" template id.
    expect(generatedP.parentGroupId).toBe(generatedInner.id);
    expect(generatedP.parentGroupId).not.toBe(innerForGroupTemplate.id);
  });

  it("does not mix parent chains across two different outer iterations", () => {
    const outerIteration0 = expandForGroupIteration({
      elements,
      forGroup: outerForGroup,
      iterationIndex: 0,
      variableValue: 0
    });
    const outerIteration1 = expandForGroupIteration({
      elements,
      forGroup: outerForGroup,
      iterationIndex: 1,
      variableValue: 1
    });
    const generatedInner0 = outerIteration0.generatedElements.find((e) => e.type === "forGroup")!;
    const generatedInner1 = outerIteration1.generatedElements.find((e) => e.type === "forGroup")!;
    expect(generatedInner0.id).not.toBe(generatedInner1.id);

    const innerExpanded0 = expandForGroupIteration({
      elements,
      forGroup: generatedInner0,
      templateForGroupId: innerForGroupTemplate.id,
      iterationIndex: 0,
      variableValue: 0
    });
    const innerExpanded1 = expandForGroupIteration({
      elements,
      forGroup: generatedInner1,
      templateForGroupId: innerForGroupTemplate.id,
      iterationIndex: 0,
      variableValue: 0
    });
    const generatedP0 = innerExpanded0.generatedElements.find((e) => e.type === "freePoint")!;
    const generatedP1 = innerExpanded1.generatedElements.find((e) => e.type === "freePoint")!;
    expect(generatedP0.parentGroupId).toBe(generatedInner0.id);
    expect(generatedP1.parentGroupId).toBe(generatedInner1.id);
    expect(generatedP0.parentGroupId).not.toBe(generatedP1.parentGroupId);
  });

});
