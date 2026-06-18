import { create } from "zustand";
import { sampleElements } from "../sampleData";
import { fallbackElementName, makeUniqueElementName } from "../model/elementNames";
import { normalizeParameterKey } from "../parameters/parameterDefinitions";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import type { CadElement, ElementId } from "../types/geometry";

export type CanvasViewport = {
  panX: number;
  panY: number;
  zoom: number;
};

export type CadHistorySnapshot = {
  elements: CadElement[];
  selectedElementId: ElementId | null;
  selectedElementIds: ElementId[];
  selectionAnchorElementId: ElementId | null;
  isParameterEditMode: boolean;
  selectedParameterKey: ParameterKey | null;
};

export const DEFAULT_CANVAS_VIEWPORT: CanvasViewport = {
  panX: 0,
  panY: 0,
  zoom: 1
};

export const MIN_CANVAS_ZOOM = 0.1;
export const MAX_CANVAS_ZOOM = 20;

export type CadState = {
  elements: CadElement[];
  selectedElementId: ElementId | null;
  selectedElementIds: ElementId[];
  selectionAnchorElementId: ElementId | null;
  isParameterEditMode: boolean;
  selectedParameterKey: ParameterKey | null;
  showElementInfoPanel: boolean;
  isDependencyJumpMode: boolean;
  selectedDependencyJumpIndex: number;
  showShortcutHelp: boolean;
  showCommandPalette: boolean;
  canvasViewport: CanvasViewport;
  past: CadHistorySnapshot[];
  future: CadHistorySnapshot[];
  setSelectedElementId: (id: ElementId | null) => void;
  setSelectedElementIds: (ids: ElementId[], primaryId?: ElementId | null) => void;
  setSelectedElementRange: (anchorId: ElementId, targetId: ElementId) => void;
  setParameterEditMode: (isParameterEditMode: boolean) => void;
  setSelectedParameterKey: (selectedParameterKey: ParameterKey | null) => void;
  setShowElementInfoPanel: (showElementInfoPanel: boolean) => void;
  setDependencyJumpMode: (isDependencyJumpMode: boolean) => void;
  setSelectedDependencyJumpIndex: (selectedDependencyJumpIndex: number) => void;
  setShowShortcutHelp: (showShortcutHelp: boolean) => void;
  setShowCommandPalette: (showCommandPalette: boolean) => void;
  setCanvasViewport: (canvasViewport: CanvasViewport) => void;
  panCanvasViewport: (dx: number, dy: number) => void;
  zoomCanvasViewportAt: (
    zoomFactor: number,
    anchor?: { x: number; y: number; width: number; height: number }
  ) => void;
  resetCanvasViewport: () => void;
  previewDocumentChange: (change: Partial<CadHistorySnapshot>) => void;
  commitDocumentChange: (change: Partial<CadHistorySnapshot>) => void;
  commitDocumentChangeFromSnapshot: (
    before: CadHistorySnapshot,
    change: Partial<CadHistorySnapshot>
  ) => void;
  setElements: (elements: CadElement[]) => void;
  updateElement: (id: ElementId, patch: Partial<CadElement>) => void;
  renameElement: (id: ElementId, requestedName: string) => void;
  undo: () => void;
  redo: () => void;
};

const currentSnapshot = (state: CadHistorySnapshot): CadHistorySnapshot => ({
  elements: state.elements,
  selectedElementId: state.selectedElementId,
  selectedElementIds: state.selectedElementIds,
  selectionAnchorElementId: state.selectionAnchorElementId,
  isParameterEditMode: state.isParameterEditMode,
  selectedParameterKey: state.selectedParameterKey
});

const uniqueElementIds = (ids: ElementId[]) => Array.from(new Set(ids));

const normalizeSnapshot = (snapshot: CadHistorySnapshot): CadHistorySnapshot => {
  const existingIds = new Set(snapshot.elements.map((element) => element.id));
  const selectedElementIds = uniqueElementIds(snapshot.selectedElementIds).filter((id) =>
    existingIds.has(id)
  );
  const selectedElementId =
    snapshot.selectedElementId && existingIds.has(snapshot.selectedElementId)
      ? snapshot.selectedElementId
      : selectedElementIds[0] ?? snapshot.elements[0]?.id ?? null;
  const normalizedSelectedElementIds =
    selectedElementId && !selectedElementIds.includes(selectedElementId)
      ? uniqueElementIds([...selectedElementIds, selectedElementId]).filter((id) => existingIds.has(id))
      : selectedElementIds;
  const selectionAnchorElementId =
    snapshot.selectionAnchorElementId && existingIds.has(snapshot.selectionAnchorElementId)
      ? snapshot.selectionAnchorElementId
      : selectedElementId;
  const selectedElement = snapshot.elements.find((element) => element.id === selectedElementId);

  return {
    elements: snapshot.elements,
    selectedElementId,
    selectedElementIds: normalizedSelectedElementIds,
    selectionAnchorElementId,
    selectedParameterKey: selectedElement
      ? normalizeParameterKey(selectedElement, snapshot.selectedParameterKey)
      : null,
    isParameterEditMode: selectedElement ? snapshot.isParameterEditMode : false
  };
};

