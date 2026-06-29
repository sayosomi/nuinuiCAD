import { create } from "zustand";
import { sampleElements } from "../sampleData";
import { fallbackElementName, makeUniqueElementName } from "../model/elementNames";
import { normalizeParameterKey } from "../parameters/parameterDefinitions";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import type { CadElement, ElementId } from "../types/geometry";

export type CadDocumentSnapshot = {
  elements: CadElement[];
  evaluationLimitIndex: number;
  selectedElementId: ElementId | null;
  selectedElementIds: ElementId[];
  selectionAnchorElementId: ElementId | null;
  selectedParameterKey: ParameterKey | null;
};

export type CadDocumentState = CadDocumentSnapshot & {
  past: CadDocumentSnapshot[];
  future: CadDocumentSnapshot[];
  currentFilePath: string | null;
  dirtySinceSave: boolean;
  setSelectedElementId: (id: ElementId | null) => void;
  setSelectedElementIds: (ids: ElementId[], primaryId?: ElementId | null) => void;
  setSelectedElementRange: (anchorId: ElementId, targetId: ElementId) => void;
  setSelectedParameterKey: (selectedParameterKey: ParameterKey | null) => void;
  previewDocumentChange: (change: Partial<CadDocumentSnapshot>) => void;
  commitDocumentChange: (change: Partial<CadDocumentSnapshot>) => void;
  commitDocumentChangeFromSnapshot: (
    before: CadDocumentSnapshot,
    change: Partial<CadDocumentSnapshot>
  ) => void;
  setElements: (elements: CadElement[]) => void;
  updateElement: (id: ElementId, patch: Partial<CadElement>) => void;
  renameElement: (id: ElementId, requestedName: string) => void;
  replaceDocument: (snapshot: CadDocumentSnapshot, filePath: string | null) => void;
  markDocumentSaved: (filePath: string) => void;
  undo: () => void;
  redo: () => void;
};

export const currentDocumentSnapshot = (state: CadDocumentSnapshot): CadDocumentSnapshot => ({
  elements: state.elements,
  evaluationLimitIndex: state.evaluationLimitIndex,
  selectedElementId: state.selectedElementId,
  selectedElementIds: state.selectedElementIds,
  selectionAnchorElementId: state.selectionAnchorElementId,
  selectedParameterKey: state.selectedParameterKey
});

const uniqueElementIds = (ids: ElementId[]) => Array.from(new Set(ids));

const normalizeSnapshot = (snapshot: CadDocumentSnapshot): CadDocumentSnapshot => {
  const existingIds = new Set(snapshot.elements.map((element) => element.id));
  const evaluationLimitIndex = Math.min(
    Math.max(snapshot.evaluationLimitIndex ?? snapshot.elements.length, 0),
    snapshot.elements.length
  );
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
    evaluationLimitIndex,
    selectedElementId,
    selectedElementIds: normalizedSelectedElementIds,
    selectionAnchorElementId,
    selectedParameterKey: selectedElement
      ? normalizeParameterKey(selectedElement, snapshot.selectedParameterKey)
      : null
  };
};

const snapshotEquals = (a: CadDocumentSnapshot, b: CadDocumentSnapshot) =>
  a.elements === b.elements &&
  a.evaluationLimitIndex === b.evaluationLimitIndex &&
  a.selectedElementId === b.selectedElementId &&
  a.selectedElementIds.length === b.selectedElementIds.length &&
  a.selectedElementIds.every((id, index) => id === b.selectedElementIds[index]) &&
  a.selectionAnchorElementId === b.selectionAnchorElementId &&
  a.selectedParameterKey === b.selectedParameterKey;

export const initialCadDocumentState = (): CadDocumentSnapshot &
  Pick<CadDocumentState, "past" | "future" | "currentFilePath" | "dirtySinceSave"> => ({
  elements: sampleElements,
  evaluationLimitIndex: sampleElements.length,
  selectedElementId: sampleElements[0]?.id ?? null,
  selectedElementIds: sampleElements[0] ? [sampleElements[0].id] : [],
  selectionAnchorElementId: sampleElements[0]?.id ?? null,
  selectedParameterKey: sampleElements[0] ? normalizeParameterKey(sampleElements[0], null) : null,
  past: [],
  future: [],
  currentFilePath: null,
  dirtySinceSave: false
});

export const useCadDocumentStore = create<CadDocumentState>((set) => ({
  ...initialCadDocumentState(),
  setSelectedElementId: (selectedElementId) =>
    set((state) => {
      const selectedElement = state.elements.find((element) => element.id === selectedElementId);
      return {
        selectedElementId,
        selectedElementIds: selectedElement ? [selectedElement.id] : [],
        selectionAnchorElementId: selectedElement?.id ?? null,
        selectedParameterKey: selectedElement
          ? normalizeParameterKey(selectedElement, state.selectedParameterKey)
          : null
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
          : null
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
        selectedParameterKey: normalizeParameterKey(selectedElement, state.selectedParameterKey)
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
  previewDocumentChange: (change) =>
    set((state) => normalizeSnapshot({ ...currentDocumentSnapshot(state), ...change })),
  commitDocumentChange: (change) =>
    set((state) => {
      const before = currentDocumentSnapshot(state);
      const after = normalizeSnapshot({ ...before, ...change });
      if (snapshotEquals(before, after)) return {};

      return {
        ...after,
        past: [...state.past, before],
        future: [],
        dirtySinceSave: true
      };
    }),
  commitDocumentChangeFromSnapshot: (before, change) =>
    set((state) => {
      const after = normalizeSnapshot({ ...before, ...change });
      if (snapshotEquals(before, after)) return {};

      return {
        ...after,
        past: [...state.past, before],
        future: [],
        dirtySinceSave: true
      };
    }),
  setElements: (elements) => useCadDocumentStore.getState().commitDocumentChange({ elements }),
  updateElement: (id, patch) =>
    set((state) => {
      if (!state.elements.some((element) => element.id === id)) return {};

      const before = currentDocumentSnapshot(state);
      const after = normalizeSnapshot({
        ...before,
        elements: state.elements.map((element) =>
          element.id === id ? ({ ...element, ...patch } as CadElement) : element
        )
      });

      return {
        ...after,
        past: [...state.past, before],
        future: [],
        dirtySinceSave: true
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

      const before = currentDocumentSnapshot(state);
      const after = normalizeSnapshot({
        ...before,
        elements: state.elements.map((element) =>
          element.id === id ? { ...element, name: uniqueName } : element
        )
      });

      return {
        ...after,
        past: [...state.past, before],
        future: [],
        dirtySinceSave: true
      };
    }),
  replaceDocument: (snapshot, currentFilePath) =>
    set(() => ({
      ...normalizeSnapshot(snapshot),
      past: [],
      future: [],
      currentFilePath,
      dirtySinceSave: false
    })),
  markDocumentSaved: (currentFilePath) =>
    set({
      currentFilePath,
      dirtySinceSave: false
    }),
  undo: () =>
    set((state) => {
      const previous = state.past.at(-1);
      if (!previous) return {};

      return {
        ...previous,
        past: state.past.slice(0, -1),
        future: [currentDocumentSnapshot(state), ...state.future],
        dirtySinceSave: true
      };
    }),
  redo: () =>
    set((state) => {
      const next = state.future[0];
      if (!next) return {};

      return {
        ...next,
        past: [...state.past, currentDocumentSnapshot(state)],
        future: state.future.slice(1),
        dirtySinceSave: true
      };
    })
}));
