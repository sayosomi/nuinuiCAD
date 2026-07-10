import { createCadElement } from "../model/elementFactory";
import {
  applyCreationPlacement,
  creationPlacementForEvaluationLimit
} from "../model/elementCreationPlacement";
import { withCreatedElementName } from "../model/elementNames";
import { derivedAnchor, referenceAnchor } from "../model/pointAnchors";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { CadElement, CadElementType } from "../types/geometry";
import type { CommandContext } from "./commandTypes";
import { getSelectedElementIds, isLineLikeElement, isPointLikeElement } from "./commandRuntime";
import {
  finishCreatedElementInteraction,
  getInitialCreatedElementParameterKey
} from "./nameEntryAfterCreation";

const creationContext = () => {
  const { elements, evaluationLimitIndex } = useCadDocumentStore.getState();
  return {
    elements,
    ...creationPlacementForEvaluationLimit(
      elements,
      evaluationLimitIndex,
      useCadUiStore.getState().groupFoldById
    )
  };
};

const createElement = (type: CadElementType, elements: CadElement[], referenceElements: CadElement[]) =>
  createCadElement(type, elements, { referenceElements });

const commitCreatedElement = (
  element: CadElement,
  elements: CadElement[],
  insertionIndex: number,
  context?: CommandContext
) => {
  const placement = creationPlacementForEvaluationLimit(
    elements,
    insertionIndex,
    useCadUiStore.getState().groupFoldById
  );
  const placedElement = withCreatedElementName(
    applyCreationPlacement(element, placement),
    elements,
    placement.referenceElements
  );
  useCadDocumentStore.getState().commitDocumentChange({
    elements: [
      ...elements.slice(0, insertionIndex),
      placedElement,
      ...elements.slice(insertionIndex)
    ],
    evaluationLimitIndex: insertionIndex + 1,
    selectedElementId: placedElement.id,
    selectedElementIds: [placedElement.id],
    selectionAnchorElementId: placedElement.id,
    selectedParameterKey: getInitialCreatedElementParameterKey(placedElement)
  });
  finishCreatedElementInteraction(context);
};

export const addElement = (
  type: CadElementType,
  commandContext?: CommandContext
) => {
  const creation = creationContext();
  const { elements, insertionIndex, referenceElements } = creation;
  const element = createElement(type, elements, referenceElements);
  commitCreatedElement(element, elements, insertionIndex, commandContext);
};

export const addOffsetLine = (context?: CommandContext) => {
  const { elements, insertionIndex, referenceElements } = creationContext();
  const selectedIds = new Set(getSelectedElementIds());
  const selectedBaseLineIds = referenceElements
    .filter((element) => selectedIds.has(element.id) && isLineLikeElement(element))
    .map((element) => element.id);
  const fallbackBaseLineId = referenceElements.find(isLineLikeElement)?.id;
  const element = createElement("offsetLine", elements, referenceElements);
  if (element.type !== "offsetLine") return;
  const offsetLine: CadElement = {
    ...element,
    baseLineIds: selectedBaseLineIds.length > 0
      ? selectedBaseLineIds
      : fallbackBaseLineId
        ? [fallbackBaseLineId]
        : []
  };
  commitCreatedElement(offsetLine, elements, insertionIndex, context);
};

export const addSplitLine = (context?: CommandContext) => {
  const { elements, insertionIndex, referenceElements } = creationContext();
  const selectedIds = new Set(getSelectedElementIds());
  const selectedLine = referenceElements.find((element) => selectedIds.has(element.id) && isLineLikeElement(element));
  const fallbackLine = selectedLine ?? referenceElements.find(isLineLikeElement);
  const selectedPoint = referenceElements.find((element) => selectedIds.has(element.id) && isPointLikeElement(element));
  const fallbackPoint = selectedPoint ?? referenceElements.find(isPointLikeElement);
  const element = createElement("splitLine", elements, referenceElements);
  if (element.type !== "splitLine") return;
  const splitLine: CadElement = {
    ...element,
    baseLineId: fallbackLine?.id ?? "",
    splitPoint: referenceAnchor(fallbackPoint?.id ?? "")
  };
  commitCreatedElement(splitLine, elements, insertionIndex, context);
};

const selectedOrFallbackLineIds = (elements: CadElement[]) => {
  const selectedIds = new Set(getSelectedElementIds());
  const selectedBaseLineIds = elements
    .filter((element) => selectedIds.has(element.id) && isLineLikeElement(element))
    .map((element) => element.id);
  const fallbackBaseLineId = elements.find(isLineLikeElement)?.id;
  return selectedBaseLineIds.length > 0
    ? selectedBaseLineIds
    : fallbackBaseLineId
      ? [fallbackBaseLineId]
      : [];
};

