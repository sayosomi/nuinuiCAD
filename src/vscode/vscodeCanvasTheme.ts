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

type HslColor = {
  hue: number;
  saturation: number;
  lightness: number;
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

const oklabCoordinates = (color: RgbaColor) => {
  const linearize = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const red = linearize(color.red);
  const green = linearize(color.green);
  const blue = linearize(color.blue);
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

const perceptualColorDistance = (first: RgbaColor, second: RgbaColor): number => {
  const firstLab = oklabCoordinates(first);
  const secondLab = oklabCoordinates(second);
  return Math.hypot(
    firstLab.lightness - secondLab.lightness,
    firstLab.a - secondLab.a,
    firstLab.b - secondLab.b
  );
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

const rgbToHsl = (color: RgbaColor): HslColor => {
  const red = color.red / 255;
  const green = color.green / 255;
  const blue = color.blue / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;

  if (delta === 0) {
    return { hue: 0, saturation: 0, lightness };
  }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === red) {
    hue = 60 * (((green - blue) / delta) % 6);
  } else if (max === green) {
    hue = 60 * ((blue - red) / delta + 2);
  } else {
    hue = 60 * ((red - green) / delta + 4);
  }

  return {
    hue: hue < 0 ? hue + 360 : hue,
    saturation,
    lightness
  };
};

const hslToRgb = ({ hue, saturation, lightness }: HslColor): RgbaColor => {
  const normalizedHue = ((hue % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hueSector = normalizedHue / 60;
  const x = chroma * (1 - Math.abs((hueSector % 2) - 1));
  const channels: [number, number, number] = hueSector < 1
    ? [chroma, x, 0]
    : hueSector < 2
      ? [x, chroma, 0]
      : hueSector < 3
        ? [0, chroma, x]
        : hueSector < 4
          ? [0, x, chroma]
          : hueSector < 5
            ? [x, 0, chroma]
            : [chroma, 0, x];
  const [red, green, blue] = channels;
  const match = lightness - chroma / 2;

  return {
    red: (red + match) * 255,
    green: (green + match) * 255,
    blue: (blue + match) * 255,
    alpha: 1,
    hasExplicitAlpha: false
  };
};

const hueDistance = (first: number, second: number) => {
  const difference = Math.abs(first - second) % 360;
  return Math.min(difference, 360 - difference);
};

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

const SELECTION_DARK_BACKGROUND_CONTRAST = 3;
const SELECTION_LIGHT_BACKGROUND_CONTRAST = 4.5;
const SELECTION_STRONG_LUMINANCE_SEPARATION = 4.5;
const SELECTION_MIN_SATURATION = 0.65;
const SELECTION_MIN_HUE_DISTANCE = 90;
const FOREGROUND_CHROMATIC_SATURATION = 0.18;
const LIGHT_SELECTION_VIVID_SATURATION = 1;
const LIGHT_SELECTION_INITIAL_LIGHTNESS = 0.58;
const LIGHT_SELECTION_MIN_PERCEPTUAL_DISTANCE = 0.15;
const LIGHT_SELECTION_OUTLINE_MIN_CONTRAST = 3;
const LIGHT_SELECTION_OUTLINE_MIN_PERCEPTUAL_DISTANCE = 0.15;
const LIGHT_SELECTION_OUTLINE_MIN_SATURATION = 0.35;
const LIGHT_SELECTION_OUTLINE_HUE_DRIFT = 20;
const LIGHT_SELECTION_OUTLINE_HUE_STEPS = 40;
const LIGHT_SELECTION_OUTLINE_LIGHTNESS_MIN = 0.08;
const LIGHT_SELECTION_OUTLINE_LIGHTNESS_MAX = 0.99;
const LIGHT_SELECTION_OUTLINE_LIGHTNESS_STEPS = 91;
const LIGHT_SELECTION_OUTLINE_SATURATION_STEPS = 40;

const backgroundIsDark = (background: RgbaColor): boolean =>
  relativeLuminance(background) < 0.35;

const selectionMinimumBackgroundContrast = (background: RgbaColor): number =>
  backgroundIsDark(background)
    ? SELECTION_DARK_BACKGROUND_CONTRAST
    : SELECTION_LIGHT_BACKGROUND_CONTRAST;

const selectionColorIsDistinct = (
  candidateValue: string,
  foregroundValue: string,
  backgroundValue: string
): boolean => {
  const candidate = parseCssColor(candidateValue);
  const foreground = parseCssColor(foregroundValue);
  const background = parseCssColor(backgroundValue);
  if (!candidate || !foreground || !background) return true;

  const visibleCandidate = compositeCssColorOver(candidate, background);
  const visibleForeground = compositeCssColorOver(foreground, background);
  if (
    contrastRatio(visibleCandidate, background) < selectionMinimumBackgroundContrast(background)
  ) {
    return false;
  }

  if (
    contrastRatio(visibleCandidate, visibleForeground) >=
    SELECTION_STRONG_LUMINANCE_SEPARATION
  ) {
    return true;
  }

  if (
    !backgroundIsDark(background) &&
    perceptualColorDistance(visibleCandidate, visibleForeground) <
      LIGHT_SELECTION_MIN_PERCEPTUAL_DISTANCE
  ) {
    return false;
  }

  const candidateHsl = rgbToHsl(visibleCandidate);
  const foregroundHsl = rgbToHsl(visibleForeground);
  if (candidateHsl.saturation < SELECTION_MIN_SATURATION) return false;
  if (foregroundHsl.saturation < FOREGROUND_CHROMATIC_SATURATION) return true;

  return hueDistance(candidateHsl.hue, foregroundHsl.hue) >= SELECTION_MIN_HUE_DISTANCE;
};

const deriveDistinctSelectionColor = (
  baseValue: string,
  foregroundValue: string,
  backgroundValue: string
): string => {
  const base = parseCssColor(baseValue);
  const foreground = parseCssColor(foregroundValue);
  const background = parseCssColor(backgroundValue);
  if (!base || !foreground || !background) return baseValue;

  const visibleBase = compositeCssColorOver(base, background);
  const visibleForeground = compositeCssColorOver(foreground, background);
  const baseHsl = rgbToHsl(visibleBase);
  const foregroundHsl = rgbToHsl(visibleForeground);
  const legacyAccent = parseCssColor(LEGACY_CANVAS_THEME.accent);
  const fallbackHue = legacyAccent ? rgbToHsl(legacyAccent).hue : 180;
  const darkBackground = backgroundIsDark(background);
  const hue = darkBackground
    ? foregroundHsl.saturation >= FOREGROUND_CHROMATIC_SATURATION
      ? (foregroundHsl.hue + 180) % 360
      : baseHsl.saturation >= 0.35
        ? baseHsl.hue
        : fallbackHue
    : baseHsl.saturation >= 0.35
      ? baseHsl.hue
      : foregroundHsl.saturation >= FOREGROUND_CHROMATIC_SATURATION
        ? (foregroundHsl.hue + 180) % 360
        : fallbackHue;
  const saturation = darkBackground
    ? Math.max(0.82, baseHsl.saturation)
    : LIGHT_SELECTION_VIVID_SATURATION;
  const initialLightness = darkBackground ? 0.68 : LIGHT_SELECTION_INITIAL_LIGHTNESS;
  const minimumContrast = selectionMinimumBackgroundContrast(background);

  for (let step = 0; step <= 42; step += 1) {
    const lightness = darkBackground
      ? Math.min(0.92, initialLightness + step * 0.01)
      : Math.max(0.08, initialLightness - step * 0.01);
    const candidate = hslToRgb({ hue, saturation, lightness });
    const hasBackgroundContrast = contrastRatio(candidate, background) >= minimumContrast;
    const hasForegroundSeparation = darkBackground ||
      perceptualColorDistance(candidate, visibleForeground) >=
        LIGHT_SELECTION_MIN_PERCEPTUAL_DISTANCE;
    if (hasBackgroundContrast && hasForegroundSeparation) {
      return formatAdjustedColor(candidate);
    }
  }

  return formatAdjustedColor(hslToRgb({ hue, saturation, lightness: initialLightness }));
};

/**
 * Keep Canvas selection theme-derived when the theme already separates it from
 * ordinary geometry. Dark backgrounds keep the established contrast-strengthening
 * path. Light backgrounds keep the existing theme-token selection policy, preserve
 * the chosen theme hue, and may change saturation/lightness until the selection is
 * perceptually separated from ordinary geometry as well as the Canvas background.
 */
const resolveSelectionColor = (
  seedValue: string,
  accentValue: string,
  foregroundValue: string,
  backgroundValue: string
): string => {
  const background = parseCssColor(backgroundValue);
  if (background && !backgroundIsDark(background)) {
    if (selectionColorIsDistinct(seedValue, foregroundValue, backgroundValue)) {
      return seedValue;
    }
    if (selectionColorIsDistinct(accentValue, foregroundValue, backgroundValue)) {
      return accentValue;
    }
    return deriveDistinctSelectionColor(accentValue, foregroundValue, backgroundValue);
  }

  const selection = strengthenContrast(seedValue, foregroundValue, backgroundValue, 4.5);
  if (selectionColorIsDistinct(selection, foregroundValue, backgroundValue)) {
    return selection;
  }
  if (selectionColorIsDistinct(accentValue, foregroundValue, backgroundValue)) {
    return accentValue;
  }
  return deriveDistinctSelectionColor(accentValue, foregroundValue, backgroundValue);
};

/**
 * Keep the light-theme module frame bright enough to read as an outline while
 * preserving the resolved selection's active-theme color family.
 */
const resolveSelectionOutlineColor = (
  selectionValue: string,
  foregroundValue: string,
  backgroundValue: string
): string => {
  const selection = parseCssColor(selectionValue);
  const foreground = parseCssColor(foregroundValue);
  const background = parseCssColor(backgroundValue);
  if (!selection || !foreground || !background || backgroundIsDark(background)) {
    return selectionValue;
  }

  const visibleSelection = compositeCssColorOver(selection, background);
  const visibleForeground = compositeCssColorOver(foreground, background);
  const selectionHsl = rgbToHsl(visibleSelection);
  const saturationCandidates = Array.from(
    { length: LIGHT_SELECTION_OUTLINE_SATURATION_STEPS + 1 },
    (_, index) => LIGHT_SELECTION_OUTLINE_MIN_SATURATION +
      (1 - LIGHT_SELECTION_OUTLINE_MIN_SATURATION) * index /
        LIGHT_SELECTION_OUTLINE_SATURATION_STEPS
  ).sort((first, second) =>
    Math.abs(first - selectionHsl.saturation) - Math.abs(second - selectionHsl.saturation)
  );
  const selectionLuminance = relativeLuminance(visibleSelection);
  let brightestCandidate: {
    color: RgbaColor;
    luminance: number;
    hueDrift: number;
    saturationDistance: number;
  } | null = null;

  for (let hueStep = 0; hueStep <= LIGHT_SELECTION_OUTLINE_HUE_STEPS; hueStep += 1) {
    const hueDrift = -LIGHT_SELECTION_OUTLINE_HUE_DRIFT +
      2 * LIGHT_SELECTION_OUTLINE_HUE_DRIFT * hueStep / LIGHT_SELECTION_OUTLINE_HUE_STEPS;
    for (
      let lightnessStep = 0;
      lightnessStep <= LIGHT_SELECTION_OUTLINE_LIGHTNESS_STEPS;
      lightnessStep += 1
    ) {
      const lightness = LIGHT_SELECTION_OUTLINE_LIGHTNESS_MIN +
        (LIGHT_SELECTION_OUTLINE_LIGHTNESS_MAX - LIGHT_SELECTION_OUTLINE_LIGHTNESS_MIN) *
          lightnessStep / LIGHT_SELECTION_OUTLINE_LIGHTNESS_STEPS;

      for (const saturation of saturationCandidates) {
        const candidate = hslToRgb({
          hue: selectionHsl.hue + hueDrift,
          saturation,
          lightness
        });
        const visibleCandidate = compositeCssColorOver(candidate, background);
        const luminance = relativeLuminance(visibleCandidate);
        if (
          contrastRatio(visibleCandidate, background) < LIGHT_SELECTION_OUTLINE_MIN_CONTRAST ||
          perceptualColorDistance(visibleCandidate, visibleForeground) <
            LIGHT_SELECTION_OUTLINE_MIN_PERCEPTUAL_DISTANCE ||
          luminance <= selectionLuminance
        ) {
          continue;
        }

        const candidateRecord = {
          color: candidate,
          luminance,
          hueDrift: Math.abs(hueDrift),
          saturationDistance: Math.abs(saturation - selectionHsl.saturation)
        };
        if (
          !brightestCandidate ||
          candidateRecord.luminance > brightestCandidate.luminance ||
          (candidateRecord.luminance === brightestCandidate.luminance &&
            (candidateRecord.hueDrift < brightestCandidate.hueDrift ||
              (candidateRecord.hueDrift === brightestCandidate.hueDrift &&
                candidateRecord.saturationDistance < brightestCandidate.saturationDistance)))
        ) {
          brightestCandidate = candidateRecord;
        }
      }
    }
  }

  return brightestCandidate ? formatAdjustedColor(brightestCandidate.color) : selectionValue;
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
  const selectionOutline = resolveSelectionOutlineColor(selection, foreground, background);

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
    selectionOutline,
    pickCandidate: accent
  };
};

export const readVSCodeCanvasTheme = (): CanvasTheme =>
  resolveVSCodeCanvasTheme(window.getComputedStyle(document.documentElement));
