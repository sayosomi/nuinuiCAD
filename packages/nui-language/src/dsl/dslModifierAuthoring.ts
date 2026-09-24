import type {
  DrawingModifierFill,
  DrawingModifierStrokeColor,
  DrawingModifierStrokeStyle
} from "../types/geometry";
import type { DslSpan } from "./dslTypes";
import { choiceAfterStep, stepDslNumericLiteral, type DslValueStepDirection } from "./dslValueStep";

export const modifierPropertySchema = [
  { key: "visible", kind: "choice", options: ["true", "false"] },
  { key: "width", kind: "numeric", unit: "px", step: 0.1, options: ["0.5px", "1px", "1.5px", "2px"] },
  { key: "lineType", kind: "choice", options: ["solid", "dashed", "dotted"] },
  { key: "color", kind: "color", options: ["foreground", "muted", "accent", "info", "warning", "error"] },
  { key: "fill", kind: "color", options: ["foreground", "muted", "accent", "info", "warning", "error", "none"] },
  { key: "fillOpacity", kind: "numeric", step: 0.1, options: ["0", "0.25", "0.5", "0.75", "1"] }
] as const;

export type ModifierPropertyKey = (typeof modifierPropertySchema)[number]["key"];
export type ModifierAuthoringTokenKind = "value" | "width" | "unit" | "style" | "themeRole" | "fixedColor";
export type ModifierAuthoringToken = { kind: ModifierAuthoringTokenKind; span: DslSpan };
export type ModifierValueParseFailure = { message: string; code: string };

export const modifierPropertyMetadata = (key: string) =>
  modifierPropertySchema.find((property) => property.key === key) ?? null;

const styles = new Set<DrawingModifierStrokeStyle>(["solid", "dashed", "dotted"]);
const themeRoles = new Set(["foreground", "muted", "accent", "info", "warning", "error"] as const);
const fixedColor = /^#[0-9a-fA-F]{6}$/;

export const parseModifierWidthValue = (value: string): { value: number } | ModifierValueParseFailure => {
  const match = value.trim().match(/^(\d+(?:\.\d*)?|\.\d+)px$/);
  const width = match ? Number(match[1]) : NaN;
  return match && Number.isFinite(width) && width > 0
    ? { value: width }
    : { message: "style の width は正の有限な10進数pxリテラルで指定してください(例: 1.5px)。", code: "style-width-invalid" };
};

export const parseModifierLineTypeValue = (value: string): { value: DrawingModifierStrokeStyle } | ModifierValueParseFailure =>
  styles.has(value as DrawingModifierStrokeStyle)
    ? { value: value as DrawingModifierStrokeStyle }
    : { message: "style の lineType は solid / dashed / dotted のいずれかで指定してください。", code: "style-line-type-invalid" };

export const parseModifierVisibleValue = (value: string): { value: boolean } | ModifierValueParseFailure =>
  value === "true" ? { value: true } : value === "false"
    ? { value: false }
    : { message: "style の visible は true / false のいずれかで指定してください。", code: "style-visible-invalid" };

export const parseModifierColorValue = (value: string): { value: DrawingModifierStrokeColor } | ModifierValueParseFailure => {
  if (themeRoles.has(value as never)) return { value: { kind: "themeRole", role: value as DrawingModifierStrokeColor & { role: never }["role"] } };
  if (value.startsWith("#")) {
    return fixedColor.test(value)
      ? { value: { kind: "fixed", hex: value.toLowerCase() } }
      : { message: "style の color 固定色は #RRGGBB の形式で指定してください。", code: "style-color-fixed-invalid" };
  }
  return { message: "style の color は foreground / muted / accent / info / warning / error または #RRGGBB で指定してください。", code: "style-color-invalid" };
};

export const parseModifierFillValue = (value: string): { value: DrawingModifierFill } | ModifierValueParseFailure => {
  if (value === "none") return { value: { kind: "none" } };
  const parsed = parseModifierColorValue(value);
  return "message" in parsed
    ? { message: "style の fill は foreground / muted / accent / info / warning / error、#RRGGBB、または none で指定してください。", code: "style-fill-invalid" }
    : { value: parsed.value };
};

const decimalNumber = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export const parseModifierFillOpacityValue = (value: string): { value: number } | ModifierValueParseFailure => {
  const text = value.trim();
  const opacity = Number(text);
  if (!decimalNumber.test(text) || !Number.isFinite(opacity)) {
    return { message: "style の fillOpacity は有限な数値で指定してください。", code: "style-fill-opacity-invalid-number" };
  }
  if (opacity < 0 || opacity > 1) {
    return { message: "style の fillOpacity は 0 以上 1 以下で指定してください。", code: "style-fill-opacity-out-of-range" };
  }
  return { value: opacity };
};

/** Exact logical sub-token spans; the strict parser and editor queries share this owner. */
export const modifierPropertyAuthoringTokens = (key: string, value: string, valueSpan: DslSpan): readonly ModifierAuthoringToken[] => {
  const leading = value.search(/\S/);
  if (leading < 0) return [];
  const start = valueSpan.start + leading;
  const trimmed = value.trim();
  if (key === "width") {
    const match = trimmed.match(/^(\d+(?:\.\d*)?|\.\d+)(px)$/);
    return match ? [
      { kind: "width", span: { start, end: start + match[1]!.length } },
      { kind: "unit", span: { start: start + match[1]!.length, end: start + trimmed.length } }
    ] : [];
  }
  if (key === "lineType") return [{ kind: "style", span: { start, end: start + trimmed.length } }];
  if (key === "color" || key === "fill") {
    return [{ kind: trimmed.startsWith("#") ? "fixedColor" : trimmed === "none" ? "value" : "themeRole", span: { start, end: start + trimmed.length } }];
  }
  if (key === "visible") return [{ kind: "value", span: { start, end: start + trimmed.length } }];
  if (key === "fillOpacity") return [{ kind: "value", span: { start, end: start + trimmed.length } }];
  return [];
};

export type ModifierValueStepResult = {
  insert: string;
};

/** Steps one parser/index-owned style sub-token using the shared property metadata. */
export const resolveModifierValueStep = (
  key: string,
  tokenKind: ModifierAuthoringTokenKind,
  value: string,
  direction: DslValueStepDirection
): ModifierValueStepResult | null => {
  const metadata = modifierPropertyMetadata(key);
  if (!metadata || tokenKind === "fixedColor" || tokenKind === "unit") return null;

  if (key === "width" && metadata.kind === "numeric" && tokenKind === "width") {
    const insert = stepDslNumericLiteral(value, metadata.step, direction);
    if (insert === null || insert === value || "message" in parseModifierWidthValue(`${insert}px`)) return null;
    return { insert };
  }

  if (key === "fillOpacity" && metadata.kind === "numeric" && tokenKind === "value") {
    const insert = stepDslNumericLiteral(value, metadata.step, direction);
    if (insert === null || insert === value || "message" in parseModifierFillOpacityValue(insert)) return null;
    return { insert };
  }

  if (
    metadata.kind === "choice" &&
    ((key === "visible" && tokenKind === "value") || (key === "lineType" && tokenKind === "style"))
  ) {
    const insert = choiceAfterStep(value, metadata.options, direction);
    return insert && insert !== value ? { insert } : null;
  }

  if ((key === "color" || key === "fill") && metadata.kind === "color" && tokenKind === "themeRole") {
    const insert = choiceAfterStep(value, metadata.options, direction);
    return insert && insert !== value ? { insert } : null;
  }
  return null;
};
