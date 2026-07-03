import { invoke } from "@tauri-apps/api/core";
import { commands, type CommandId } from "../commands/commands";
import { isTauriRuntime } from "../geometry/evaluationEngine";
import { isCommandRibbonIconId, type CommandRibbonIconId } from "./commandRibbonIcons";

const STORAGE_KEY = "nuinuiCAD.commandRibbonSettings.v1";

export type { CommandRibbonIconId };

export const commandRibbonIconSizes = [14, 16, 18, 20, 24] as const;

export type CommandRibbonIconSize = (typeof commandRibbonIconSizes)[number];

export const commandRibbonIconColors = [
  "default",
  "teal",
  "blue",
  "green",
  "amber",
  "orange",
  "red",
  "pink",
  "purple",
  "slate"
] as const;

export type CommandRibbonIconColor = (typeof commandRibbonIconColors)[number];

export const commandRibbonIconColorLabels: Record<CommandRibbonIconColor, string> = {
  default: "標準",
  teal: "青緑",
  blue: "青",
  green: "緑",
  amber: "黄",
  orange: "橙",
  red: "赤",
  pink: "桃",
  purple: "紫",
  slate: "灰"
};

export const commandRibbonIconColorValues: Record<CommandRibbonIconColor, string> = {
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
};

export type CommandRibbonButton = {
  id: string;
  commandId: CommandId;
  icon: CommandRibbonIconId;
  iconColor: CommandRibbonIconColor;
  label: string;
  showLabel: boolean;
};

export type CommandRibbon = {
  id: string;
  label: string;
  x: number | null;
  y: number;
  orientation: "horizontal" | "vertical";
  iconSize: CommandRibbonIconSize;
  buttons: CommandRibbonButton[];
};

export type CommandRibbonSettings = {
  version: 1;
  ribbons: CommandRibbon[];
};

const DEFAULT_RIBBON_Y = 12;
const DEFAULT_ICON_SIZE: CommandRibbonIconSize = 16;
const MIN_RIBBON_COORDINATE = 0;
const MAX_RIBBON_COORDINATE = 10000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isCommandId = (value: unknown): value is CommandId =>
  typeof value === "string" && Object.hasOwn(commands, value);

const clampCoordinate = (value: number) =>
  Math.min(Math.max(Math.round(value), MIN_RIBBON_COORDINATE), MAX_RIBBON_COORDINATE);

const normalizeIconSize = (value: unknown): CommandRibbonIconSize =>
  typeof value === "number" && (commandRibbonIconSizes as readonly number[]).includes(value)
    ? (value as CommandRibbonIconSize)
    : DEFAULT_ICON_SIZE;

const normalizeIconColor = (value: unknown): CommandRibbonIconColor =>
  typeof value === "string" && (commandRibbonIconColors as readonly string[]).includes(value)
    ? (value as CommandRibbonIconColor)
    : "default";

const defaultButton = (
  commandId: CommandId,
  icon: CommandRibbonIconId,
  label?: string
): CommandRibbonButton => ({
  id: commandId,
  commandId,
  icon,
  iconColor: "default",
  label: label ?? commands[commandId].label,
  showLabel: false
});

export const defaultCommandRibbonSettings = (): CommandRibbonSettings => ({
  version: 1,
  ribbons: [
    {
      id: "drafting",
      label: "作図",
      x: null,
      y: DEFAULT_RIBBON_Y,
      orientation: "horizontal",
      iconSize: DEFAULT_ICON_SIZE,
      buttons: [
        defaultButton("addFreePoint", "circle-dot", "点"),
        defaultButton("addOffsetPoint", "move-right", "オフセット点"),
        defaultButton("addPolarOffsetPoint", "slash", "極座標点"),
        defaultButton("addLine", "slash", "線"),
        defaultButton("addArcLine", "corner-down-right", "円弧"),
        defaultButton("addThreePointArcLine", "corner-down-right", "3点円弧"),
        defaultButton("addCornerRadiusArcLine", "corner-down-right", "角R"),
        defaultButton("addBezierCurve", "spline", "曲線"),
        defaultButton("addOffsetLine", "move-right", "オフセット線"),
        defaultButton("addSplitLine", "scissors", "分割線"),
        defaultButton("addCopyLine", "copy", "コピー線"),
        defaultButton("addSymmetricCopyLine", "flip-horizontal", "対称コピー")
      ]
    }
  ]
});

const normalizeButton = (value: unknown): CommandRibbonButton | null => {
  if (!isObject(value) || !isCommandId(value.commandId)) return null;
  return {
    id: typeof value.id === "string" && value.id.length > 0 ? value.id : value.commandId,
    commandId: value.commandId,
    icon: isCommandRibbonIconId(value.icon) ? value.icon : "circle-dot",
    iconColor: normalizeIconColor(value.iconColor),
    label:
      typeof value.label === "string" && value.label.trim().length > 0
        ? value.label
        : commands[value.commandId].label,
    showLabel: value.showLabel === true
  };
};

const normalizeRibbon = (value: unknown): CommandRibbon | null => {
  if (!isObject(value) || !Array.isArray(value.buttons)) return null;
  const buttons = value.buttons
    .map(normalizeButton)
    .filter((button): button is CommandRibbonButton => Boolean(button));
  if (buttons.length === 0) return null;

  return {
    id: typeof value.id === "string" && value.id.length > 0 ? value.id : "ribbon",
    label: typeof value.label === "string" && value.label.length > 0 ? value.label : "リボン",
    x: typeof value.x === "number" && Number.isFinite(value.x) ? clampCoordinate(value.x) : null,
    y: typeof value.y === "number" && Number.isFinite(value.y) ? clampCoordinate(value.y) : DEFAULT_RIBBON_Y,
    orientation: value.orientation === "vertical" ? "vertical" : "horizontal",
    iconSize: normalizeIconSize(value.iconSize),
    buttons
  };
};

export const normalizeCommandRibbonSettings = (value: unknown): CommandRibbonSettings => {
  if (!isObject(value) || !Array.isArray(value.ribbons)) return defaultCommandRibbonSettings();
  const ribbons = value.ribbons
    .map(normalizeRibbon)
    .filter((ribbon): ribbon is CommandRibbon => Boolean(ribbon));
  return ribbons.length > 0 ? { version: 1, ribbons } : defaultCommandRibbonSettings();
};

const loadCommandRibbonSettingsFromLocalStorage = () => {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultCommandRibbonSettings();
  try {
    return normalizeCommandRibbonSettings(JSON.parse(raw));
  } catch {
    return defaultCommandRibbonSettings();
  }
};

const saveCommandRibbonSettingsToLocalStorage = (settings: CommandRibbonSettings) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
};

export const loadCommandRibbonSettings = async (): Promise<CommandRibbonSettings> => {
  if (!isTauriRuntime()) return loadCommandRibbonSettingsFromLocalStorage();
  const settings = await invoke<unknown>("load_command_ribbon_settings");
  return normalizeCommandRibbonSettings(settings);
};

export const saveCommandRibbonSettings = async (settings: CommandRibbonSettings) => {
  const normalized = normalizeCommandRibbonSettings(settings);
  if (!isTauriRuntime()) {
    saveCommandRibbonSettingsToLocalStorage(normalized);
    return;
  }
  await invoke<void>("save_command_ribbon_settings", { input: normalized });
};
