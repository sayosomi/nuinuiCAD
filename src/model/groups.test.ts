import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import {
  groupStateByElementId,
  initialGroupFoldForLoadedDocument,
  isGroupElement,
  isContainerElement,
  visibleOutlineElements
} from "./groups";

const hierarchy = (outerActivity: CadElement["activity"] = "visible"): CadElement[] => [
  { id: "outer", name: "outer", type: "group", activity: outerActivity },
  {
    id: "module",
    name: "module",
    type: "moduleInstance",
    activity: "visible",
    parentGroupId: "outer"
  },
  {
    id: "child",
    name: "child",
    type: "freePoint",
    activity: "visible",
    parentGroupId: "module",
    x: 0,
    y: 0
  }
];

describe("generic container hierarchy", () => {
  it("walks group -> moduleInstance -> child ancestry without changing group-only classification", () => {
    const elements = hierarchy();
    const states = groupStateByElementId(elements);

    expect(isContainerElement(elements[1])).toBe(true);
    expect(isGroupElement(elements[1])).toBe(false);
    expect(states.get("child")).toMatchObject({
      depth: 2,
      ancestorGroupIds: ["outer", "module"]
    });
  });

  it("carries outer fold and activity state across a moduleInstance", () => {
    const elements = hierarchy("hidden");
    const fold = new Map([["outer", { expanded: false }]]);
    const states = groupStateByElementId(elements, fold);

    expect(states.get("child")).toMatchObject({
      hiddenByGroupId: "outer",
      isCollapsedByGroup: true
    });
    expect(visibleOutlineElements(elements, fold).map((element) => element.id)).toEqual(["outer"]);
  });

  it("does not seed moduleInstance in the group-only initial fold map", () => {
    const fold = initialGroupFoldForLoadedDocument(hierarchy());
    expect(fold.has("outer")).toBe(true);
    expect(fold.has("module")).toBe(false);
  });
});
