import { isNumericExpression } from "../geometry/numericExpressions";
import { tokenize, type Token } from "../geometry/numericExpressionParser";
import type {
  CadElement,
  ElementId,
  LineEndpointReference,
  NumericValue,
  PointAnchor
} from "../types/geometry";
import { createCadElementId } from "./cadIds";
import { elementIdsInDocumentOrder, selectedIndexes } from "./documentSelection";
import { fallbackElementName, makeUniqueElementName } from "./elementNames";
import { subtreeIdsForElement } from "./groups";

type DuplicateElementsOptions = {
  createId?: (type: CadElement["type"]) => ElementId;
};

export type DuplicateElementsChange = {
  elements: CadElement[];
};

export type DuplicateElementsResult = DuplicateElementsChange & {
  selectedElementId: ElementId | null;
  selectedElementIds: ElementId[];
  selectionAnchorElementId: ElementId | null;
};

const uniqueIds = (ids: ElementId[]) => Array.from(new Set(ids));

const mapId = (id: ElementId, idMap: Map<ElementId, ElementId>) => idMap.get(id) ?? id;

const remapPointAnchor = (anchor: PointAnchor, idMap: Map<ElementId, ElementId>): PointAnchor => {
  if (anchor.mode === "reference") {
    return { ...anchor, pointId: mapId(anchor.pointId, idMap) };
  }
  if (anchor.mode === "derived") {
    return { ...anchor, elementId: mapId(anchor.elementId, idMap) };
  }
  return {
    ...anchor,
    x: remapNumericValue(anchor.x, idMap),
    y: remapNumericValue(anchor.y, idMap)
  };
};

const remapEndpoint = (
  endpoint: LineEndpointReference,
  idMap: Map<ElementId, ElementId>
): LineEndpointReference => ({
  ...endpoint,
  lineId: mapId(endpoint.lineId, idMap)
});

const tokenText = (token: Token, idMap: Map<ElementId, ElementId>) => {
  switch (token.type) {
    case "number":
      return `${token.value}`;
    case "reference":
      return `${mapId(token.elementId, idMap)}.${token.property}`;
    case "element":
      return mapId(token.elementId, idMap);
    case "localVariable":
      return `@${mapId(token.variableId, idMap)}`;
    case "function":
      return token.name;
    case "operator":
      return ` ${token.value} `;
    case "comparisonOperator":
      return ` ${token.value} `;
    case "logicalOperator":
      return ` ${token.value} `;
    case "comma":
      return ", ";
    case "leftParen":
      return "(";
    case "rightParen":
      return ")";
  }
};

const remapExpression = (expression: string, idMap: Map<ElementId, ElementId>) => {
  try {
    const tokens = tokenize(expression);
    const referencesCopiedElement = tokens.some(
      (token) =>
        ((token.type === "reference" || token.type === "element") &&
          idMap.has(token.elementId)) ||
        (token.type === "localVariable" && idMap.has(token.variableId))
    );
    if (!referencesCopiedElement) return expression;
    return tokens.map((token) => tokenText(token, idMap)).join("").replace(/\s+/g, " ").trim();
  } catch {
    return expression;
  }
};

const remapNumericValue = (value: NumericValue, idMap: Map<ElementId, ElementId>): NumericValue =>
  isNumericExpression(value)
    ? { ...value, expression: remapExpression(value.expression, idMap) }
    : value;

const remapNumericFields = <T extends CadElement>(element: T, idMap: Map<ElementId, ElementId>): T => ({
  ...element,
  numericVariables: element.numericVariables?.map((variable) => ({
    ...variable,
    value: remapNumericValue(variable.value, idMap)
  }))
});

const remapBaseLineIds = (baseLineIds: ElementId[], idMap: Map<ElementId, ElementId>) =>
  baseLineIds.map((id) => mapId(id, idMap));

