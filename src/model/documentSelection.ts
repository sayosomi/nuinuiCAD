import type { CadElement, ElementId } from "../types/geometry";

export const elementIdsInDocumentOrder = (elements: CadElement[], ids: ElementId[]) => {
  const selectedIds = new Set(ids);
  return elements.filter((element) => selectedIds.has(element.id)).map((element) => element.id);
};

export const selectedIndexes = (elements: CadElement[], selectedIds: ElementId[]) => {
  const idSet = new Set(selectedIds);
  return elements
    .map((element, index) => (idSet.has(element.id) ? index : -1))
    .filter((index) => index >= 0);
};

export const elementIdByOffset = (
  elements: CadElement[],
  selectedElementId: ElementId | null,
  offset: number
) => {
  if (elements.length === 0) return null;

  const selectedIndex = selectedElementId
    ? elements.findIndex((element) => element.id === selectedElementId)
    : -1;
  const currentIndex = selectedIndex < 0 ? 0 : selectedIndex;
  const nextIndex = Math.min(Math.max(currentIndex + offset, 0), elements.length - 1);
  return elements[nextIndex].id;
};

export const selectionRangeIds = (
  elements: CadElement[],
  anchorId: ElementId,
  targetId: ElementId
) => {
  const anchorIndex = elements.findIndex((element) => element.id === anchorId);
  const targetIndex = elements.findIndex((element) => element.id === targetId);
  if (anchorIndex < 0 || targetIndex < 0) return [];

  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return elements.slice(start, end + 1).map((element) => element.id);
};

export const toggleSelectionIds = (
  elements: CadElement[],
  selectedElementIds: ElementId[],
  elementId: ElementId
) => {
  if (!elements.some((element) => element.id === elementId)) return null;

  const selectedIds = new Set(selectedElementIds);
  let primaryId = elementId;
  if (selectedIds.has(elementId) && selectedIds.size > 1) {
    selectedIds.delete(elementId);
    primaryId = [...selectedIds][0];
  } else {
    selectedIds.add(elementId);
  }

  return {
    selectedElementIds: [...selectedIds],
    selectedElementId: primaryId
  };
};
