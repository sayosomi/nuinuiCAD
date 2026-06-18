import type { CadElement, ElementId } from "../types/geometry";

export type DependencyReference = {
  id: ElementId;
  element: CadElement | null;
};

export type DependencySummary = {
  parents: DependencyReference[];
  children: CadElement[];
  ancestorCount: number;
  descendantCount: number;
};

export const getDirectParentIds = (element: CadElement): ElementId[] => {
  switch (element.type) {
    case "freePoint":
      return [];
    case "offsetPoint":
      return [element.fromPointId];
    case "line":
      return [element.startPointId, element.endPointId];
  }
};

export const getDirectParents = (
  element: CadElement,
  elementsById: Map<ElementId, CadElement>
): DependencyReference[] =>
  getDirectParentIds(element).map((id) => ({
    id,
    element: elementsById.get(id) ?? null
  }));

export const getDirectChildren = (elementId: ElementId, elements: CadElement[]): CadElement[] =>
  elements.filter((element) => getDirectParentIds(element).includes(elementId));

const collectAncestors = (
  element: CadElement,
  elementsById: Map<ElementId, CadElement>,
  visited: Set<ElementId>
) => {
  for (const parentId of getDirectParentIds(element)) {
    const parent = elementsById.get(parentId);
    if (!parent || visited.has(parent.id)) continue;
    visited.add(parent.id);
    collectAncestors(parent, elementsById, visited);
  }
};

const collectDescendants = (
  elementId: ElementId,
  elements: CadElement[],
  visited: Set<ElementId>
) => {
  for (const child of getDirectChildren(elementId, elements)) {
    if (visited.has(child.id)) continue;
    visited.add(child.id);
    collectDescendants(child.id, elements, visited);
  }
};

export const getDependencySummary = (
  element: CadElement,
  elements: CadElement[]
): DependencySummary => {
  const elementsById = new Map(elements.map((item) => [item.id, item]));
  const ancestors = new Set<ElementId>();
  const descendants = new Set<ElementId>();

  collectAncestors(element, elementsById, ancestors);
  collectDescendants(element.id, elements, descendants);

  return {
    parents: getDirectParents(element, elementsById),
    children: getDirectChildren(element.id, elements),
    ancestorCount: ancestors.size,
    descendantCount: descendants.size
  };
};

export const getDependencyJumpTargets = (
  element: CadElement | null,
  elements: CadElement[]
): CadElement[] => {
  if (!element) return [];

  const summary = getDependencySummary(element, elements);
  const targets = new Map<ElementId, CadElement>();

  for (const parent of summary.parents) {
    if (parent.element) targets.set(parent.element.id, parent.element);
  }
  for (const child of summary.children) {
    targets.set(child.id, child);
  }

  return Array.from(targets.values());
};