export const remapElementReferences = (source: CadElement, idMap: Map<ElementId, ElementId>): CadElement => {
  const element = remapNumericFields(source, idMap);

  switch (element.type) {
    case "group":
      return element;
    case "conditionalGroup":
      return {
        ...element,
        condition: remapNumericValue(element.condition, idMap)
      };
    case "forGroup":
      return {
        ...element,
        start: remapNumericValue(element.start, idMap),
        count: remapNumericValue(element.count, idMap),
        step: remapNumericValue(element.step, idMap)
      };
    case "variable":
      return {
        ...element,
        expression: remapNumericValue(element.expression, idMap),
        point1: remapPointAnchor(element.point1, idMap),
        point2: remapPointAnchor(element.point2, idMap),
        point: remapPointAnchor(element.point, idMap),
        lineId: mapId(element.lineId, idMap)
      };
    case "freePoint":
      return {
        ...element,
        x: remapNumericValue(element.x, idMap),
        y: remapNumericValue(element.y, idMap)
      };
    case "offsetPoint":
      return {
        ...element,
        fromPoint: element.fromPoint ? remapPointAnchor(element.fromPoint, idMap) : element.fromPoint,
        fromPointId: element.fromPointId ? mapId(element.fromPointId, idMap) : element.fromPointId,
        dx: remapNumericValue(element.dx, idMap),
        dy: remapNumericValue(element.dy, idMap)
      };
    case "polarOffsetPoint":
      return {
        ...element,
        fromPoint: element.fromPoint ? remapPointAnchor(element.fromPoint, idMap) : element.fromPoint,
        fromPointId: element.fromPointId ? mapId(element.fromPointId, idMap) : element.fromPointId,
        angleDeg: remapNumericValue(element.angleDeg, idMap),
        distance: remapNumericValue(element.distance, idMap)
      };
    case "divisionPoint":
      return {
        ...element,
        startPoint: remapPointAnchor(element.startPoint, idMap),
        endPoint: remapPointAnchor(element.endPoint, idMap),
        placement: { ...element.placement, value: remapNumericValue(element.placement.value, idMap) }
      };
    case "lineDivisionPoint":
      return {
        ...element,
        endpoint: remapEndpoint(element.endpoint, idMap),
        placement: { ...element.placement, value: remapNumericValue(element.placement.value, idMap) }
      };
    case "intersectionPoint":
      return {
        ...element,
        line1Id: mapId(element.line1Id, idMap),
        line2Id: mapId(element.line2Id, idMap),
        intersectionIndex: remapNumericValue(element.intersectionIndex, idMap)
      };
    case "lineTangentOffsetPoint":
      return {
        ...element,
        baseLineId: mapId(element.baseLineId, idMap),
        basePoint: remapPointAnchor(element.basePoint, idMap),
        tangentAngleDeg: remapNumericValue(element.tangentAngleDeg, idMap),
        distance: remapNumericValue(element.distance, idMap)
      };
    case "line":
      return {
        ...element,
        startPoint: remapPointAnchor(element.startPoint, idMap),
        endPoint: remapPointAnchor(element.endPoint, idMap)
      };
    case "angleLengthLine":
      return {
        ...element,
        startPoint: remapPointAnchor(element.startPoint, idMap),
        angleDeg: remapNumericValue(element.angleDeg, idMap),
        length: remapNumericValue(element.length, idMap)
      };
    case "arcLine":
      return {
        ...element,
        centerPoint: remapPointAnchor(element.centerPoint, idMap),
        radius: remapNumericValue(element.radius, idMap),
        startAngleDeg: remapNumericValue(element.startAngleDeg, idMap),
        endAngleDeg: remapNumericValue(element.endAngleDeg, idMap)
      };
    case "threePointArcLine":
      return {
        ...element,
        point1: remapPointAnchor(element.point1, idMap),
        point2: remapPointAnchor(element.point2, idMap),
        point3: remapPointAnchor(element.point3, idMap),
        startAngleDeg: remapNumericValue(element.startAngleDeg, idMap),
        endAngleDeg: remapNumericValue(element.endAngleDeg, idMap)
      };
    case "cornerRadiusArcLine":
    case "edge":
      return {
        ...element,
        endpoint1: remapEndpoint(element.endpoint1, idMap),
        endpoint2: remapEndpoint(element.endpoint2, idMap),
        intersectionIndex: remapNumericValue(element.intersectionIndex, idMap),
        ...("radius" in element ? { radius: remapNumericValue(element.radius, idMap) } : {})
      };
    case "extendTrim":
      return {
        ...element,
        endpoint: remapEndpoint(element.endpoint, idMap),
        point: remapPointAnchor(element.point, idMap)
      };
    case "bezierCurve":
      return {
        ...element,
        startPoint: remapPointAnchor(element.startPoint, idMap),
        startHandleAngleDeg: remapNumericValue(element.startHandleAngleDeg, idMap),
        startHandleLength: remapNumericValue(element.startHandleLength, idMap),
        intermediatePoints: element.intermediatePoints.map((point) => ({
          ...point,
          point: remapPointAnchor(point.point, idMap),
          handleAngleDeg: remapNumericValue(point.handleAngleDeg, idMap),
          incomingHandleLength: remapNumericValue(point.incomingHandleLength, idMap),
          outgoingHandleLength: remapNumericValue(point.outgoingHandleLength, idMap)
        })),
        endPoint: remapPointAnchor(element.endPoint, idMap),
        endHandleAngleDeg: remapNumericValue(element.endHandleAngleDeg, idMap),
        endHandleLength: remapNumericValue(element.endHandleLength, idMap)
      };
    case "offsetLine":
      return {
        ...element,
        baseLineIds: remapBaseLineIds(element.baseLineIds, idMap),
        offset: remapNumericValue(element.offset, idMap)
      };
    case "splitLine":
      return {
        ...element,
        baseLineId: mapId(element.baseLineId, idMap),
        splitPoint: remapPointAnchor(element.splitPoint, idMap)
      };
    case "copyLine":
    case "move":
      return {
        ...element,
        startPoint: remapPointAnchor(element.startPoint, idMap),
        endPoint: remapPointAnchor(element.endPoint, idMap),
        scale: remapNumericValue(element.scale, idMap),
        angleDeg: remapNumericValue(element.angleDeg, idMap),
        baseLineIds: remapBaseLineIds(element.baseLineIds, idMap)
      };
    case "symmetricCopyLine":
    case "symmetricMove":
      return {
        ...element,
        axisPoint1: remapPointAnchor(element.axisPoint1, idMap),
        axisPoint2: remapPointAnchor(element.axisPoint2, idMap),
        baseLineIds: remapBaseLineIds(element.baseLineIds, idMap)
      };
    case "image":
      return {
        ...element,
        originPoint: remapPointAnchor(element.originPoint, idMap),
        scale: remapNumericValue(element.scale, idMap),
        angleDeg: remapNumericValue(element.angleDeg, idMap)
      };
    case "text":
      return {
        ...element,
        anchor: element.anchor ? remapPointAnchor(element.anchor, idMap) : null,
        fontSize: remapNumericValue(element.fontSize, idMap)
      };
  }
};

