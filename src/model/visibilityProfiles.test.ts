import { describe, expect, it } from "vitest";
import type { CadElement, VisibilityProfile } from "../types/geometry";
import { effectiveVisibleElementIdsForProfile } from "./visibilityProfiles";

const profile = (roleVisibility: Record<string, boolean>): VisibilityProfile => ({
  id: "profile",
  name: "作業表示",
  defaultRoleVisible: false,
  roleVisibility
});

const group = (
  id: string,
  patch: Partial<Extract<CadElement, { type: "group" }>> = {}
): CadElement => ({
  id,
  name: id,
  type: "group",
  visible: true,
  enabled: true,
  expanded: true,
  ...patch
});

const point = (
  id: string,
  patch: Partial<Extract<CadElement, { type: "freePoint" }>> = {}
): CadElement => ({
  id,
  name: id,
  type: "freePoint",
  visible: true,
  enabled: true,
  x: 0,
  y: 0,
  ...patch
});

describe("visibility profiles", () => {
  it("shows role-tagged groups when any assigned role is enabled", () => {
    const elements = [
      group("body"),
      group("allowance", { parentGroupId: "body", visibilityRoleIds: ["seam"] }),
      point("allowance-point", { parentGroupId: "allowance" }),
      group("multi", { parentGroupId: "body", visibilityRoleIds: ["notch", "seam"] }),
      point("multi-point", { parentGroupId: "multi" })
    ];

    expect([...effectiveVisibleElementIdsForProfile({
      elements,
      profile: profile({ seam: true, notch: false })
    })]).toEqual(["body", "allowance", "allowance-point", "multi", "multi-point"]);
  });

  it("does not let role visibility override visible=false", () => {
    const elements = [
      group("allowance", { visible: false, visibilityRoleIds: ["seam"] }),
      point("child", { parentGroupId: "allowance" })
    ];

    expect([...effectiveVisibleElementIdsForProfile({
      elements,
      profile: profile({ seam: true })
    })]).toEqual([]);
  });

  it("hides descendants when an ancestor role is disabled", () => {
    const elements = [
      group("allowance", { visibilityRoleIds: ["seam"] }),
      point("child", { parentGroupId: "allowance" })
    ];

    expect([...effectiveVisibleElementIdsForProfile({
      elements,
      profile: profile({ seam: false })
    })]).toEqual([]);
  });
});
