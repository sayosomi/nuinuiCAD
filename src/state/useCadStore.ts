import { create } from "zustand";
import { sampleElements } from "../sampleData";
import { fallbackElementName, makeUniqueElementName } from "../model/elementNames";
import { normalizeParameterKey } from "../parameters/parameterDefinitions";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import type { CadElement, ElementId } from "../types/geometry";

export type CadHistorySnapshot = {
  elements: CadElement[];
  selectedElementId: ElementId | null;
  isParameterEditMode: boolean;
  selectedParameterKey: ParameterKey | null;
};

export type CadState = {
  elements: CadElement[];
  selectedElementId: ElementId | null;
  isParameterEditMode: boolean;
  selectedParameterKey: ParameterKey | null;
  showShortcutHelp: boolean;
  showCommandPalette: boolean;
  past: CadHistorySnapshot[];
  future: CadHistorySnapshot[];
  setSelectedElementId: (id: ElementId | null) => void;
  setParameterEditMode: (isParameterEditMode: boolean) => void;
  setSelectedParameterKey: (selectedParameterKey: ParameterKey | null) => void;
  setShowShortcutHelp: (showShortcutHelp: boolean) => void;
  setShowCommandPalette: (showCommandPalette: boolean) => void;
  commitDocumentChange: (change: Partial<CadHistorySnapshot>) => void;
  setElements: (elements: CadElement[]) => void;
  updateElement: (id: ElementId, patch: Partial<CadElement>) => void;
  renameElement: (id: ElementId, requestedName: string) => void;
  undo: () => void;
  redo: () => void;
};

const currentSnapshot = (state: CadHistorySnapshot): CadHistorySnapshot => ({
  elements: state.elements,
  selectedElementId: state.selectedElementId,
  isParameterEditMode: state.isParameterEditMode,
  selectedParameterKey: state.selectedParameterKey
});

const normalizeSnapshot = (snapshot: CadHistorySnapshot): CadHistorySnapshot => {
  const selectedElementId =
    snapshot.selectedElementId && snapshot.elements.some((element) => element.id === snapshot.selectedElementId)
      ? snapshot.selectedElementId
      : snapshot.elements[0]?.id ?? null;
  const selectedElement = snapshot.elements.find((element) => element.id === selectedElementId);

  return {
    elements: snapshot.elements,
    selectedElementId,
    selectedParameterKey: selectedElement
      ? normalizeParameterKey(selectedElement, snapshot.selectedParameterKey)
      : null,
    isParameterEditMode: selectedElement ? snapshot.isParameterEditMode : false
  };
};

const snapshotEquals = (a: CadHistorySnapshot, b: CadHistorySnapshot) =>
  a.elements === b.elements &&
  a.selectedElementId === b.selectedElementId &&
  a.isParameterEditMode === b.isParameterEditMode &&
  a.selectedParameterKey === b.selectedParameterKey;

export const useCadStore = create<CadState>((set) => ({
  elements: sampleElements,
  selectedElementId: sampleElements[0]?.id ?? null,
  isParameterEditMode: false,
  selectedParameterKey: sampleElements[0] ? normalizeParameterKey(sampleElements[0], null) : null,
  showShortcutHelp: true,
  showCommandPalette: false,
  past: [],
  future: [],
  setSelectedElementId: (selectedElementId) =>
    set((state) => {
      const selectedElement = state.elements.find((element) => element.id === selectedElementId);
      return {
        selectedElementId,
        selectedParameterKey: selectedElement
          ? normalizeParameterKey(selectedElement, state.selectedParameterKey)
          : null,
        isParameterEditMode: selectedElement ? state.isParameterEditMode : false
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
  setShowShortcutHelp: (showShortcutHelp) => set({ showShortcutHelp }),
  setShowCommandPalette: (showCommandPalette) => set({ showCommandPalette }),
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
