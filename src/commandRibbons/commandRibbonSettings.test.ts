import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultCommandRibbonSettings,
  loadCommandRibbonSettings,
  normalizeCommandRibbonSettings,
  saveCommandRibbonSettings
} from "./commandRibbonSettings";

beforeEach(() => {
  window.localStorage.clear();
});

describe("commandRibbonSettings", () => {
  it("loads the default ribbon when no browser setting exists", async () => {
    const settings = await loadCommandRibbonSettings();

    expect(settings.ribbons[0].id).toBe("drafting");
    expect(settings.ribbons[0].x).toBeNull();
    expect(settings.ribbons[0].buttons.map((button) => button.commandId)).toContain("addLine");
  });

  it("saves and loads browser command ribbon settings", async () => {
    await saveCommandRibbonSettings({
      version: 1,
      ribbons: [
        {
          id: "custom",
          label: "Custom",
          x: 80,
          y: 24,
          orientation: "vertical",
          buttons: [
            {
              id: "line",
              commandId: "addLine",
              icon: "slash",
              label: "Line",
              showLabel: true
            }
          ]
        }
      ]
    });

    await expect(loadCommandRibbonSettings()).resolves.toEqual({
      version: 1,
      ribbons: [
        {
          id: "custom",
          label: "Custom",
          x: 80,
          y: 24,
          orientation: "vertical",
          buttons: [
            {
              id: "line",
              commandId: "addLine",
              icon: "slash",
              label: "Line",
              showLabel: true
            }
          ]
        }
      ]
    });
  });

  it("normalizes broken settings to the default ribbon", () => {
    expect(normalizeCommandRibbonSettings({ version: 1, ribbons: [] })).toEqual(
      defaultCommandRibbonSettings()
    );
    expect(normalizeCommandRibbonSettings({ version: 1, ribbons: [{ buttons: [] }] })).toEqual(
      defaultCommandRibbonSettings()
    );
  });

  it("filters invalid buttons and clamps saved coordinates", () => {
    const settings = normalizeCommandRibbonSettings({
      version: 1,
      ribbons: [
        {
          id: "r",
          label: "Ribbon",
          x: -12,
          y: 20000,
          orientation: "sideways",
          buttons: [
            { id: "line", commandId: "addLine", icon: "slash", label: "Line", showLabel: true },
            { id: "bad", commandId: "missing", icon: "slash", label: "Bad", showLabel: true }
          ]
        }
      ]
    });

    expect(settings.ribbons[0].x).toBe(0);
    expect(settings.ribbons[0].y).toBe(10000);
    expect(settings.ribbons[0].orientation).toBe("horizontal");
    expect(settings.ribbons[0].buttons).toHaveLength(1);
  });

  it("falls back to the default ribbon for broken browser settings", async () => {
    window.localStorage.setItem("nuinuiCAD.commandRibbonSettings.v1", "{not-json");

    const settings = await loadCommandRibbonSettings();

    expect(settings).toEqual(defaultCommandRibbonSettings());
  });
});
