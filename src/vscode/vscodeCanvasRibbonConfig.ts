export const VSCODE_CANVAS_RIBBON_SETTING = "nuinuiCAD.canvasRibbon.ribbons";

export const VSCODE_CANVAS_RIBBON_DEFAULT_Y = 12;
export const VSCODE_CANVAS_RIBBON_DEFAULT_ICON_SIZE = 16;

export type VscodeCanvasRibbonOrientation = "horizontal" | "vertical";

export type VscodeCanvasRibbonCommandItem = {
  id: string;
  type: "command";
  commandId: string;
  icon: string;
  iconColor?: string;
  label?: string;
  showLabel: boolean;
};

export type VscodeCanvasRibbonValueItem = {
  id: string;
  type: "value";
  valueId: "canvasZoom";
  label?: string;
};

export type VscodeCanvasRibbonItem =
  | VscodeCanvasRibbonCommandItem
  | VscodeCanvasRibbonValueItem;

export type VscodeCanvasRibbon = {
  id: string;
  label: string;
  x: number | null;
  y: number;
  orientation: VscodeCanvasRibbonOrientation;
  iconSize: number;
  items: VscodeCanvasRibbonItem[];
};

export const defaultVscodeCanvasRibbons = (): VscodeCanvasRibbon[] => [
  {
    id: "canvas-ribbon",
    label: "Canvas Ribbon",
    x: null,
    y: VSCODE_CANVAS_RIBBON_DEFAULT_Y,
    orientation: "horizontal",
    iconSize: VSCODE_CANVAS_RIBBON_DEFAULT_ICON_SIZE,
    items: [
      {
        id: "editCanvasRibbon",
        type: "command",
        commandId: "editCanvasRibbon",
        icon: "settings-2",
        showLabel: false
      }
    ]
  }
];

const VSCODE_CANVAS_RIBBON_MIN_ICON_SIZE = 10;
const VSCODE_CANVAS_RIBBON_MAX_ICON_SIZE = 48;
export const VSCODE_CANVAS_RIBBON_SAFE_ICON_COLOR = "currentColor";

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const nonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const finiteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const normalizeCoordinate = (value: unknown, fallback: number | null): number | null => {
  const coordinate = finiteNumber(value);
  return coordinate === null ? fallback : Math.round(coordinate);
};

const normalizeIconSize = (value: unknown): number => {
  const size = finiteNumber(value);
  return size !== null && size >= VSCODE_CANVAS_RIBBON_MIN_ICON_SIZE && size <= VSCODE_CANVAS_RIBBON_MAX_ICON_SIZE
    ? Math.round(size)
    : VSCODE_CANVAS_RIBBON_DEFAULT_ICON_SIZE;
};

const isSafeIconColor = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const color = value.trim();
  if (color.length === 0 || color.length > 100) return false;
  return /^#[0-9a-f]{3,8}$/i.test(color) ||
    /^(?:rgb|rgba|hsl|hsla)\([^()]{1,80}\)$/i.test(color) ||
    /^var\(--[a-z0-9-]+\)$/i.test(color) ||
    /^(?:currentColor|transparent|black|white|red|green|blue|teal|orange|purple|pink|yellow|gray|grey)$/i.test(color);
};

const normalizeIconColor = (value: unknown): string =>
  isSafeIconColor(value) ? value.trim() : VSCODE_CANVAS_RIBBON_SAFE_ICON_COLOR;

const normalizeCommandItem = (value: unknown): VscodeCanvasRibbonCommandItem | null => {
  if (!isObject(value)) return null;
  const id = nonEmptyString(value.id);
  const commandId = nonEmptyString(value.commandId);
  if (id === null || commandId === null || value.type !== "command") return null;
  const icon = nonEmptyString(value.icon) ?? "circle";
  const label = nonEmptyString(value.label);
  return {
    id,
    type: "command",
    commandId,
    icon,
    iconColor: normalizeIconColor(value.iconColor),
    ...(label ? { label } : {}),
    showLabel: value.showLabel === true
  };
};

const normalizeValueItem = (value: unknown): VscodeCanvasRibbonValueItem | null => {
  if (!isObject(value)) return null;
  const id = nonEmptyString(value.id);
  if (id === null || value.type !== "value" || value.valueId !== "canvasZoom") return null;
  const label = nonEmptyString(value.label);
  return {
    id,
    type: "value",
    valueId: "canvasZoom",
    ...(label ? { label } : {})
  };
};

const normalizeItem = (value: unknown): VscodeCanvasRibbonItem | null => {
  if (!isObject(value)) return null;
  return value.type === "command" ? normalizeCommandItem(value) : normalizeValueItem(value);
};

const normalizeRibbon = (value: unknown): VscodeCanvasRibbon | null => {
  if (!isObject(value) || !Array.isArray(value.items)) return null;
  const id = nonEmptyString(value.id);
  if (id === null) return null;
  const items: VscodeCanvasRibbonItem[] = [];
  const itemIds = new Set<string>();
  for (const rawItem of value.items) {
    const item = normalizeItem(rawItem);
    if (!item || itemIds.has(item.id)) continue;
    itemIds.add(item.id);
    items.push(item);
  }
  const label = nonEmptyString(value.label) ?? id;
  return {
    id,
    label,
    x: normalizeCoordinate(value.x, null),
    y: normalizeCoordinate(value.y, VSCODE_CANVAS_RIBBON_DEFAULT_Y) ?? VSCODE_CANVAS_RIBBON_DEFAULT_Y,
    orientation: value.orientation === "vertical" ? "vertical" : "horizontal",
    iconSize: normalizeIconSize(value.iconSize),
    items
  };
};

/**
 * Normalize the VS Code setting independently from the Tauri settings model.
 * An explicit empty array is intentional and must not trigger a default.
 */
export const normalizeVscodeCanvasRibbons = (value: unknown): VscodeCanvasRibbon[] => {
  if (!Array.isArray(value)) return defaultVscodeCanvasRibbons();
  const ribbons: VscodeCanvasRibbon[] = [];
  const ribbonIds = new Set<string>();
  for (const rawRibbon of value) {
    const ribbon = normalizeRibbon(rawRibbon);
    if (!ribbon || ribbonIds.has(ribbon.id)) continue;
    ribbonIds.add(ribbon.id);
    ribbons.push(ribbon);
  }
  return ribbons;
};

export const patchVscodeCanvasRibbonPosition = (
  value: unknown,
  ribbonId: string,
  x: number,
  y: number
): VscodeCanvasRibbon[] | null => {
  if (!ribbonId || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const ribbons = normalizeVscodeCanvasRibbons(value);
  if (!ribbons.some((ribbon) => ribbon.id === ribbonId)) return null;
  return ribbons.map((ribbon) => ribbon.id === ribbonId ? { ...ribbon, x: Math.round(x), y: Math.round(y) } : ribbon);
};
