import { commands, type CommandId } from "../commands/commands";
import { isCommandRibbonIconId, type CommandRibbonIconId } from "./commandRibbonIcons";
import {
  commandRibbonIconColors,
  commandRibbonIconSizes
} from "./commandRibbonVisuals";
import type {
  CommandRibbonIconColor,
  CommandRibbonIconSize
} from "./commandRibbonVisuals";

export {
  commandRibbonIconColors,
  commandRibbonIconColorLabels,
  commandRibbonIconColorValues,
  commandRibbonIconSizes
} from "./commandRibbonVisuals";
export type {
  CommandRibbonIconColor,
  CommandRibbonIconSize
} from "./commandRibbonVisuals";

const STORAGE_KEY = "nuinuiCAD.commandRibbonSettings.v1";

export type { CommandRibbonIconId };

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
  dock: "canvas" | "leftPanelBottom";
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
const SELECTION_ACTIONS_RIBBON_ID = "selection-actions";

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isCommandId = (value: unknown): value is CommandId =>
  typeof value === "string" && Object.hasOwn(commands, value);

const normalizeCanvasIdentityCommandId = (commandId: CommandId): CommandId =>
  commandId === "toggleCanvasElementNames" ? "toggleCanvasPointNames" : commandId;

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
      dock: "canvas",
      x: null,
      y: DEFAULT_RIBBON_Y,
      orientation: "horizontal",
      iconSize: DEFAULT_ICON_SIZE,
      buttons: [
        defaultButton("addFreePoint", "circle-dot", "点"),
        defaultButton("addOffsetPoint", "move-right", "オフセット点"),
        defaultButton("addPolarOffsetPoint", "slash", "極座標点"),
        defaultButton("addLine", "slash", "線"),
        defaultButton("addAngleLengthLine", "compass", "角度距離線"),
        defaultButton("addArcLine", "corner-down-right", "円弧"),
        defaultButton("addThreePointArcLine", "corner-down-right", "3点円弧"),
        defaultButton("addCornerRadiusArcLine", "corner-down-right", "角R"),
        defaultButton("addBezierCurve", "spline", "曲線"),
        defaultButton("addOffsetLine", "move-right", "オフセット線"),
        defaultButton("addSplitLine", "scissors", "分割線"),
        defaultButton("addCopyLine", "copy", "コピー線"),
        defaultButton("addSymmetricCopyLine", "flip-horizontal", "対称コピー")
      ]
    },
    {
      id: SELECTION_ACTIONS_RIBBON_ID,
      label: "選択操作",
      dock: "leftPanelBottom",
      x: 24,
      y: 72,
      orientation: "horizontal",
      iconSize: DEFAULT_ICON_SIZE,
      buttons: [
        defaultButton("moveSelectedElementUp", "arrow-up", "上へ"),
        defaultButton("moveSelectedElementDown", "arrow-down", "下へ"),
        defaultButton("duplicateSelectedElement", "copy", "複製"),
        defaultButton("setSelectedElementsVisible", "eye", "表示にする"),
        defaultButton("setSelectedElementsHidden", "eye-off", "非表示にする"),
        defaultButton("setSelectedElementsDisabled", "ban", "評価しない"),
        {
          ...defaultButton("deleteSelectedElement", "trash", "削除"),
          iconColor: "red"
        }
      ]
    }
  ]
});

const normalizeButton = (value: unknown): CommandRibbonButton | null => {
  if (!isObject(value) || !isCommandId(value.commandId)) return null;
  const commandId = normalizeCanvasIdentityCommandId(value.commandId);
  const rawId = typeof value.id === "string" && value.id.length > 0 ? value.id : value.commandId;
  return {
    id: rawId === "toggleCanvasElementNames" ? commandId : rawId,
    commandId,
    icon: isCommandRibbonIconId(value.icon) ? value.icon : "circle-dot",
    iconColor: normalizeIconColor(value.iconColor),
    label:
      typeof value.label === "string" && value.label.trim().length > 0
        ? value.label
        : commands[commandId].label,
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
    dock: value.dock === "leftPanelBottom" ? "leftPanelBottom" : "canvas",
    x: typeof value.x === "number" && Number.isFinite(value.x) ? clampCoordinate(value.x) : null,
    y: typeof value.y === "number" && Number.isFinite(value.y) ? clampCoordinate(value.y) : DEFAULT_RIBBON_Y,
    orientation: value.orientation === "vertical" ? "vertical" : "horizontal",
    iconSize: normalizeIconSize(value.iconSize),
    buttons
  };
};

export const normalizeCommandRibbonSettings = (value: unknown): CommandRibbonSettings => {
  if (!isObject(value) || !Array.isArray(value.ribbons)) return defaultCommandRibbonSettings();
  const hasDockField = value.ribbons.some(
    (ribbon) => isObject(ribbon) && typeof ribbon.dock === "string"
  );
  const ribbons = value.ribbons
    .map(normalizeRibbon)
    .filter((ribbon): ribbon is CommandRibbon => Boolean(ribbon));
  if (ribbons.length === 0) return defaultCommandRibbonSettings();
  if (!hasDockField && !ribbons.some((ribbon) => ribbon.id === SELECTION_ACTIONS_RIBBON_ID)) {
    const selectionActionsRibbon = defaultCommandRibbonSettings().ribbons.find(
      (ribbon) => ribbon.id === SELECTION_ACTIONS_RIBBON_ID
    );
    return {
      version: 1,
      ribbons: selectionActionsRibbon ? [...ribbons, selectionActionsRibbon] : ribbons
    };
  }
  return { version: 1, ribbons };
};

export const loadCommandRibbonSettings = async (): Promise<CommandRibbonSettings> => {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultCommandRibbonSettings();
  try {
    return normalizeCommandRibbonSettings(JSON.parse(raw));
  } catch {
    return defaultCommandRibbonSettings();
  }
};

export const saveCommandRibbonSettings = async (settings: CommandRibbonSettings) => {
  const normalized = normalizeCommandRibbonSettings(settings);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
};
