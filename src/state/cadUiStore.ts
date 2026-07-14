import { create } from "zustand";
import type { CommandRibbonSettings } from "../commandRibbons/commandRibbonSettings";
import type { CadDocumentSelectionSnapshot } from "../document/documentFormat";
import type { NumericMeasurementKey } from "../geometry/numericExpressionTypes";
import type { ShortcutSettings } from "../keyboard/shortcutTypes";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import { sampleElements } from "../sampleData";
import { useCadDocumentStore } from "./cadDocumentStore";
import { sourceEditSession } from "../editor/sourceEditSession";
import type { CommandLineSession } from "../commands/commandLineSession";
import type { ActiveTemplateInsertion } from "../templates/templateInsertionMode";
import type { CadElement, ElementId, PointAnchor } from "../types/geometry";
import type { GroupFoldState } from "../model/groups";

export type MeasurementInsertMode = "distance" | "angle" | "lineDistance";
export type MeasurementPointSlot = "point1" | "point2";
export type MeasurementPickSlot = MeasurementPointSlot | "line";

export type ActivePointPickTarget = {
  elementId: ElementId;
  parameterKey: ParameterKey;
  /** Document index the picked reference will be inserted at when `elementId`
   * is a virtual target that is not in the document yet (template insertion,
   * future command-line creation). Candidates must precede this index. */
  insertionIndex?: number;
  measurementSlot?: MeasurementPointSlot;
  nextParameterKey?: ParameterKey;
  pickFlow?: "lineEndpointPair" | "lineAndPoint" | "endpointPair" | "endpointAndPoint";
};

export type ActiveNumericReferencePickTarget = {
  elementId: ElementId;
  parameterKey: ParameterKey;
  /** See ActivePointPickTarget.insertionIndex. */
  insertionIndex?: number;
  mode: "replace" | "insert";
  property: NumericMeasurementKey;
  displayedExpression?: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
};

