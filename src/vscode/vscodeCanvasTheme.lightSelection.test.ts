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

const visibleOklabFor = (value: string, backgroundValue: string) => {
  const color = parseCssColor(value);
  const background = parseCssColor(backgroundValue);
  if (!color || !background) throw new Error("Expected test colors to parse");
  const visible = compositeCssColorOver(color, background);
  const linearize = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const red = linearize(visible.red);
  const green = linearize(visible.green);
  const blue = linearize(visible.blue);
  const l = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue;
  const m = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue;
  const s = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue;
  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);
  return {
    lightness: 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    a: 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot
  };
};

const perceptualDistanceFor = (
  firstValue: string,
  secondValue: string,
  backgroundValue: string
) => {
  const first = visibleOklabFor(firstValue, backgroundValue);
  const second = visibleOklabFor(secondValue, backgroundValue);
  return Math.hypot(
    first.lightness - second.lightness,
    first.a - second.a,
    first.b - second.b
  );
};

describe("resolveVSCodeCanvasTheme light selection correction", () => {
  it.each([
    ["teal", "#657b83", "#fdf6e3", "#07958a"],
    ["magenta", "#333333", "#ffffff", "#d95ba5"]
  ])("keeps the active theme %s hue when a light fallback needs strengthening", (
    _label,
    foreground,
    background,
    themeAccent
  ) => {
    const theme = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": foreground,
      "--vscode-editor-background": background,
      "--vscode-focusBorder": themeAccent,
      "--vscode-editor-selectionHighlightBorder": themeAccent
    }));

    const baseHsl = visibleHslFor(themeAccent, background);
    const selectionHsl = visibleHslFor(theme.selection, background);

    expect(contrastFor(themeAccent, background)).toBeLessThan(4.5);
    expect(theme.selection).not.toBe(themeAccent);
    expect(hueDistance(selectionHsl.hue, baseHsl.hue)).toBeLessThanOrEqual(1);
    expect(selectionHsl.saturation).toBeGreaterThanOrEqual(0.98);
    expect(contrastFor(theme.selection, background)).toBeGreaterThanOrEqual(4.5);
  });

  it("adds material perceptual separation from ordinary geometry on the failing light palette", () => {
    const foreground = "#657b83";
    const background = "#fdf6e3";
    const themeAccent = "#07958a";
    const theme = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": foreground,
      "--vscode-editor-background": background,
      "--vscode-focusBorder": themeAccent,
      "--vscode-editor-selectionHighlightBorder": themeAccent
    }));

    const baseHsl = visibleHslFor(themeAccent, background);
    const selectionHsl = visibleHslFor(theme.selection, background);

    expect(perceptualDistanceFor(themeAccent, foreground, background)).toBeLessThan(0.15);
    expect(perceptualDistanceFor(theme.selection, foreground, background)).toBeGreaterThanOrEqual(0.15);
    expect(hueDistance(selectionHsl.hue, baseHsl.hue)).toBeLessThanOrEqual(1);
    expect(selectionHsl.saturation).toBeGreaterThanOrEqual(0.98);
    expect(contrastFor(theme.selection, background)).toBeGreaterThanOrEqual(4.5);
  });

  it("derives a brighter Solarized-like outline from the active theme hue", () => {
    const foreground = "#657b83";
    const background = "#fdf6e3";
    const themeAccent = "#07958a";
    const theme = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": foreground,
      "--vscode-editor-background": background,
      "--vscode-focusBorder": themeAccent,
      "--vscode-editor-selectionHighlightBorder": themeAccent
    }));

    const accentHsl = visibleHslFor(themeAccent, background);
    const selectionHsl = visibleHslFor(theme.selection, background);
    const outlineHsl = visibleHslFor(theme.selectionOutline, background);

    expect(contrastFor(theme.selection, background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastFor(theme.selectionOutline, background)).toBeGreaterThanOrEqual(3);
    expect(perceptualDistanceFor(theme.selectionOutline, foreground, background))
      .toBeGreaterThanOrEqual(0.15);
    expect(hueDistance(outlineHsl.hue, accentHsl.hue)).toBeLessThanOrEqual(1);
    expect(outlineHsl.lightness).toBeGreaterThan(selectionHsl.lightness);
    expect(theme.selectionOutline).not.toBe(theme.selection);
  });

  it("keeps materially different light-theme hues materially different in the outline", () => {
    const resolve = (foreground: string, background: string, accent: string) =>
      resolveVSCodeCanvasTheme(stylesFor({
        "--vscode-editor-foreground": foreground,
        "--vscode-editor-background": background,
        "--vscode-focusBorder": accent,
        "--vscode-editor-selectionHighlightBorder": accent
      }));
    const teal = resolve("#657b83", "#fdf6e3", "#07958a");
    const magenta = resolve("#333333", "#ffffff", "#d95ba5");

    expect(hueDistance(
      visibleHslFor(teal.selectionOutline, teal.background).hue,
      visibleHslFor(magenta.selectionOutline, magenta.background).hue
    )).toBeGreaterThan(60);
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
    expect(contrastFor(theme.selectionOutline, background)).toBeGreaterThanOrEqual(3);
    expect(perceptualDistanceFor(theme.selectionOutline, foreground, background))
      .toBeGreaterThanOrEqual(0.15);
    expect(hueDistance(
      visibleHslFor(theme.selectionOutline, background).hue,
      visibleHslFor(focusAccent, background).hue
    )).toBeLessThanOrEqual(1);
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
    expect(theme.selectionOutline).toBe(theme.selection);
  });
});
