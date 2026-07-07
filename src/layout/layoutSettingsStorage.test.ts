import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DSL_PANEL_HEIGHT,
  DEFAULT_DSL_PANEL_WIDTH,
  DEFAULT_DSL_PANEL_WINDOW,
  DEFAULT_PRINT_PREVIEW_WINDOW
} from "../state/cadUiStore";
import {
  DEFAULT_LEFT_PANEL_WIDTH,
  MAX_LEFT_PANEL_WIDTH,
  MIN_LEFT_PANEL_WIDTH,
  loadLayoutSettings,
  normalizeLayoutSettings,
  saveLayoutSettings
} from "./layoutSettingsStorage";

beforeEach(() => {
  window.localStorage.clear();
});

describe("layoutSettingsStorage", () => {
  it("loads default layout settings without saved browser settings", async () => {
    await expect(loadLayoutSettings()).resolves.toEqual({
      version: 1,
      leftPanelWidth: DEFAULT_LEFT_PANEL_WIDTH,
      collapsedPrintPanelSections: ["variables"],
      printPreviewWindow: DEFAULT_PRINT_PREVIEW_WINDOW,
      dslPanelWindow: DEFAULT_DSL_PANEL_WINDOW
    });
  });

  it("saves and loads layout settings from browser storage", async () => {
    await saveLayoutSettings({
      version: 1,
      leftPanelWidth: 480,
      collapsedPrintPanelSections: ["output", "groups"],
      printPreviewWindow: {
        x: 40,
        y: 30,
        width: 420,
        height: 260,
        zoom: 0.8,
        layoutId: "print-layout-2"
      },
      dslPanelWindow: { x: 320, y: 80, width: 560, height: 500 }
    });

    await expect(loadLayoutSettings()).resolves.toEqual({
      version: 1,
      leftPanelWidth: 480,
      collapsedPrintPanelSections: ["output", "groups"],
      printPreviewWindow: {
        x: 40,
        y: 30,
        width: 420,
        height: 260,
        zoom: 0.8,
        layoutId: "print-layout-2"
      },
      dslPanelWindow: { x: 320, y: 80, width: 560, height: 500 }
    });
  });

  it("normalizes broken and out-of-range layout settings", () => {
    expect(normalizeLayoutSettings({ version: 1, leftPanelWidth: 200 })).toEqual({
      version: 1,
      leftPanelWidth: MIN_LEFT_PANEL_WIDTH,
      collapsedPrintPanelSections: ["variables"],
      printPreviewWindow: DEFAULT_PRINT_PREVIEW_WINDOW,
      dslPanelWindow: DEFAULT_DSL_PANEL_WINDOW
    });
    expect(normalizeLayoutSettings({ version: 1, leftPanelWidth: 900 })).toEqual({
      version: 1,
      leftPanelWidth: MAX_LEFT_PANEL_WIDTH,
      collapsedPrintPanelSections: ["variables"],
      printPreviewWindow: DEFAULT_PRINT_PREVIEW_WINDOW,
      dslPanelWindow: DEFAULT_DSL_PANEL_WINDOW
    });
    expect(
      normalizeLayoutSettings({
        version: 1,
        leftPanelWidth: 420,
        collapsedPrintPanelSections: ["output", "missing", "placements"]
      })
    ).toEqual({
      version: 1,
      leftPanelWidth: 420,
      collapsedPrintPanelSections: ["output", "placements"],
      printPreviewWindow: DEFAULT_PRINT_PREVIEW_WINDOW,
      dslPanelWindow: DEFAULT_DSL_PANEL_WINDOW
    });
    expect(
      normalizeLayoutSettings({
        version: 1,
        leftPanelWidth: 420,
        printPreviewWindow: {
          x: 12.4,
          y: 20.6,
          width: 100,
          height: 90,
          zoom: 12,
          layoutId: "print-layout-2"
        },
        dslPanelWindow: {
          x: 300.3,
          y: 88.6,
          width: 120,
          height: 90
        }
      })
    ).toEqual({
      version: 1,
      leftPanelWidth: 420,
      collapsedPrintPanelSections: ["variables"],
      printPreviewWindow: {
        x: 12,
        y: 21,
        width: 260,
        height: 180,
        zoom: 4,
        layoutId: "print-layout-2"
      },
      dslPanelWindow: {
        x: 300,
        y: 89,
        width: 360,
        height: 260
      }
    });
    expect(normalizeLayoutSettings("{not-json")).toEqual({
      version: 1,
      leftPanelWidth: DEFAULT_LEFT_PANEL_WIDTH,
      collapsedPrintPanelSections: ["variables"],
      printPreviewWindow: DEFAULT_PRINT_PREVIEW_WINDOW,
      dslPanelWindow: DEFAULT_DSL_PANEL_WINDOW
    });
  });

  it("falls back to defaults for broken browser storage", async () => {
    window.localStorage.setItem("nuinuiCAD.layoutSettings.v1", "{not-json");

    await expect(loadLayoutSettings()).resolves.toEqual({
      version: 1,
      leftPanelWidth: DEFAULT_LEFT_PANEL_WIDTH,
      collapsedPrintPanelSections: ["variables"],
      printPreviewWindow: DEFAULT_PRINT_PREVIEW_WINDOW,
      dslPanelWindow: DEFAULT_DSL_PANEL_WINDOW
    });
  });

  it("upgrades older DSL panel window settings without size", () => {
    expect(
      normalizeLayoutSettings({
        version: 1,
        leftPanelWidth: 420,
        dslPanelWindow: {
          x: 300,
          y: 88
        }
      }).dslPanelWindow
    ).toEqual({
      x: 300,
      y: 88,
      width: DEFAULT_DSL_PANEL_WIDTH,
      height: DEFAULT_DSL_PANEL_HEIGHT
    });
  });
});
