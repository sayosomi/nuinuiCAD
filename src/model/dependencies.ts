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

export type DependencyIndex = {
  elementsById: Map<ElementId, CadElement>;
  parentIdsByElementId: Map<ElementId, ElementId[]>;
  childIdsByElementId: Map<ElementId, ElementId[]>;
  ancestorIdsForElement: (elementId: ElementId) => Set<ElementId>;
  descendantIdsForElement: (elementId: ElementId) => Set<ElementId>;
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
      case "group":
        return [];
      case "conditionalGroup":
        return [
          ...numericVariableReferences(element),
          ...extractNumericExpressionReferences(element.condition)
        ].map((reference) => reference.elementId);
      case "forGroup":
        return [
          ...numericVariableReferences(element),
          ...extractNumericExpressionReferences(element.start),
          ...extractNumericExpressionReferences(element.count),
          ...extractNumericExpressionReferences(element.step)
        ].map((reference) => reference.elementId);
      case "variable":
        return [
          ...numericVariableReferences(element),
          ...(element.valueMode === "expression"
            ? extractNumericExpressionReferences(element.expression)
            : []),
          ...(element.valueMode === "pointDistance" || element.valueMode === "pointAngle"
            ? [
                ...pointAnchorParentIds(element.point1).map((elementId) => ({ elementId })),
                ...pointAnchorParentIds(element.point2).map((elementId) => ({ elementId }))
              ]
            : []),
          ...(element.valueMode === "pointLineDistance"
            ? [
                ...pointAnchorParentIds(element.point).map((elementId) => ({ elementId })),
                { elementId: element.lineId }
              ]
            : [])
        ].map((reference) => reference.elementId);
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
      case "lineDivisionPoint":
        return [
          ...numericVariableReferences(element),
          { elementId: element.endpoint.lineId },
          ...(element.placementMode === "distance"
            ? extractNumericExpressionReferences(element.distance)
            : extractNumericExpressionReferences(element.ratio))
        ].map((reference) => reference.elementId);
      case "intersectionPoint":
        return [
          ...numericVariableReferences(element),
          { elementId: element.line1Id },
          { elementId: element.line2Id },
          ...extractNumericExpressionReferences(element.intersectionIndex)
        ].map((reference) => reference.elementId);
      case "lineTangentOffsetPoint":
        return [
          ...numericVariableReferences(element),
          { elementId: element.baseLineId },
          ...pointAnchorParentIds(element.basePoint).map((elementId) => ({ elementId })),
          ...extractNumericExpressionReferences(element.tangentAngleDeg),
          ...extractNumericExpressionReferences(element.distance)
        ].map((reference) => reference.elementId);
      case "splitLine":
        return [
          ...numericVariableReferences(element),
          { elementId: element.baseLineId },
          ...pointAnchorParentIds(element.splitPoint).map((elementId) => ({ elementId }))
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
      case "cornerRadiusArcLine":
        return [
          ...numericVariableReferences(element),
          { elementId: element.endpoint1.lineId },
          { elementId: element.endpoint2.lineId },
          ...extractNumericExpressionReferences(element.radius),
          ...extractNumericExpressionReferences(element.intersectionIndex)
        ].map((reference) => reference.elementId);
      case "edge":
        return [
          ...numericVariableReferences(element),
          { elementId: element.endpoint1.lineId },
          { elementId: element.endpoint2.lineId },
          ...extractNumericExpressionReferences(element.intersectionIndex)
        ].map((reference) => reference.elementId);
      case "extendTrim":
        return [
          ...numericVariableReferences(element),
          { elementId: element.endpoint.lineId },
          ...pointAnchorParentIds(element.point).map((elementId) => ({ elementId }))
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
      case "offsetLine":
        return [
          ...numericVariableReferences(element),
          ...element.baseLineIds.map((elementId) => ({ elementId })),
          ...extractNumericExpressionReferences(element.offset)
        ].map((reference) => reference.elementId);
      case "copyLine":
      case "move":
        return [
          ...numericVariableReferences(element),
          ...pointAnchorParentIds(element.startPoint).map((elementId) => ({ elementId })),
          ...pointAnchorParentIds(element.endPoint).map((elementId) => ({ elementId })),
          ...extractNumericExpressionReferences(element.angleDeg),
          ...element.baseLineIds.map((elementId) => ({ elementId }))
        ].map((reference) => reference.elementId);
      case "symmetricCopyLine":
      case "symmetricMove":
        return [
          ...numericVariableReferences(element),
          ...pointAnchorParentIds(element.axisPoint1).map((elementId) => ({ elementId })),
          ...pointAnchorParentIds(element.axisPoint2).map((elementId) => ({ elementId })),
          ...element.baseLineIds.map((elementId) => ({ elementId }))
        ].map((reference) => reference.elementId);
      case "image":
        return [
          ...numericVariableReferences(element),
          ...pointAnchorParentIds(element.originPoint).map((elementId) => ({ elementId })),
          ...extractNumericExpressionReferences(element.scale),
          ...extractNumericExpressionReferences(element.angleDeg)
        ].map((reference) => reference.elementId);
    }
  };

  switch (element.type) {
    case "group":
      return [];
    case "conditionalGroup":
      return numericExpressionParentIds();
    case "forGroup":
      return numericExpressionParentIds();
    case "variable":
      return numericExpressionParentIds();
    case "freePoint":
      return numericExpressionParentIds();
    case "offsetPoint":
    case "polarOffsetPoint":
      return [
        ...pointAnchorParentIds(pointAnchorForElement(element) ?? { mode: "reference", pointId: "" }),
        ...numericExpressionParentIds()
      ].filter(Boolean);
    case "divisionPoint":
    case "lineDivisionPoint":
    case "intersectionPoint":
    case "lineTangentOffsetPoint":
      return numericExpressionParentIds();
    case "line":
    case "arcLine":
    case "threePointArcLine":
    case "cornerRadiusArcLine":
    case "edge":
    case "extendTrim":
      return numericExpressionParentIds();
    case "bezierCurve":
    case "offsetLine":
    case "splitLine":
    case "copyLine":
    case "symmetricCopyLine":
    case "move":
    case "symmetricMove":
    case "image":
      return numericExpressionParentIds();
  }
};