const snapshotEquals = (a: CadHistorySnapshot, b: CadHistorySnapshot) =>
  a.elements === b.elements &&
  a.selectedElementId === b.selectedElementId &&
  a.selectedElementIds.length === b.selectedElementIds.length &&
  a.selectedElementIds.every((id, index) => id === b.selectedElementIds[index]) &&
  a.selectionAnchorElementId === b.selectionAnchorElementId &&
  a.isParameterEditMode === b.isParameterEditMode &&
  a.selectedParameterKey === b.selectedParameterKey;

const clampCanvasZoom = (zoom: number) =>
  Math.min(Math.max(zoom, MIN_CANVAS_ZOOM), MAX_CANVAS_ZOOM);

export const useCadStore = create<CadState>((set) => ({
  elements: sampleElements,
  selectedElementId: sampleElements[0]?.id ?? null,
  selectedElementIds: sampleElements[0] ? [sampleElements[0].id] : [],
  selectionAnchorElementId: sampleElements[0]?.id ?? null,
  isParameterEditMode: false,
  selectedParameterKey: sampleElements[0] ? normalizeParameterKey(sampleElements[0], null) : null,
  showElementInfoPanel: true,
  isDependencyJumpMode: false,
  selectedDependencyJumpIndex: 0,
  showShortcutHelp: false,
  showCommandPalette: false,
  canvasViewport: DEFAULT_CANVAS_VIEWPORT,
  past: [],
  future: [],
  setSelectedElementId: (selectedElementId) =>
    set((state) => {
      const selectedElement = state.elements.find((element) => element.id === selectedElementId);
      return {
        selectedElementId,
        selectedElementIds: selectedElement ? [selectedElement.id] : [],
        selectionAnchorElementId: selectedElement?.id ?? null,
        selectedParameterKey: selectedElement
          ? normalizeParameterKey(selectedElement, state.selectedParameterKey)
          : null,
        isParameterEditMode: selectedElement ? state.isParameterEditMode : false,
        selectedDependencyJumpIndex: 0
      };
    }),
  setSelectedElementIds: (selectedElementIds, primaryId) =>
    set((state) => {
      const existingIds = new Set(state.elements.map((element) => element.id));
      const normalizedIds = uniqueElementIds(selectedElementIds).filter((id) => existingIds.has(id));
      const selectedElementId =
        primaryId && existingIds.has(primaryId)
          ? primaryId
          : normalizedIds[0] ?? null;
      const selectedElement = state.elements.find((element) => element.id === selectedElementId);
      const nextSelectedElementIds =
        selectedElementId && !normalizedIds.includes(selectedElementId)
          ? uniqueElementIds([...normalizedIds, selectedElementId])
          : normalizedIds;
      return {
        selectedElementId,
        selectedElementIds: nextSelectedElementIds,
        selectionAnchorElementId: selectedElementId,
        selectedParameterKey: selectedElement
          ? normalizeParameterKey(selectedElement, state.selectedParameterKey)
          : null,
        isParameterEditMode: selectedElement ? state.isParameterEditMode : false,
        selectedDependencyJumpIndex: 0
      };
    }),
  setSelectedElementRange: (anchorId, targetId) =>
    set((state) => {
      const anchorIndex = state.elements.findIndex((element) => element.id === anchorId);
      const targetIndex = state.elements.findIndex((element) => element.id === targetId);
      if (anchorIndex < 0 || targetIndex < 0) return {};

      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      const selectedElementIds = state.elements.slice(start, end + 1).map((element) => element.id);
      const selectedElement = state.elements[targetIndex];
      return {
        selectedElementId: selectedElement.id,
        selectedElementIds,
        selectionAnchorElementId: anchorId,
        selectedParameterKey: normalizeParameterKey(selectedElement, state.selectedParameterKey),
        isParameterEditMode: state.isParameterEditMode,
        selectedDependencyJumpIndex: 0
      };
    }),
  setParameterEditMode: (isParameterEditMode) =>
    set((state) => {
      const selectedElement = state.elements.find((element) => element.id === state.selectedElementId);
      return {
        isParameterEditMode: selectedElement ? isParameterEditMode : false,
        selectedParameterKey: selectedElement
          ? normalizeParameterKey(selectedElement, state.selectedParameterKey)
          : null
      };
    }),
  setSelectedParameterKey: (selectedParameterKey) =>
    set((state) => {
      const selectedElement = state.elements.find((element) => element.id === state.selectedElementId);
      return {
        selectedParameterKey: selectedElement
          ? normalizeParameterKey(selectedElement, selectedParameterKey)
          : null
      };
    }),
  setShowElementInfoPanel: (showElementInfoPanel) =>
    set({
      showElementInfoPanel,
      isDependencyJumpMode: showElementInfoPanel ? useCadStore.getState().isDependencyJumpMode : false
    }),
  setDependencyJumpMode: (isDependencyJumpMode) =>
    set({
      isDependencyJumpMode,
      isParameterEditMode: isDependencyJumpMode ? false : useCadStore.getState().isParameterEditMode,
      showElementInfoPanel: isDependencyJumpMode ? true : useCadStore.getState().showElementInfoPanel
    }),
  setSelectedDependencyJumpIndex: (selectedDependencyJumpIndex) =>
    set({ selectedDependencyJumpIndex }),
  setShowShortcutHelp: (showShortcutHelp) => set({ showShortcutHelp }),
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
      const worldY = (anchor.y - anchor.height / 2 - current.panY) / current.zoom;

      return {
        canvasViewport: {
          zoom: nextZoom,
          panX: anchor.x - anchor.width / 2 - worldX * nextZoom,
          panY: anchor.y - anchor.height / 2 - worldY * nextZoom
        }
      };
    }),
  resetCanvasViewport: () => set({ canvasViewport: DEFAULT_CANVAS_VIEWPORT }),
  previewDocumentChange: (change) =>
    set((state) => normalizeSnapshot({ ...currentSnapshot(state), ...change })),
  commitDocumentChange: (change) =>
    set((state) => {
      const before = currentSnapshot(state);
      const after = normalizeSnapshot({ ...before, ...change });
      if (snapshotEquals(before, after)) return {};

      return {
        ...after,
        past: [...state.past, before],
        future: []
      };
    }),
  commitDocumentChangeFromSnapshot: (before, change) =>
    set((state) => {
      const after = normalizeSnapshot({ ...before, ...change });
      if (snapshotEquals(before, after)) return {};

      return {
        ...after,
        past: [...state.past, before],
        future: []
      };
    }),
  setElements: (elements) => useCadStore.getState().commitDocumentChange({ elements }),
  updateElement: (id, patch) =>
    set((state) => {
      if (!state.elements.some((element) => element.id === id)) return {};

      const before = currentSnapshot(state);
      const after = normalizeSnapshot({
        ...before,
        elements: state.elements.map((element) =>
          element.id === id ? ({ ...element, ...patch } as CadElement) : element
        )
      });

      return {
        ...after,
        past: [...state.past, before],
        future: []
      };
    }),
  renameElement: (id, requestedName) =>
    set((state) => {
      const elementToRename = state.elements.find((element) => element.id === id);
      if (!elementToRename) return {};

      const uniqueName = makeUniqueElementName({
        elements: state.elements,
        elementId: id,
        requestedName,
        fallbackBaseName: fallbackElementName(elementToRename.type)
      });

      if (uniqueName === elementToRename.name) return {};

      const before = currentSnapshot(state);
      const after = normalizeSnapshot({
        ...before,
        elements: state.elements.map((element) =>
          element.id === id ? { ...element, name: uniqueName } : element
        )
      });

      return {
        ...after,
        past: [...state.past, before],
        future: []
      };
    }),
  undo: () =>
    set((state) => {
      const previous = state.past.at(-1);
      if (!previous) return {};

      return {
        ...previous,
        past: state.past.slice(0, -1),
        future: [currentSnapshot(state), ...state.future]
      };
    }),
  redo: () =>
    set((state) => {
      const next = state.future[0];
      if (!next) return {};

      return {
        ...next,
        past: [...state.past, currentSnapshot(state)],
        future: state.future.slice(1)
      };
    })
}));
