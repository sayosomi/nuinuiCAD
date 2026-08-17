import { createCadElementId } from "../model/cadIds";
import { pointAnchorOptions, referenceAnchor } from "../model/pointAnchors";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import type { PointAnchor } from "../types/geometry";
import { getSelectedElement, updateSelectedElement } from "./commandRuntime";

const anchorPointId = (anchor: PointAnchor) =>
  anchor.mode === "reference" ? anchor.pointId : null;

export const addBezierIntermediatePoint = () => {
  const selectedElement = getSelectedElement();
  if (selectedElement?.type !== "bezierCurve") return;
  const options = pointAnchorOptions(useCadDocumentStore.getState().elements);
  const startPointId = anchorPointId(selectedElement.startPoint);
  const endPointId = anchorPointId(selectedElement.endPoint);
  const point =
    options.find((anchor) => {
      const pointId = anchorPointId(anchor);
      return pointId !== startPointId && pointId !== endPointId;
    }) ??
    options[0] ??
    referenceAnchor("");
  const intermediatePoint = {
    id: createCadElementId("bezierCurve"),
    point,
    handleAngleDeg: 0,
    incomingHandleLength: 30,
    outgoingHandleLength: 30,
  };
  updateSelectedElement((element) =>
    element.type === "bezierCurve"
      ? {
          ...element,
          intermediatePoints: [
            ...element.intermediatePoints,
            intermediatePoint,
          ],
        }
      : element,
  );
};

export const deleteBezierIntermediatePoint = (
  intermediatePointId: string | undefined,
) => {
  const selectedElement = getSelectedElement();
  if (selectedElement?.type !== "bezierCurve") return;
  const targetId =
    intermediatePointId ?? selectedElement.intermediatePoints.at(-1)?.id;
  if (!targetId) return;
  updateSelectedElement((element) =>
    element.type === "bezierCurve"
      ? {
          ...element,
          intermediatePoints: element.intermediatePoints.filter(
            (point) => point.id !== targetId,
          ),
        }
      : element,
  );
};
