import { create } from "zustand";
import { sampleElements } from "../sampleData";
import type { CadElement, ElementId } from "../types/geometry";

export type CadState = {
  elements: CadElement[];
  selectedElementId: ElementId | null;
  showShortcutHelp: boolean;
  setSelectedElementId: (id: ElementId | null) => void;
  setShowShortcutHelp: (showShortcutHelp: boolean) => void;
  setElements: (elements: CadElement[]) => void;
  updateElement: (id: ElementId, patch: Partial<CadElement>) => void;
};

export const useCadStore = create<CadState>((set) => ({
  elements: sampleElements,
  selectedElementId: sampleElements[0]?.id ?? null,
  showShortcutHelp: true,
  setSelectedElementId: (selectedElementId) => set({ selectedElementId }),
  setShowShortcutHelp: (showShortcutHelp) => set({ showShortcutHelp }),
  setElements: (elements) =>
    set((state) => ({
      elements,
      selectedElementId:
        state.selectedElementId && elements.some((e) => e.id === state.selectedElementId)
          ? state.selectedElementId
          : elements[0]?.id ?? null
    })),
  updateElement: (id, patch) =>
    set((state) => ({
      elements: state.elements.map((element) =>
        element.id === id ? ({ ...element, ...patch } as CadElement) : element
      )
    }))
}));
