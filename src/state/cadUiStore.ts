import { create } from "zustand";
import type { CommandRibbonSettings } from "../commandRibbons/commandRibbonSettings";
import type { NumericMeasurementKey } from "../geometry/numericExpressionTypes";
import type { ShortcutSettings } from "../keyboard/shortcutTypes";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import type { ActiveTemplateInsertion } from "../templates/templateInsertionMode";
import type { ElementId, PointAnchor } from "../types/geometry";

export type MeasurementInsertMode = "distance" | "angle" | "lineDistance";
export type MeasurementPointSlot = "point1" | "point2";
export type MeasurementPickSlot = MeasurementPointSlot | "line";

export type ActivePointPickTarget = {
  elementId: ElementId;
  parameterKey: ParameterKey;
  measurementSlot?: MeasurementPointSlot;
  nextParameterKey?: ParameterKey;
  pickFlow?: "lineEndpointPair" | "lineAndPoint" | "endpointPair" | "endpointAndPoint";
};

export type ActiveNumericReferencePickTarget = {
  elementId: ElementId;
  parameterKey: ParameterKey;
  mode: "replace" | "insert";
  property: NumericMeasurementKey;
  displayedExpression?: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
};

export type ActiveLinePickTarget = {
  elementId: ElementId;
  parameterKey: ParameterKey;
  measurementSlot?: "line";
  nextPointParameterKey?: ParameterKey;
  pickFlow?: "lineAndPoint";
};

export type ActiveExpressionInsertTarget = {
  elementId: ElementId;
  parameterKey: ParameterKey;
};

export type ActiveMeasurementInsertTarget = {
  elementId: ElementId;
  parameterKey: ParameterKey;
  mode: MeasurementInsertMode;
  point1Anchor: PointAnchor | null;
  point2Anchor: PointAnchor | null;
  lineId: ElementId | null;
  displayedExpression: string;
  selectionStart: number | null;
  selectionEnd: number | null;
};

export type ActivePickCursor = {
  elementId: ElementId;
  optionIndex: number;
};

export type CanvasViewport = {
  panX: number;
  panY: number;
  zoom: number;
};

export type PrintPreviewWindow = {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
  layoutId: string | null;
};

export type ReferenceHelperPosition = {
  x: number;
  y: number;
};

export type PendingImageImport = {
  sourcePath: string;
  displayName: string;
  naturalWidthPx: number;
  naturalHeightPx: number;
  detectedDpi: number | null;
  sourceDpi: number;
  targetPixelsPerMm: number;
  error: string | null;
};

export const DEFAULT_CANVAS_VIEWPORT: CanvasViewport = {
  panX: 0,
  panY: 0,
  zoom: 1
};

export const MIN_CANVAS_ZOOM = 0.1;
export const MAX_CANVAS_ZOOM = 20;
export const MIN_PRINT_PREVIEW_ZOOM = 0.15;
export const MAX_PRINT_PREVIEW_ZOOM = 4;
export const MIN_PRINT_PREVIEW_WIDTH = 260;
export const MIN_PRINT_PREVIEW_HEIGHT = 180;

export const DEFAULT_PRINT_PREVIEW_WINDOW: PrintPreviewWindow = {
  x: 24,
  y: 24,
  width: 380,
  height: 300,
  zoom: 0.55,
  layoutId: null
};

export const DEFAULT_REFERENCE_HELPER_POSITION: ReferenceHelperPosition = {
  x: 24,
  y: 72
};

