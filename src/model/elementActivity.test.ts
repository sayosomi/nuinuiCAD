import { describe, expect, it } from "vitest";
import {
  activityAllowsDrawing,
  activityAllowsEvaluation,
  effectiveElementActivityById,
  elementTypeSupportsHiddenActivity,
  nextElementActivity
} from "./elementActivity";
import { isContainerElement } from "./containers";
import { isGroupElement } from "./groups";
import type { CadElement } from "../types/geometry";

describe("element activity", () => {
  it.each([
    ["visible"],
    ["hidden"],
    ["disabled"]
  ] as const)("allows evaluation/drawing correctly for %s", (activity) => {
    expect(activityAllowsEvaluation(activity)).toBe(activity !== "disabled");
    expect(activityAllowsDrawing(activity)).toBe(activity === "visible");
  });

  it("composes parents once while giving disabled precedence over hidden", () => {
    const activities = effectiveElementActivityById([
      { id: "hidden", type: "group", activity: "hidden" },
      { id: "nested", type: "group", parentGroupId: "hidden", activity: "disabled" },
      { id: "child", type: "freePoint", parentGroupId: "nested", activity: "visible" },
      { id: "visible-child", type: "freePoint", parentGroupId: "hidden", activity: "visible" }
    ]);

    expect(activities.get("nested")).toMatchObject({ activity: "disabled", disabledByElementId: "nested" });
    expect(activities.get("child")).toMatchObject({ activity: "disabled", disabledByElementId: "nested" });
    expect(activities.get("visible-child")).toMatchObject({ activity: "hidden", hiddenByElementId: "hidden" });
  });

  it("propagates activity through a moduleInstance without making it a group", () => {
    const moduleInstance: CadElement = {
      id: "module",
      name: "module",
      type: "moduleInstance",
      activity: "visible",
      parentGroupId: "outer"
    };
    const child: CadElement = {
      id: "child",
      name: "child",
      type: "freePoint",
      activity: "visible",
      parentGroupId: "module",
      x: 0,
      y: 0
    };

    expect(isContainerElement(moduleInstance)).toBe(true);
    expect(isGroupElement(moduleInstance)).toBe(false);

    expect(effectiveElementActivityById([
      { id: "outer", name: "outer", type: "group", activity: "hidden" },
      moduleInstance,
      child
    ]).get("child")).toMatchObject({ activity: "hidden", hiddenByElementId: "outer" });

    expect(effectiveElementActivityById([
      { id: "outer", name: "outer", type: "group", activity: "disabled" },
      moduleInstance,
      child
    ]).get("child")).toMatchObject({ activity: "disabled", disabledByElementId: "outer" });

    expect(effectiveElementActivityById([
      { id: "outer", name: "outer", type: "group", activity: "visible" },
      { ...moduleInstance, activity: "hidden" },
      child
    ]).get("child")).toMatchObject({ activity: "hidden", hiddenByElementId: "module" });

    expect(effectiveElementActivityById([
      { id: "outer", name: "outer", type: "group", activity: "visible" },
      { ...moduleInstance, activity: "disabled" },
      child
    ]).get("child")).toMatchObject({ activity: "disabled", disabledByElementId: "module" });
  });

  it("resolves modifier state outer-to-inner-to-element with left-to-right last-wins", () => {
    const definitions = [
      { name: "hide", state: "hidden" },
      { name: "disable", state: "disabled" },
      { name: "show", state: "visible" }
    ] as const;
    const outer = { id: "outer", type: "group", activity: "visible" as const, modifierNames: ["hide"] };
    const inner = {
      id: "inner",
      type: "group",
      activity: "visible" as const,
      parentGroupId: "outer",
      modifierNames: ["disable", "show"]
    };

    expect(effectiveElementActivityById([outer, inner, {
      id: "child",
      type: "freePoint",
      activity: "visible",
      parentGroupId: "inner"
    }], definitions).get("child")).toEqual({ activity: "visible" });

    expect(effectiveElementActivityById([outer, inner, {
      id: "child",
      type: "freePoint",
      activity: "visible",
      parentGroupId: "inner",
      modifierNames: ["disable"]
    }], definitions).get("child")).toEqual({ activity: "disabled", disabledByElementId: "child" });

    expect(effectiveElementActivityById([{ ...outer, modifierNames: ["hide"] }, {
      ...inner,
      modifierNames: ["disable"]
    }, {
      id: "child",
      type: "freePoint",
      activity: "visible",
      parentGroupId: "inner"
    }], definitions).get("child")).toEqual({ activity: "disabled", disabledByElementId: "inner" });
  });

  it("lets modifier visible clear an earlier modifier state but not a direct hard gate", () => {
    const definitions = [
      { name: "hide", state: "hidden" },
      { name: "disable", state: "disabled" },
      { name: "show", state: "visible" }
    ] as const;

    expect(effectiveElementActivityById([
      { id: "group", type: "group", activity: "visible", modifierNames: ["hide", "show"] },
      { id: "child", type: "freePoint", activity: "visible", parentGroupId: "group" }
    ], definitions).get("child")).toEqual({ activity: "visible" });

    expect(effectiveElementActivityById([
      { id: "group", type: "group", activity: "hidden", modifierNames: ["disable"] },
      { id: "child", type: "freePoint", activity: "visible", parentGroupId: "group", modifierNames: ["show"] }
    ], definitions).get("child")).toEqual({ activity: "hidden", hiddenByElementId: "group" });

    expect(effectiveElementActivityById([
      { id: "child", type: "freePoint", activity: "disabled", modifierNames: ["show"] }
    ], definitions).get("child")).toEqual({ activity: "disabled", disabledByElementId: "child" });
  });

  it.each([
    ["group", true],
    ["conditionalGroup", true],
    ["forGroup", true],
    ["moduleInstance", true],
    ["freePoint", true],
    ["line", true],
    ["image", true],
    ["text", true],
    ["edge", false],
    ["extendTrim", false],
    ["move", false],
    ["symmetricMove", false]
  ] as const)("elementTypeSupportsHiddenActivity(%s) is %s", (elementType, expected) => {
    expect(elementTypeSupportsHiddenActivity(elementType)).toBe(expected);
  });

  it("cycles visible -> hidden -> disabled -> visible for types where hidden is meaningful", () => {
    expect(nextElementActivity("visible", "freePoint")).toBe("hidden");
    expect(nextElementActivity("hidden", "freePoint")).toBe("disabled");
    expect(nextElementActivity("disabled", "freePoint")).toBe("visible");
  });

  it("skips hidden for types where it is meaningless, and recovers forward from a hidden state", () => {
    expect(nextElementActivity("visible", "extendTrim")).toBe("disabled");
    expect(nextElementActivity("disabled", "extendTrim")).toBe("visible");
    expect(nextElementActivity("hidden", "extendTrim")).toBe("disabled");
  });
});
