import { describe, expect, it } from "vitest";
import { LEGACY_CANVAS_THEME } from "../components/canvasTheme";
import {
  compositeCssColorOver,
  contrastRatio,
  parseCssColor,
  resolveVSCodeCanvasTheme
} from "./vscodeCanvasTheme";

const stylesFor = (values: Record<string, string>) => ({
  getPropertyValue: (name: string) => values[name] ?? ""
});

const contrastFor = (value: string, backgroundValue: string) => {
  const valueColor = parseCssColor(value);
  const backgroundColor = parseCssColor(backgroundValue);
  if (!valueColor || !backgroundColor) throw new Error("Expected test colors to parse");
  return contrastRatio(compositeCssColorOver(valueColor, backgroundColor), backgroundColor);
};

const contrastBetweenFor = (
  firstValue: string,
  secondValue: string,
  backgroundValue: string
) => {
  const firstColor = parseCssColor(firstValue);
  const secondColor = parseCssColor(secondValue);
  const backgroundColor = parseCssColor(backgroundValue);
  if (!firstColor || !secondColor || !backgroundColor) {
    throw new Error("Expected test colors to parse");
  }
  return contrastRatio(
    compositeCssColorOver(firstColor, backgroundColor),
    compositeCssColorOver(secondColor, backgroundColor)
  );
};

const hslFor = (value: string, backgroundValue: string) => {
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
  if (delta === 0) return { hue: 0, saturation: 0 };
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === red) hue = 60 * (((green - blue) / delta) % 6);
  else if (max === green) hue = 60 * ((blue - red) / delta + 2);
  else hue = 60 * ((red - green) / delta + 4);
  return { hue: hue < 0 ? hue + 360 : hue, saturation };
};

const hueDistanceFor = (firstValue: string, secondValue: string, backgroundValue: string) => {
  const first = hslFor(firstValue, backgroundValue);
  const second = hslFor(secondValue, backgroundValue);
  const difference = Math.abs(first.hue - second.hue) % 360;
  return Math.min(difference, 360 - difference);
};

