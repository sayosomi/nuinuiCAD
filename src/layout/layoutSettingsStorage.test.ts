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

  it("saves and loads layout settings from browser storage", async () => {
    await saveLayoutSettings({ version: 1, leftPanelWidth: 480 });

    await expect(loadLayoutSettings()).resolves.toEqual({
      version: 1,
      leftPanelWidth: 480
    });
  });

  it("normalizes broken and out-of-range layout settings", () => {
    expect(normalizeLayoutSettings({ version: 1, leftPanelWidth: 200 })).toEqual({
      version: 1,
      leftPanelWidth: MIN_LEFT_PANEL_WIDTH
    });
    expect(normalizeLayoutSettings({ version: 1, leftPanelWidth: 900 })).toEqual({
      version: 1,
      leftPanelWidth: MAX_LEFT_PANEL_WIDTH
    });
    expect(normalizeLayoutSettings("{not-json")).toEqual({
      version: 1,
      leftPanelWidth: DEFAULT_LEFT_PANEL_WIDTH
    });
  });

  it("falls back to defaults for broken browser storage", async () => {
    window.localStorage.setItem("nuinuiCAD.layoutSettings.v1", "{not-json");

    await expect(loadLayoutSettings()).resolves.toEqual({
      version: 1,
      leftPanelWidth: DEFAULT_LEFT_PANEL_WIDTH
    });
  });
});
