import { createCadElement } from "../model/elementFactory";
import { derivedAnchor, referenceAnchor } from "../model/pointAnchors";
import { getFirstParameterKey } from "../parameters/parameterDefinitions";
import { useCadStore } from "../state/useCadStore";
import type { CadElement, CadElementType } from "../types/geometry";
import { getSelectedElementIds, isLineLikeElement, isPointLikeElement } from "./commandRuntime";

export const addElement = (type: CadElementType) => {
  const { elements } = useCadStore.getState();
  const element = createCadElement(type, elements);
  useCadStore.getState().commitDocumentChange({
    elements: [...elements, element],
    selectedElementId: element.id,
    selectedElementIds: [element.id],
    selectionAnchorElementId: element.id,
    selectedParameterKey: getFirstParameterKey(element)
  });
};

export const addOffsetLine = () => {
  const { elements } = useCadStore.getState();
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
  useCadStore.getState().commitDocumentChange({
    elements: [...elements, offsetLine],
    selectedElementId: offsetLine.id,
    selectedElementIds: [offsetLine.id],
    selectionAnchorElementId: offsetLine.id,
    selectedParameterKey: getFirstParameterKey(offsetLine)
  });
};

export const addLineDivisionPoint = () => {
  const { elements } = useCadStore.getState();
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
  useCadStore.getState().commitDocumentChange({
    elements: [...elements, lineDivisionPoint],
    selectedElementId: lineDivisionPoint.id,
    selectedElementIds: [lineDivisionPoint.id],
    selectionAnchorElementId: lineDivisionPoint.id,
    selectedParameterKey: getFirstParameterKey(lineDivisionPoint)
  });
};

export const addIntersectionPoint = () => {
  const { elements } = useCadStore.getState();
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
  useCadStore.getState().commitDocumentChange({
    elements: [...elements, intersectionPoint],
    selectedElementId: intersectionPoint.id,
    selectedElementIds: [intersectionPoint.id],
    selectionAnchorElementId: intersectionPoint.id,
    selectedParameterKey: getFirstParameterKey(intersectionPoint)
  });
};

export const addLineTangentOffsetPoint = () => {
  const { elements } = useCadStore.getState();
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
  useCadStore.getState().commitDocumentChange({
    elements: [...elements, point],
    selectedElementId: point.id,
    selectedElementIds: [point.id],
    selectionAnchorElementId: point.id,
    selectedParameterKey: getFirstParameterKey(point)
  });
};