export const createDependencyIndex = (elements: CadElement[]): DependencyIndex => {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const parentIdsByElementId = new Map(
    elements.map((element) => [element.id, getDirectParentIds(element)])
  );
  const childIdSetsByElementId = new Map<ElementId, Set<ElementId>>();

  for (const element of elements) {
    for (const parentId of parentIdsByElementId.get(element.id) ?? []) {
      if (!elementsById.has(parentId)) continue;
      const childIds = childIdSetsByElementId.get(parentId) ?? new Set<ElementId>();
      childIds.add(element.id);
      childIdSetsByElementId.set(parentId, childIds);
    }
  }

  const childIdsByElementId = new Map(
    elements.map((element) => [
      element.id,
      [...(childIdSetsByElementId.get(element.id) ?? new Set<ElementId>())]
    ])
  );
  const ancestorCache = new Map<ElementId, Set<ElementId>>();
  const descendantCache = new Map<ElementId, Set<ElementId>>();

  const ancestorIdsForElement = (elementId: ElementId, visiting = new Set<ElementId>()) => {
    const cached = ancestorCache.get(elementId);
    if (cached) return new Set(cached);
    if (visiting.has(elementId)) return new Set<ElementId>();

    visiting.add(elementId);
    const ancestors = new Set<ElementId>();
    for (const parentId of parentIdsByElementId.get(elementId) ?? []) {
      if (!elementsById.has(parentId)) continue;
      ancestors.add(parentId);
      for (const ancestorId of ancestorIdsForElement(parentId, visiting)) {
        ancestors.add(ancestorId);
      }
    }
    visiting.delete(elementId);
    ancestorCache.set(elementId, ancestors);
    return new Set(ancestors);
  };

  const descendantIdsForElement = (elementId: ElementId, visiting = new Set<ElementId>()) => {
    const cached = descendantCache.get(elementId);
    if (cached) return new Set(cached);
    if (visiting.has(elementId)) return new Set<ElementId>();

    visiting.add(elementId);
    const descendants = new Set<ElementId>();
    for (const childId of childIdsByElementId.get(elementId) ?? []) {
      descendants.add(childId);
      for (const descendantId of descendantIdsForElement(childId, visiting)) {
        descendants.add(descendantId);
      }
    }
    visiting.delete(elementId);
    descendantCache.set(elementId, descendants);
    return new Set(descendants);
  };

  return {
    elementsById,
    parentIdsByElementId,
    childIdsByElementId,
    ancestorIdsForElement,
    descendantIdsForElement
  };
};

export const getDirectParents = (
  element: CadElement,
  elementsByIdOrIndex: Map<ElementId, CadElement> | DependencyIndex
): DependencyReference[] =>
  (elementsByIdOrIndex instanceof Map
    ? getDirectParentIds(element)
    : elementsByIdOrIndex.parentIdsByElementId.get(element.id) ?? getDirectParentIds(element)
  ).map((id) => {
    const elementsById =
      elementsByIdOrIndex instanceof Map
        ? elementsByIdOrIndex
        : elementsByIdOrIndex.elementsById;
    const parent = elementsById.get(id) ?? null;
    const ancestorCount =
      parent && !(elementsByIdOrIndex instanceof Map)
        ? elementsByIdOrIndex.ancestorIdsForElement(parent.id).size
        : (() => {
            const ancestors = new Set<ElementId>();
            if (parent) collectAncestors(parent, elementsById, ancestors);
            return ancestors.size;
          })();

    return {
      id,
      element: parent,
      ancestorCount
    };
  });

export const getDirectChildren = (
  elementId: ElementId,
  elements: CadElement[],
  index?: DependencyIndex
): CadElement[] => {
  const dependencyIndex = index ?? createDependencyIndex(elements);
  return (dependencyIndex.childIdsByElementId.get(elementId) ?? [])
    .map((id) => dependencyIndex.elementsById.get(id))
    .filter((element): element is CadElement => Boolean(element));
};

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

export const getDependencySummary = (
  element: CadElement,
  elements: CadElement[],
  index?: DependencyIndex
): DependencySummary => {
  const dependencyIndex = index ?? createDependencyIndex(elements);
  const directChildren = getDirectChildren(element.id, elements, dependencyIndex).map((child) => {
    const childDescendants = dependencyIndex.descendantIdsForElement(child.id);

    return {
      element: child,
      descendantCount: childDescendants.size
    };
  });

  const ancestors = dependencyIndex.ancestorIdsForElement(element.id);
  const descendants = dependencyIndex.descendantIdsForElement(element.id);

  return {
    parents: getDirectParents(element, dependencyIndex),
    children: directChildren,
    ancestorCount: ancestors.size,
    descendantCount: descendants.size
  };
};

export const getDependencyJumpTargets = (
  element: CadElement | null,
  elements: CadElement[],
  index?: DependencyIndex
): CadElement[] => {
  if (!element) return [];

  const summary = getDependencySummary(element, elements, index);
  const targets = new Map<ElementId, CadElement>();

  for (const parent of summary.parents) {
    if (parent.element) targets.set(parent.element.id, parent.element);
  }
  for (const child of summary.children) {
    targets.set(child.element.id, child.element);
  }

  return Array.from(targets.values());
};
