import { describe, expect, it } from "vitest";
import {
  activityAllowsDrawing,
  activityAllowsEvaluation,
  effectiveElementActivityById,
  elementActivityFromLegacyFlags,
  elementTypeSupportsHiddenActivity,
  legacyFlagsForElementActivity,
  nextElementActivity
} from "./elementActivity";

describe("element activity legacy bridge", () => {
  it.each([
    [{ visible: true, enabled: true }, "visible"],
    [{ visible: false, enabled: true }, "hidden"],
    [{ visible: true, enabled: false }, "disabled"],
    [{ visible: false, enabled: false }, "disabled"]
  ] as const)("maps %o to %s", (flags, activity) => {
    expect(elementActivityFromLegacyFlags(flags)).toBe(activity);
    expect(activityAllowsEvaluation(activity)).toBe(activity !== "disabled");
    expect(activityAllowsDrawing(activity)).toBe(activity === "visible");
  });

  it("writes the canonical v2 flag pair for every activity", () => {
    expect(legacyFlagsForElementActivity("visible")).toEqual({ visible: true, enabled: true });
    expect(legacyFlagsForElementActivity("hidden")).toEqual({ visible: false, enabled: true });
    expect(legacyFlagsForElementActivity("disabled")).toEqual({ visible: true, enabled: false });
  });

  it("composes parents once while giving disabled precedence over hidden", () => {
    const activities = effectiveElementActivityById([
      { id: "hidden", type: "group", visible: false, enabled: true },
      { id: "nested", type: "group", parentGroupId: "hidden", visible: true, enabled: false },
      { id: "child", type: "freePoint", parentGroupId: "nested", visible: true, enabled: true },
      { id: "visible-child", type: "freePoint", parentGroupId: "hidden", visible: true, enabled: true }
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
    ["variable", false],
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

  it("skips hidden for types where it is meaningless, and recovers forward from a legacy hidden state", () => {
    expect(nextElementActivity("visible", "variable")).toBe("disabled");
    expect(nextElementActivity("disabled", "variable")).toBe("visible");
    expect(nextElementActivity("hidden", "variable")).toBe("disabled");
  });
});
