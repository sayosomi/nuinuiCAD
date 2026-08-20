import { describe, expect, it } from "vitest";
import {
  defaultVscodeCanvasRibbons,
  normalizeVscodeCanvasRibbons,
  patchVscodeCanvasRibbonPosition
} from "./vscodeCanvasRibbonConfig";
import {
  vscodeCanvasRibbonCommandCatalog,
  vscodeCanvasRibbonCommandIds,
  vscodeCanvasRibbonCommandFor
} from "./vscodeCanvasRibbonCatalog";
import { resolveVscodeLucideIconName } from "./vscodeCanvasRibbonIcons";

describe("VS Code Canvas Ribbon configuration", () => {
  it("provides the single edit-only default and preserves explicit empty settings", () => {
    expect(defaultVscodeCanvasRibbons()).toEqual([
      {
        id: "canvas-ribbon",
        label: "Canvas Ribbon",
        x: null,
        y: 12,
        orientation: "horizontal",
        iconSize: 16,
        items: [{
          id: "editCanvasRibbon",
          type: "command",
          commandId: "editCanvasRibbon",
          icon: "settings-2",
          showLabel: false
        }]
      }
    ]);
    expect(normalizeVscodeCanvasRibbons([])).toEqual([]);
  });

  it("fails closed while normalizing malformed records and duplicate IDs", () => {
    const ribbons = normalizeVscodeCanvasRibbons([
      { id: "missing-items" },
      {
        id: "first",
        label: "First",
        x: Number.POSITIVE_INFINITY,
        y: "bad",
        orientation: "diagonal",
        iconSize: 999,
        items: [
          {
            id: "command",
            type: "command",
            commandId: "workbench.action.files.openFile",
            icon: "not-a-lucide-icon",
            iconColor: "not-a-color",
            showLabel: true
          },
          {
            id: "command",
            type: "command",
            commandId: "resetCanvasView",
            icon: "circle",
            showLabel: false
          },
          { id: "zoom", type: "value", valueId: "canvasZoom" },
          { id: "bad-value", type: "value", valueId: "other" }
        ]
      },
      {
        id: "first",
        label: "Duplicate",
        items: []
      },
      {
        id: "second",
        items: [],
        x: 10.4,
        y: 20.6,
        orientation: "vertical",
        iconSize: 20
      }
    ]);

    expect(ribbons).toHaveLength(2);
    expect(ribbons[0]).toMatchObject({
      id: "first",
      x: null,
      y: 12,
      orientation: "horizontal",
      iconSize: 16
    });
    expect(ribbons[0]?.items).toHaveLength(2);
    expect(ribbons[0]?.items[0]).toMatchObject({
      commandId: "workbench.action.files.openFile",
      icon: "not-a-lucide-icon",
      iconColor: "currentColor",
      showLabel: true
    });
    expect(ribbons[1]).toMatchObject({ id: "second", x: 10, y: 21, orientation: "vertical", iconSize: 20 });
  });

  it("keeps the closed Ribbon command catalog separate from shared CommandId", () => {
    expect(vscodeCanvasRibbonCommandIds).toEqual([
      "clearCanvasSelection",
      "resetCanvasView",
      "fitDrawing",
      "toggleCanvasElementNames",
      "toggleCanvasPoints",
      "editCanvasRibbon"
    ]);
    expect(Object.keys(vscodeCanvasRibbonCommandCatalog)).toEqual(vscodeCanvasRibbonCommandIds);
    expect(vscodeCanvasRibbonCommandFor("workbench.action.files.openFile")).toBeNull();
    expect(vscodeCanvasRibbonCommandFor("editCanvasRibbon")?.hostAction).toBe("editCanvasRibbon");
  });

  it("resolves known Lucide names and uses a deterministic fallback", () => {
    expect(resolveVscodeLucideIconName("circle")).toBe("circle");
    expect(resolveVscodeLucideIconName("not-a-lucide-icon")).toBe("circle");
    expect(resolveVscodeLucideIconName(42)).toBe("circle");
  });

  it("patches only a finite position and preserves the current Ribbon model", () => {
    const current = [{
      id: "one",
      label: "One",
      x: null,
      y: 12,
      orientation: "horizontal",
      iconSize: 16,
      items: [{ id: "edit", type: "command", commandId: "editCanvasRibbon", icon: "settings-2", iconColor: "currentColor", showLabel: false }]
    }, {
      id: "two",
      label: "Two",
      x: 3,
      y: 4,
      orientation: "vertical",
      iconSize: 20,
      items: [{ id: "zoom", type: "value", valueId: "canvasZoom" }]
    }];
    expect(patchVscodeCanvasRibbonPosition(current, "one", 24, 36)).toEqual([
      { ...current[0], x: 24, y: 36 },
      current[1]
    ]);
    expect(patchVscodeCanvasRibbonPosition(current, "one", Number.NaN, 36)).toBeNull();
  });
});
