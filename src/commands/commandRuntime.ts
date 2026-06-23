import { elementIdsInDocumentOrder } from "../model/documentSelection";
import { findParameterDefinition } from "../parameters/parameterDefinitions";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import type { CadElement } from "../types/geometry";

export const getSelectedElementIds = () => {
  const { elements, selectedElementId, selectedElementIds } = useCadDocumentStore.getState();
  if (selectedElementId && !selectedElementIds.includes(selectedElementId)) {
    return [selectedElementId];
  }
  if (selectedElementIds.length > 0) {
    return elementIdsInDocumentOrder(elements, selectedElementIds);
  }
  return selectedElementId ? [selectedElementId] : [];
};

export const getSelectedElement = () => {
  const { elements, selectedElementId } = useCadDocumentStore.getState();
  return selectedElementId ? elements.find((element) => element.id === selectedElementId) ?? null : null;
};

export const isLineLikeElement = (element: CadElement) =>
  element.type === "line" ||
  element.type === "arcLine" ||
  element.type === "threePointArcLine" ||
  element.type === "cornerRadiusArcLine" ||
  element.type === "bezierCurve" ||
  element.type === "offsetLine" ||
  element.type === "splitLine";

export const isPointLikeElement = (element: CadElement) =>
  element.type === "freePoint" ||
  element.type === "offsetPoint" ||
  element.type === "polarOffsetPoint" ||
  element.type === "divisionPoint" ||
  element.type === "lineDivisionPoint" ||
  element.type === "intersectionPoint" ||
  element.type === "lineTangentOffsetPoint";

export const updateSelectedElement = (updater: (element: CadElement) => CadElement) => {
  const { elements, selectedElementId } = useCadDocumentStore.getState();
  if (!selectedElementId) return;

  useCadDocumentStore.getState().commitDocumentChange({
    elements: elements.map((element) => (element.id === selectedElementId ? updater(element) : element))
  });
};

export const selectedParameterDefinition = () => {
  const selectedElement = getSelectedElement();
  if (!selectedElement) return null;
  const { selectedParameterKey } = useCadDocumentStore.getState();
  return findParameterDefinition(selectedElement, selectedParameterKey);
};
