import { useCadStore } from "../state/useCadStore";
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
  historySnapshot
}: CommandContext) => {
  if (!elementId) return;
  if (dx === 0 && dy === 0) {
    if (baseElements) {
      useCadStore.getState().previewDocumentChange({ elements: baseElements });
    }
    return;
  }

  const sourceElements = baseElements ?? useCadStore.getState().elements;
  const nextElements = movePointElementByDeltaInElements(sourceElements, elementId, {
    dx,
    dy,
    angleLocked,
    distanceLocked
  });
  if (!nextElements) return;

  if (commitMode === "preview") {
    useCadStore.getState().previewDocumentChange({ elements: nextElements });
    return;
  }

  if (historySnapshot) {
    useCadStore.getState().commitDocumentChangeFromSnapshot(historySnapshot, {
      elements: nextElements
    });
    return;
  }

  useCadStore.getState().commitDocumentChange({ elements: nextElements });
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
  historySnapshot
}: CommandContext) => {
  if (!elementId || !bezierHandleRole) return;
  if (dx === 0 && dy === 0) {
    if (baseElements) {
      useCadStore.getState().previewDocumentChange({ elements: baseElements });
    }
    return;
  }

  const sourceElements = baseElements ?? useCadStore.getState().elements;
  const nextElements = moveBezierHandleByDeltaInElements(sourceElements, elementId, {
    dx,
    dy,
    role: bezierHandleRole,
    intermediatePointId,
    angleLocked,
    distanceLocked
  });
  if (!nextElements) return;

  if (commitMode === "preview") {
    useCadStore.getState().previewDocumentChange({ elements: nextElements });
    return;
  }

  if (historySnapshot) {
    useCadStore.getState().commitDocumentChangeFromSnapshot(historySnapshot, {
      elements: nextElements
    });
    return;
  }

  useCadStore.getState().commitDocumentChange({ elements: nextElements });
};
