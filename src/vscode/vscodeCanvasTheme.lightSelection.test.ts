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

const hueDistance = (first: number, second: number) => {
  const difference = Math.abs(first - second) % 360;
  return Math.min(difference, 360 - difference);
};

const contrastFor = (value: string, backgroundValue: string) => {
  const color = parseCssColor(value);
  const background = parseCssColor(backgroundValue);
  if (!color || !background) throw new Error("Expected test colors to parse");
  return contrastRatio(compositeCssColorOver(color, background), background);
};

describe("resolveVSCodeCanvasTheme light selection correction", () => {
  it("keeps a weak light-theme selection hue instead of replacing it with fixed blue", () => {
    const foreground = "#657b83";
    const background = "#fdf6e3";
    const themeSelection = "#07958a";
    const theme = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": foreground,
      "--vscode-editor-background": background,
      "--vscode-focusBorder": themeSelection,
      "--vscode-editor-selectionHighlightBorder": themeSelection
    }));

    const baseHsl = visibleHslFor(themeSelection, background);
    const selectionHsl = visibleHslFor(theme.selection, background);

    expect(theme.selection).not.toBe(themeSelection);
    expect(hueDistance(selectionHsl.hue, baseHsl.hue)).toBeLessThanOrEqual(1);
    expect(selectionHsl.saturation).toBeGreaterThanOrEqual(0.98);
    expect(contrastFor(theme.selection, background)).toBeGreaterThanOrEqual(4.5);
  });

  it("uses the theme selection token as the light correction base before focus accent", () => {
    const foreground = "#333333";
    const background = "#ffffff";
    const focusAccent = "#007acc";
    const themeSelection = "#d95ba5";
    const theme = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": foreground,
      "--vscode-editor-background": background,
      "--vscode-focusBorder": focusAccent,
      "--vscode-editor-selectionHighlightBorder": themeSelection
    }));

    const baseHsl = visibleHslFor(themeSelection, background);
    const focusHsl = visibleHslFor(focusAccent, background);
    const selectionHsl = visibleHslFor(theme.selection, background);

    expect(hueDistance(selectionHsl.hue, baseHsl.hue)).toBeLessThanOrEqual(1);
    expect(hueDistance(selectionHsl.hue, focusHsl.hue)).toBeGreaterThan(60);
    expect(selectionHsl.saturation).toBeGreaterThanOrEqual(0.98);
    expect(contrastFor(theme.selection, background)).toBeGreaterThanOrEqual(4.5);
  });

  it("uses an already-distinct theme focus token unchanged when no selection token exists", () => {
    const foreground = "#333333";
    const background = "#ffffff";
    const focusAccent = "#8a2be2";
    const theme = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": foreground,
      "--vscode-editor-background": background,
      "--vscode-focusBorder": focusAccent
    }));

    expect(theme.selection).toBe(focusAccent);
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
