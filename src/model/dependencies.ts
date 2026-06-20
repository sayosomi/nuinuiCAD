import type { CadElement, ElementId, PointAnchor } from "../types/geometry";
import { extractNumericExpressionReferences } from "../geometry/numericExpressions";
import { anchorReferenceElementId, pointAnchorForElement } from "./pointAnchors";

export type DependencyReference = {
  id: ElementId;
  element: CadElement | null;
  ancestorCount: number;
};

export type DependencyChildReference = {
  element: CadElement;
  descendantCount: number;
};

export type DependencySummary = {
  parents: DependencyReference[];
  children: DependencyChildReference[];
  ancestorCount: number;
  descendantCount: number;
};

const numericVariableReferences = (element: CadElement) =>
  (element.numericVariables ?? []).flatMap((variable) =>
    extractNumericExpressionReferences(variable.value)
  );

const pointAnchorParentIds = (anchor: PointAnchor) =>
  anchor.mode === "coordinate"
    ? [
        ...extractNumericExpressionReferences(anchor.x),
        ...extractNumericExpressionReferences(anchor.y)
      ].map((reference) => reference.elementId)
    : [anchorReferenceElementId(anchor)].filter((id): id is ElementId => Boolean(id));

export const getDirectParentIds = (element: CadElement): ElementId[] => {
  const numericExpressionParentIds = () => {
    switch (element.type) {
      case "freePoint":
        return [
          ...numericVariableReferences(element),
          ...extractNumericExpressionReferences(element.x),
          ...extractNumericExpressionReferences(element.y)
        ].map((reference) => reference.elementId);
      case "offsetPoint":
        return [
          ...numericVariableReferences(element),
          ...extractNumericExpressionReferences(element.dx),
          ...extractNumericExpressionReferences(element.dy)
        ].map((reference) => reference.elementId);
      case "polarOffsetPoint":
        return [
          ...numericVariableReferences(element),
          ...extractNumericExpressionReferences(element.angleDeg),
          ...extractNumericExpressionReferences(element.distance)
        ].map((reference) => reference.elementId);
      case "divisionPoint":
        return [
          ...numericVariableReferences(element),
          ...pointAnchorParentIds(element.startPoint).map((elementId) => ({ elementId })),
          ...pointAnchorParentIds(element.endPoint).map((elementId) => ({ elementId })),
          ...(element.placementMode === "distance"
            ? extractNumericExpressionReferences(element.distance)
            : extractNumericExpressionReferences(element.ratio))
        ].map((reference) => reference.elementId);
      case "line":
        return [
          ...numericVariableReferences(element),
          ...pointAnchorParentIds(element.startPoint).map((elementId) => ({ elementId })),
          ...pointAnchorParentIds(element.endPoint).map((elementId) => ({ elementId }))
        ].map((reference) => reference.elementId);
      case "arcLine":
        return [
          ...numericVariableReferences(element),
          ...pointAnchorParentIds(element.centerPoint).map((elementId) => ({ elementId })),
          ...extractNumericExpressionReferences(element.radius),
          ...extractNumericExpressionReferences(element.startAngleDeg),
          ...extractNumericExpressionReferences(element.endAngleDeg)
        ].map((reference) => reference.elementId);
      case "threePointArcLine":
        return [
          ...numericVariableReferences(element),
          ...pointAnchorParentIds(element.point1).map((elementId) => ({ elementId })),
          ...pointAnchorParentIds(element.point2).map((elementId) => ({ elementId })),
          ...pointAnchorParentIds(element.point3).map((elementId) => ({ elementId })),
          ...extractNumericExpressionReferences(element.startAngleDeg),
          ...extractNumericExpressionReferences(element.endAngleDeg)
        ].map((reference) => reference.elementId);
      case "bezierCurve":
        return [
          ...numericVariableReferences(element),
          ...pointAnchorParentIds(element.startPoint).map((elementId) => ({ elementId })),
          ...extractNumericExpressionReferences(element.startHandleAngleDeg),
          ...extractNumericExpressionReferences(element.startHandleLength),
          ...element.intermediatePoints.flatMap((point) => [
            ...pointAnchorParentIds(point.point).map((elementId) => ({ elementId })),
            ...extractNumericExpressionReferences(point.handleAngleDeg),
            ...extractNumericExpressionReferences(point.incomingHandleLength),
            ...extractNumericExpressionReferences(point.outgoingHandleLength)
          ]),
          ...pointAnchorParentIds(element.endPoint).map((elementId) => ({ elementId })),
          ...extractNumericExpressionReferences(element.endHandleAngleDeg),
          ...extractNumericExpressionReferences(element.endHandleLength)
        ].map((reference) => reference.elementId);
    }
  };

  switch (element.type) {
    case "freePoint":
      return numericExpressionParentIds();
    case "offsetPoint":
    case "polarOffsetPoint":
      return [
        ...pointAnchorParentIds(pointAnchorForElement(element) ?? { mode: "reference", pointId: "" }),
        ...numericExpressionParentIds()
      ].filter(Boolean);
    case "divisionPoint":
      return numericExpressionParentIds();
    case "line":
    case "arcLine":
    case "threePointArcLine":
      return numericExpressionParentIds();
    case "bezierCurve":
      return numericExpressionParentIds();
  }
};

export const getDirectParents = (
  element: CadElement,
  elementsById: Map<ElementId, CadElement>
): DependencyReference[] =>
  getDirectParentIds(element).map((id) => {
    const parent = elementsById.get(id) ?? null;
    const ancestors = new Set<ElementId>();

    if (parent) {
      collectAncestors(parent, elementsById, ancestors);
    }

    return {
      id,
      element: parent,
      ancestorCount: ancestors.size
    };
  });

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
  const directChildren = getDirectChildren(element.id, elements).map((child) => {
    const childDescendants = new Set<ElementId>();
    collectDescendants(child.id, elements, childDescendants);

    return {
      element: child,
      descendantCount: childDescendants.size
    };
  });

  collectAncestors(element, elementsById, ancestors);
  collectDescendants(element.id, elements, descendants);

  return {
    parents: getDirectParents(element, elementsById),
    children: directChildren,
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
    targets.set(child.element.id, child.element);
  }

  return Array.from(targets.values());
};
