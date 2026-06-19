import type { CadElement, ElementId } from "../types/geometry";
import { elementIdsInDocumentOrder } from "./documentSelection";

export type DocumentOrderChange = {
  elements: CadElement[];
  selectedElementId: ElementId | null;
  selectedElementIds: ElementId[];
  selectionAnchorElementId: ElementId | null;
};

export const moveElementsToInsertionIndex = ({
  elements,
  elementIds,
  insertionIndex,
  selectedElementId,
  selectionAnchorElementId
}: {
  elements: CadElement[];
  elementIds: ElementId[];
  insertionIndex: number;
  selectedElementId: ElementId | null;
  selectionAnchorElementId: ElementId | null;
}): DocumentOrderChange | null => {
  const movingIds = elementIdsInDocumentOrder(elements, elementIds);
  if (movingIds.length === 0) return null;

  const movingIdSet = new Set(movingIds);
  const firstMovingIndex = elements.findIndex((element) => movingIdSet.has(element.id));
  const clampedInsertionIndex = Math.min(Math.max(insertionIndex, 0), elements.length);
  const movedBeforeInsertion = elements
    .slice(0, clampedInsertionIndex)
    .filter((element) => movingIdSet.has(element.id)).length;
  const remainingElements = elements.filter((element) => !movingIdSet.has(element.id));
  const targetIndex = clampedInsertionIndex - movedBeforeInsertion;
  const movingElements = elements.filter((element) => movingIdSet.has(element.id));

  const isNoop =
    targetIndex === firstMovingIndex &&
    movingElements.every((element, index) => elements[firstMovingIndex + index]?.id === element.id);
  if (isNoop) return null;

  const nextElements = [
    ...remainingElements.slice(0, targetIndex),
    ...movingElements,
    ...remainingElements.slice(targetIndex)
  ];

  if (movingIds.length === 1) {
    return {
      elements: nextElements,
      selectedElementId: movingIds[0],
      selectedElementIds: [movingIds[0]],
      selectionAnchorElementId: movingIds[0]
    };
  }

  return {
    elements: nextElements,
    selectedElementId: selectedElementId && movingIdSet.has(selectedElementId)
      ? selectedElementId
      : movingIds[0],
    selectedElementIds: movingIds,
    selectionAnchorElementId: selectionAnchorElementId ?? movingIds[0]
  };
};
