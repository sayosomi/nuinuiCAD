import { descendantIdsForGroup, isGroupElement } from "../model/groups";
import type {
  CadElement,
  ElementId,
  EvaluationResult,
  VisibilityProfile
} from "../types/geometry";
import type {
  CanvasDrawingBounds,
  CanvasTextWidthMeasurer
} from "./canvasDrawingBounds";
import { containerCanvasGeometry } from "./containerCanvasGeometry";

export type GroupCanvasGeometry = {
  groupId: ElementId;
  descendantIds: readonly ElementId[];
  renderableDescendantIds: readonly ElementId[];
  bounds: CanvasDrawingBounds | null;
};

type GroupCanvasGeometryInput = {
  groupId: ElementId;
  elements: readonly CadElement[];
  evaluation: EvaluationResult;
  visibilityProfiles: readonly VisibilityProfile[];
  activeVisibilityProfileId: string | null;
  measureCanvasTextWidth?: CanvasTextWidthMeasurer;
};

/** Resolve exact-current Canvas geometry for one authored group-like container. */
export const groupCanvasGeometry = ({
  groupId,
  elements,
  evaluation,
  visibilityProfiles,
  activeVisibilityProfileId,
  measureCanvasTextWidth
}: GroupCanvasGeometryInput): GroupCanvasGeometry | null => {
  const group = elements.find((element) => element.id === groupId);
  if (!group || !isGroupElement(group)) return null;

  return {
    groupId,
    ...containerCanvasGeometry({
      descendantIds: descendantIdsForGroup([...elements], groupId),
      elements,
      evaluation,
      visibilityProfiles,
      activeVisibilityProfileId,
      measureCanvasTextWidth
    })
  };
};