export type CadUiState = {
  isParameterEditMode: boolean;
  showElementInfoPanel: boolean;
  isDependencyJumpMode: boolean;
  activePointPickTarget: ActivePointPickTarget | null;
  activeNumericReferencePickTarget: ActiveNumericReferencePickTarget | null;
  activeLinePickTarget: ActiveLinePickTarget | null;
  activeExpressionInsertTarget: ActiveExpressionInsertTarget | null;
  activeMeasurementInsertTarget: ActiveMeasurementInsertTarget | null;
  activeTemplateInsertion: ActiveTemplateInsertion | null;
  activePickCursor: ActivePickCursor | null;
  selectedDependencyJumpIndex: number;
  elementSearchQuery: string;
  elementSearchCursorId: ElementId | null;
  elementSearchPickableOnly: boolean;
  showCanvasElementNames: boolean;
  showCanvasPoints: boolean;
  showElementListColorAccents: boolean;
  showShortcutHelp: boolean;
  showShortcutSettings: boolean;
  showPaletteSettings: boolean;
  showGroupTemplateLibrary: boolean;
  groupTemplateLibraryMode: "manage" | "insert";
  showDslPanel: boolean;
  showCommandRibbonSettings: boolean;
  showSelectionColorPicker: boolean;
  showPrintLayout: boolean;
  showPrintPreviewWindow: boolean;
  commandErrorMessage: string | null;
  pendingImageImport: PendingImageImport | null;
  imageImportError: string | null;
  shortcutSettings: ShortcutSettings;
  shortcutSettingsLoading: boolean;
  shortcutSettingsError: string | null;
  commandRibbonSettings: CommandRibbonSettings | null;
  commandRibbonSettingsLoading: boolean;
  commandRibbonSettingsError: string | null;
  showCommandPalette: boolean;
  selectedPrintPlacementId: string | null;
  canvasViewport: CanvasViewport;
  printCanvasViewport: CanvasViewport;
  printPreviewWindow: PrintPreviewWindow;
  referenceHelperPosition: ReferenceHelperPosition | null;
  setParameterEditMode: (isParameterEditMode: boolean) => void;
  setShowElementInfoPanel: (showElementInfoPanel: boolean) => void;
  setDependencyJumpMode: (isDependencyJumpMode: boolean) => void;
  setActivePointPickTarget: (activePointPickTarget: ActivePointPickTarget | null) => void;
  setActiveNumericReferencePickTarget: (
    activeNumericReferencePickTarget: ActiveNumericReferencePickTarget | null
  ) => void;
  setActiveLinePickTarget: (activeLinePickTarget: ActiveLinePickTarget | null) => void;
  setActiveExpressionInsertTarget: (
    activeExpressionInsertTarget: ActiveExpressionInsertTarget | null
  ) => void;
  setActiveMeasurementInsertTarget: (
    activeMeasurementInsertTarget: ActiveMeasurementInsertTarget | null
  ) => void;
  setActiveTemplateInsertion: (activeTemplateInsertion: ActiveTemplateInsertion | null) => void;
  setActivePickCursor: (activePickCursor: ActivePickCursor | null) => void;
  clearPickMode: () => void;
  setSelectedDependencyJumpIndex: (selectedDependencyJumpIndex: number) => void;
  setElementSearchQuery: (elementSearchQuery: string) => void;
  setElementSearchCursorId: (elementSearchCursorId: ElementId | null) => void;
  setElementSearchPickableOnly: (elementSearchPickableOnly: boolean) => void;
  setShowCanvasElementNames: (showCanvasElementNames: boolean) => void;
  setShowCanvasPoints: (showCanvasPoints: boolean) => void;
  setShowElementListColorAccents: (showElementListColorAccents: boolean) => void;
  setShowShortcutHelp: (showShortcutHelp: boolean) => void;
  setShowShortcutSettings: (showShortcutSettings: boolean) => void;
  setShowPaletteSettings: (showPaletteSettings: boolean) => void;
  setShowGroupTemplateLibrary: (showGroupTemplateLibrary: boolean) => void;
  setGroupTemplateLibraryMode: (groupTemplateLibraryMode: "manage" | "insert") => void;
  setShowDslPanel: (showDslPanel: boolean) => void;
  setShowCommandRibbonSettings: (showCommandRibbonSettings: boolean) => void;
  setShowSelectionColorPicker: (showSelectionColorPicker: boolean) => void;
  setShowPrintLayout: (showPrintLayout: boolean) => void;
  setShowPrintPreviewWindow: (showPrintPreviewWindow: boolean) => void;
  setCommandErrorMessage: (commandErrorMessage: string | null) => void;
  setPendingImageImport: (pendingImageImport: PendingImageImport | null) => void;
  setImageImportError: (imageImportError: string | null) => void;
  setShortcutSettings: (shortcutSettings: ShortcutSettings) => void;
  setShortcutSettingsLoading: (shortcutSettingsLoading: boolean) => void;
  setShortcutSettingsError: (shortcutSettingsError: string | null) => void;
  setCommandRibbonSettings: (commandRibbonSettings: CommandRibbonSettings | null) => void;
  setCommandRibbonSettingsLoading: (commandRibbonSettingsLoading: boolean) => void;
  setCommandRibbonSettingsError: (commandRibbonSettingsError: string | null) => void;
  setShowCommandPalette: (showCommandPalette: boolean) => void;
  setSelectedPrintPlacementId: (selectedPrintPlacementId: string | null) => void;
  setCanvasViewport: (canvasViewport: CanvasViewport) => void;
  panCanvasViewport: (dx: number, dy: number) => void;
  zoomCanvasViewportAt: (
    zoomFactor: number,
    anchor?: { x: number; y: number; width: number; height: number }
  ) => void;
  resetCanvasViewport: () => void;
  setPrintCanvasViewport: (printCanvasViewport: CanvasViewport) => void;
  panPrintCanvasViewport: (dx: number, dy: number) => void;
  zoomPrintCanvasViewportAt: (
    zoomFactor: number,
    anchor?: { x: number; y: number; width: number; height: number }
  ) => void;
  resetPrintCanvasViewport: () => void;
  setPrintPreviewWindow: (printPreviewWindow: PrintPreviewWindow) => void;
  updatePrintPreviewWindow: (patch: Partial<PrintPreviewWindow>) => void;
  setReferenceHelperPosition: (referenceHelperPosition: ReferenceHelperPosition) => void;
};

