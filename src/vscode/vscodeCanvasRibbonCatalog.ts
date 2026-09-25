import { selectionCommandDefinitions } from "../commands/selectionCommandDefinitions";
import { viewModeCommandDefinitions } from "../commands/viewModeCommandDefinitions";
import type { CommandId } from "../commands/commandTypes";
import type { CanvasModalMode } from "./pickModeCanvasPolicy";
import type { VscodeLucideIconName } from "./vscodeCanvasRibbonIcons";
import type { VscodeCanvasRibbonCommandId } from "./vscodeCanvasRibbonConfig";

export const vscodeCanvasRibbonCommandIds: readonly VscodeCanvasRibbonCommandId[] = [
  "zoomOutCanvas",
  "zoomInCanvas",
  "resetCanvasView",
  "fitDrawing",
  "toggleCanvasPoints",
  "toggleCanvasPointNames",
  "toggleCanvasGeometryNames",
  "toggleCanvasGrid",
  "configureCanvasGrid",
  "toggleCanvasGridSnap"
];

export type VscodeCanvasRibbonCommandContext = {
  showCanvasPointNames: boolean;
  showCanvasGeometryNames: boolean;
  showCanvasPoints: boolean;
  canvasGridEnabled?: boolean;
  canvasGridSpacingMm?: number;
  canvasGridMajorEvery?: number;
  canvasGridSnapEnabled?: boolean;
  canvasGridSnapAvailable?: boolean;
  pickModeActive?: boolean;
  canvasModalMode?: CanvasModalMode | null;
};

export type VscodeCanvasRibbonCommandDefinition = {
  id: VscodeCanvasRibbonCommandId;
  label: string;
  description: string;
  icon: VscodeLucideIconName;
  sharedCommandId?: CommandId;
  hostAction?: "toggleCanvasGrid" | "configureCanvasGrid" | "toggleCanvasGridSnap";
  isAvailable: (context: VscodeCanvasRibbonCommandContext) => boolean;
  isPressed?: (context: VscodeCanvasRibbonCommandContext) => boolean;
};

const sharedLabel = (commandId: Exclude<
  VscodeCanvasRibbonCommandId,
  "zoomInCanvas" | "zoomOutCanvas" | "toggleCanvasGrid" | "configureCanvasGrid" | "toggleCanvasGridSnap"
>): string => ({
  clearCanvasSelection: selectionCommandDefinitions.clearCanvasSelection,
  resetCanvasView: viewModeCommandDefinitions.resetCanvasView,
  fitDrawing: viewModeCommandDefinitions.fitDrawing,
  toggleCanvasPointNames: viewModeCommandDefinitions.toggleCanvasPointNames,
  toggleCanvasGeometryNames: viewModeCommandDefinitions.toggleCanvasGeometryNames,
  toggleCanvasPoints: viewModeCommandDefinitions.toggleCanvasPoints
} as Record<string, { label: string }>)[commandId].label;

const available = (): boolean => true;

export const vscodeCanvasRibbonCommandCatalog: Record<
  VscodeCanvasRibbonCommandId,
  VscodeCanvasRibbonCommandDefinition
> = {
  zoomOutCanvas: {
    id: "zoomOutCanvas",
    label: "Zoom Out",
    description: "Zoom the Canvas out.",
    icon: "minus",
    sharedCommandId: "zoomOutCanvas",
    isAvailable: available
  },
  zoomInCanvas: {
    id: "zoomInCanvas",
    label: "Zoom In",
    description: "Zoom the Canvas in.",
    icon: "plus",
    sharedCommandId: "zoomInCanvas",
    isAvailable: available
  },
  resetCanvasView: {
    id: "resetCanvasView",
    label: sharedLabel("resetCanvasView"),
    description: "Reset Canvas pan and zoom.",
    icon: "rotate-ccw",
    sharedCommandId: "resetCanvasView",
    isAvailable: available
  },
  fitDrawing: {
    id: "fitDrawing",
    label: sharedLabel("fitDrawing"),
    description: "Fit the drawing to the Canvas viewport.",
    icon: "maximize",
    sharedCommandId: "fitDrawing",
    isAvailable: available
  },
  toggleCanvasPoints: {
    id: "toggleCanvasPoints",
    label: sharedLabel("toggleCanvasPoints"),
    description: "Show or hide Canvas points.",
    icon: "circle-dot",
    sharedCommandId: "toggleCanvasPoints",
    isAvailable: available,
    isPressed: ({ showCanvasPoints }) => showCanvasPoints
  },
  toggleCanvasPointNames: {
    id: "toggleCanvasPointNames",
    label: sharedLabel("toggleCanvasPointNames"),
    description: "Show or hide Canvas point names.",
    icon: "tag",
    sharedCommandId: "toggleCanvasPointNames",
    isAvailable: available,
    isPressed: ({ showCanvasPointNames }) => showCanvasPointNames
  },
  toggleCanvasGeometryNames: {
    id: "toggleCanvasGeometryNames",
    label: sharedLabel("toggleCanvasGeometryNames"),
    description: "Show or hide Canvas geometry names.",
    icon: "tag",
    sharedCommandId: "toggleCanvasGeometryNames",
    isAvailable: available,
    isPressed: ({ showCanvasGeometryNames }) => showCanvasGeometryNames
  },
  toggleCanvasGrid: {
    id: "toggleCanvasGrid",
    label: "Grid",
    description: "Show or hide the Canvas grid.",
    icon: "grid-3x3",
    hostAction: "toggleCanvasGrid",
    isAvailable: available,
    isPressed: ({ canvasGridEnabled }) => canvasGridEnabled === true
  },
  configureCanvasGrid: {
    id: "configureCanvasGrid",
    label: "Grid Settings",
    description: "Configure Canvas grid visibility, spacing, and major interval.",
    icon: "ruler",
    hostAction: "configureCanvasGrid",
    isAvailable: available
  },
  toggleCanvasGridSnap: {
    id: "toggleCanvasGridSnap",
    label: "Grid Snap",
    description: "Enable or disable Canvas grid snapping.",
    icon: "magnet",
    hostAction: "toggleCanvasGridSnap",
    isAvailable: ({ canvasGridSnapAvailable }) => canvasGridSnapAvailable === true,
    isPressed: ({ canvasGridSnapEnabled }) => canvasGridSnapEnabled === true
  }
};

export const vscodeCanvasRibbonCommandFor = (
  commandId: string
): VscodeCanvasRibbonCommandDefinition | null =>
  Object.hasOwn(vscodeCanvasRibbonCommandCatalog, commandId)
    ? vscodeCanvasRibbonCommandCatalog[commandId as VscodeCanvasRibbonCommandId]
    : null;
