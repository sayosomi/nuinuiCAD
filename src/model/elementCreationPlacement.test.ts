import { describe, expect, it } from "vitest";
import { sampleElements } from "../sampleData";
import type { CadElement } from "../types/geometry";
import { creationPlacementForEvaluationLimit } from "./elementCreationPlacement";

describe("element creation placement", () => {
  it("uses the root when the evaluation divider is not after a group subtree", () => {
    const placement = creationPlacementForEvaluationLimit(sampleElements, 2);

    expect(placement.insertionIndex).toBe(2);
    expect(placement.parentGroupId).toBeUndefined();
    expect(placement.conditionalBranch).toBeUndefined();
  });

  it("places new elements inside a group when the divider is directly after its last child", () => {
    const elements: CadElement[] = [
      {
        id: "group",
        name: "身頃",
        type: "group",
        visible: true,
        enabled: true,
        expanded: true
      },
      { ...sampleElements[0], parentGroupId: "group" },
      sampleElements[1]
    ];

    const placement = creationPlacementForEvaluationLimit(elements, 2);

    expect(placement).toMatchObject({
      insertionIndex: 2,
      parentGroupId: "group"
    });
  });

  it("places new elements inside an empty group when the divider is directly below it", () => {
    const elements: CadElement[] = [
      {
        id: "group",
        name: "身頃",
        type: "group",
        visible: true,
        enabled: true,
        expanded: true
      },
      sampleElements[0]
    ];

    const placement = creationPlacementForEvaluationLimit(elements, 1);

    expect(placement.parentGroupId).toBe("group");
  });

  it("places new elements outside a closed group when the divider is directly below it", () => {
    const elements: CadElement[] = [
      {
        id: "group",
        name: "身頃",
        type: "group",
        visible: true,
        enabled: true,
        expanded: false
      },
      { ...sampleElements[0], parentGroupId: "group" },
      sampleElements[1]
    ];

    const placement = creationPlacementForEvaluationLimit(elements, 2);

    expect(placement.parentGroupId).toBeUndefined();
    expect(placement.conditionalBranch).toBeUndefined();
  });

  it("places new elements outside a closed nested group but inside an open parent group", () => {
    const elements: CadElement[] = [
      {
        id: "outer",
        name: "外側",
        type: "group",
        visible: true,
        enabled: true,
        expanded: true
      },
      {
        id: "inner",
        name: "内側",
        type: "group",
        visible: true,
        enabled: true,
        expanded: false,
        parentGroupId: "outer"
      },
      { ...sampleElements[0], parentGroupId: "inner" }
    ];

    const placement = creationPlacementForEvaluationLimit(elements, 3);

    expect(placement.parentGroupId).toBe("outer");
  });

  it("uses the deepest group when nested group subtrees end at the same position", () => {
    const elements: CadElement[] = [
      {
        id: "outer",
        name: "外側",
        type: "group",
        visible: true,
        enabled: true,
        expanded: true
      },
      {
        id: "inner",
        name: "内側",
        type: "group",
        visible: true,
        enabled: true,
        expanded: true,
        parentGroupId: "outer"
      }
    ];

    const placement = creationPlacementForEvaluationLimit(elements, 2);

    expect(placement.parentGroupId).toBe("inner");
  });

  it("inherits the previous conditional branch for direct children of an if group", () => {
    const elements: CadElement[] = [
      {
        id: "if",
        name: "分岐",
        type: "conditionalGroup",
        visible: true,
        enabled: true,
        condition: 1,
        expanded: true,
        elseExpanded: true
      },
      { ...sampleElements[0], parentGroupId: "if", conditionalBranch: "then" },
      { ...sampleElements[1], parentGroupId: "if", conditionalBranch: "else" }
    ];

    const placement = creationPlacementForEvaluationLimit(elements, 3);

    expect(placement).toMatchObject({
      parentGroupId: "if",
      conditionalBranch: "else"
    });
  });

  it("places new elements inside a for group template subtree", () => {
    const elements: CadElement[] = [
      {
        id: "loop",
        name: "繰り返し",
        type: "forGroup",
        visible: true,
        enabled: true,
        variableName: "i",
        start: 0,
        count: 3,
        step: 1,
        expanded: true,
        showGenerated: false
      },
      { ...sampleElements[0], parentGroupId: "loop" }
    ];

    const placement = creationPlacementForEvaluationLimit(elements, 2);

    expect(placement.parentGroupId).toBe("loop");
  });
});