describe("resolveVSCodeCanvasTheme", () => {
  it("maps active VS Code CSS variables to the shared CanvasTheme DTO", () => {
    const theme = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": "#111111",
      "--vscode-descriptionForeground": "#222222",
      "--vscode-focusBorder": "#111111",
      "--vscode-editorInfo-foreground": "#444444",
      "--vscode-editorWarning-foreground": "#555555",
      "--vscode-editorError-foreground": "#666666",
      "--vscode-editor-background": "#777777",
      "--vscode-editorIndentGuide-background1": "#888888",
      "--vscode-editorIndentGuide-activeBackground1": "#888888",
      "--vscode-editorRuler-foreground": "#aaaaaa",
      "--vscode-editor-selectionHighlightBorder": "#ffffff"
    }));

    expect(theme).toEqual({
      foreground: "#111111",
      muted: "#222222",
      accent: "#111111",
      info: "#444444",
      warning: "#555555",
      error: "#666666",
      background: "#777777",
      minorGrid: "#888888",
      majorGrid: "#888888",
      axis: "#aaaaaa",
      bezierHandleLine: "#222222",
      bezierHandlePoint: "#111111",
      selection: "#ffffff",
      selectionOutline: "#ffffff",
      pickCandidate: "#111111"
    });
  });

  it("falls back safely when optional values are missing", () => {
    const theme = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": "#101010",
      "--vscode-descriptionForeground": "#202020",
      "--vscode-focusBorder": "#303030"
    }));

    expect(theme.foreground).toBe("#101010");
    expect(theme.muted).toBe("#202020");
    expect(theme.axis).toBe("#202020");
    expect(theme.bezierHandleLine).toBe("#202020");
    expect(theme.bezierHandlePoint).toBe("#303030");
    expect(theme.selection).not.toBe(theme.foreground);
    expect(contrastBetweenFor(theme.selection, theme.foreground, theme.background))
      .toBeGreaterThanOrEqual(2);
    expect(contrastFor(theme.selection, theme.background)).toBeGreaterThanOrEqual(3);
    expect(theme.pickCandidate).toBe("#303030");
    expect(theme.background).toBe(LEGACY_CANVAS_THEME.background);
    expect(theme.minorGrid).toBe(LEGACY_CANVAS_THEME.minorGrid);
    expect(theme.majorGrid).toBe(LEGACY_CANVAS_THEME.majorGrid);
    expect(theme.info).toBe(LEGACY_CANVAS_THEME.info);
    expect(theme.warning).toBe(LEGACY_CANVAS_THEME.warning);
    expect(theme.error).toBe(LEGACY_CANVAS_THEME.error);
  });

  it("re-resolves changed computed values without naming or selecting themes", () => {
    const first = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": "#111111",
      "--vscode-editor-background": "#eeeeee"
    }));
    const second = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": "#eeeeff",
      "--vscode-editor-background": "#111122"
    }));

    expect(first.foreground).toBe("#111111");
    expect(first.background).toBe("#eeeeee");
    expect(second.foreground).toBe("#eeeeff");
    expect(second.background).toBe("#111122");
  });

  it("leaves acceptable dark-theme grid colors unchanged", () => {
    const theme = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": "#f5f5f5",
      "--vscode-editor-background": "#1e1e1e",
      "--vscode-editorIndentGuide-background1": "#2a2a2a",
      "--vscode-editorIndentGuide-activeBackground1": "#3a3a3a"
    }));

    expect(theme.minorGrid).toBe("#2a2a2a");
    expect(theme.majorGrid).toBe("#3a3a3a");
  });

  it("reduces over-contrast light-theme grid colors to their caps", () => {
    const background = "#ffffff";
    const theme = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": "#111111",
      "--vscode-editor-background": background,
      "--vscode-editorIndentGuide-background1": "#000000",
      "--vscode-editorIndentGuide-activeBackground1": "#333333"
    }));

    expect(theme.minorGrid).not.toBe("#000000");
    expect(theme.majorGrid).not.toBe("#333333");
    expect(contrastFor(theme.minorGrid, background)).toBeLessThanOrEqual(1.3 + 1e-6);
    expect(contrastFor(theme.majorGrid, background)).toBeLessThanOrEqual(1.6 + 1e-6);
  });

  it("preserves an already visible accent and shares it with point and pick roles", () => {
    const theme = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": "#111111",
      "--vscode-editor-background": "#ffffff",
      "--vscode-focusBorder": "#0066cc"
    }));

    expect(theme.accent).toBe("#0066cc");
    expect(theme.bezierHandlePoint).toBe(theme.accent);
    expect(theme.pickCandidate).toBe(theme.accent);
  });

  it("strengthens a low-contrast accent to the minimum", () => {
    const background = "#202020";
    const theme = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": "#ffffff",
      "--vscode-editor-background": background,
      "--vscode-focusBorder": "#303030"
    }));

    expect(theme.accent).not.toBe("#303030");
    expect(contrastFor(theme.accent, background)).toBeGreaterThanOrEqual(3);
    expect(theme.bezierHandlePoint).toBe(theme.accent);
    expect(theme.pickCandidate).toBe(theme.accent);
  });

  it("strengthens only a low-contrast Bezier handle line", () => {
    const background = "#ffffff";
    const lowContrast = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": "#000000",
      "--vscode-editor-background": background,
      "--vscode-descriptionForeground": "#eeeeee"
    }));
    const adequate = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": "#000000",
      "--vscode-editor-background": background,
      "--vscode-descriptionForeground": "#808080"
    }));

    expect(contrastFor(lowContrast.bezierHandleLine, background)).toBeGreaterThanOrEqual(1.8);
    expect(adequate.bezierHandleLine).toBe("#808080");
  });

  it("strengthens low-contrast selection and derives a chromatic neutral fallback", () => {
    const background = "#ffffff";
    const lowContrast = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": "#000000",
      "--vscode-editor-background": background,
      "--vscode-focusBorder": "#eeeeee",
      "--vscode-editor-selectionHighlightBorder": "#eeeeee"
    }));
    const fallback = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": "#000000",
      "--vscode-editor-background": background,
      "--vscode-focusBorder": "#444444"
    }));

    expect(contrastFor(lowContrast.selection, background)).toBeGreaterThanOrEqual(4.5);
    expect(fallback.selection).not.toBe("#444444");
    expect(hslFor(fallback.selection, background).saturation).toBeGreaterThanOrEqual(0.65);
    expect(contrastFor(fallback.selection, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["dark", "#d4d4d4", "#1e1e1e", "#007fd4", 3],
    ["light", "#333333", "#ffffff", "#0066cc", 4.5]
  ])("uses the theme accent when %s selection is already chromatically distinct", (
    _label,
    foreground,
    background,
    accent,
    minimumContrast
  ) => {
    const theme = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": foreground,
      "--vscode-editor-background": background,
      "--vscode-focusBorder": accent,
      "--vscode-editor-selectionHighlightBorder": foreground
    }));

    expect(theme.selection).toBe(theme.accent);
    expect(hslFor(theme.selection, background).saturation).toBeGreaterThanOrEqual(0.65);
    expect(contrastFor(theme.selection, background)).toBeGreaterThanOrEqual(minimumContrast);
  });

  it("darkens a saturated light-theme selection that only clears 3:1 contrast", () => {
    const foreground = "#657b83";
    const background = "#fdf6e3";
    const accent = "#07958a";
    const theme = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": foreground,
      "--vscode-editor-background": background,
      "--vscode-focusBorder": accent,
      "--vscode-editor-selectionHighlightBorder": accent
    }));

    expect(contrastFor(accent, background)).toBeGreaterThan(3);
    expect(contrastFor(accent, background)).toBeLessThan(4.5);
    expect(theme.selection).not.toBe(accent);
    expect(hslFor(theme.selection, background).saturation).toBeGreaterThanOrEqual(0.65);
    expect(contrastFor(theme.selection, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["dark", "#7aa2d6", "#07111d", "#5f91c7"],
    ["light", "#55789f", "#fff8e8", "#6d8fb6"]
  ])("rotates same-hue %s selection away from normal geometry", (
    _label,
    foreground,
    background,
    accent
  ) => {
    const theme = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": foreground,
      "--vscode-editor-background": background,
      "--vscode-focusBorder": accent,
      "--vscode-editor-selectionHighlightBorder": accent
    }));

    expect(theme.selection).not.toBe(theme.accent);
    expect(hslFor(theme.selection, background).saturation).toBeGreaterThanOrEqual(0.8);
    expect(hueDistanceFor(theme.selection, theme.foreground, background)).toBeGreaterThanOrEqual(170);
    expect(contrastFor(theme.selection, background)).toBeGreaterThanOrEqual(
      _label === "light" ? 4.5 : 3
    );
  });

  it("derives a distinct selection when both theme selection tokens match geometry", () => {
    const foreground = "#111111";
    const background = "#ffffff";
    const theme = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": foreground,
      "--vscode-editor-background": background,
      "--vscode-focusBorder": foreground,
      "--vscode-editor-selectionHighlightBorder": foreground
    }));

    expect(theme.selection).not.toBe(theme.foreground);
    expect(contrastBetweenFor(theme.selection, theme.foreground, background))
      .toBeGreaterThanOrEqual(2);
    expect(contrastFor(theme.selection, background)).toBeGreaterThanOrEqual(4.5);
  });

  it("measures alpha colors after compositing over the Canvas background", () => {
    const background = "#ffffff";
    const seed = "rgba(128, 128, 128, 0.5)";
    const theme = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": "#000000",
      "--vscode-editor-background": background,
      "--vscode-focusBorder": seed
    }));

    expect(theme.accent).not.toBe(seed);
    expect(parseCssColor(theme.accent)?.alpha).toBe(0.5);
    expect(contrastFor(theme.accent, background)).toBeGreaterThanOrEqual(3);
  });

  it("parses the supported CSS color forms", () => {
    expect(parseCssColor("#abc")).toMatchObject({ red: 170, green: 187, blue: 204, alpha: 1 });
    expect(parseCssColor("#abcd")).toMatchObject({ red: 170, green: 187, blue: 204, alpha: 0.8666666666666667 });
    expect(parseCssColor("#aabbcc")).toMatchObject({ red: 170, green: 187, blue: 204, alpha: 1 });
    expect(parseCssColor("#aabbccdd")).toMatchObject({ red: 170, green: 187, blue: 204, alpha: 0.8666666666666667 });
    expect(parseCssColor("rgb(10, 20, 30)")).toMatchObject({ red: 10, green: 20, blue: 30, alpha: 1 });
    expect(parseCssColor("rgba(10 20 30 / 50%)")).toMatchObject({ red: 10, green: 20, blue: 30, alpha: 0.5 });
  });

  it("preserves unparseable CSS values without throwing", () => {
    const theme = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": "#000000",
      "--vscode-editor-background": "#ffffff",
      "--vscode-focusBorder": "var(--unknown-color)",
      "--vscode-descriptionForeground": "color(display-p3 0 0 0)",
      "--vscode-editorIndentGuide-background1": "not-a-color"
    }));

    expect(theme.accent).toBe("var(--unknown-color)");
    expect(theme.bezierHandlePoint).toBe("var(--unknown-color)");
    expect(theme.pickCandidate).toBe("var(--unknown-color)");
    expect(theme.bezierHandleLine).toBe("color(display-p3 0 0 0)");
    expect(theme.minorGrid).toBe("not-a-color");
  });
});
