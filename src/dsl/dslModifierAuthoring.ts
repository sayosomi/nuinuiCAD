import type { DrawingModifierStrokeColor, DrawingModifierStrokeStyle, DrawingModifierState } from "../types/geometry";
import type { DslSpan } from "./dslTypes";
import { choiceAfterStep, stepDslNumericLiteral, type DslValueStepDirection } from "./dslValueStep";

export const modifierPropertySchema = [
  { key: "state", kind: "choice", options: ["visible", "hidden", "disabled"] },
  { key: "width", kind: "numeric", unit: "px", step: 0.1, options: ["0.5px", "1px", "1.5px", "2px"] },
  { key: "style", kind: "choice", options: ["solid", "dashed", "dotted"] },
  { key: "color", kind: "color", options: ["foreground", "muted", "accent", "info", "warning", "error"] }
] as const;

export type ModifierPropertyKey = (typeof modifierPropertySchema)[number]["key"];
export type ModifierAuthoringTokenKind = "value" | "width" | "unit" | "style" | "themeRole" | "fixedColor";
export type ModifierAuthoringToken = { kind: ModifierAuthoringTokenKind; span: DslSpan };

export const modifierPropertyMetadata = (key: string) =>
  modifierPropertySchema.find((property) => property.key === key) ?? null;

const stateValues = new Set<DrawingModifierState>(["visible", "hidden", "disabled"]);
const styles = new Set<DrawingModifierStrokeStyle>(["solid", "dashed", "dotted"]);
const themeRoles = new Set(["foreground", "muted", "accent", "info", "warning", "error"] as const);
const fixedColor = /^#[0-9a-fA-F]{6}$/;

export const parseModifierWidthValue = (value: string): { value: number } | { message: string } => {
  const match = value.trim().match(/^(\d+(?:\.\d*)?|\.\d+)px$/);
  const width = match ? Number(match[1]) : NaN;
  return match && Number.isFinite(width) && width > 0
    ? { value: width }
    : { message: "modifier の width は正の有限な10進数pxリテラルで指定してください(例: 1.5px)。" };
};

export const parseModifierStyleValue = (value: string): { value: DrawingModifierStrokeStyle } | { message: string } =>
  styles.has(value as DrawingModifierStrokeStyle)
    ? { value: value as DrawingModifierStrokeStyle }
    : { message: "modifier の style は solid / dashed / dotted のいずれかで指定してください。" };

export const parseModifierColorValue = (value: string): { value: DrawingModifierStrokeColor } | { message: string } => {
  if (themeRoles.has(value as never)) return { value: { kind: "themeRole", role: value as DrawingModifierStrokeColor & { role: never }["role"] } };
  if (value.startsWith("#")) {
    return fixedColor.test(value)
      ? { value: { kind: "fixed", hex: value.toLowerCase() } }
      : { message: "modifier の color 固定色は #RRGGBB の形式で指定してください。" };
  }
  return { message: "modifier の color は foreground / muted / accent / info / warning / error または #RRGGBB で指定してください。" };
};

export const isModifierStateValue = (value: string): value is DrawingModifierState => stateValues.has(value as DrawingModifierState);

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
  if (key === "style") return [{ kind: "style", span: { start, end: start + trimmed.length } }];
  if (key === "color") return [{ kind: trimmed.startsWith("#") ? "fixedColor" : "themeRole", span: { start, end: start + trimmed.length } }];
  if (key === "state") return [{ kind: "value", span: { start, end: start + trimmed.length } }];
  return [];
};

export type ModifierValueStepResult = {
  insert: string;
};

/** Steps one parser/index-owned modifier sub-token using the shared property metadata. */
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
    if (insert === null || insert === value || "message" in parseModifierWidthValue(`${insert}${metadata.unit}`)) return null;
    return { insert };
  }

  if (
    metadata.kind === "choice" &&
    ((key === "state" && tokenKind === "value") || (key === "style" && tokenKind === "style"))
  ) {
    const insert = choiceAfterStep(value, metadata.options, direction);
    return insert && insert !== value ? { insert } : null;
  }

  if (key === "color" && metadata.kind === "color" && tokenKind === "themeRole") {
    const insert = choiceAfterStep(value, metadata.options, direction);
    return insert && insert !== value ? { insert } : null;
  }
  return null;
};
