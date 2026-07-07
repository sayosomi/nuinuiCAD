import { descendantIdsForGroup, isGroupElement } from "./groups";
import type { CadElement, ElementId } from "../types/geometry";

export const lockedAncestorIdForElement = (
  elementsById: Map<ElementId, CadElement>,
  element: CadElement
) => {
  let parentId = element.parentGroupId;
  while (parentId) {
    const parent = elementsById.get(parentId);
    if (!parent) return null;
    if (parent.locked) return parent.id;
    parentId = parent.parentGroupId;
  }
  return null;
};

export const lockedElementIdsInSubtrees = (
  elements: CadElement[],
  rootIds: Iterable<ElementId>
) => {
  const ids = new Set<ElementId>();
  for (const rootId of rootIds) {
    const root = elements.find((element) => element.id === rootId);
    if (!root) continue;
    ids.add(root.id);
    if (isGroupElement(root)) {
      for (const descendantId of descendantIdsForGroup(elements, root.id)) {
        ids.add(descendantId);
      }
    }
  }
  return new Set(
    elements
      .filter((element) => ids.has(element.id) && element.locked)
      .map((element) => element.id)
  );
};

export const protectedElementIdsForDestructiveChange = (
  elements: CadElement[],
  rootIds: Iterable<ElementId>
) => {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const ids = new Set<ElementId>();
  for (const rootId of rootIds) {
    const root = elementsById.get(rootId);
    if (!root) continue;
    ids.add(root.id);
    if (isGroupElement(root)) {
      for (const descendantId of descendantIdsForGroup(elements, root.id)) {
        ids.add(descendantId);
      }
    }
  }

  return new Set(
    [...ids].filter((id) => {
      const element = elementsById.get(id);
      return Boolean(element?.locked || (element && lockedAncestorIdForElement(elementsById, element)));
    })
  );
};
