import { describe, expect, it } from "vitest";
import {
  activityAllowsDrawing,
  activityAllowsEvaluation,
  effectiveElementActivityById,
  elementActivityFromLegacyFlags,
  legacyFlagsForElementActivity
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
});