export const initialCadUiState = (): Omit<
  CadUiState,
  | "setParameterEditMode"
  | "setShowElementInfoPanel"
  | "setDependencyJumpMode"
  | "setActivePointPickTarget"
  | "setActiveNumericReferencePickTarget"
  | "setActiveLinePickTarget"
  | "setActiveExpressionInsertTarget"
  | "setActiveMeasurementInsertTarget"
  | "setActiveTemplateInsertion"
  | "setActivePickCursor"
  | "clearPickMode"
  | "setSelectedDependencyJumpIndex"
  | "setElementSearchQuery"
  | "setElementSearchCursorId"
  | "setElementSearchPickableOnly"
  | "setShowCanvasElementNames"
  | "setShowCanvasPoints"
  | "setShowElementListColorAccents"
  | "setShowShortcutHelp"
  | "setShowShortcutSettings"
  | "setShowPaletteSettings"
  | "setShowGroupTemplateLibrary"
  | "setGroupTemplateLibraryMode"
  | "setShowDslPanel"
  | "setShowCommandRibbonSettings"
  | "setShowSelectionColorPicker"
  | "setShowPrintLayout"
  | "setShowPrintPreviewWindow"
  | "setCommandErrorMessage"
  | "setPendingImageImport"
  | "setImageImportError"
  | "setShortcutSettings"
  | "setShortcutSettingsLoading"
  | "setShortcutSettingsError"
  | "setCommandRibbonSettings"
  | "setCommandRibbonSettingsLoading"
  | "setCommandRibbonSettingsError"
  | "setShowCommandPalette"
  | "setSelectedPrintPlacementId"
  | "setCanvasViewport"
  | "panCanvasViewport"
  | "zoomCanvasViewportAt"
  | "resetCanvasViewport"
  | "setPrintCanvasViewport"
  | "panPrintCanvasViewport"
  | "zoomPrintCanvasViewportAt"
  | "resetPrintCanvasViewport"
  | "setPrintPreviewWindow"
  | "updatePrintPreviewWindow"
  | "setReferenceHelperPosition"
> => ({
  isParameterEditMode: false,
  showElementInfoPanel: true,
  isDependencyJumpMode: false,
  activePointPickTarget: null,
  activeNumericReferencePickTarget: null,
  activeLinePickTarget: null,
  activeExpressionInsertTarget: null,
  activeMeasurementInsertTarget: null,
  activeTemplateInsertion: null,
  activePickCursor: null,
  selectedDependencyJumpIndex: 0,
  elementSearchQuery: "",
  elementSearchCursorId: null,
  elementSearchPickableOnly: false,
  showCanvasElementNames: true,
  showCanvasPoints: true,
  showElementListColorAccents: false,
  showShortcutHelp: false,
  showShortcutSettings: false,
  showPaletteSettings: false,
  showGroupTemplateLibrary: false,
  groupTemplateLibraryMode: "manage",
  showDslPanel: false,
  showCommandRibbonSettings: false,
  showSelectionColorPicker: false,
  showPrintLayout: false,
  showPrintPreviewWindow: false,
  commandErrorMessage: null,
  pendingImageImport: null,
  imageImportError: null,
  shortcutSettings: { version: 1, overrides: [] },
  shortcutSettingsLoading: false,
  shortcutSettingsError: null,
  commandRibbonSettings: null,
  commandRibbonSettingsLoading: false,
  commandRibbonSettingsError: null,
  showCommandPalette: false,
  selectedPrintPlacementId: null,
  canvasViewport: DEFAULT_CANVAS_VIEWPORT,
  printCanvasViewport: DEFAULT_CANVAS_VIEWPORT,
  printPreviewWindow: DEFAULT_PRINT_PREVIEW_WINDOW,
  referenceHelperPosition: null
});

const clampCanvasZoom = (zoom: number) =>
  Math.min(Math.max(zoom, MIN_CANVAS_ZOOM), MAX_CANVAS_ZOOM);

