import { beforeEach, describe, expect, it } from "vitest";
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
      leftPanelWidth: DEFAULT_LEFT_PANEL_WIDTH
    });
  });

  it("saves and loads current layout settings from browser storage", async () => {
    await saveLayoutSettings({
      version: 1,
      leftPanelWidth: 480
    });

    await expect(loadLayoutSettings()).resolves.toEqual({
      version: 1,
      leftPanelWidth: 480
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
      leftPanelWidth: 420
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
      leftPanelWidth: MIN_LEFT_PANEL_WIDTH
    });
    expect(normalizeLayoutSettings({ version: 1, leftPanelWidth: 9999 })).toEqual({
      version: 1,
      leftPanelWidth: MAX_LEFT_PANEL_WIDTH
    });
    expect(normalizeLayoutSettings({ version: 1, leftPanelWidth: 420, unknown: true })).toEqual({
      version: 1,
      leftPanelWidth: 420
    });
    expect(normalizeLayoutSettings("{not-json")).toEqual({
      version: 1,
      leftPanelWidth: DEFAULT_LEFT_PANEL_WIDTH
    });
  });

  it("upgrades an earlier 320px editor width to the new readable minimum", () => {
    expect(normalizeLayoutSettings({ version: 1, leftPanelWidth: 320 }).leftPanelWidth).toBe(360);
  });

  it("falls back to defaults for broken browser storage", async () => {
    window.localStorage.setItem("nuinuiCAD.layoutSettings.v1", "{not-json");

    await expect(loadLayoutSettings()).resolves.toEqual({
      version: 1,
      leftPanelWidth: DEFAULT_LEFT_PANEL_WIDTH
    });
  });
});
