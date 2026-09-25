import { describe, expect, it } from "vitest";
import {
  normalizeVscodeCanvasRibbonPositions,
  patchVscodeCanvasRibbonPosition,
  vscodeCanvasRibbonDefinitions,
  vscodeCanvasRibbonIds
} from "./vscodeCanvasRibbonConfig";
import {
  vscodeCanvasRibbonCommandCatalog,
  vscodeCanvasRibbonCommandIds,
  vscodeCanvasRibbonCommandFor
} from "./vscodeCanvasRibbonCatalog";
import {
  isVscodeLucideIconName,
  resolveVscodeLucideIcon,
  vscodeLucideIconName,
  vscodeLucideIconRegistry
} from "./vscodeCanvasRibbonIcons";

describe("fixed VS Code Canvas Ribbons", () => {
  it("owns exactly three horizontal product Ribbons with fixed item order, labels, and icons", () => {
    expect(vscodeCanvasRibbonIds).toEqual(["viewport", "display", "grid"]);
    expect(vscodeCanvasRibbonDefinitions.map(({ id, label, orientation }) => ({ id, label, orientation })))
      .toEqual([
        { id: "viewport", label: "Viewport", orientation: "horizontal" },
        { id: "display", label: "Display", orientation: "horizontal" },
        { id: "grid", label: "Grid", orientation: "horizontal" }
      ]);
    expect(vscodeCanvasRibbonDefinitions.map((ribbon) => ribbon.items.map((item) =>
      item.type === "command"
        ? [item.commandId, item.icon, item.showLabel]
        : [item.valueId]
    ))).toEqual([
      [
        ["zoomOutCanvas", "minus", false],
        ["canvasStatus"],
        ["zoomInCanvas", "plus", false],
        ["resetCanvasView", "rotate-ccw", false],
        ["fitDrawing", "maximize", false]
      ],
      [
        ["toggleCanvasPoints", "circle-dot", false],
        ["toggleCanvasPointNames", "tag", true],
        ["toggleCanvasGeometryNames", "tag", true]
      ],
      [
        ["toggleCanvasGrid", "grid-3x3", false],
        ["canvasGridSettings"],
        ["toggleCanvasGridSnap", "magnet", false]
      ]
    ]);
  });

  it("validates fixed position entries independently and rejects arbitrary old Ribbon JSON", () => {
    expect(normalizeVscodeCanvasRibbonPositions({
      viewport: { x: 8, y: 12 },
      display: { x: Number.NaN, y: 28 },
      grid: { x: 20, y: Number.POSITIVE_INFINITY },
      custom: { x: 99, y: 99 }
    })).toEqual({ viewport: { x: 8, y: 12 } });
    expect(normalizeVscodeCanvasRibbonPositions([
      { id: "custom", label: "Custom", items: [{ commandId: "editCanvasRibbon" }] }
    ])).toEqual({});
    expect(vscodeCanvasRibbonDefinitions.map(({ id }) => id)).toEqual(["viewport", "display", "grid"]);
  });

  it("patches one validated Ribbon position while preserving valid siblings", () => {
    const current = {
      viewport: { x: 8, y: 16 },
      display: { x: 8, y: 90 },
      grid: { x: 8, y: 154 },
      legacy: { x: 500, y: 500 }
    };
    expect(patchVscodeCanvasRibbonPosition(current, "display", { x: 34.5, y: 72.25 }))
      .toEqual({
        viewport: { x: 8, y: 16 },
        display: { x: 34.5, y: 72.25 },
        grid: { x: 8, y: 154 }
      });
    expect(patchVscodeCanvasRibbonPosition(current, "legacy", { x: 1, y: 1 })).toBeNull();
    expect(patchVscodeCanvasRibbonPosition(current, "grid", { x: Number.NaN, y: 4 })).toBeNull();
  });
});

describe("fixed Canvas Ribbon command model", () => {
  it("contains only product-owned actions and has a definition for each action", () => {
    expect(vscodeCanvasRibbonCommandIds).toEqual([
      "zoomOutCanvas",
      "zoomInCanvas",
      "resetCanvasView",
      "fitDrawing",
      "toggleCanvasPoints",
      "toggleCanvasPointNames",
      "toggleCanvasGeometryNames",
      "toggleCanvasGrid",
      "configureCanvasGrid",
      "toggleCanvasGridSnap"
    ]);
    expect(Object.keys(vscodeCanvasRibbonCommandCatalog)).toEqual(vscodeCanvasRibbonCommandIds);
    expect(vscodeCanvasRibbonCommandFor("workbench.action.files.openFile")).toBeNull();
  });

  it("projects existing display, grid, and viewport command state into Ribbon actions", () => {
    expect(vscodeCanvasRibbonCommandFor("toggleCanvasPointNames")?.isPressed?.({
      showCanvasPointNames: true,
      showCanvasGeometryNames: false,
      showCanvasPoints: true
    })).toBe(true);
    expect(vscodeCanvasRibbonCommandFor("toggleCanvasPoints")?.isPressed?.({
      showCanvasPointNames: false,
      showCanvasGeometryNames: false,
      showCanvasPoints: true
    })).toBe(true);
    expect(vscodeCanvasRibbonCommandFor("toggleCanvasGrid")?.isPressed?.({
      showCanvasPointNames: false,
      showCanvasGeometryNames: false,
      showCanvasPoints: false,
      canvasGridEnabled: true
    })).toBe(true);
    expect(vscodeCanvasRibbonCommandFor("toggleCanvasGridSnap")?.isAvailable({
      showCanvasPointNames: false,
      showCanvasGeometryNames: false,
      showCanvasPoints: false,
      canvasGridSnapAvailable: true
    })).toBe(true);
    expect(vscodeCanvasRibbonCommandFor("configureCanvasGrid")?.hostAction).toBe("configureCanvasGrid");
  });
});

describe("static VS Code Webview Lucide registry", () => {
  it("contains exactly the explicitly referenced Canvas and Output Preview icons", () => {
    expect(Object.keys(vscodeLucideIconRegistry)).toEqual([
      "circle-dot",
      "crosshair",
      "file-down",
      "grid-3x3",
      "magnet",
      "maximize",
      "minus",
      "plus",
      "rotate-ccw",
      "ruler",
      "tag"
    ]);
    expect(vscodeCanvasRibbonDefinitions.flatMap(({ items }) => items.flatMap((item) =>
      item.type === "command" ? [item.icon] : item.valueId === "canvasGridSettings" ? ["ruler"] : []
    )).every(isVscodeLucideIconName)).toBe(true);
    expect(vscodeLucideIconName("rotate-ccw")).toBe("rotate-ccw");
    expect(resolveVscodeLucideIcon("maximize")).toBe(vscodeLucideIconRegistry.maximize);
    expect(isVscodeLucideIconName("future-icon")).toBe(false);
    expect(() => resolveVscodeLucideIcon("future-icon")).toThrow("Unregistered VS Code Webview icon");
  });
});
