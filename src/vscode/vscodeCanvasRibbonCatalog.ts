import { selectionCommandDefinitions } from "../commands/selectionCommandDefinitions";
import { viewModeCommandDefinitions } from "../commands/viewModeCommandDefinitions";
import type { CommandId } from "../commands/commandTypes";

export const vscodeCanvasRibbonCommandIds = [
  "clearCanvasSelection",
  "resetCanvasView",
  "fitDrawing",
  "toggleCanvasPointNames",
  "toggleCanvasGeometryNames",
  "toggleCanvasPoints",
  "editCanvasRibbon"
] as const;

export type VscodeCanvasRibbonCommandId = (typeof vscodeCanvasRibbonCommandIds)[number];

export type VscodeCanvasRibbonCommandContext = {
  hasSelection: boolean;
  showCanvasPointNames: boolean;
  showCanvasGeometryNames: boolean;
  showCanvasPoints: boolean;
};

export type VscodeCanvasRibbonCommandDefinition = {
  id: VscodeCanvasRibbonCommandId;
  label: string;
  description: string;
  icon: string;
  sharedCommandId?: Exclude<VscodeCanvasRibbonCommandId, "editCanvasRibbon"> & CommandId;
  hostAction?: "editCanvasRibbon";
  isAvailable: (context: VscodeCanvasRibbonCommandContext) => boolean;
  isPressed?: (context: VscodeCanvasRibbonCommandContext) => boolean;
};

const sharedLabel = (commandId: Exclude<VscodeCanvasRibbonCommandId, "editCanvasRibbon">): string =>
  ({
    clearCanvasSelection: selectionCommandDefinitions.clearCanvasSelection,
    resetCanvasView: viewModeCommandDefinitions.resetCanvasView,
    fitDrawing: viewModeCommandDefinitions.fitDrawing,
    toggleCanvasPointNames: viewModeCommandDefinitions.toggleCanvasPointNames,
    toggleCanvasGeometryNames: viewModeCommandDefinitions.toggleCanvasGeometryNames,
    toggleCanvasPoints: viewModeCommandDefinitions.toggleCanvasPoints
  } as Record<Exclude<VscodeCanvasRibbonCommandId, "editCanvasRibbon">, { label: string }>)[commandId].label;

export const vscodeCanvasRibbonCommandCatalog: Record<
  VscodeCanvasRibbonCommandId,
  VscodeCanvasRibbonCommandDefinition
> = {
  clearCanvasSelection: {
    id: "clearCanvasSelection",
    label: sharedLabel("clearCanvasSelection"),
    description: "Clear the current Canvas selection.",
    icon: "x",
    sharedCommandId: "clearCanvasSelection",
    isAvailable: ({ hasSelection }) => hasSelection
  },
  resetCanvasView: {
    id: "resetCanvasView",
    label: sharedLabel("resetCanvasView"),
    description: "Reset Canvas pan and zoom.",
    icon: "scan",
    sharedCommandId: "resetCanvasView",
    isAvailable: () => true
  },
  fitDrawing: {
    id: "fitDrawing",
    label: sharedLabel("fitDrawing"),
    description: "Fit the drawing to the Canvas viewport.",
    icon: "maximize",
    sharedCommandId: "fitDrawing",
    isAvailable: () => true
  },
  toggleCanvasPointNames: {
    id: "toggleCanvasPointNames",
    label: sharedLabel("toggleCanvasPointNames"),
    description: "Show or hide Canvas point names.",
    icon: "tags",
    sharedCommandId: "toggleCanvasPointNames",
    isAvailable: () => true,
    isPressed: ({ showCanvasPointNames }) => showCanvasPointNames
  },
  toggleCanvasGeometryNames: {
    id: "toggleCanvasGeometryNames",
    label: sharedLabel("toggleCanvasGeometryNames"),
    description: "Show or hide Canvas geometry names.",
    icon: "tags",
    sharedCommandId: "toggleCanvasGeometryNames",
    isAvailable: () => true,
    isPressed: ({ showCanvasGeometryNames }) => showCanvasGeometryNames
  },
  toggleCanvasPoints: {
    id: "toggleCanvasPoints",
    label: sharedLabel("toggleCanvasPoints"),
    description: "Show or hide Canvas points.",
    icon: "dot",
    sharedCommandId: "toggleCanvasPoints",
    isAvailable: () => true,
    isPressed: ({ showCanvasPoints }) => showCanvasPoints
  },
  editCanvasRibbon: {
    id: "editCanvasRibbon",
    label: "Edit Canvas Ribbon",
    description: "Open the VS Code setting for Canvas Ribbon items.",
    icon: "settings-2",
    hostAction: "editCanvasRibbon",
    isAvailable: () => true
  }
};

export const vscodeCanvasRibbonCommandFor = (
  commandId: string
): VscodeCanvasRibbonCommandDefinition | null =>
  Object.hasOwn(vscodeCanvasRibbonCommandCatalog, commandId)
    ? vscodeCanvasRibbonCommandCatalog[commandId as VscodeCanvasRibbonCommandId]
    : null;
