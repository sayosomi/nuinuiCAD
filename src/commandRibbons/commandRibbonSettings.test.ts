import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultCommandRibbonSettings,
  loadCommandRibbonSettings,
  normalizeCommandRibbonSettings,
  saveCommandRibbonSettings,
  commandRibbonIconColorValues
} from "./commandRibbonSettings";

beforeEach(() => {
  window.localStorage.clear();
});

describe("commandRibbonSettings", () => {
  it("keeps the Tauri semantic icon color constants unchanged", () => {
    expect(commandRibbonIconColorValues).toEqual({
      default: "currentColor",
      teal: "#0f766e",
      blue: "#2563eb",
      green: "#15803d",
      amber: "#b7791f",
      orange: "#c2410c",
      red: "#dc2626",
      pink: "#db2777",
      purple: "#7c3aed",
      slate: "#475569"
    });
  });

  it("loads the default ribbon when no browser setting exists", async () => {
    const settings = await loadCommandRibbonSettings();

    expect(settings.ribbons[0].id).toBe("drafting");
    expect(settings.ribbons[0].dock).toBe("canvas");
    expect(settings.ribbons[0].x).toBeNull();
    expect(settings.ribbons[0].buttons.map((button) => button.commandId)).toContain("addLine");
    expect(settings.ribbons[1]).toMatchObject({
      id: "selection-actions",
      dock: "leftPanelBottom"
    });
  });

  it("saves and loads browser command ribbon settings", async () => {
    await saveCommandRibbonSettings({
      version: 1,
      ribbons: [
        {
          id: "custom",
          label: "Custom",
          dock: "canvas",
          x: 80,
          y: 24,
          orientation: "vertical",
          iconSize: 20,
          buttons: [
            {
              id: "line",
              commandId: "addLine",
              icon: "slash",
              iconColor: "teal",
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
          dock: "canvas",
          x: 80,
          y: 24,
          orientation: "vertical",
          iconSize: 20,
          buttons: [
            {
              id: "line",
              commandId: "addLine",
              icon: "slash",
              iconColor: "teal",
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
          iconSize: 999,
          orientation: "sideways",
          buttons: [
            { id: "line", commandId: "addLine", icon: "slash", label: "Line", showLabel: true },
            { id: "deleted-template", commandId: "openGroupTemplateLibrary", icon: "slash", label: "Deleted template", showLabel: true },
            { id: "bad", commandId: "missing", icon: "slash", label: "Bad", showLabel: true }
          ]
        }
      ]
    });

    expect(settings.ribbons[0].x).toBe(0);
    expect(settings.ribbons[0].y).toBe(10000);
    expect(settings.ribbons[0].dock).toBe("canvas");
    expect(settings.ribbons[0].orientation).toBe("horizontal");
    expect(settings.ribbons[0].iconSize).toBe(16);
    expect(settings.ribbons[0].buttons).toHaveLength(1);
    expect(settings.ribbons[0].buttons[0].iconColor).toBe("default");
    expect(settings.ribbons.some((ribbon) => ribbon.id === "selection-actions")).toBe(true);
  });

  it("migrates the retired Element Names button to Point Names", () => {
    const settings = normalizeCommandRibbonSettings({
      version: 1,
      ribbons: [{
        id: "canvas",
        buttons: [{ id: "toggleCanvasElementNames", commandId: "toggleCanvasElementNames", icon: "tags" }]
      }]
    });

    expect(settings.ribbons[0]?.buttons[0]).toMatchObject({
      id: "toggleCanvasPointNames",
      commandId: "toggleCanvasPointNames"
    });
  });

  it("falls back to the default ribbon for broken browser settings", async () => {
    window.localStorage.setItem("nuinuiCAD.commandRibbonSettings.v1", "{not-json");

    const settings = await loadCommandRibbonSettings();

    expect(settings).toEqual(defaultCommandRibbonSettings());
  });
});
