import { describe, expect, it } from "vitest";
import {
  activityAllowsDrawing,
  activityAllowsEvaluation,
  effectiveElementActivityById,
  elementTypeSupportsHiddenActivity,
  nextElementActivity
} from "./elementActivity";

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

  it.each([
    ["group", true],
    ["conditionalGroup", true],
    ["forGroup", true],
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
