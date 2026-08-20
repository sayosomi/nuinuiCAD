import { create } from "zustand";
import type { CommandRibbonSettings } from "../commandRibbons/commandRibbonSettings";
import type { NumericMeasurementKey } from "../geometry/numericExpressionTypes";
import type { ShortcutSettings } from "../keyboard/shortcutTypes";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import { useCadDocumentStore } from "./cadDocumentStore";
import { sourceEditSession } from "../editor/sourceEditSession";
import type { CommandLineSession } from "../commands/commandLineSession";
import type { SourceCreationInsertion } from "../commands/sourceCreationInsertion";
import type { CadElement, ElementId, PointAnchor } from "../types/geometry";
import { isGroupExpanded } from "../model/groups";
import type { FoldTarget, GroupFoldById, GroupFoldState } from "../model/groups";
import type { BindingId } from "../scalars/bindingCatalog";
import type { ModuleSemanticTarget } from "../dsl/moduleSemanticEditor";

export type MeasurementInsertMode = "distance" | "angle" | "lineDistance";
export type MeasurementPointSlot = "point1" | "point2";
export type MeasurementPickSlot = MeasurementPointSlot | "line";

export type ActivePointPickTarget = {
  elementId: ElementId;
  parameterKey: ParameterKey;
  /** Document index the picked reference will be inserted at when `elementId`
   * is a virtual target that is not in the document yet (future command-line
   * creation). Candidates must precede this index. */
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
  sourceInsertion: SourceCreationInsertion | null;
  error: string | null;
};

export const DEFAULT_CANVAS_VIEWPORT: CanvasViewport = {
  panX: 0,
  panY: 0,
  zoom: 1
};

export const MIN_CANVAS_ZOOM = 0.1;
export const MAX_CANVAS_ZOOM = 20;
export const DEFAULT_REFERENCE_HELPER_POSITION: ReferenceHelperPosition = {
  x: 24,
  y: 72
};

const uniqueElementIds = (ids: ElementId[]) => Array.from(new Set(ids));

const currentDocumentElements = () => useCadDocumentStore.getState().elements;

export type CadElementSelection = {
  selectedElementId: ElementId | null;
  selectedElementIds: ElementId[];
  selectionAnchorElementId: ElementId | null;
};

/**
 * Single source of truth for which kind of thing is currently selected.
 * Element selection (selectedElementId/selectedElementIds/selectionAnchorElementId)
 * && typed binding selection are mutually exclusive: every setter that
 * changes one side clears the other's fields in the same `set()`, so no
 * consumer (Canvas, Inspector, command layer) can observe both as active at
 * once. See setSelectedBindingId / setSelectedElementId et al. below.
 */
export type CadSelectionSubject =
  | { kind: "elements" }
  | { kind: "binding"; bindingId: BindingId };

