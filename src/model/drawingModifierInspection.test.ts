import { describe, expect, it } from "vitest";
import type { DrawingModifierDefinition } from "../types/geometry";
import {
  effectiveDrawingModifierResolutionById,
  effectiveDrawingModifierRuntimeById,
  effectiveDrawingModifierStrokeByRuntime
} from "./elementActivity";

const element = (
  id: string,
  options: {
    type?: string;
    activity?: "visible" | "hidden" | "disabled";
    enabled?: boolean;
    visible?: boolean;
    modifierNames?: string[];
    parentGroupId?: string;
  } = {}
) => ({
  id,
  type: options.type ?? "line",
  activity: options.activity ?? "visible",
  enabled: options.enabled ?? options.activity !== "disabled",
  visible: options.visible ?? (options.activity === undefined || options.activity === "visible"),
  ...(options.modifierNames ? { modifierNames: options.modifierNames } : {}),
  ...(options.parentGroupId ? { parentGroupId: options.parentGroupId } : {})
});

describe("Drawing Modifier winner provenance", () => {
  it("reports the direct element style winner for each authored property", () => {
    const modifiers: DrawingModifierDefinition[] = [{
      name: "detail",
      widthPx: 2,
      lineType: "dashed",
      color: { kind: "themeRole", role: "accent" }
    }];
    const resolution = effectiveDrawingModifierResolutionById([
      element("line", { modifierNames: ["detail"] })
    ], modifiers).get("line")!;

    expect(resolution.widthPx).toEqual({
      value: 2,
      winner: { ownerElementId: "line", modifierName: "detail", selectedProfileDelta: null }
    });
    expect(resolution.lineType.winner?.modifierName).toBe("detail");
    expect(resolution.color.winner?.ownerElementId).toBe("line");
    expect(resolution.visible).toEqual({ value: true, winner: null });
  });

  it("preserves outer -> inner -> element precedence while keeping property-specific winners", () => {
    const modifiers: DrawingModifierDefinition[] = [
      { name: "outer", widthPx: 2, lineType: "dotted" },
      { name: "inner", widthPx: 3 },
      { name: "local", color: { kind: "themeRole", role: "warning" } }
    ];
    const resolution = effectiveDrawingModifierResolutionById([
      element("outerGroup", { type: "group", modifierNames: ["outer"] }),
      element("innerGroup", { type: "group", parentGroupId: "outerGroup", modifierNames: ["inner"] }),
      element("line", { parentGroupId: "innerGroup", modifierNames: ["local"] })
    ], modifiers).get("line")!;

    expect(resolution.widthPx.value).toBe(3);
    expect(resolution.widthPx.winner).toMatchObject({ ownerElementId: "innerGroup", modifierName: "inner" });
    expect(resolution.lineType.value).toBe("dotted");
    expect(resolution.lineType.winner).toMatchObject({ ownerElementId: "outerGroup", modifierName: "outer" });
    expect(resolution.color.value).toEqual({ kind: "themeRole", role: "warning" });
    expect(resolution.color.winner).toMatchObject({ ownerElementId: "line", modifierName: "local" });
  });

  it("uses left-to-right style order on the same owner", () => {
    const modifiers: DrawingModifierDefinition[] = [
      { name: "first", widthPx: 2 },
      { name: "second", widthPx: 4 }
    ];
    const resolution = effectiveDrawingModifierResolutionById([
      element("line", { modifierNames: ["first", "second"] })
    ], modifiers).get("line")!;

    expect(resolution.widthPx.value).toBe(4);
    expect(resolution.widthPx.winner?.modifierName).toBe("second");
  });

  it("attributes only overridden properties to the selected profile delta", () => {
    const modifiers: DrawingModifierDefinition[] = [{
      name: "seam",
      widthPx: 2,
      lineType: "dashed",
      color: { kind: "themeRole", role: "muted" },
      profileDeltas: [{
        profileId: "profile-print",
        profileName: "print",
        widthPx: 5,
        color: { kind: "fixed", hex: "#123456" }
      }]
    }];
    const selected = effectiveDrawingModifierResolutionById([
      element("line", { modifierNames: ["seam"] })
    ], modifiers, "profile-print").get("line")!;

    expect(selected.widthPx).toEqual({
      value: 5,
      winner: {
        ownerElementId: "line",
        modifierName: "seam",
        selectedProfileDelta: { profileId: "profile-print", profileName: "print" }
      }
    });
    expect(selected.color.winner?.selectedProfileDelta).toEqual({
      profileId: "profile-print",
      profileName: "print"
    });
    expect(selected.lineType.value).toBe("dashed");
    expect(selected.lineType.winner?.selectedProfileDelta).toBeNull();

    const common = effectiveDrawingModifierResolutionById([
      element("line", { modifierNames: ["seam"] })
    ], modifiers).get("line")!;
    expect(common.widthPx.value).toBe(2);
    expect(common.widthPx.winner?.selectedProfileDelta).toBeNull();
  });

  it("keeps direct activity as the hard gate and does not fabricate a style state winner", () => {
    const modifiers: DrawingModifierDefinition[] = [{ name: "off", visible: false }];
    const runtime = effectiveDrawingModifierRuntimeById([
      element("group", { type: "group", visible: false }),
      element("line", { parentGroupId: "group", modifierNames: ["off"] })
    ], modifiers);
    const line = runtime.get("line")!;

    expect(line.activity).toEqual({ activity: "hidden", hiddenByElementId: "group" });
    expect(line.resolution.visible).toEqual({ value: false, winner: null });
  });

  it("represents built-in defaults with no authored winner", () => {
    const runtime = effectiveDrawingModifierRuntimeById([element("line")]);
    const line = runtime.get("line")!;

    expect(line.hasModifier).toBe(false);
    expect(line.resolution).toEqual({
      visible: { value: true, winner: null },
      widthPx: { value: 1, winner: null },
      lineType: { value: "solid", winner: null },
      color: { value: { kind: "themeRole", role: "foreground" }, winner: null }
    });
  });

  it("supports the same winner query at a group boundary and for descendants", () => {
    const modifiers: DrawingModifierDefinition[] = [{ name: "groupStyle", widthPx: 3 }];
    const resolutions = effectiveDrawingModifierResolutionById([
      element("group", { type: "group", modifierNames: ["groupStyle"] }),
      element("line", { parentGroupId: "group" })
    ], modifiers);

    expect(resolutions.get("group")?.widthPx.winner).toMatchObject({
      ownerElementId: "group",
      modifierName: "groupStyle"
    });
    expect(resolutions.get("line")?.widthPx.winner).toMatchObject({
      ownerElementId: "group",
      modifierName: "groupStyle"
    });
  });

  it("preserves the explicit stroke map even for a visibility-only Style", () => {
    const runtime = effectiveDrawingModifierRuntimeById([
      element("line", { modifierNames: ["hidden"] })
    ], [{ name: "hidden", visible: false }]);

    expect(effectiveDrawingModifierStrokeByRuntime(runtime).get("line")).toEqual({
      widthPx: 1,
      style: "solid",
      color: { kind: "themeRole", role: "foreground" }
    });
  });
});
