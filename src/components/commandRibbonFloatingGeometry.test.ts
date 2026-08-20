import { describe, expect, it } from "vitest";
import { estimatedRibbonSize } from "./commandRibbonFloatingGeometry";
import type { CommandRibbonPresentation } from "./CommandRibbonView";

const commandItem = (id: string, showLabel = false) => ({
  id,
  type: "command" as const,
  commandId: id,
  icon: "circle",
  label: showLabel ? "Edit Canvas Ribbon" : id,
  description: "Description",
  showLabel,
  available: true
});

const ribbonFor = (
  orientation: "horizontal" | "vertical",
  items: CommandRibbonPresentation["items"],
  verticalHandlePlacement?: "top" | "side"
): CommandRibbonPresentation => ({
  id: "ribbon",
  label: "Ribbon",
  x: null,
  y: 12,
  orientation,
  iconSize: 16,
  items,
  verticalHandlePlacement
});

describe("Command Ribbon estimated geometry", () => {
  it("estimates one-item VS Code vertical side-handle geometry", () => {
    expect(estimatedRibbonSize(ribbonFor("vertical", [commandItem("edit", true)], "side"))).toEqual({
      width: 179,
      height: 32
    });
  });

  it("estimates multiple VS Code vertical items as one side-handle column", () => {
    expect(estimatedRibbonSize(ribbonFor("vertical", [commandItem("one"), commandItem("two")], "side"))).toEqual({
      width: 54,
      height: 64
    });
  });

  it("preserves the Tauri vertical top-handle estimate", () => {
    expect(estimatedRibbonSize(ribbonFor("vertical", [commandItem("one"), commandItem("two")]))).toEqual({
      width: 32,
      height: 84
    });
  });
});
