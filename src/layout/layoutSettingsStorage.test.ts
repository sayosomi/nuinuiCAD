import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PRINT_PREVIEW_WINDOW } from "../state/cadUiStore";
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
      printPreviewWindow: DEFAULT_PRINT_PREVIEW_WINDOW
    });
  });

  it("saves and loads current layout settings from browser storage", async () => {
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
      }
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
      }
    });
  });

  it("ignores a saved DslPanel window as an unknown layout key", async () => {
    const legacySettings = {
      version: 1,
      leftPanelWidth: 420,
      dslPanelWindow: { x: 300, y: 88, width: 120, height: 90 }
    };

    expect(normalizeLayoutSettings(legacySettings)).toEqual({
      version: 1,
      leftPanelWidth: 420,
      collapsedPrintPanelSections: ["variables"],
      printPreviewWindow: DEFAULT_PRINT_PREVIEW_WINDOW
    });
    expect(normalizeLayoutSettings(legacySettings)).not.toHaveProperty("dslPanelWindow");

    window.localStorage.setItem("nuinuiCAD.layoutSettings.v1", JSON.stringify(legacySettings));
    const loaded = await loadLayoutSettings();
    await saveLayoutSettings(loaded);
    expect(JSON.parse(window.localStorage.getItem("nuinuiCAD.layoutSettings.v1") ?? "")).not.toHaveProperty(
      "dslPanelWindow"
    );
  });

  it("normalizes broken and out-of-range layout settings", () => {
    expect(normalizeLayoutSettings({ version: 1, leftPanelWidth: 200 })).toEqual({
      version: 1,
      leftPanelWidth: MIN_LEFT_PANEL_WIDTH,
      collapsedPrintPanelSections: ["variables"],
      printPreviewWindow: DEFAULT_PRINT_PREVIEW_WINDOW
    });
    expect(normalizeLayoutSettings({ version: 1, leftPanelWidth: 900 })).toEqual({
      version: 1,
      leftPanelWidth: MAX_LEFT_PANEL_WIDTH,
      collapsedPrintPanelSections: ["variables"],
      printPreviewWindow: DEFAULT_PRINT_PREVIEW_WINDOW
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
      printPreviewWindow: DEFAULT_PRINT_PREVIEW_WINDOW
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
      }
    });
    expect(normalizeLayoutSettings("{not-json")).toEqual({
      version: 1,
      leftPanelWidth: DEFAULT_LEFT_PANEL_WIDTH,
      collapsedPrintPanelSections: ["variables"],
      printPreviewWindow: DEFAULT_PRINT_PREVIEW_WINDOW
    });
  });

  it("upgrades an earlier 320px editor width to the new readable minimum", () => {
    expect(normalizeLayoutSettings({ version: 1, leftPanelWidth: 320 }).leftPanelWidth).toBe(360);
  });

  it("falls back to defaults for broken browser storage", async () => {
    window.localStorage.setItem("nuinuiCAD.layoutSettings.v1", "{not-json");

    await expect(loadLayoutSettings()).resolves.toEqual({
      version: 1,
      leftPanelWidth: DEFAULT_LEFT_PANEL_WIDTH,
      collapsedPrintPanelSections: ["variables"],
      printPreviewWindow: DEFAULT_PRINT_PREVIEW_WINDOW
    });
  });
});
