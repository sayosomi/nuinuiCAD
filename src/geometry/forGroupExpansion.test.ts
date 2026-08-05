import { describe, expect, it } from "vitest";
import { elementDisplayName } from "../model/elementNames";
import type { CadElement, ForGroupElement, FreePointElement } from "../types/geometry";
import { evaluateLocalVariables } from "./evaluationContext";
import { expandForGroupIteration, forGroupGeneratedElementId } from "./forGroupExpansion";
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
  start: 0,
  count: 2,
  step: 1,
  showGenerated: true
};

const basePoints: CadElement[] = [
  { id: "point-a", name: "点A", type: "freePoint", activity: "visible", x: 0, y: 0 },
  { id: "point-b", name: "点B", type: "freePoint", activity: "visible", x: 10, y: 0 }
];

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
        // outside the template idMap and its reference is left unchanged.
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
});

describe("expandForGroupIteration (nested forGroup ownership and iteration context)", () => {
  const outerForGroup: ForGroupElement = {
    id: "outer",
    name: "Outer",
    type: "forGroup",
    activity: "visible",
    variableName: "i",
    start: 0,
    count: 2,
    step: 1,
    showGenerated: false
  };
  const innerForGroupTemplate: ForGroupElement = {
    id: "inner",
    name: "Inner",
    type: "forGroup",
    activity: "visible",
    variableName: "j",
    start: 0,
    count: 3,
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
      variableValue: 0,
      ancestorIterationVariables: [outerExpanded.iterationVariable]
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
      variableValue: 0,
      ancestorIterationVariables: [outerIteration0.iterationVariable]
    });
    const innerExpanded1 = expandForGroupIteration({
      elements,
      forGroup: generatedInner1,
      templateForGroupId: innerForGroupTemplate.id,
      iterationIndex: 0,
      variableValue: 0,
      ancestorIterationVariables: [outerIteration1.iterationVariable]
    });
    const generatedP0 = innerExpanded0.generatedElements.find((e) => e.type === "freePoint")!;
    const generatedP1 = innerExpanded1.generatedElements.find((e) => e.type === "freePoint")!;
    expect(generatedP0.parentGroupId).toBe(generatedInner0.id);
    expect(generatedP1.parentGroupId).toBe(generatedInner1.id);
    expect(generatedP0.parentGroupId).not.toBe(generatedP1.parentGroupId);
  });

  it("gives a nested body element both the outer and inner ancestor iteration variables, resolvable to @i and @j", () => {
    const outerExpanded = expandForGroupIteration({
      elements,
      forGroup: outerForGroup,
      iterationIndex: 1,
      variableValue: 1
    });
    const generatedInner = outerExpanded.generatedElements.find((e) => e.type === "forGroup") as ForGroupElement;
    const innerExpanded = expandForGroupIteration({
      elements,
      forGroup: generatedInner,
      templateForGroupId: innerForGroupTemplate.id,
      iterationIndex: 2,
      variableValue: 2,
      ancestorIterationVariables: [outerExpanded.iterationVariable]
    });
    const generatedP = innerExpanded.generatedElements.find((e) => e.type === "freePoint")!;
    // evaluateLocalVariables keys localVariableValues by both binding id and
    // by plain name, so a `@i` / `@j` numeric expression resolves by name
    // directly.
    const localVariables = evaluateLocalVariables(generatedP, new Map(), new Map(), [], elements);
    expect(localVariables?.localVariableValues.get("i")).toBe(1);
    expect(localVariables?.localVariableValues.get("j")).toBe(2);
  });

  it("shadows an outer loop variable with an inner loop variable of the same name", () => {
    const outerNamedI: ForGroupElement = { ...outerForGroup, variableName: "i" };
    const innerNamedI: ForGroupElement = { ...innerForGroupTemplate, variableName: "i" };
    const bodyReferencingI: FreePointElement = {
      ...pointTemplate,
      x: makeNumericExpression("@i"),
      y: makeNumericExpression("0")
    };
    const shadowElements: CadElement[] = [outerNamedI, innerNamedI, bodyReferencingI];

    const outerExpanded = expandForGroupIteration({
      elements: shadowElements,
      forGroup: outerNamedI,
      iterationIndex: 0,
      variableValue: 100
    });
    const generatedInner = outerExpanded.generatedElements.find((e) => e.type === "forGroup") as ForGroupElement;
    const innerExpanded = expandForGroupIteration({
      elements: shadowElements,
      forGroup: generatedInner,
      templateForGroupId: innerNamedI.id,
      iterationIndex: 0,
      variableValue: 5,
      ancestorIterationVariables: [outerExpanded.iterationVariable]
    });
    const generatedP = innerExpanded.generatedElements.find((e) => e.type === "freePoint")!;
    const localVariables = evaluateLocalVariables(generatedP, new Map(), new Map(), [], shadowElements);
    // Both bindings are present (by id) in numericVariables, but resolving
    // by plain name "i" must yield the inner (later, higher-precedence)
    // value - the inner loop shadows the outer loop.
    expect(generatedP.numericVariables?.filter((variable) => variable.name === "i")).toHaveLength(2);
    expect(localVariables!.localVariableValues.get("i")).toBe(5);
  });

  it("lets a body element's own local variable shadow the loop's iteration variable of the same name (existing precedence rule)", () => {
    const bodyWithOwnLocalVar: FreePointElement = {
      ...pointTemplate,
      parentGroupId: "outer",
      x: makeNumericExpression("@i"),
      y: makeNumericExpression("0"),
      numericVariables: [{ id: "p:own-i", name: "i", value: -1 }]
    };
    const localElements: CadElement[] = [outerForGroup, bodyWithOwnLocalVar];
    const { generatedElements } = expandForGroupIteration({
      elements: localElements,
      forGroup: outerForGroup,
      iterationIndex: 0,
      variableValue: 42,
      ancestorIterationVariables: []
    });
    const generatedP = generatedElements.find((element) => element.type === "freePoint")!;
    const localVariables = evaluateLocalVariables(generatedP, new Map(), new Map(), [], localElements);
    // The body element's own declared "i" (-1) must win over the loop's own
    // "i" (42) - this precedence predates this fix and must not change.
    expect(localVariables?.localVariableValues.get("i")).toBe(-1);
  });

  it("does not forward the forGroup element's own numericVariables to children - only the explicit ancestorIterationVariables parameter", () => {
    const forGroupWithOwnLocalVar: ForGroupElement = {
      ...outerForGroup,
      numericVariables: [{ id: "outer:own", name: "ownVar", value: 999 }]
    };
    const localElements: CadElement[] = [forGroupWithOwnLocalVar, { ...pointTemplate, parentGroupId: forGroupWithOwnLocalVar.id }];
    const { generatedElements } = expandForGroupIteration({
      elements: localElements,
      forGroup: forGroupWithOwnLocalVar,
      iterationIndex: 0,
      variableValue: 0,
      ancestorIterationVariables: []
    });
    const generatedP = generatedElements.find((element) => element.type === "freePoint")!;
    expect(generatedP.numericVariables?.some((variable) => variable.name === "ownVar")).toBe(false);
  });
});