const selectedOrFallbackPointPair = (elements: CadElement[]) => {
  const selectedIds = new Set(getSelectedElementIds());
  const selectedPoints = elements.filter((element) => selectedIds.has(element.id) && isPointLikeElement(element));
  const fallbackPoints = elements.filter(isPointLikeElement);
  const firstPoint = selectedPoints[0] ?? fallbackPoints[0];
  const secondPoint = selectedPoints[1] ?? fallbackPoints.find((point) => point.id !== firstPoint?.id) ?? firstPoint;
  return { firstPoint, secondPoint };
};

const addCopyLikeElement = (
  type: "copyLine" | "move",
  context?: CommandContext
) => {
  const { elements, insertionIndex, referenceElements } = creationContext();
  const { firstPoint: startPoint, secondPoint: endPoint } = selectedOrFallbackPointPair(referenceElements);
  const element = createElement(type, elements, referenceElements);
  if (element.type !== type) return;
  const copyLine: CadElement = {
    ...element,
    startPoint: referenceAnchor(startPoint?.id ?? ""),
    endPoint: referenceAnchor(endPoint?.id ?? ""),
    baseLineIds: selectedOrFallbackLineIds(referenceElements)
  };
  commitCreatedElement(copyLine, elements, insertionIndex, context);
};

export const addCopyLine = (context?: CommandContext) =>
  addCopyLikeElement("copyLine", context);

export const addMove = (context?: CommandContext) =>
  addCopyLikeElement("move", context);

export const addAngleLengthLine = (context?: CommandContext) => {
  const { elements, insertionIndex, referenceElements } = creationContext();
  const selectedIds = new Set(getSelectedElementIds());
  const selectedPoint = referenceElements.find((element) => selectedIds.has(element.id) && isPointLikeElement(element));
  const fallbackPoint = selectedPoint ?? referenceElements.find(isPointLikeElement);
  const element = createElement("angleLengthLine", elements, referenceElements);
  if (element.type !== "angleLengthLine") return;
  const angleLengthLine: CadElement = {
    ...element,
    startPoint: fallbackPoint ? referenceAnchor(fallbackPoint.id) : element.startPoint
  };
  commitCreatedElement(angleLengthLine, elements, insertionIndex, context);
};

const addSymmetricCopyLikeElement = (
  type: "symmetricCopyLine" | "symmetricMove",
  context?: CommandContext
) => {
  const { elements, insertionIndex, referenceElements } = creationContext();
  const { firstPoint: axisPoint1, secondPoint: axisPoint2 } = selectedOrFallbackPointPair(referenceElements);
  const element = createElement(type, elements, referenceElements);
  if (element.type !== type) return;
  const symmetricCopyLine: CadElement = {
    ...element,
    axisPoint1: referenceAnchor(axisPoint1?.id ?? ""),
    axisPoint2: referenceAnchor(axisPoint2?.id ?? ""),
    baseLineIds: selectedOrFallbackLineIds(referenceElements)
  };
  commitCreatedElement(symmetricCopyLine, elements, insertionIndex, context);
};

export const addSymmetricCopyLine = (context?: CommandContext) =>
  addSymmetricCopyLikeElement("symmetricCopyLine", context);

export const addSymmetricMove = (context?: CommandContext) =>
  addSymmetricCopyLikeElement("symmetricMove", context);

export const addLineDivisionPoint = (context?: CommandContext) => {
  const { elements, insertionIndex, referenceElements } = creationContext();
  const selectedIds = new Set(getSelectedElementIds());
  const selectedLine = referenceElements.find((element) => selectedIds.has(element.id) && isLineLikeElement(element));
  const fallbackLine = selectedLine ?? referenceElements.find(isLineLikeElement);
  const element = createElement("lineDivisionPoint", elements, referenceElements);
  if (element.type !== "lineDivisionPoint") return;
  const lineDivisionPoint: CadElement = {
    ...element,
    endpoint: {
      lineId: fallbackLine?.id ?? "",
      endpointKey: "start"
    }
  };
  commitCreatedElement(lineDivisionPoint, elements, insertionIndex, context);
};

export const addIntersectionPoint = (context?: CommandContext) => {
  const { elements, insertionIndex, referenceElements } = creationContext();
  const selectedIds = new Set(getSelectedElementIds());
  const selectedLines = referenceElements
    .filter((element) => selectedIds.has(element.id) && isLineLikeElement(element))
    .map((element) => element.id);
  const fallbackLines = referenceElements.filter(isLineLikeElement).map((element) => element.id);
  const element = createElement("intersectionPoint", elements, referenceElements);
  if (element.type !== "intersectionPoint") return;
  const line1Id = selectedLines[0] ?? fallbackLines[0] ?? "";
  const line2Id =
    selectedLines.find((id) => id !== line1Id) ??
    fallbackLines.find((id) => id !== line1Id) ??
    line1Id;
  const intersectionPoint: CadElement = {
    ...element,
    line1Id,
    line2Id
  };
  commitCreatedElement(intersectionPoint, elements, insertionIndex, context);
};