export const clampPrintPreviewZoom = (zoom: number) =>
  Math.min(Math.max(Number.isFinite(zoom) ? zoom : DEFAULT_PRINT_PREVIEW_WINDOW.zoom, MIN_PRINT_PREVIEW_ZOOM), MAX_PRINT_PREVIEW_ZOOM);

export const normalizePrintPreviewWindow = (window: PrintPreviewWindow): PrintPreviewWindow => ({
  x: Number.isFinite(window.x) ? Math.round(window.x) : DEFAULT_PRINT_PREVIEW_WINDOW.x,
  y: Number.isFinite(window.y) ? Math.round(window.y) : DEFAULT_PRINT_PREVIEW_WINDOW.y,
  width: Math.max(Math.round(window.width), MIN_PRINT_PREVIEW_WIDTH),
  height: Math.max(Math.round(window.height), MIN_PRINT_PREVIEW_HEIGHT),
  zoom: clampPrintPreviewZoom(window.zoom),
  layoutId: window.layoutId
});

const zoomViewportAt = (
  current: CanvasViewport,
  zoomFactor: number,
  anchor?: { x: number; y: number; width: number; height: number }
) => {
  const nextZoom = clampCanvasZoom(current.zoom * zoomFactor);
  if (nextZoom === current.zoom) return current;

  if (!anchor) {
    return {
      ...current,
      zoom: nextZoom
    };
  }

  const worldX = (anchor.x - anchor.width / 2 - current.panX) / current.zoom;
  const worldY = (anchor.height / 2 + current.panY - anchor.y) / current.zoom;

  return {
    zoom: nextZoom,
    panX: anchor.x - anchor.width / 2 - worldX * nextZoom,
    panY: anchor.y - anchor.height / 2 + worldY * nextZoom
  };
};

