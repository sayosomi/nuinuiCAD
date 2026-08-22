import { elementIdsInDocumentOrder } from "../model/documentSelection";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { CadElement } from "../types/geometry";

export const getSelectedElementIds = () => {
  const { elements } = useCadDocumentStore.getState();
  const { selectedElementId, selectedElementIds } = useCadUiStore.getState();
  if (selectedElementId && !selectedElementIds.includes(selectedElementId)) {
    return [selectedElementId];
  }
  if (selectedElementIds.length > 0) {
    return elementIdsInDocumentOrder(elements, selectedElementIds);
  }
  return selectedElementId ? [selectedElementId] : [];
};

export const getSelectedElement = () => {
  const { elements } = useCadDocumentStore.getState();
  const { selectedElementId } = useCadUiStore.getState();
  return selectedElementId ? elements.find((element) => element.id === selectedElementId) ?? null : null;
};

export const isLineLikeElement = (element: CadElement) =>
  element.type === "line" ||
  element.type === "angleLengthLine" ||
  element.type === "commonTangentLine" ||
  element.type === "arcLine" ||
  element.type === "threePointArcLine" ||
  element.type === "cornerRadiusArcLine" ||
  element.type === "bezierCurve" ||
  element.type === "offsetLine" ||
  element.type === "splitLine" ||
  element.type === "copyLine" ||
  element.type === "symmetricCopyLine";

export const isPointLikeElement = (element: CadElement) =>
  element.type === "freePoint" ||
  element.type === "offsetPoint" ||
  element.type === "polarOffsetPoint" ||
  element.type === "divisionPoint" ||
  element.type === "lineDivisionPoint" ||
  element.type === "intersectionPoint" ||
  element.type === "lineTangentOffsetPoint" ||
  element.type === "bezierExtremePoint" ||
  element.type === "bezierBulgePoint";

export const updateSelectedElement = (updater: (element: CadElement) => CadElement) => {
  const { elements } = useCadDocumentStore.getState();
  const { selectedElementId } = useCadUiStore.getState();
  if (!selectedElementId) return;

  useCadDocumentStore.getState().commitDocumentChange({
    elements: elements.map((element) => (element.id === selectedElementId ? updater(element) : element))
  });
};
