import { elementIdsInDocumentOrder } from "../model/documentSelection";
import { findParameterDefinition } from "../parameters/parameterDefinitions";
import { useCadStore } from "../state/useCadStore";
import type { CadElement } from "../types/geometry";

export const getSelectedElementIds = () => {
  const { elements, selectedElementId, selectedElementIds } = useCadStore.getState();
  if (selectedElementId && !selectedElementIds.includes(selectedElementId)) {
    return [selectedElementId];
  }
  if (selectedElementIds.length > 0) {
    return elementIdsInDocumentOrder(elements, selectedElementIds);
  }
  return selectedElementId ? [selectedElementId] : [];
};

export const getSelectedElement = () => {
  const { elements, selectedElementId } = useCadStore.getState();
  return selectedElementId ? elements.find((element) => element.id === selectedElementId) ?? null : null;
};

export const isLineLikeElement = (element: CadElement) =>
  element.type === "line" ||
  element.type === "arcLine" ||
  element.type === "threePointArcLine" ||
  element.type === "bezierCurve" ||
  element.type === "offsetLine";

export const isPointLikeElement = (element: CadElement) =>
  element.type === "freePoint" ||
  element.type === "offsetPoint" ||
  element.type === "polarOffsetPoint" ||
  element.type === "divisionPoint" ||
  element.type === "lineDivisionPoint" ||
  element.type === "intersectionPoint" ||
  element.type === "lineTangentOffsetPoint";

export const updateSelectedElement = (updater: (element: CadElement) => CadElement) => {
  const { elements, selectedElementId } = useCadStore.getState();
  if (!selectedElementId) return;

  useCadStore.getState().commitDocumentChange({
    elements: elements.map((element) => (element.id === selectedElementId ? updater(element) : element))
  });
};

export const selectedParameterDefinition = () => {
  const selectedElement = getSelectedElement();
  if (!selectedElement) return null;
  const { selectedParameterKey } = useCadStore.getState();
  return findParameterDefinition(selectedElement, selectedParameterKey);
};

