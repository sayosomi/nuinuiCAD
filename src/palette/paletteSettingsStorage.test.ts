import { beforeEach, describe, expect, it } from "vitest";
import {
  loadPaletteTemplateSettings,
  savePaletteTemplateSettings
} from "./paletteSettingsStorage";

beforeEach(() => {
  window.localStorage.clear();
});

describe("paletteSettingsStorage", () => {
  it("loads the default template when no browser setting exists", async () => {
    const settings = await loadPaletteTemplateSettings();

    expect(settings.palette.defaultColorId).toBe("pattern-black");
  });

  it("saves and loads a browser palette template", async () => {
    await savePaletteTemplateSettings({
      defaultColorId: "ink",
      colors: [{ id: "ink", name: "Ink", hex: "#111111" }]
    });

    await expect(loadPaletteTemplateSettings()).resolves.toEqual({
      version: 1,
      palette: {
        defaultColorId: "ink",
        colors: [{ id: "ink", name: "Ink", hex: "#111111" }]
      }
    });
  });

  it("falls back to the default template for broken browser settings", async () => {
    window.localStorage.setItem("nuinuiCAD.paletteTemplate.v1", "{not-json");

    const settings = await loadPaletteTemplateSettings();

    expect(settings.palette.defaultColorId).toBe("pattern-black");
  });
});
