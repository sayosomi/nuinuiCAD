export const VSCODE_CANVAS_RIBBON_SETTING = "nuinuiCAD.canvasRibbon.ribbons";

export const VSCODE_CANVAS_RIBBON_DEFAULT_Y = 12;
export const VSCODE_CANVAS_RIBBON_ICON_SIZE = 16;

export type VscodeCanvasRibbonOrientation = "horizontal" | "vertical";

export type VscodeCanvasRibbonCommandItem = {
  id: string;
  type: "command";
  commandId: string;
  icon: string;
  showLabel: boolean;
};

export type VscodeCanvasRibbonValueItem = {
  id: string;
  type: "value";
  valueId: "canvasZoom";
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
  items: VscodeCanvasRibbonItem[];
};

export const defaultVscodeCanvasRibbons = (): VscodeCanvasRibbon[] => [
  {
    id: "canvas-ribbon",
    label: "Canvas Ribbon",
    x: null,
    y: VSCODE_CANVAS_RIBBON_DEFAULT_Y,
    orientation: "horizontal",
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

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const nonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const normalizeCanvasRibbonCommandId = (commandId: string): string =>
  commandId === "toggleCanvasElementNames" ? "toggleCanvasPointNames" : commandId;

const finiteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const normalizeCoordinate = (value: unknown, fallback: number | null): number | null => {
  const coordinate = finiteNumber(value);
  return coordinate === null ? fallback : Math.round(coordinate);
};

const normalizeCommandItem = (value: unknown): VscodeCanvasRibbonCommandItem | null => {
  if (!isObject(value)) return null;
  const id = nonEmptyString(value.id);
  const commandId = nonEmptyString(value.commandId);
  if (id === null || commandId === null || value.type !== "command") return null;
  const normalizedCommandId = normalizeCanvasRibbonCommandId(commandId);
  const icon = nonEmptyString(value.icon) ?? "circle";
  return {
    id: id === commandId && commandId === "toggleCanvasElementNames" ? normalizedCommandId : id,
    type: "command",
    commandId: normalizedCommandId,
    icon,
    showLabel: value.showLabel === true
  };
};

const normalizeValueItem = (value: unknown): VscodeCanvasRibbonValueItem | null => {
  if (!isObject(value)) return null;
  const id = nonEmptyString(value.id);
  if (id === null || value.type !== "value" || value.valueId !== "canvasZoom") return null;
  return {
    id,
    type: "value",
    valueId: "canvasZoom"
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
    items
  };
};

/**
 * Normalize the VS Code setting independently from the legacy host settings model.
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
): unknown[] | null => {
  if (typeof ribbonId !== "string" || ribbonId.trim().length === 0 || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (!Array.isArray(value)) return null;

  const normalizedRibbonId = ribbonId.trim();
  const ownerIndex = value.findIndex((ribbon) =>
    isObject(ribbon) &&
    Array.isArray(ribbon.items) &&
    nonEmptyString(ribbon.id) === normalizedRibbonId
  );
  if (ownerIndex < 0) return null;

  return value.map((ribbon, index) =>
    index === ownerIndex && isObject(ribbon)
      ? { ...ribbon, x, y }
      : ribbon
  );
};
