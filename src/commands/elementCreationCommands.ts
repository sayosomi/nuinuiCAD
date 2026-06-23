import { createCadElement } from "../model/elementFactory";
import { derivedAnchor, referenceAnchor } from "../model/pointAnchors";
import { getFirstParameterKey } from "../parameters/parameterDefinitions";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import type { CadElement, CadElementType } from "../types/geometry";
import { getSelectedElementIds, isLineLikeElement, isPointLikeElement } from "./commandRuntime";

export const addElement = (type: CadElementType) => {
  const { elements } = useCadDocumentStore.getState();
  const element = createCadElement(type, elements);
  useCadDocumentStore.getState().commitDocumentChange({
    elements: [...elements, element],
    selectedElementId: element.id,
    selectedElementIds: [element.id],
    selectionAnchorElementId: element.id,
    selectedParameterKey: getFirstParameterKey(element)
  });
};

export const addOffsetLine = () => {
  const { elements } = useCadDocumentStore.getState();
  const selectedIds = new Set(getSelectedElementIds());
  const selectedBaseLineIds = elements
    .filter((element) => selectedIds.has(element.id) && isLineLikeElement(element))
    .map((element) => element.id);
  const fallbackBaseLineId = elements.find(isLineLikeElement)?.id;
  const element = createCadElement("offsetLine", elements);
  if (element.type !== "offsetLine") return;
  const offsetLine: CadElement = {
    ...element,
    baseLineIds: selectedBaseLineIds.length > 0
      ? selectedBaseLineIds
      : fallbackBaseLineId
        ? [fallbackBaseLineId]
        : []
  };
  useCadDocumentStore.getState().commitDocumentChange({
    elements: [...elements, offsetLine],
    selectedElementId: offsetLine.id,
    selectedElementIds: [offsetLine.id],
    selectionAnchorElementId: offsetLine.id,
    selectedParameterKey: getFirstParameterKey(offsetLine)
  });
};

export const addLineDivisionPoint = () => {
  const { elements } = useCadDocumentStore.getState();
  const selectedIds = new Set(getSelectedElementIds());
  const selectedLine = elements.find((element) => selectedIds.has(element.id) && isLineLikeElement(element));
  const fallbackLine = selectedLine ?? elements.find(isLineLikeElement);
  const element = createCadElement("lineDivisionPoint", elements);
  if (element.type !== "lineDivisionPoint") return;
  const lineDivisionPoint: CadElement = {
    ...element,
    endpoint: {
      lineId: fallbackLine?.id ?? "",
      endpointKey: "start"
    }
  };
  useCadDocumentStore.getState().commitDocumentChange({
    elements: [...elements, lineDivisionPoint],
    selectedElementId: lineDivisionPoint.id,
    selectedElementIds: [lineDivisionPoint.id],
    selectionAnchorElementId: lineDivisionPoint.id,
    selectedParameterKey: getFirstParameterKey(lineDivisionPoint)
  });
};

export const addIntersectionPoint = () => {
  const { elements } = useCadDocumentStore.getState();
  const selectedIds = new Set(getSelectedElementIds());
  const selectedLines = elements
    .filter((element) => selectedIds.has(element.id) && isLineLikeElement(element))
    .map((element) => element.id);
  const fallbackLines = elements.filter(isLineLikeElement).map((element) => element.id);
  const element = createCadElement("intersectionPoint", elements);
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
  useCadDocumentStore.getState().commitDocumentChange({
    elements: [...elements, intersectionPoint],
    selectedElementId: intersectionPoint.id,
    selectedElementIds: [intersectionPoint.id],
    selectionAnchorElementId: intersectionPoint.id,
    selectedParameterKey: getFirstParameterKey(intersectionPoint)
  });
};

export const addCornerRadiusArcLine = () => {
  const { elements } = useCadDocumentStore.getState();
  const selectedIds = new Set(getSelectedElementIds());
  const selectedLines = elements
    .filter((element) => selectedIds.has(element.id) && isLineLikeElement(element))
    .map((element) => element.id);
  const fallbackLines = elements.filter(isLineLikeElement).map((element) => element.id);
  const element = createCadElement("cornerRadiusArcLine", elements);
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
  useCadDocumentStore.getState().commitDocumentChange({
    elements: [...elements, arc],
    selectedElementId: arc.id,
    selectedElementIds: [arc.id],
    selectionAnchorElementId: arc.id,
    selectedParameterKey: getFirstParameterKey(arc)
  });
};

export const addLineTangentOffsetPoint = () => {
  const { elements } = useCadDocumentStore.getState();
  const selectedIds = new Set(getSelectedElementIds());
  const selectedLine = elements.find((element) => selectedIds.has(element.id) && isLineLikeElement(element));
  const fallbackLine = selectedLine ?? elements.find(isLineLikeElement);
  const selectedPoint = elements.find((element) => selectedIds.has(element.id) && isPointLikeElement(element));
  const fallbackPoint = selectedPoint ?? elements.find(isPointLikeElement);
  const element = createCadElement("lineTangentOffsetPoint", elements);
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
  useCadDocumentStore.getState().commitDocumentChange({
    elements: [...elements, point],
    selectedElementId: point.id,
    selectedElementIds: [point.id],
    selectionAnchorElementId: point.id,
    selectedParameterKey: getFirstParameterKey(point)
  });
};