export const useCadUiStore = create<CadUiState>((set) => ({
  ...initialCadUiState(),
  setParameterEditMode: (isParameterEditMode) => set({ isParameterEditMode }),
  setShowElementInfoPanel: (showElementInfoPanel) =>
    set((state) => ({
      showElementInfoPanel,
      isDependencyJumpMode: showElementInfoPanel ? state.isDependencyJumpMode : false
    })),
  setDependencyJumpMode: (isDependencyJumpMode) =>
    set((state) => ({
      isDependencyJumpMode,
      activePointPickTarget: null,
      activeNumericReferencePickTarget: null,
      activeLinePickTarget: null,
      activePickCursor: null,
      isParameterEditMode: isDependencyJumpMode ? false : state.isParameterEditMode,
      showElementInfoPanel: isDependencyJumpMode ? true : state.showElementInfoPanel
    })),
  setActivePointPickTarget: (activePointPickTarget) =>
    set({ activePointPickTarget, activePickCursor: null }),
  setActiveNumericReferencePickTarget: (activeNumericReferencePickTarget) =>
    set({ activeNumericReferencePickTarget, activePickCursor: null }),
  setActiveLinePickTarget: (activeLinePickTarget) =>
    set({ activeLinePickTarget, activePickCursor: null }),
  setActiveExpressionInsertTarget: (activeExpressionInsertTarget) =>
    set((state) => ({
      activeExpressionInsertTarget,
      activeMeasurementInsertTarget: activeExpressionInsertTarget
        ? state.activeMeasurementInsertTarget
        : null
    })),
  setActiveMeasurementInsertTarget: (activeMeasurementInsertTarget) =>
    set({ activeMeasurementInsertTarget }),
  setActiveTemplateInsertion: (activeTemplateInsertion) =>
    set({ activeTemplateInsertion, activePickCursor: null }),
  setActivePickCursor: (activePickCursor) => set({ activePickCursor }),
  clearPickMode: () =>
    set({
      activePointPickTarget: null,
      activeNumericReferencePickTarget: null,
      activeLinePickTarget: null,
      activeTemplateInsertion: null,
      activePickCursor: null
    }),
  setSelectedDependencyJumpIndex: (selectedDependencyJumpIndex) =>
    set({ selectedDependencyJumpIndex }),
  setElementSearchQuery: (elementSearchQuery) =>
    set({ elementSearchQuery, elementSearchCursorId: null }),
  setElementSearchCursorId: (elementSearchCursorId) => set({ elementSearchCursorId }),
  setElementSearchPickableOnly: (elementSearchPickableOnly) =>
    set({ elementSearchPickableOnly, elementSearchCursorId: null }),
  setShowCanvasElementNames: (showCanvasElementNames) => set({ showCanvasElementNames }),
  setShowCanvasPoints: (showCanvasPoints) => set({ showCanvasPoints }),
  setShowElementListColorAccents: (showElementListColorAccents) =>
    set({ showElementListColorAccents }),
  setShowShortcutHelp: (showShortcutHelp) => set({ showShortcutHelp }),
  setShowShortcutSettings: (showShortcutSettings) => set({ showShortcutSettings }),
  setShowPaletteSettings: (showPaletteSettings) => set({ showPaletteSettings }),
  setShowGroupTemplateLibrary: (showGroupTemplateLibrary) =>
    set({ showGroupTemplateLibrary }),
  setGroupTemplateLibraryMode: (groupTemplateLibraryMode) =>
    set({ groupTemplateLibraryMode }),
  setShowDslPanel: (showDslPanel) => set({ showDslPanel }),
  setShowCommandRibbonSettings: (showCommandRibbonSettings) =>
    set({ showCommandRibbonSettings }),
  setShowSelectionColorPicker: (showSelectionColorPicker) => set({ showSelectionColorPicker }),
  setShowPrintLayout: (showPrintLayout) => set({ showPrintLayout }),
  setShowPrintPreviewWindow: (showPrintPreviewWindow) => set({ showPrintPreviewWindow }),
  setCommandErrorMessage: (commandErrorMessage) => set({ commandErrorMessage }),
  setPendingImageImport: (pendingImageImport) => set({ pendingImageImport }),
  setImageImportError: (imageImportError) => set({ imageImportError }),
  setShortcutSettings: (shortcutSettings) => set({ shortcutSettings }),
  setShortcutSettingsLoading: (shortcutSettingsLoading) => set({ shortcutSettingsLoading }),
  setShortcutSettingsError: (shortcutSettingsError) => set({ shortcutSettingsError }),
  setCommandRibbonSettings: (commandRibbonSettings) => set({ commandRibbonSettings }),
  setCommandRibbonSettingsLoading: (commandRibbonSettingsLoading) =>
    set({ commandRibbonSettingsLoading }),
  setCommandRibbonSettingsError: (commandRibbonSettingsError) =>
    set({ commandRibbonSettingsError }),
  setShowCommandPalette: (showCommandPalette) => set({ showCommandPalette }),
  setSelectedPrintPlacementId: (selectedPrintPlacementId) => set({ selectedPrintPlacementId }),
  setCanvasViewport: (canvasViewport) =>
    set({
      canvasViewport: {
        ...canvasViewport,
        zoom: clampCanvasZoom(canvasViewport.zoom)
      }
    }),
  panCanvasViewport: (dx, dy) =>
    set((state) => ({
      canvasViewport: {
        ...state.canvasViewport,
        panX: state.canvasViewport.panX + dx,
        panY: state.canvasViewport.panY + dy
      }
    })),
  zoomCanvasViewportAt: (zoomFactor, anchor) =>
    set((state) => {
      const canvasViewport = zoomViewportAt(state.canvasViewport, zoomFactor, anchor);
      return canvasViewport === state.canvasViewport ? {} : { canvasViewport };
    }),
  resetCanvasViewport: () => set({ canvasViewport: DEFAULT_CANVAS_VIEWPORT }),
  setPrintCanvasViewport: (printCanvasViewport) =>
    set({
      printCanvasViewport: {
        ...printCanvasViewport,
        zoom: clampCanvasZoom(printCanvasViewport.zoom)
      }
    }),
  panPrintCanvasViewport: (dx, dy) =>
    set((state) => ({
      printCanvasViewport: {
        ...state.printCanvasViewport,
        panX: state.printCanvasViewport.panX + dx,
        panY: state.printCanvasViewport.panY + dy
      }
    })),
  zoomPrintCanvasViewportAt: (zoomFactor, anchor) =>
    set((state) => {
      const printCanvasViewport = zoomViewportAt(state.printCanvasViewport, zoomFactor, anchor);
      return printCanvasViewport === state.printCanvasViewport ? {} : { printCanvasViewport };
    }),
  resetPrintCanvasViewport: () => set({ printCanvasViewport: DEFAULT_CANVAS_VIEWPORT }),
  setPrintPreviewWindow: (printPreviewWindow) =>
    set({ printPreviewWindow: normalizePrintPreviewWindow(printPreviewWindow) }),
  updatePrintPreviewWindow: (patch) =>
    set((state) => ({
      printPreviewWindow: normalizePrintPreviewWindow({
        ...state.printPreviewWindow,
        ...patch
      })
    })),
  setReferenceHelperPosition: (referenceHelperPosition) =>
    set({
      referenceHelperPosition: {
        x: Math.round(referenceHelperPosition.x),
        y: Math.round(referenceHelperPosition.y)
      }
    })
}));
