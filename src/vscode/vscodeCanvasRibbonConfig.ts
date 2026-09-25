import type { RibbonPosition } from "../components/commandRibbonFloatingGeometry";
import type { VscodeLucideIconName } from "./vscodeCanvasRibbonIcons";

export const VSCODE_CANVAS_RIBBON_ICON_SIZE = 16;
export const VSCODE_CANVAS_RIBBON_MARGIN = 8;
export const VSCODE_CANVAS_RIBBON_GAP = 8;

export const vscodeCanvasRibbonIds = ["viewport", "display", "grid"] as const;
export type VscodeCanvasRibbonId = (typeof vscodeCanvasRibbonIds)[number];

export type VscodeCanvasRibbonCommandId =
  | "zoomOutCanvas"
  | "zoomInCanvas"
  | "resetCanvasView"
  | "fitDrawing"
  | "toggleCanvasPoints"
  | "toggleCanvasPointNames"
  | "toggleCanvasGeometryNames"
  | "toggleCanvasGrid"
  | "configureCanvasGrid"
  | "toggleCanvasGridSnap";

export type VscodeCanvasRibbonCommandItem = {
  id: string;
  type: "command";
  commandId: VscodeCanvasRibbonCommandId;
  icon: VscodeLucideIconName;
  showLabel: boolean;
};

export type VscodeCanvasRibbonValueItem = {
  id: string;
  type: "value";
  valueId: "canvasStatus" | "canvasGridSettings";
};

export type VscodeCanvasRibbonItem =
  | VscodeCanvasRibbonCommandItem
  | VscodeCanvasRibbonValueItem;

export type VscodeCanvasRibbonDefinition = {
  id: VscodeCanvasRibbonId;
  labelKey: `canvas.ribbon.${VscodeCanvasRibbonId}`;
  label: string;
  orientation: "horizontal";
  items: readonly VscodeCanvasRibbonItem[];
};

const command = (
  id: string,
  commandId: VscodeCanvasRibbonCommandId,
  icon: VscodeLucideIconName,
  showLabel = false
): VscodeCanvasRibbonCommandItem => ({ id, type: "command", commandId, icon, showLabel });

const value = (
  id: string,
  valueId: VscodeCanvasRibbonValueItem["valueId"]
): VscodeCanvasRibbonValueItem => ({ id, type: "value", valueId });

export const vscodeCanvasRibbonDefinitions: readonly VscodeCanvasRibbonDefinition[] = [
  {
    id: "viewport",
    labelKey: "canvas.ribbon.viewport",
    label: "Viewport",
    orientation: "horizontal",
    items: [
      command("zoom-out", "zoomOutCanvas", "minus"),
      value("canvas-status", "canvasStatus"),
      command("zoom-in", "zoomInCanvas", "plus"),
      command("reset-view", "resetCanvasView", "rotate-ccw"),
      command("fit-drawing", "fitDrawing", "maximize")
    ]
  },
  {
    id: "display",
    labelKey: "canvas.ribbon.display",
    label: "Display",
    orientation: "horizontal",
    items: [
      command("points", "toggleCanvasPoints", "circle-dot"),
      command("point-names", "toggleCanvasPointNames", "tag", true),
      command("geometry-names", "toggleCanvasGeometryNames", "tag", true)
    ]
  },
  {
    id: "grid",
    labelKey: "canvas.ribbon.grid",
    label: "Grid",
    orientation: "horizontal",
    items: [
      command("grid", "toggleCanvasGrid", "grid-3x3"),
      value("grid-settings", "canvasGridSettings"),
      command("grid-snap", "toggleCanvasGridSnap", "magnet")
    ]
  }
];

export type VscodeCanvasRibbonPositions = Partial<Record<VscodeCanvasRibbonId, RibbonPosition>>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const isVscodeCanvasRibbonId = (value: unknown): value is VscodeCanvasRibbonId =>
  typeof value === "string" && (vscodeCanvasRibbonIds as readonly string[]).includes(value);

/** Accept valid fixed-ID coordinates independently; invalid entries use layout defaults. */
export const normalizeVscodeCanvasRibbonPositions = (
  value: unknown
): VscodeCanvasRibbonPositions => {
  if (!isRecord(value)) return {};
  const positions: VscodeCanvasRibbonPositions = {};
  for (const ribbonId of vscodeCanvasRibbonIds) {
    const candidate = value[ribbonId];
    if (!isRecord(candidate)) continue;
    const { x, y } = candidate;
    if (typeof x !== "number" || !Number.isFinite(x) || typeof y !== "number" || !Number.isFinite(y)) continue;
    positions[ribbonId] = { x, y };
  }
  return positions;
};

export const patchVscodeCanvasRibbonPosition = (
  value: unknown,
  ribbonId: unknown,
  position: RibbonPosition
): VscodeCanvasRibbonPositions | null => {
  if (
    !isVscodeCanvasRibbonId(ribbonId) ||
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y)
  ) return null;
  return { ...normalizeVscodeCanvasRibbonPositions(value), [ribbonId]: { x: position.x, y: position.y } };
};