export const addCornerRadiusArcLine = (context?: CommandContext) => {
  const { elements, insertionIndex, referenceElements } = creationContext();
  const selectedIds = new Set(getSelectedElementIds());
  const selectedLines = referenceElements
    .filter((element) => selectedIds.has(element.id) && isLineLikeElement(element))
    .map((element) => element.id);
  const fallbackLines = referenceElements.filter(isLineLikeElement).map((element) => element.id);
  const element = createElement("cornerRadiusArcLine", elements, referenceElements);
  if (element.type !== "cornerRadiusArcLine") return;
  const line1Id = selectedLines[0] ?? fallbackLines[0] ?? "";
  const line2Id =
    selectedLines.find((id) => id !== line1Id) ??
    fallbackLines.find((id) => id !== line1Id) ??
    line1Id;
  const arc: CadElement = {
    ...element,
    endpoint1: {
      lineId: line1Id,
      endpointKey: "start"
    },
    endpoint2: {
      lineId: line2Id,
      endpointKey: "start"
    }
  };
  commitCreatedElement(arc, elements, insertionIndex, context);
};

export const addEdge = (context?: CommandContext) => {
  const { elements, insertionIndex, referenceElements } = creationContext();
  const selectedIds = new Set(getSelectedElementIds());
  const selectedLines = referenceElements
    .filter((element) => selectedIds.has(element.id) && isLineLikeElement(element))
    .map((element) => element.id);
  const fallbackLines = referenceElements.filter(isLineLikeElement).map((element) => element.id);
  const element = createElement("edge", elements, referenceElements);
  if (element.type !== "edge") return;
  const line1Id = selectedLines[0] ?? fallbackLines[0] ?? "";
  const line2Id =
    selectedLines.find((id) => id !== line1Id) ??
    fallbackLines.find((id) => id !== line1Id) ??
    line1Id;
  const edge: CadElement = {
    ...element,
    endpoint1: {
      lineId: line1Id,
      endpointKey: "start"
    },
    endpoint2: {
      lineId: line2Id,
      endpointKey: "start"
    }
  };
  commitCreatedElement(edge, elements, insertionIndex, context);
};

export const addExtendTrim = (context?: CommandContext) => {
  const { elements, insertionIndex, referenceElements } = creationContext();
  const selectedIds = new Set(getSelectedElementIds());
  const selectedLine = referenceElements.find((element) => selectedIds.has(element.id) && isLineLikeElement(element));
  const fallbackLine = selectedLine ?? referenceElements.find(isLineLikeElement);
  const selectedPoint = referenceElements.find((element) => selectedIds.has(element.id) && isPointLikeElement(element));
  const fallbackPoint = selectedPoint ?? referenceElements.find(isPointLikeElement);
  const element = createElement("extendTrim", elements, referenceElements);
  if (element.type !== "extendTrim") return;
  const extendTrim: CadElement = {
    ...element,
    endpoint: {
      lineId: fallbackLine?.id ?? "",
      endpointKey: "start"
    },
    point: referenceAnchor(fallbackPoint?.id ?? "")
  };
  commitCreatedElement(extendTrim, elements, insertionIndex, context);
};

export const addLineTangentOffsetPoint = (
  context?: CommandContext
) => {
  const { elements, insertionIndex, referenceElements } = creationContext();
  const selectedIds = new Set(getSelectedElementIds());
  const selectedLine = referenceElements.find((element) => selectedIds.has(element.id) && isLineLikeElement(element));
  const fallbackLine = selectedLine ?? referenceElements.find(isLineLikeElement);
  const selectedPoint = referenceElements.find((element) => selectedIds.has(element.id) && isPointLikeElement(element));
  const fallbackPoint = selectedPoint ?? referenceElements.find(isPointLikeElement);
  const element = createElement("lineTangentOffsetPoint", elements, referenceElements);
  if (element.type !== "lineTangentOffsetPoint") return;
  const point: CadElement = {
    ...element,
    baseLineId: fallbackLine?.id ?? "",
    basePoint: selectedPoint
      ? referenceAnchor(selectedPoint.id)
      : fallbackLine
        ? derivedAnchor(fallbackLine.id, "start")
        : referenceAnchor(fallbackPoint?.id ?? "")
  };
  commitCreatedElement(point, elements, insertionIndex, context);
};
