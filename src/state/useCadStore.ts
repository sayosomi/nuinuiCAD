import { create } from "zustand";
import { sampleElements } from "../sampleData";
import { normalizeParameterKey } from "../parameters/parameterDefinitions";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import type { CadElement, ElementId } from "../types/geometry";

export type CadState = {
  elements: CadElement[];
  selectedElementId: ElementId | null;
  isParameterEditMode: boolean;
  selectedParameterKey: ParameterKey | null;
  showShortcutHelp: boolean;
  setSelectedElementId: (id: ElementId | null) => void;
  setParameterEditMode: (isParameterEditMode: boolean) => void;
  setSelectedParameterKey: (selectedParameterKey: ParameterKey | null) => void;
  setShowShortcutHelp: (showShortcutHelp: boolean) => void;
  setElements: (elements: CadElement[]) => void;
  updateElement: (id: ElementId, patch: Partial<CadElement>) => void;
};

export const useCadStore = create<CadState>((set) => ({
  elements: sampleElements,
  selectedElementId: sampleElements[0]?.id ?? null,
  isParameterEditMode: false,
  selectedParameterKey: sampleElements[0] ? normalizeParameterKey(sampleElements[0], null) : null,
  showShortcutHelp: true,
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
  setElements: (elements) =>
    set((state) => {
      const selectedElementId =
        state.selectedElementId && elements.some((e) => e.id === state.selectedElementId)
          ? state.selectedElementId
          : elements[0]?.id ?? null;
      const selectedElement = elements.find((element) => element.id === selectedElementId);
      return {
        elements,
        selectedElementId,
        selectedParameterKey: selectedElement
          ? normalizeParameterKey(selectedElement, state.selectedParameterKey)
          : null,
        isParameterEditMode: selectedElement ? state.isParameterEditMode : false
      };
    }),
  updateElement: (id, patch) =>
    set((state) => {
      const elements = state.elements.map((element) =>
        element.id === id ? ({ ...element, ...patch } as CadElement) : element
      );
      const selectedElement = elements.find((element) => element.id === state.selectedElementId);
      return {
        elements,
        selectedParameterKey:
          id === state.selectedElementId && selectedElement
            ? normalizeParameterKey(selectedElement, state.selectedParameterKey)
            : state.selectedParameterKey
      };
    })
}));
