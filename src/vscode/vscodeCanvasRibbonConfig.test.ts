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
            iconColor: "legacy-amber",
            label: "Legacy command",
            showLabel: true
          },
          {
            id: "command",
            type: "command",
            commandId: "resetCanvasView",
            icon: "circle",
            showLabel: false
          },
          { id: "zoom", type: "value", valueId: "canvasZoom", label: "Legacy zoom" },
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
      orientation: "horizontal"
    });
    expect(ribbons[0]?.items).toHaveLength(2);
    expect(ribbons[0]?.items[0]).toMatchObject({
      commandId: "workbench.action.files.openFile",
      icon: "not-a-lucide-icon",
      showLabel: true
    });
    expect(ribbons[0]?.items[0]).not.toHaveProperty("iconColor");
    expect(ribbons[1]).toMatchObject({ id: "second", x: 10, y: 21, orientation: "vertical" });
    expect(ribbons[1]).not.toHaveProperty("iconSize");
  });

  it("ignores legacy iconSize, iconColor, and item label input during normalization", () => {
    const normalized = normalizeVscodeCanvasRibbons([{
      id: "legacy-settings",
      iconSize: 24,
      items: [{
        id: "command",
        type: "command",
        commandId: "resetCanvasView",
        icon: "circle",
        iconColor: "#0f766e",
        label: "Legacy command",
        showLabel: false
      }, {
        id: "zoom",
        type: "value",
        valueId: "canvasZoom",
        label: "Legacy zoom"
      }]
    }]);
    expect(normalized[0]).toEqual({
      id: "legacy-settings",
      label: "legacy-settings",
      x: null,
      y: 12,
      orientation: "horizontal",
      items: [{
        id: "command",
        type: "command",
        commandId: "resetCanvasView",
        icon: "circle",
        showLabel: false
      }, {
        id: "zoom",
        type: "value",
        valueId: "canvasZoom"
      }]
    });
    expect(normalized[0]).not.toHaveProperty("iconSize");
    expect(normalized[0]?.items[0]).not.toHaveProperty("iconColor");
    expect(normalized[0]?.items[0]).not.toHaveProperty("label");
    expect(normalized[0]?.items[1]).not.toHaveProperty("label");
  });

  it("migrates the retired Element Names command in saved Ribbons", () => {
    const normalized = normalizeVscodeCanvasRibbons([{
      id: "legacy-labels",
      items: [{
        id: "toggleCanvasElementNames",
        type: "command",
        commandId: "toggleCanvasElementNames",
        icon: "tags",
        showLabel: false
      }]
    }]);

    expect(normalized[0]?.items[0]).toMatchObject({
      id: "toggleCanvasPointNames",
      commandId: "toggleCanvasPointNames"
    });
  });

  it("keeps the closed Ribbon command catalog separate from shared CommandId", () => {
    expect(vscodeCanvasRibbonCommandIds).toEqual([
      "clearCanvasSelection",
      "resetCanvasView",
      "fitDrawing",
      "toggleCanvasPointNames",
      "toggleCanvasGeometryNames",
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

  it("patches only the first valid owner and preserves the raw Ribbon model", () => {
    const current = [{
      id: "one",
      label: "One",
      x: null,
      y: 12,
      orientation: "horizontal",
      iconSize: 16,
      items: [{
        id: "edit",
        type: "command",
        commandId: "editCanvasRibbon",
        icon: "settings-2",
        label: "Legacy edit",
        iconColor: "legacy-amber",
        showLabel: false
      }],
      futureRibbonField: { keep: true }
    }, {
      id: "two",
      label: "Two",
      x: 3,
      y: 4,
      orientation: "vertical",
      iconSize: 20,
      items: [{ id: "zoom", type: "value", valueId: "canvasZoom", label: "Legacy zoom" }]
    }, {
      id: "one",
      malformedFutureField: true,
      items: "not-an-array"
    }];
    const patched = patchVscodeCanvasRibbonPosition(current, "one", 24.5, 36.25);
    expect(patched).toEqual([
      { ...current[0], x: 24.5, y: 36.25 },
      current[1],
      current[2]
    ]);
    expect(patched?.[0]).toMatchObject({ iconSize: 16, items: [{ label: "Legacy edit" }] });
    expect(patched?.[1]).toMatchObject({ items: [{ label: "Legacy zoom" }] });
    expect((patched?.[0] as { items: Array<Record<string, unknown>> }).items[0]?.iconColor).toBe("legacy-amber");
    expect(patchVscodeCanvasRibbonPosition(current, "one", Number.NaN, 36)).toBeNull();
    expect(patchVscodeCanvasRibbonPosition(current, "one", Number.POSITIVE_INFINITY, 36)).toBeNull();
    expect(patchVscodeCanvasRibbonPosition(current, "missing", 24, 36)).toBeNull();
  });
});
