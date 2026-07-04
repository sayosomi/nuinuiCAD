import {
  isGroupElement,
  subtreeIdsForElement
} from "../model/groups";
import type {
  CadElement,
  ElementId
} from "../types/geometry";

export type ElementListDropTarget = {
  elementId: ElementId;
  insertionIndex: number;
  placement: "before" | "after" | "inside";
  targetParentGroupId?: ElementId | null;
};

export type ElementListPointerDrag =
  | {
      kind: "elements";
      pointerId: number;
      movingIds: ElementId[];
      sourceElementId: ElementId;
      target: ElementListDropTarget | null;
    }
  | {
      kind: "divider";
      pointerId: number;
      target: ElementListDropTarget | null;
    };

const AUTO_SCROLL_EDGE_SIZE = 48;
const AUTO_SCROLL_MAX_DELTA = 18;

export const elementListAutoScrollDelta = (
  rect: Pick<DOMRect, "top" | "bottom">,
  clientY: number
) => {
  if (clientY < rect.top + AUTO_SCROLL_EDGE_SIZE) {
    const distance = rect.top + AUTO_SCROLL_EDGE_SIZE - clientY;
    return -Math.min(AUTO_SCROLL_MAX_DELTA, (distance / AUTO_SCROLL_EDGE_SIZE) * AUTO_SCROLL_MAX_DELTA);
  }
  if (clientY > rect.bottom - AUTO_SCROLL_EDGE_SIZE) {
    const distance = clientY - (rect.bottom - AUTO_SCROLL_EDGE_SIZE);
    return Math.min(AUTO_SCROLL_MAX_DELTA, (distance / AUTO_SCROLL_EDGE_SIZE) * AUTO_SCROLL_MAX_DELTA);
  }
  return 0;
};

export const isNoopElementDrop = (
  elements: CadElement[],
  elementIds: ElementId[],
  insertionIndex: number
) => {
  const movingIds = elementIds.flatMap((id) => subtreeIdsForElement(elements, id));
  const indexes = elements
    .map((element, index) => (movingIds.includes(element.id) ? index : -1))
    .filter((index) => index >= 0);
  if (indexes.length === 0) return true;
  const minIndex = indexes[0];
  const maxIndex = indexes[indexes.length - 1];
  return insertionIndex >= minIndex && insertionIndex <= maxIndex + 1;
};

export const elementInsertionIndexForClientY = (
  elements: CadElement[],
  element: CadElement,
  rowIndex: number,
  rect: DOMRect,
  clientY: number
) => {
  const isAfter = clientY >= rect.top + rect.height / 2;
  if (isAfter && isGroupElement(element)) {
    const subtreeIds = subtreeIdsForElement(elements, element.id);
    const indexes = elements
      .map((item, index) => (subtreeIds.includes(item.id) ? index : -1))
      .filter((index) => index >= 0);
    return (indexes.at(-1) ?? rowIndex) + 1;
  }
  return rowIndex + (isAfter ? 1 : 0);
};

const subtreeIdSetForElement = (elements: CadElement[], elementId: ElementId) =>
  new Set(subtreeIdsForElement(elements, elementId));

const lastSubtreeIndex = (elements: CadElement[], elementId: ElementId, fallbackIndex: number) => {
  const subtreeIds = subtreeIdSetForElement(elements, elementId);
  const indexes = elements
    .map((item, index) => (subtreeIds.has(item.id) ? index : -1))
    .filter((index) => index >= 0);
  return indexes.at(-1) ?? fallbackIndex;
};

export const elementListDropTargetForRow = (
  elements: CadElement[],
  element: CadElement,
  rowIndex: number,
  rect: DOMRect,
  clientY: number
): ElementListDropTarget => {
  if (isGroupElement(element)) {
    const topBand = rect.top + rect.height / 3;
    const bottomBand = rect.bottom - rect.height / 3;
    if (clientY >= topBand && clientY <= bottomBand) {
      return {
        elementId: element.id,
        insertionIndex: lastSubtreeIndex(elements, element.id, rowIndex) + 1,
        placement: "inside",
        targetParentGroupId: element.id
      };
    }
    if (clientY > bottomBand) {
      return {
        elementId: element.id,
        insertionIndex: lastSubtreeIndex(elements, element.id, rowIndex) + 1,
        placement: "after",
        targetParentGroupId: element.parentGroupId ?? null
      };
    }
    return {
      elementId: element.id,
      insertionIndex: rowIndex,
      placement: "before",
      targetParentGroupId: element.parentGroupId ?? null
    };
  }

  const isAfter = clientY >= rect.top + rect.height / 2;
  return {
    elementId: element.id,
    insertionIndex: rowIndex + (isAfter ? 1 : 0),
    placement: isAfter ? "after" : "before",
    targetParentGroupId: element.parentGroupId ?? null
  };
};

export const elementListDropTargetForClientY = (
  elements: CadElement[],
  rowRefs: Map<ElementId, HTMLDivElement>,
  clientY: number
): ElementListDropTarget | null => {
  const rows = elements
    .map((element, index) => {
      const row = rowRefs.get(element.id);
      return row ? { element, index, rect: row.getBoundingClientRect() } : null;
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => a.rect.top - b.rect.top);

  if (rows.length === 0) return null;

  const row =
    rows.find(({ rect }) => clientY >= rect.top && clientY <= rect.bottom) ??
    rows.reduce((nearest, candidate) => {
      const nearestDistance = distanceFromRect(clientY, nearest.rect);
      const candidateDistance = distanceFromRect(clientY, candidate.rect);
      return candidateDistance < nearestDistance ? candidate : nearest;
    });

  return {
    ...elementListDropTargetForRow(
      elements,
      row.element,
      row.index,
      row.rect,
      clientY
    )
  };
};

const distanceFromRect = (clientY: number, rect: DOMRect) => {
  if (clientY < rect.top) return rect.top - clientY;
  if (clientY > rect.bottom) return clientY - rect.bottom;
  return 0;
};
