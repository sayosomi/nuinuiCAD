import {
  LEGACY_CANVAS_THEME,
  type CanvasTheme
} from "../components/canvasTheme";

type CssVariableSource = {
  getPropertyValue: (property: string) => string;
};

type RgbaColor = {
  red: number;
  green: number;
  blue: number;
  alpha: number;
  hasExplicitAlpha: boolean;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const cssNumber = (value: string): number | null => {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(%)?$/.exec(value.trim());
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return null;
  return match[2] ? parsed / 100 : parsed;
};

const cssChannel = (value: string): number | null => {
  const parsed = cssNumber(value);
  if (parsed === null) return null;
  return clamp(value.trim().endsWith("%") ? parsed * 255 : parsed, 0, 255);
};

const cssAlpha = (value: string): number | null => {
  const parsed = cssNumber(value);
  if (parsed === null) return null;
  return clamp(value.trim().endsWith("%") ? parsed : parsed, 0, 1);
};

const parseFunctionalColor = (value: string): RgbaColor | null => {
  const match = /^(rgba?)\((.*)\)$/i.exec(value.trim());
  if (!match) return null;

  const body = match[2].trim();
  const usesCommas = body.includes(",");
  let channels: string[];
  let alphaValue: string | undefined;

  if (usesCommas) {
    const parts = body.split(",").map((part) => part.trim());
    if (parts.length !== 3 && parts.length !== 4) return null;
    channels = parts.slice(0, 3);
    alphaValue = parts[3];
  } else {
    const slashParts = body.split("/").map((part) => part.trim());
    if (slashParts.length > 2) return null;
    channels = slashParts[0]?.split(/\s+/).filter(Boolean) ?? [];
    alphaValue = slashParts[1];
  }

  if (channels.length !== 3) return null;
  const red = cssChannel(channels[0]);
  const green = cssChannel(channels[1]);
  const blue = cssChannel(channels[2]);
  const alpha = alphaValue === undefined ? 1 : cssAlpha(alphaValue);
  if (red === null || green === null || blue === null || alpha === null) return null;

  return {
    red,
    green,
    blue,
    alpha,
    hasExplicitAlpha: alphaValue !== undefined
  };
};

/** Parses the CSS color forms emitted by VS Code theme variables. */
export const parseCssColor = (value: string): RgbaColor | null => {
  const trimmed = value.trim();
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(trimmed);
  if (hex) {
    const digits = hex[1];
    const expanded = digits.length <= 4
      ? digits.split("").map((digit) => `${digit}${digit}`).join("")
      : digits;
    return {
      red: Number.parseInt(expanded.slice(0, 2), 16),
      green: Number.parseInt(expanded.slice(2, 4), 16),
      blue: Number.parseInt(expanded.slice(4, 6), 16),
      alpha: expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1,
      hasExplicitAlpha: expanded.length === 8
    };
  }
  return parseFunctionalColor(trimmed);
};

export const compositeCssColorOver = (color: RgbaColor, background: RgbaColor): RgbaColor => ({
  red: color.red * color.alpha + background.red * (1 - color.alpha),
  green: color.green * color.alpha + background.green * (1 - color.alpha),
  blue: color.blue * color.alpha + background.blue * (1 - color.alpha),
  alpha: 1,
  hasExplicitAlpha: false
});

const relativeLuminance = (color: RgbaColor): number => {
  const linearize = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linearize(color.red) +
    0.7152 * linearize(color.green) +
    0.0722 * linearize(color.blue);
};

/** Returns the WCAG contrast ratio between two opaque sRGB colors. */
export const contrastRatio = (foreground: RgbaColor, background: RgbaColor): number => {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
};

const contrastAgainst = (color: RgbaColor, background: RgbaColor) =>
  contrastRatio(compositeCssColorOver(color, background), background);

const mixRgb = (from: RgbaColor, to: RgbaColor, amount: number): RgbaColor => ({
  red: from.red + (to.red - from.red) * amount,
  green: from.green + (to.green - from.green) * amount,
  blue: from.blue + (to.blue - from.blue) * amount,
  alpha: from.alpha,
  hasExplicitAlpha: from.hasExplicitAlpha
});

const formatNumber = (value: number) => String(Number(value.toFixed(10)));

const formatAdjustedColor = (color: RgbaColor): string => {
  const channels = [color.red, color.green, color.blue].map(formatNumber).join(", ");
  return color.hasExplicitAlpha
    ? `rgba(${channels}, ${formatNumber(color.alpha)})`
    : `rgb(${channels})`;
};

const strengthenContrast = (
  seedValue: string,
  foregroundValue: string,
  backgroundValue: string,
  minimumContrast: number
): string => {
  const seed = parseCssColor(seedValue);
  const foreground = parseCssColor(foregroundValue);
  const background = parseCssColor(backgroundValue);
  if (!seed || !foreground || !background) return seedValue;

  const seedContrast = contrastAgainst(seed, background);
  if (seedContrast >= minimumContrast) return seedValue;

  const foregroundContrast = contrastAgainst(foreground, background);
  const foregroundDirectionContrast = contrastAgainst(
    mixRgb(seed, foreground, 1),
    background
  );
  if (foregroundDirectionContrast < minimumContrast) {
    return foregroundContrast > seedContrast ? foregroundValue : seedValue;
  }

  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const amount = (low + high) / 2;
    const candidate = mixRgb(seed, foreground, amount);
    if (contrastAgainst(candidate, background) >= minimumContrast) high = amount;
    else low = amount;
  }
  return formatAdjustedColor(mixRgb(seed, foreground, Math.min(high + 1e-7, 1)));
};

