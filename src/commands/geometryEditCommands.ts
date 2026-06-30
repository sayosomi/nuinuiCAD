import { useCadDocumentStore } from "../state/cadDocumentStore";
import {
  moveBezierHandleByDeltaInElements,
  movePointElementByDeltaInElements
} from "../model/elementDragTransforms";
import type { CommandContext } from "./commandTypes";

export const movePointElementByDelta = ({
  elementId,
  dx = 0,
  dy = 0,
  angleLocked,
  distanceLocked,
  commitMode = "commit",
  baseElements,
  baseEvaluation,
  historySnapshot
}: CommandContext) => {
  if (!elementId) return;
  if (dx === 0 && dy === 0) {
    if (baseElements) {
      useCadDocumentStore.getState().previewDocumentChange({ elements: baseElements });
    }
    return;
  }

  const sourceElements = baseElements ?? useCadDocumentStore.getState().elements;
  const nextElements = movePointElementByDeltaInElements(sourceElements, elementId, {
    dx,
    dy,
    angleLocked,
    distanceLocked,
    baseEvaluation
  });
  if (!nextElements) return;

  if (commitMode === "preview") {
    useCadDocumentStore.getState().previewDocumentChange({ elements: nextElements });
    return;
  }

  if (historySnapshot) {
    useCadDocumentStore.getState().commitDocumentChangeFromSnapshot(historySnapshot, {
      elements: nextElements
    });
    return;
  }

  useCadDocumentStore.getState().commitDocumentChange({ elements: nextElements });
};

export const moveBezierHandleByDelta = ({
  elementId,
  dx = 0,
  dy = 0,
  bezierHandleRole,
  intermediatePointId,
  angleLocked,
  distanceLocked,
  commitMode = "commit",
  baseElements,
  baseEvaluation,
  historySnapshot
}: CommandContext) => {
  if (!elementId || !bezierHandleRole) return;
  if (dx === 0 && dy === 0) {
    if (baseElements) {
      useCadDocumentStore.getState().previewDocumentChange({ elements: baseElements });
    }
    return;
  }

  const sourceElements = baseElements ?? useCadDocumentStore.getState().elements;
  const nextElements = moveBezierHandleByDeltaInElements(sourceElements, elementId, {
    dx,
    dy,
    role: bezierHandleRole,
    intermediatePointId,
    angleLocked,
    distanceLocked,
    baseEvaluation
  });
  if (!nextElements) return;

  if (commitMode === "preview") {
    useCadDocumentStore.getState().previewDocumentChange({ elements: nextElements });
    return;
  }

  if (historySnapshot) {
    useCadDocumentStore.getState().commitDocumentChangeFromSnapshot(historySnapshot, {
      elements: nextElements
    });
    return;
  }

  useCadDocumentStore.getState().commitDocumentChange({ elements: nextElements });
};
