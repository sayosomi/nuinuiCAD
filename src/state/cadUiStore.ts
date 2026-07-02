import { create } from "zustand";
import type { NumericMeasurementKey } from "../geometry/numericExpressionTypes";
import type { ShortcutSettings } from "../keyboard/shortcutTypes";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import type { ElementId, PointAnchor } from "../types/geometry";

export type MeasurementInsertMode = "distance" | "angle" | "lineDistance";
export type MeasurementPointSlot = "point1" | "point2";
export type MeasurementPickSlot = MeasurementPointSlot | "line";

export type ActivePointPickTarget = {
  elementId: ElementId;
  parameterKey: ParameterKey;
  measurementSlot?: MeasurementPointSlot;
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

export const DEFAULT_CANVAS_VIEWPORT: CanvasViewport = {
  panX: 0,
  panY: 0,
  zoom: 1
};

export const MIN_CANVAS_ZOOM = 0.1;
export const MAX_CANVAS_ZOOM = 20;

export type CadUiState = {
  isParameterEditMode: boolean;
  showElementInfoPanel: boolean;
  isDependencyJumpMode: boolean;
  activePointPickTarget: ActivePointPickTarget | null;
  activeNumericReferencePickTarget: ActiveNumericReferencePickTarget | null;
  activeLinePickTarget: ActiveLinePickTarget | null;
  activeExpressionInsertTarget: ActiveExpressionInsertTarget | null;
  activeMeasurementInsertTarget: ActiveMeasurementInsertTarget | null;
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
  shortcutSettings: ShortcutSettings;
  shortcutSettingsLoading: boolean;
  shortcutSettingsError: string | null;
  showCommandPalette: boolean;
  canvasViewport: CanvasViewport;
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
  setShortcutSettings: (shortcutSettings: ShortcutSettings) => void;
  setShortcutSettingsLoading: (shortcutSettingsLoading: boolean) => void;
  setShortcutSettingsError: (shortcutSettingsError: string | null) => void;
  setShowCommandPalette: (showCommandPalette: boolean) => void;
  setCanvasViewport: (canvasViewport: CanvasViewport) => void;
  panCanvasViewport: (dx: number, dy: number) => void;
  zoomCanvasViewportAt: (
    zoomFactor: number,
    anchor?: { x: number; y: number; width: number; height: number }
  ) => void;
  resetCanvasViewport: () => void;
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
  | "setShortcutSettings"
  | "setShortcutSettingsLoading"
  | "setShortcutSettingsError"
  | "setShowCommandPalette"
  | "setCanvasViewport"
  | "panCanvasViewport"
  | "zoomCanvasViewportAt"
  | "resetCanvasViewport"
> => ({
  isParameterEditMode: false,
  showElementInfoPanel: true,
  isDependencyJumpMode: false,
  activePointPickTarget: null,
  activeNumericReferencePickTarget: null,
  activeLinePickTarget: null,
  activeExpressionInsertTarget: null,
  activeMeasurementInsertTarget: null,
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
  shortcutSettings: { version: 1, overrides: [] },
  shortcutSettingsLoading: false,
  shortcutSettingsError: null,
  showCommandPalette: false,
  canvasViewport: DEFAULT_CANVAS_VIEWPORT
});

const clampCanvasZoom = (zoom: number) =>
  Math.min(Math.max(zoom, MIN_CANVAS_ZOOM), MAX_CANVAS_ZOOM);

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
  setActivePickCursor: (activePickCursor) => set({ activePickCursor }),
  clearPickMode: () =>
    set({
      activePointPickTarget: null,
      activeNumericReferencePickTarget: null,
      activeLinePickTarget: null,
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
  setShortcutSettings: (shortcutSettings) => set({ shortcutSettings }),
  setShortcutSettingsLoading: (shortcutSettingsLoading) => set({ shortcutSettingsLoading }),
  setShortcutSettingsError: (shortcutSettingsError) => set({ shortcutSettingsError }),
  setShowCommandPalette: (showCommandPalette) => set({ showCommandPalette }),
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
      const current = state.canvasViewport;
      const nextZoom = clampCanvasZoom(current.zoom * zoomFactor);
      if (nextZoom === current.zoom) return {};

      if (!anchor) {
        return {
          canvasViewport: {
            ...current,
            zoom: nextZoom
          }
        };
      }

      const worldX = (anchor.x - anchor.width / 2 - current.panX) / current.zoom;
      const worldY = (anchor.height / 2 + current.panY - anchor.y) / current.zoom;

      return {
        canvasViewport: {
          zoom: nextZoom,
          panX: anchor.x - anchor.width / 2 - worldX * nextZoom,
          panY: anchor.y - anchor.height / 2 + worldY * nextZoom
        }
      };
    }),
  resetCanvasViewport: () => set({ canvasViewport: DEFAULT_CANVAS_VIEWPORT })
}));