export const duplicateElements = (
  elements: CadElement[],
  elementIds: ElementId[],
  options: DuplicateElementsOptions = {}
): DuplicateElementsResult | null => {
  const selectedIds = new Set(elementIds);
  if (selectedIds.size === 0) return null;

  const expandedIds = uniqueIds(elementIds.flatMap((id) => subtreeIdsForElement(elements, id)));
  const orderedIds = elementIdsInDocumentOrder(elements, expandedIds);
  if (orderedIds.length === 0) return null;

  const insertionIndexes = selectedIndexes(elements, orderedIds);
  const insertionIndex = (insertionIndexes.at(-1) ?? -1) + 1;
  if (insertionIndex <= 0) return null;

  const createId = options.createId ?? createCadElementId;
  const idMap = new Map<ElementId, ElementId>();
  for (const id of orderedIds) {
    const element = elements.find((item) => item.id === id);
    if (element) idMap.set(id, createId(element.type));
  }

  const copiedElements: CadElement[] = [];
  for (const original of elements.filter((element) => idMap.has(element.id))) {
    const copy = structuredClone(original) as CadElement;
    const copiedId = idMap.get(original.id);
    if (!copiedId) continue;

    const baseName = original.name.trim() || fallbackElementName(original.type);
    const copiedParentGroupId = copy.parentGroupId ? mapId(copy.parentGroupId, idMap) : copy.parentGroupId;
    const renamed = {
      ...copy,
      id: copiedId,
      name: makeUniqueElementName({
        elements: [...elements, ...copiedElements],
        elementId: copiedId,
        requestedName: `${baseName} コピー`,
        fallbackBaseName: `${fallbackElementName(original.type)} コピー`,
        parentGroupId: copiedParentGroupId
      }),
      parentGroupId: copiedParentGroupId
    } as CadElement;
    copiedElements.push(remapElementReferences(renamed, idMap));
  }

  const copiedIds = copiedElements.map((element) => element.id);
  return {
    elements: [
      ...elements.slice(0, insertionIndex),
      ...copiedElements,
      ...elements.slice(insertionIndex)
    ],
    selectedElementId: copiedIds.at(-1) ?? null,
    selectedElementIds: copiedIds,
    selectionAnchorElementId: copiedIds[0] ?? null
  };
};
