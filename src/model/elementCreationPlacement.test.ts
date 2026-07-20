import { describe, expect, it } from "vitest";
import { sampleElements } from "../sampleData";
import type { CadElement, GroupElement } from "../types/geometry";
import {
  creationPlacementForEvaluationLimit,
  creationPlacementForTarget
} from "./elementCreationPlacement";

const group = (id: string, patch: Partial<GroupElement> = {}): GroupElement => ({
  id,
  name: id,
  type: "group",
  visible: true,
  enabled: true,
  ...patch
});

describe("element creation placement", () => {
  it("uses the shared structural scope between adjacent siblings", () => {
    const elements: CadElement[] = [
      group("group"),
      { ...sampleElements[0], parentGroupId: "group" },
      { ...sampleElements[1], parentGroupId: "group" },
      sampleElements[2]
    ];

    expect(creationPlacementForEvaluationLimit(elements, 2)).toMatchObject({
      insertionIndex: 2,
      parentGroupId: "group"
    });
  });

  it("enters a group immediately after its header when its next row is a direct child", () => {
    const elements: CadElement[] = [
      group("group"),
      { ...sampleElements[0], parentGroupId: "group" },
      sampleElements[1]
    ];

    expect(creationPlacementForEvaluationLimit(elements, 1)).toMatchObject({ parentGroupId: "group" });
  });

  it("does not absorb an ambiguous subtree-end boundary into the deepest group", () => {
    const elements: CadElement[] = [
      group("outer"),
      group("inner", { parentGroupId: "outer" }),
      { ...sampleElements[0], parentGroupId: "inner" },
      { ...sampleElements[1], parentGroupId: "outer" },
      sampleElements[2]
    ];

    expect(creationPlacementForEvaluationLimit(elements, 3)).toMatchObject({ parentGroupId: "outer" });
    expect(creationPlacementForEvaluationLimit(elements, 4).parentGroupId).toBeUndefined();
  });

  it("keeps a bare document-end index at root scope", () => {
    const elements: CadElement[] = [group("group"), { ...sampleElements[0], parentGroupId: "group" }];

    expect(creationPlacementForEvaluationLimit(elements, 2).parentGroupId).toBeUndefined();
  });

  it("uses an anchor-derived parent scope even where a bare index is ambiguous", () => {
    const elements: CadElement[] = [group("group"), { ...sampleElements[0], parentGroupId: "group" }];

    expect(creationPlacementForTarget(elements, {
      insertionIndex: 2,
      parentGroupId: "group"
    }, undefined)).toMatchObject({ parentGroupId: "group" });
  });
});