export type ActiveLinePickTarget = {
  elementId: ElementId;
  parameterKey: ParameterKey;
  /** See ActivePointPickTarget.insertionIndex. */
  insertionIndex?: number;
  /** Present only while editing a lineReferenceList; changes remain uncommitted until finish. */
  draftLineIds?: ElementId[];
  measurementSlot?: "line";
  nextPointParameterKey?: ParameterKey;
  pickFlow?: "lineAndPoint";
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

export type DslPanelWindow = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DslPanelSourceRequest = {
  requestId: number;
  elementIds: ElementId[];
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
export const DEFAULT_DSL_PANEL_WIDTH = 520;
export const DEFAULT_DSL_PANEL_HEIGHT = 640;
export const MIN_DSL_PANEL_WIDTH = 360;
export const MIN_DSL_PANEL_HEIGHT = 260;

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

export const DEFAULT_DSL_PANEL_WINDOW: DslPanelWindow | null = null;

const uniqueElementIds = (ids: ElementId[]) => Array.from(new Set(ids));

const currentDocumentElements = () => useCadDocumentStore.getState().elements;

const normalizedSelection = (
  elements: CadElement[],
  selection: CadDocumentSelectionSnapshot
): CadDocumentSelectionSnapshot => {
  const existingIds = new Set(elements.map((element) => element.id));
  const selectedElementIds = uniqueElementIds(selection.selectedElementIds).filter((id) => existingIds.has(id));
  const selectedElementId =
    selection.selectedElementId && existingIds.has(selection.selectedElementId)
      ? selection.selectedElementId
      : selectedElementIds[0] ?? elements[0]?.id ?? null;
  const normalizedIds =
    selectedElementId && !selectedElementIds.includes(selectedElementId)
      ? [...selectedElementIds, selectedElementId]
      : selectedElementIds;
  const selectionAnchorElementId =
    selection.selectionAnchorElementId && existingIds.has(selection.selectionAnchorElementId)
      ? selection.selectionAnchorElementId
      : selectedElementId;
  return {
    selectedElementId,
    selectedElementIds: normalizedIds,
    selectionAnchorElementId
  };
};

export type CadUiState = CadDocumentSelectionSnapshot & {
  /** Primary DSL editor cursor; intentionally independent from Canvas selection. */
  sourceCursorLine: number | null;
  groupFoldById: ReadonlyMap<ElementId, GroupFoldState>;
  isInspectorExpanded: boolean;
  activePointPickTarget: ActivePointPickTarget | null;
  activeNumericReferencePickTarget: ActiveNumericReferencePickTarget | null;
  activeLinePickTarget: ActiveLinePickTarget | null;
  activeMeasurementInsertTarget: ActiveMeasurementInsertTarget | null;
  activeTemplateInsertion: ActiveTemplateInsertion | null;
  commandLineSession: CommandLineSession | null;
  activePickCursor: ActivePickCursor | null;
  elementSearchQuery: string;
  elementSearchCursorId: ElementId | null;
  elementSearchPickableOnly: boolean;
  showCanvasElementNames: boolean;
  showCanvasPoints: boolean;
  showElementListColorAccents: boolean;
  showShortcutHelp: boolean;
  showShortcutSettings: boolean;
  showPaletteSettings: boolean;
  showVisibilityProfileSettings: boolean;
  showGroupTemplateLibrary: boolean;
  groupTemplateLibraryMode: "manage" | "insert";
  showDslPanel: boolean;
  dslPanelSourceRequest: DslPanelSourceRequest | null;
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
  dslPanelWindow: DslPanelWindow | null;
  setInspectorExpanded: (isInspectorExpanded: boolean) => void;
  setActivePointPickTarget: (activePointPickTarget: ActivePointPickTarget | null) => void;
  setActiveNumericReferencePickTarget: (
    activeNumericReferencePickTarget: ActiveNumericReferencePickTarget | null
  ) => void;
  setActiveLinePickTarget: (activeLinePickTarget: ActiveLinePickTarget | null) => void;
  setActiveMeasurementInsertTarget: (
    activeMeasurementInsertTarget: ActiveMeasurementInsertTarget | null
  ) => void;
  setActiveTemplateInsertion: (activeTemplateInsertion: ActiveTemplateInsertion | null) => void;
  setCommandLineSession: (commandLineSession: CommandLineSession | null) => void;
  /**
   * Replaces a creation session and all in-store pick state atomically. The 4c
   * command layer must first clear pending Canvas pointer intent and pending
   * Source Editor focus reservations, which live outside this store.
   */
  startCommandLineSession: (commandLineSession: CommandLineSession) => void;
  setActivePickCursor: (activePickCursor: ActivePickCursor | null) => void;
  clearPickMode: () => void;
  setElementSearchQuery: (elementSearchQuery: string) => void;
  setElementSearchCursorId: (elementSearchCursorId: ElementId | null) => void;
  setElementSearchPickableOnly: (elementSearchPickableOnly: boolean) => void;
  setShowCanvasElementNames: (showCanvasElementNames: boolean) => void;
  setShowCanvasPoints: (showCanvasPoints: boolean) => void;
  setShowElementListColorAccents: (showElementListColorAccents: boolean) => void;
  setShowShortcutHelp: (showShortcutHelp: boolean) => void;
  setShowShortcutSettings: (showShortcutSettings: boolean) => void;
  setShowPaletteSettings: (showPaletteSettings: boolean) => void;
  setShowVisibilityProfileSettings: (showVisibilityProfileSettings: boolean) => void;
  setShowGroupTemplateLibrary: (showGroupTemplateLibrary: boolean) => void;
  setGroupTemplateLibraryMode: (groupTemplateLibraryMode: "manage" | "insert") => void;
  setShowDslPanel: (showDslPanel: boolean) => void;
  setDslPanelSourceRequest: (dslPanelSourceRequest: DslPanelSourceRequest | null) => void;
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
  setDslPanelWindow: (dslPanelWindow: DslPanelWindow | null) => void;
  setGroupFold: (id: ElementId, patch: GroupFoldState) => void;
  toggleGroupExpanded: (id: ElementId) => void;
  toggleElseExpanded: (id: ElementId) => void;
  pruneGroupFold: (existingIds: ReadonlySet<ElementId>) => void;
  setSelectedElementId: (id: ElementId | null) => void;
  setSelectedElementIds: (ids: ElementId[], primaryId?: ElementId | null) => void;
  setSelectedElementRange: (anchorId: ElementId, targetId: ElementId) => void;
  setSourceCursorLine: (sourceCursorLine: number | null) => void;
  applySelection: (elements: CadElement[], selection: CadDocumentSelectionSnapshot) => void;
  reconcileSelectionWithElements: (elements: CadElement[]) => void;
};

export const initialCadUiState = (): Omit<
  CadUiState,
  | "setInspectorExpanded"
  | "setActivePointPickTarget"
  | "setActiveNumericReferencePickTarget"
  | "setActiveLinePickTarget"
  | "setActiveMeasurementInsertTarget"
  | "setActiveTemplateInsertion"
  | "setCommandLineSession"
  | "startCommandLineSession"
  | "setActivePickCursor"
  | "clearPickMode"
  | "setElementSearchQuery"
  | "setElementSearchCursorId"
  | "setElementSearchPickableOnly"
  | "setShowCanvasElementNames"
  | "setShowCanvasPoints"
  | "setShowElementListColorAccents"
  | "setShowShortcutHelp"
  | "setShowShortcutSettings"
  | "setShowPaletteSettings"
  | "setShowVisibilityProfileSettings"
  | "setShowGroupTemplateLibrary"
  | "setGroupTemplateLibraryMode"
  | "setShowDslPanel"
  | "setDslPanelSourceRequest"
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
  | "setDslPanelWindow"
  | "setGroupFold"
  | "toggleGroupExpanded"
  | "toggleElseExpanded"
  | "pruneGroupFold"
  | "setSelectedElementId"
  | "setSelectedElementIds"
  | "setSelectedElementRange"
  | "setSourceCursorLine"
  | "applySelection"
  | "reconcileSelectionWithElements"
> => ({
  selectedElementId: sampleElements[0]?.id ?? null,
  selectedElementIds: sampleElements[0] ? [sampleElements[0].id] : [],
  selectionAnchorElementId: sampleElements[0]?.id ?? null,
  sourceCursorLine: null,
  groupFoldById: new Map(),
  isInspectorExpanded: true,
  activePointPickTarget: null,
  activeNumericReferencePickTarget: null,
  activeLinePickTarget: null,
  activeMeasurementInsertTarget: null,
  activeTemplateInsertion: null,
  commandLineSession: null,
  activePickCursor: null,
  elementSearchQuery: "",
  elementSearchCursorId: null,
  elementSearchPickableOnly: false,
  showCanvasElementNames: true,
  showCanvasPoints: true,
  showElementListColorAccents: false,
  showShortcutHelp: false,
  showShortcutSettings: false,
  showPaletteSettings: false,
  showVisibilityProfileSettings: false,
  showGroupTemplateLibrary: false,
  groupTemplateLibraryMode: "manage",
  showDslPanel: false,
  dslPanelSourceRequest: null,
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
  referenceHelperPosition: null,
  dslPanelWindow: DEFAULT_DSL_PANEL_WINDOW
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

export const normalizeDslPanelWindow = (window: DslPanelWindow): DslPanelWindow => ({
  x: Number.isFinite(window.x) ? Math.round(window.x) : 20,
  y: Number.isFinite(window.y) ? Math.round(window.y) : 68,
  width: Math.max(
    Number.isFinite(window.width) ? Math.round(window.width) : DEFAULT_DSL_PANEL_WIDTH,
    MIN_DSL_PANEL_WIDTH
  ),
  height: Math.max(
    Number.isFinite(window.height) ? Math.round(window.height) : DEFAULT_DSL_PANEL_HEIGHT,
    MIN_DSL_PANEL_HEIGHT
  )
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
  setInspectorExpanded: (isInspectorExpanded) => set({ isInspectorExpanded }),
  setActivePointPickTarget: (activePointPickTarget) =>
    set({ activePointPickTarget, activePickCursor: null }),
  setActiveNumericReferencePickTarget: (activeNumericReferencePickTarget) =>
    set({ activeNumericReferencePickTarget, activePickCursor: null }),
  setActiveLinePickTarget: (activeLinePickTarget) =>
    set({ activeLinePickTarget, activePickCursor: null }),
  setActiveMeasurementInsertTarget: (activeMeasurementInsertTarget) =>
    set({ activeMeasurementInsertTarget }),
  setActiveTemplateInsertion: (activeTemplateInsertion) =>
    set({ activeTemplateInsertion, activePickCursor: null }),
  setCommandLineSession: (commandLineSession) => set({ commandLineSession }),
  startCommandLineSession: (commandLineSession) =>
    set({
      activePointPickTarget: null,
      activeNumericReferencePickTarget: null,
      activeLinePickTarget: null,
      activeMeasurementInsertTarget: null,
      activeTemplateInsertion: null,
      activePickCursor: null,
      commandLineSession
    }),
  setActivePickCursor: (activePickCursor) => set({ activePickCursor }),
  clearPickMode: () =>
    set({
      activePointPickTarget: null,
      activeNumericReferencePickTarget: null,
      activeLinePickTarget: null,
      activeMeasurementInsertTarget: null,
      activeTemplateInsertion: null,
      activePickCursor: null,
      commandLineSession: null
    }),
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
  setShowVisibilityProfileSettings: (showVisibilityProfileSettings) =>
    set({ showVisibilityProfileSettings }),
  setShowGroupTemplateLibrary: (showGroupTemplateLibrary) =>
    set({ showGroupTemplateLibrary }),
  setGroupTemplateLibraryMode: (groupTemplateLibraryMode) =>
    set({ groupTemplateLibraryMode }),
  setShowDslPanel: (showDslPanel) => set({ showDslPanel }),
  setDslPanelSourceRequest: (dslPanelSourceRequest) => set({ dslPanelSourceRequest }),
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
    }),
  setDslPanelWindow: (dslPanelWindow) =>
    set({
      dslPanelWindow: dslPanelWindow
        ? normalizeDslPanelWindow(dslPanelWindow)
        : null
    }),
  setGroupFold: (id, patch) =>
    set((state) => {
      const previous = state.groupFoldById.get(id) ?? {};
      const next = { ...previous, ...patch };
      if (previous.expanded === next.expanded && previous.elseExpanded === next.elseExpanded) return {};
      const groupFoldById = new Map(state.groupFoldById);
      groupFoldById.set(id, next);
      return { groupFoldById };
    }),
  toggleGroupExpanded: (id) =>
    set((state) => {
      const previous = state.groupFoldById.get(id) ?? {};
      const groupFoldById = new Map(state.groupFoldById);
      groupFoldById.set(id, { ...previous, expanded: !(previous.expanded ?? false) });
      return { groupFoldById };
    }),
  toggleElseExpanded: (id) =>
    set((state) => {
      const previous = state.groupFoldById.get(id) ?? {};
      const groupFoldById = new Map(state.groupFoldById);
      groupFoldById.set(id, { ...previous, elseExpanded: !(previous.elseExpanded ?? true) });
      return { groupFoldById };
    }),
  pruneGroupFold: (existingIds) =>
    set((state) => {
      const groupFoldById = new Map(
        [...state.groupFoldById].filter(([id]) => existingIds.has(id))
      );
      return groupFoldById.size === state.groupFoldById.size ? {} : { groupFoldById };
    }),
  applySelection: (elements, selection) => set(() => normalizedSelection(elements, selection)),
  reconcileSelectionWithElements: (elements) =>
    set((state) => normalizedSelection(elements, {
      selectedElementId: state.selectedElementId,
      selectedElementIds: state.selectedElementIds,
      selectionAnchorElementId: state.selectionAnchorElementId
    })),
  setSelectedElementId: (selectedElementId) =>
    set(() => normalizedSelection(currentDocumentElements(), {
      selectedElementId,
      selectedElementIds: selectedElementId ? [selectedElementId] : [],
      selectionAnchorElementId: selectedElementId
    })),
  setSelectedElementIds: (selectedElementIds, primaryId) =>
    set(() => normalizedSelection(currentDocumentElements(), {
      selectedElementId: primaryId ?? selectedElementIds[0] ?? null,
      selectedElementIds,
      selectionAnchorElementId: primaryId ?? selectedElementIds[0] ?? null
    })),
  setSelectedElementRange: (anchorId, targetId) =>
    set(() => {
      const elements = currentDocumentElements();
      const anchorIndex = elements.findIndex((element) => element.id === anchorId);
      const targetIndex = elements.findIndex((element) => element.id === targetId);
      if (anchorIndex < 0 || targetIndex < 0) return {};
      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      return normalizedSelection(elements, {
        selectedElementId: targetId,
        selectedElementIds: elements.slice(start, end + 1).map((element) => element.id),
        selectionAnchorElementId: anchorId
      });
    }),
  setSourceCursorLine: (sourceCursorLine) => {
    if (sourceEditSession.isComposing()) return;
    set({ sourceCursorLine });
  }
}));