const softenContrast = (
  seedValue: string,
  backgroundValue: string,
  maximumContrast: number
): string => {
  const seed = parseCssColor(seedValue);
  const background = parseCssColor(backgroundValue);
  if (!seed || !background) return seedValue;
  if (contrastAgainst(seed, background) <= maximumContrast) return seedValue;

  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const amount = (low + high) / 2;
    const candidate = mixRgb(seed, background, amount);
    if (contrastAgainst(candidate, background) <= maximumContrast) high = amount;
    else low = amount;
  }
  return formatAdjustedColor(mixRgb(seed, background, Math.min(high + 1e-7, 1)));
};

const contrastBetween = (
  firstValue: string,
  secondValue: string,
  backgroundValue: string
): number | null => {
  const first = parseCssColor(firstValue);
  const second = parseCssColor(secondValue);
  const background = parseCssColor(backgroundValue);
  if (!first || !second || !background) return null;
  return contrastRatio(
    compositeCssColorOver(first, background),
    compositeCssColorOver(second, background)
  );
};

const SELECTION_MIN_FOREGROUND_CONTRAST = 2;
const SELECTION_MIN_BACKGROUND_CONTRAST = 3;

/**
 * Keep Canvas selection theme-derived, but do not allow a theme's selection
 * border token to collapse into the same visible color as ordinary geometry.
 */
const resolveSelectionColor = (
  seedValue: string,
  accentValue: string,
  foregroundValue: string,
  backgroundValue: string
): string => {
  const selection = strengthenContrast(seedValue, foregroundValue, backgroundValue, 4.5);
  const selectionForegroundContrast = contrastBetween(
    selection,
    foregroundValue,
    backgroundValue
  );
  if (
    selectionForegroundContrast === null ||
    selectionForegroundContrast >= SELECTION_MIN_FOREGROUND_CONTRAST
  ) {
    return selection;
  }

  const accentForegroundContrast = contrastBetween(
    accentValue,
    foregroundValue,
    backgroundValue
  );
  const accent = parseCssColor(accentValue);
  const background = parseCssColor(backgroundValue);
  if (
    accentForegroundContrast !== null &&
    accentForegroundContrast >= SELECTION_MIN_FOREGROUND_CONTRAST &&
    accent &&
    background &&
    contrastAgainst(accent, background) >= SELECTION_MIN_BACKGROUND_CONTRAST
  ) {
    return accentValue;
  }

  const selectionColor = parseCssColor(selection);
  const foreground = parseCssColor(foregroundValue);
  if (selectionColor && foreground && background) {
    const visibleSelection = compositeCssColorOver(selectionColor, background);
    const visibleForeground = compositeCssColorOver(foreground, background);
    for (let step = 1; step <= 64; step += 1) {
      const candidate = mixRgb(visibleSelection, background, step / 64);
      if (contrastRatio(candidate, background) < SELECTION_MIN_BACKGROUND_CONTRAST) break;
      if (
        contrastRatio(candidate, visibleForeground) >=
        SELECTION_MIN_FOREGROUND_CONTRAST
      ) {
        return formatAdjustedColor(candidate);
      }
    }
  }

  return accentForegroundContrast !== null &&
    accentForegroundContrast > selectionForegroundContrast
    ? accentValue
    : selection;
};

const colorFrom = (
  styles: CssVariableSource,
  variableName: string,
  fallback: string
): string => {
  const value = styles.getPropertyValue(variableName).trim();
  return value || fallback;
};

/** Resolves the active VS Code webview theme without exposing host details downstream. */
export const resolveVSCodeCanvasTheme = (styles: CssVariableSource): CanvasTheme => {
  const foreground = colorFrom(styles, "--vscode-editor-foreground", LEGACY_CANVAS_THEME.foreground);
  const muted = colorFrom(styles, "--vscode-descriptionForeground", LEGACY_CANVAS_THEME.muted);
  const accentSeed = colorFrom(styles, "--vscode-focusBorder", LEGACY_CANVAS_THEME.accent);
  const background = colorFrom(styles, "--vscode-editor-background", LEGACY_CANVAS_THEME.background);
  const accent = strengthenContrast(accentSeed, foreground, background, 3);
  const selectionSeed = colorFrom(styles, "--vscode-editor-selectionHighlightBorder", accentSeed);
  const selection = resolveSelectionColor(selectionSeed, accent, foreground, background);

  return {
    foreground,
    muted,
    accent,
    info: colorFrom(styles, "--vscode-editorInfo-foreground", LEGACY_CANVAS_THEME.info),
    warning: colorFrom(styles, "--vscode-editorWarning-foreground", LEGACY_CANVAS_THEME.warning),
    error: colorFrom(styles, "--vscode-editorError-foreground", LEGACY_CANVAS_THEME.error),
    background,
    minorGrid: softenContrast(
      colorFrom(styles, "--vscode-editorIndentGuide-background1", LEGACY_CANVAS_THEME.minorGrid),
      background,
      1.3
    ),
    majorGrid: softenContrast(
      colorFrom(styles, "--vscode-editorIndentGuide-activeBackground1", LEGACY_CANVAS_THEME.majorGrid),
      background,
      1.6
    ),
    axis: colorFrom(styles, "--vscode-editorRuler-foreground", muted),
    bezierHandleLine: strengthenContrast(
      colorFrom(styles, "--vscode-descriptionForeground", muted),
      foreground,
      background,
      1.8
    ),
    bezierHandlePoint: accent,
    selection,
    pickCandidate: accent
  };
};

export const readVSCodeCanvasTheme = (): CanvasTheme =>
  resolveVSCodeCanvasTheme(window.getComputedStyle(document.documentElement));