const normalizedSelection = (
  elements: CadElement[],
  selection: CadElementSelection
): CadElementSelection => {
  const existingIds = new Set(elements.map((element) => element.id));
  const selectedElementIds = uniqueElementIds(selection.selectedElementIds).filter((id) => existingIds.has(id));
  const selectedElementId =
    selection.selectedElementId && existingIds.has(selection.selectedElementId)
      ? selection.selectedElementId
      : selectedElementIds[0] ?? null;
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

export type CadUiState = CadElementSelection & {
  /** Which kind of thing selectedElementId/selectedBindingId-style state currently refers to. */
  selectionSubject: CadSelectionSubject;
  /** Primary DSL editor cursor; intentionally independent from Canvas selection. */
  sourceCursorLine: number | null;
  groupFoldById: ReadonlyMap<ElementId, GroupFoldState>;
  isInspectorExpanded: boolean;
  activePointPickTarget: ActivePointPickTarget | null;
  activeNumericReferencePickTarget: ActiveNumericReferencePickTarget | null;
  activeLinePickTarget: ActiveLinePickTarget | null;
  activeMeasurementInsertTarget: ActiveMeasurementInsertTarget | null;
  commandLineSession: CommandLineSession | null;
  activePickCursor: ActivePickCursor | null;
  elementSearchQuery: string;
  elementSearchCursorId: ElementId | null;
  elementSearchPickableOnly: boolean;
  /** Canonical identity-label visibility flags. */
  showCanvasPointNames: boolean;
  showCanvasGeometryNames: boolean;
  showCanvasPoints: boolean;
  showElementListColorAccents: boolean;
  showShortcutHelp: boolean;
  showShortcutSettings: boolean;
  showPaletteSettings: boolean;
  showVisibilityProfileSettings: boolean;
  showCommandRibbonSettings: boolean;
  showSelectionColorPicker: boolean;
  renameElementPromptTargetId: ElementId | null;
  renameTypedBindingPromptTargetId: BindingId | null;
  renameModuleSemanticPromptTarget: ModuleSemanticTarget | null;
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
  canvasViewport: CanvasViewport;
  referenceHelperPosition: ReferenceHelperPosition | null;
  setInspectorExpanded: (isInspectorExpanded: boolean) => void;
  setActivePointPickTarget: (activePointPickTarget: ActivePointPickTarget | null) => void;
  setActiveNumericReferencePickTarget: (
    activeNumericReferencePickTarget: ActiveNumericReferencePickTarget | null
  ) => void;
  setActiveLinePickTarget: (activeLinePickTarget: ActiveLinePickTarget | null) => void;
  setActiveMeasurementInsertTarget: (
    activeMeasurementInsertTarget: ActiveMeasurementInsertTarget | null
  ) => void;
  setCommandLineSession: (commandLineSession: CommandLineSession | null) => void;
  /**
   * Replaces a creation session && all in-store pick state atomically. The 4c
   * command layer must first clear pending Canvas pointer intent && pending
   * Source Editor focus reservations, which live outside this store.
   */
  startCommandLineSession: (commandLineSession: CommandLineSession) => void;
  setActivePickCursor: (activePickCursor: ActivePickCursor | null) => void;
  clearPickMode: () => void;
  setElementSearchQuery: (elementSearchQuery: string) => void;
  setElementSearchCursorId: (elementSearchCursorId: ElementId | null) => void;
  setElementSearchPickableOnly: (elementSearchPickableOnly: boolean) => void;
  setShowCanvasPointNames: (showCanvasPointNames: boolean) => void;
  setShowCanvasGeometryNames: (showCanvasGeometryNames: boolean) => void;
  setShowCanvasPoints: (showCanvasPoints: boolean) => void;
  setShowElementListColorAccents: (showElementListColorAccents: boolean) => void;
  setShowShortcutHelp: (showShortcutHelp: boolean) => void;
  setShowShortcutSettings: (showShortcutSettings: boolean) => void;
  setShowPaletteSettings: (showPaletteSettings: boolean) => void;
  setShowVisibilityProfileSettings: (showVisibilityProfileSettings: boolean) => void;
  setShowCommandRibbonSettings: (showCommandRibbonSettings: boolean) => void;
  setShowSelectionColorPicker: (showSelectionColorPicker: boolean) => void;
  setRenameElementPromptTargetId: (renameElementPromptTargetId: ElementId | null) => void;
  setRenameTypedBindingPromptTargetId: (renameTypedBindingPromptTargetId: BindingId | null) => void;
  setRenameModuleSemanticPromptTarget: (target: ModuleSemanticTarget | null) => void;
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
  setCanvasViewport: (canvasViewport: CanvasViewport) => void;
  panCanvasViewport: (dx: number, dy: number) => void;
  zoomCanvasViewportAt: (
    zoomFactor: number,
    anchor?: { x: number; y: number; width: number; height: number }
  ) => void;
  resetCanvasViewport: () => void;
  setReferenceHelperPosition: (referenceHelperPosition: ReferenceHelperPosition) => void;
  /** Updates one presentation branch without changing document semantics. */
  setFoldTargetExpanded: (target: FoldTarget, expanded: boolean) => void;
  /** Batches many targets into a single groupFoldById update (one subscription notification). */
  setFoldTargetsExpanded: (targets: readonly FoldTarget[], expanded: boolean) => void;
  setGroupFold: (id: ElementId, patch: GroupFoldState) => void;
  /** Replaces the whole map, so a newly loaded document never inherits fold
   * entries keyed by an element id that happens to repeat across documents. */
  replaceGroupFoldById: (groupFoldById: GroupFoldById) => void;
  toggleGroupExpanded: (id: ElementId) => void;
  toggleElseExpanded: (id: ElementId) => void;
  pruneGroupFold: (existingIds: ReadonlySet<ElementId>) => void;
  setSelectedElementId: (id: ElementId | null) => void;
  setSelectedElementIds: (ids: ElementId[], primaryId?: ElementId | null) => void;
  setSelectedElementRange: (anchorId: ElementId, targetId: ElementId) => void;
  /** Clears element fields while preserving a typed binding as the active subject. */
  clearElementSelection: () => void;
  /** Selects a typed const/let binding as the current subject, clearing any active element selection. */
  setSelectedBindingId: (bindingId: BindingId) => void;
  setSourceCursorLine: (sourceCursorLine: number | null) => void;
  applySelection: (elements: CadElement[], selection: CadElementSelection) => void;
  reconcileSelectionWithElements: (elements: CadElement[]) => void;
};

export const initialCadUiState = (): Omit<
  CadUiState,
  | "setInspectorExpanded"
  | "setActivePointPickTarget"
  | "setActiveNumericReferencePickTarget"
  | "setActiveLinePickTarget"
  | "setActiveMeasurementInsertTarget"
  | "setCommandLineSession"
  | "startCommandLineSession"
  | "setActivePickCursor"
  | "clearPickMode"
  | "setElementSearchQuery"
  | "setElementSearchCursorId"
  | "setElementSearchPickableOnly"
  | "setShowCanvasPointNames"
  | "setShowCanvasGeometryNames"
  | "setShowCanvasPoints"
  | "setShowElementListColorAccents"
  | "setShowShortcutHelp"
  | "setShowShortcutSettings"
  | "setShowPaletteSettings"
  | "setShowVisibilityProfileSettings"
  | "setShowCommandRibbonSettings"
  | "setShowSelectionColorPicker"
  | "setRenameElementPromptTargetId"
  | "setRenameTypedBindingPromptTargetId"
  | "setRenameModuleSemanticPromptTarget"
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
  | "setCanvasViewport"
  | "panCanvasViewport"
  | "zoomCanvasViewportAt"
  | "resetCanvasViewport"
  | "setReferenceHelperPosition"
  | "setFoldTargetExpanded"
  | "setFoldTargetsExpanded"
  | "setGroupFold"
  | "replaceGroupFoldById"
  | "toggleGroupExpanded"
  | "toggleElseExpanded"
  | "pruneGroupFold"
  | "setSelectedElementId"
  | "setSelectedElementIds"
  | "setSelectedElementRange"
  | "clearElementSelection"
  | "setSelectedBindingId"
  | "setSourceCursorLine"
  | "applySelection"
  | "reconcileSelectionWithElements"
> => ({
  selectedElementId: null,
  selectedElementIds: [],
  selectionAnchorElementId: null,
  selectionSubject: { kind: "elements" },
  sourceCursorLine: null,
  groupFoldById: new Map(),
  isInspectorExpanded: true,
  activePointPickTarget: null,
  activeNumericReferencePickTarget: null,
  activeLinePickTarget: null,
  activeMeasurementInsertTarget: null,
  commandLineSession: null,
  activePickCursor: null,
  elementSearchQuery: "",
  elementSearchCursorId: null,
  elementSearchPickableOnly: false,
  showCanvasPointNames: true,
  showCanvasGeometryNames: false,
  showCanvasPoints: true,
  showElementListColorAccents: false,
  showShortcutHelp: false,
  showShortcutSettings: false,
  showPaletteSettings: false,
  showVisibilityProfileSettings: false,
  showCommandRibbonSettings: false,
  showSelectionColorPicker: false,
  renameElementPromptTargetId: null,
  renameTypedBindingPromptTargetId: null,
  renameModuleSemanticPromptTarget: null,
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
  canvasViewport: DEFAULT_CANVAS_VIEWPORT,
  referenceHelperPosition: null,
});

const isFinitePositive = (value: number): boolean => Number.isFinite(value) && value > 0;

const normalizeCanvasZoom = (zoom: number): number | null =>
  isFinitePositive(zoom) ? zoom : null;

const zoomViewportAt = (
  current: CanvasViewport,
  zoomFactor: number,
  anchor: { x: number; y: number; width: number; height: number } | undefined,
  normalizeZoom: (zoom: number) => number | null
) => {
  const nextZoom = normalizeZoom(current.zoom * zoomFactor);
  if (nextZoom === null || nextZoom === current.zoom) return current;

  if (!anchor) {
    return {
      ...current,
      zoom: nextZoom
    };
  }

  const worldX = (anchor.x - anchor.width / 2 - current.panX) / current.zoom;
  const worldY = (anchor.height / 2 + current.panY - anchor.y) / current.zoom;

  const nextViewport = {
    zoom: nextZoom,
    panX: anchor.x - anchor.width / 2 - worldX * nextZoom,
    panY: anchor.y - anchor.height / 2 + worldY * nextZoom
  };
  return Number.isFinite(nextViewport.panX) && Number.isFinite(nextViewport.panY)
    ? nextViewport
    : current;
};

export const useCadUiStore = create<CadUiState>((set, get) => ({
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
  setCommandLineSession: (commandLineSession) => {
    if (commandLineSession === null && get().commandLineSession) {
      useCadDocumentStore.getState().clearPreviewDocumentChange();
    }
    set({ commandLineSession });
  },
  startCommandLineSession: (commandLineSession) => {
    if (get().commandLineSession) useCadDocumentStore.getState().clearPreviewDocumentChange();
    set({
      activePointPickTarget: null,
      activeNumericReferencePickTarget: null,
      activeLinePickTarget: null,
      activeMeasurementInsertTarget: null,
      activePickCursor: null,
      commandLineSession
    });
  },
  setActivePickCursor: (activePickCursor) => set({ activePickCursor }),
  // activeMeasurementInsertTarget is deliberately NOT cleared ,here: it is the
  // Source Editor's accumulated measurement-insert state, && selection changes
  // (clearTransientSelectionUi) && rejected commits route through this without
  // meaning to abandon a measurement in progress. Only an explicit creation-
  // session replacement (startCommandLineSession above) resets it.
  clearPickMode: () => {
    if (get().commandLineSession) useCadDocumentStore.getState().clearPreviewDocumentChange();
    set({
      activePointPickTarget: null,
      activeNumericReferencePickTarget: null,
      activeLinePickTarget: null,
      activePickCursor: null,
      commandLineSession: null
    });
  },
  setElementSearchQuery: (elementSearchQuery) =>
    set({ elementSearchQuery, elementSearchCursorId: null }),
  setElementSearchCursorId: (elementSearchCursorId) => set({ elementSearchCursorId }),
  setElementSearchPickableOnly: (elementSearchPickableOnly) =>
    set({ elementSearchPickableOnly, elementSearchCursorId: null }),
  setShowCanvasPointNames: (showCanvasPointNames) => set({ showCanvasPointNames }),
  setShowCanvasGeometryNames: (showCanvasGeometryNames) => set({ showCanvasGeometryNames }),
  setShowCanvasPoints: (showCanvasPoints) => set({ showCanvasPoints }),
  setShowElementListColorAccents: (showElementListColorAccents) =>
    set({ showElementListColorAccents }),
  setShowShortcutHelp: (showShortcutHelp) => set({ showShortcutHelp }),
  setShowShortcutSettings: (showShortcutSettings) => set({ showShortcutSettings }),
  setShowPaletteSettings: (showPaletteSettings) => set({ showPaletteSettings }),
  setShowVisibilityProfileSettings: (showVisibilityProfileSettings) =>
    set({ showVisibilityProfileSettings }),
  setShowCommandRibbonSettings: (showCommandRibbonSettings) =>
    set({ showCommandRibbonSettings }),
  setShowSelectionColorPicker: (showSelectionColorPicker) => set({ showSelectionColorPicker }),
  setRenameElementPromptTargetId: (renameElementPromptTargetId) => set({ renameElementPromptTargetId }),
  setRenameTypedBindingPromptTargetId: (renameTypedBindingPromptTargetId) => set({ renameTypedBindingPromptTargetId }),
  setRenameModuleSemanticPromptTarget: (renameModuleSemanticPromptTarget) => set({ renameModuleSemanticPromptTarget }),
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
  setCanvasViewport: (canvasViewport) =>
    set(() => {
      if (!isFinitePositive(canvasViewport.zoom) || !Number.isFinite(canvasViewport.panX) || !Number.isFinite(canvasViewport.panY)) {
        return {};
      }
      return { canvasViewport };
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
      const canvasViewport = zoomViewportAt(state.canvasViewport, zoomFactor, anchor, normalizeCanvasZoom);
      return canvasViewport === state.canvasViewport ? {} : { canvasViewport };
    }),
  resetCanvasViewport: () => set({ canvasViewport: DEFAULT_CANVAS_VIEWPORT }),
  setReferenceHelperPosition: (referenceHelperPosition) =>
    set({
      referenceHelperPosition: {
        x: Math.round(referenceHelperPosition.x),
        y: Math.round(referenceHelperPosition.y)
      }
    }),
  setFoldTargetExpanded: (target, expanded) =>
    set((state) => {
      const previous = state.groupFoldById.get(target.elementId) ?? {};
      const patch = target.branch === "statement"
        ? { statementExpanded: expanded }
        : target.branch === "primary"
          ? { expanded }
          : { elseExpanded: expanded };
      const next = { ...previous, ...patch };
      if (
        previous.expanded === next.expanded &&
        previous.elseExpanded === next.elseExpanded &&
        previous.statementExpanded === next.statementExpanded
      ) return {};
      const groupFoldById = new Map(state.groupFoldById);
      groupFoldById.set(target.elementId, next);
      return { groupFoldById };
    }),
  setFoldTargetsExpanded: (targets, expanded) =>
    set((state) => {
      const groupFoldById = new Map(state.groupFoldById);
      let changed = false;
      for (const target of targets) {
        const previous = groupFoldById.get(target.elementId) ?? {};
        const patch = target.branch === "statement"
          ? { statementExpanded: expanded }
          : target.branch === "primary"
            ? { expanded }
            : { elseExpanded: expanded };
        const next = { ...previous, ...patch };
        if (
          previous.expanded === next.expanded &&
          previous.elseExpanded === next.elseExpanded &&
          previous.statementExpanded === next.statementExpanded
        ) continue;
        groupFoldById.set(target.elementId, next);
        changed = true;
      }
      return changed ? { groupFoldById } : {};
    }),
  setGroupFold: (id, patch) =>
    set((state) => {
      const previous = state.groupFoldById.get(id) ?? {};
      const next = { ...previous, ...patch };
      if (
        previous.expanded === next.expanded &&
        previous.elseExpanded === next.elseExpanded &&
        previous.statementExpanded === next.statementExpanded
      ) return {};
      const groupFoldById = new Map(state.groupFoldById);
      groupFoldById.set(id, next);
      return { groupFoldById };
    }),
  replaceGroupFoldById: (groupFoldById) => set(() => ({ groupFoldById: new Map(groupFoldById) })),
  toggleGroupExpanded: (id) =>
    set((state) => {
      const previous = state.groupFoldById.get(id) ?? {};
      const groupFoldById = new Map(state.groupFoldById);
      groupFoldById.set(id, { ...previous, expanded: !isGroupExpanded(id, state.groupFoldById) });
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
  applySelection: (elements, selection) =>
    set(() => ({ ...normalizedSelection(elements, selection), selectionSubject: { kind: "elements" } })),
  reconcileSelectionWithElements: (elements) =>
    set((state) =>
      // A typed binding is the active subject: element selection was deliberately
      // cleared (setSelectedBindingId) && must stay cleared on document recompile.
      state.selectionSubject.kind === "binding"
        ? {}
        : normalizedSelection(elements, {
            selectedElementId: state.selectedElementId,
            selectedElementIds: state.selectedElementIds,
            selectionAnchorElementId: state.selectionAnchorElementId
          })
    ),
  setSelectedElementId: (selectedElementId) =>
    set(() => ({
      ...normalizedSelection(currentDocumentElements(), {
        selectedElementId,
        selectedElementIds: selectedElementId ? [selectedElementId] : [],
        selectionAnchorElementId: selectedElementId
      }),
      selectionSubject: { kind: "elements" }
    })),
  setSelectedElementIds: (selectedElementIds, primaryId) =>
    set(() => ({
      ...normalizedSelection(currentDocumentElements(), {
        selectedElementId: primaryId ?? selectedElementIds[0] ?? null,
        selectedElementIds,
        selectionAnchorElementId: primaryId ?? selectedElementIds[0] ?? null
      }),
      selectionSubject: { kind: "elements" }
    })),
  setSelectedElementRange: (anchorId, targetId) =>
    set(() => {
      const elements = currentDocumentElements();
      const anchorIndex = elements.findIndex((element) => element.id === anchorId);
      const targetIndex = elements.findIndex((element) => element.id === targetId);
      if (anchorIndex < 0 || targetIndex < 0) return {};
      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      return {
        ...normalizedSelection(elements, {
          selectedElementId: targetId,
          selectedElementIds: elements.slice(start, end + 1).map((element) => element.id),
          selectionAnchorElementId: anchorId
        }),
        selectionSubject: { kind: "elements" }
      };
    }),
  clearElementSelection: () =>
    set((state) => ({
      selectedElementId: null,
      selectedElementIds: [],
      selectionAnchorElementId: null,
      selectionSubject: state.selectionSubject.kind === "binding"
        ? state.selectionSubject
        : { kind: "elements" }
    })),
  setSelectedBindingId: (bindingId) =>
    set({
      selectionSubject: { kind: "binding", bindingId },
      selectedElementId: null,
      selectedElementIds: [],
      selectionAnchorElementId: null
    }),
  setSourceCursorLine: (sourceCursorLine) => {
    if (sourceEditSession.isComposing()) return;
    set({ sourceCursorLine });
  }
}));
