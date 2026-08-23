import { describe, expect, it } from "vitest";
import {
  compositeCssColorOver,
  contrastRatio,
  parseCssColor,
  resolveVSCodeCanvasTheme
} from "./vscodeCanvasTheme";

const stylesFor = (values: Record<string, string>) => ({
  getPropertyValue: (name: string) => values[name] ?? ""
});

const visibleHslFor = (value: string, backgroundValue: string) => {
  const color = parseCssColor(value);
  const background = parseCssColor(backgroundValue);
  if (!color || !background) throw new Error("Expected test colors to parse");
  const visible = compositeCssColorOver(color, background);
  const red = visible.red / 255;
  const green = visible.green / 255;
  const blue = visible.blue / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;
  if (delta === 0) return { hue: 0, saturation: 0, lightness };
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === red) hue = 60 * (((green - blue) / delta) % 6);
  else if (max === green) hue = 60 * ((blue - red) / delta + 2);
  else hue = 60 * ((red - green) / delta + 4);
  return { hue: hue < 0 ? hue + 360 : hue, saturation, lightness };
};

const contrastFor = (value: string, backgroundValue: string) => {
  const color = parseCssColor(value);
  const background = parseCssColor(backgroundValue);
  if (!color || !background) throw new Error("Expected test colors to parse");
  return contrastRatio(compositeCssColorOver(color, background), background);
};

describe("resolveVSCodeCanvasTheme light selection correction", () => {
  it("uses a materially brighter near-full-chroma blue on a weak light-theme teal", () => {
    const foreground = "#657b83";
    const background = "#fdf6e3";
    const accent = "#07958a";
    const theme = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": foreground,
      "--vscode-editor-background": background,
      "--vscode-focusBorder": accent,
      "--vscode-editor-selectionHighlightBorder": accent
    }));

    const accentHsl = visibleHslFor(accent, background);
    const selectionHsl = visibleHslFor(theme.selection, background);

    expect(theme.selection).not.toBe(accent);
    expect(selectionHsl.lightness).toBeGreaterThanOrEqual(0.56);
    expect(selectionHsl.lightness - accentHsl.lightness).toBeGreaterThanOrEqual(0.2);
    expect(selectionHsl.saturation).toBeGreaterThanOrEqual(0.98);
    expect(selectionHsl.hue).toBeGreaterThanOrEqual(220);
    expect(selectionHsl.hue).toBeLessThanOrEqual(230);
    expect(contrastFor(theme.selection, background)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the accepted dark-theme teal correction direction unchanged", () => {
    const foreground = "#d4d4d4";
    const background = "#07111d";
    const accent = "#07958a";
    const theme = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": foreground,
      "--vscode-editor-background": background,
      "--vscode-focusBorder": accent,
      "--vscode-editor-selectionHighlightBorder": accent
    }));

    expect(theme.selection).toBe(accent);
  });
});
