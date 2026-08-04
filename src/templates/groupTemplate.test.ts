import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import { createTemplateFromGroup, instantiateGroupTemplate } from "./groupTemplate";

describe("group templates", () => {
  it("keeps point and line external inputs without creating document numeric bindings", () => {
    const elements: CadElement[] = [
      { id: "point", name: "基準点", type: "freePoint", activity: "visible", x: 0, y: 0 },
      {
        id: "line",
        name: "基準線",
        type: "line",
        activity: "visible",
        startPoint: { mode: "reference", pointId: "point" },
        endPoint: { mode: "coordinate", x: 20, y: 0 }
      },
      { id: "group", name: "袖", type: "group", activity: "visible" },
      {
        id: "child",
        name: "袖点",
        type: "offsetPoint",
        activity: "visible",
        parentGroupId: "group",
        fromPoint: { mode: "reference", pointId: "point" },
        dx: 10,
        dy: 0
      }
    ];

    const template = createTemplateFromGroup({ elements, groupId: "group" });
    expect(template.inputs).toEqual([{ id: "point:point", kind: "point", label: "基準点", sourceElementId: "point" }]);
    const inserted = instantiateGroupTemplate({
      elements,
      template,
      inputValues: { "point:point": "point" }
    });
    expect(inserted.insertedCount).toBe(2);
    expect(inserted.elements).toHaveLength(6);
  });
});
