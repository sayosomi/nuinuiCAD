import { descendantIdsForGroup, isGroupElement } from "@nuinuicad/nui-language";
import type {
  CadElement,
  ElementId,
  EvaluationResult,
  VisibilityProfile
} from "../types/geometry";
import { evaluationWithCanvasPresentationVisibility } from "./canvasDrawingBounds";
import type {
  CanvasDrawingBounds,
  CanvasTextWidthMeasurer
} from "./canvasDrawingBounds";
import { containerCanvasGeometry } from "./containerCanvasGeometry";
import type { CanvasLayerPresentation } from "../model/canvasLayerPresentation";

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
  canvasLayerPresentation?: CanvasLayerPresentation;
  measureCanvasTextWidth?: CanvasTextWidthMeasurer;
};

/** Resolve exact-current Canvas geometry for one authored group-like container. */
export const groupCanvasGeometry = ({
  groupId,
  elements,
  evaluation,
  visibilityProfiles,
  activeVisibilityProfileId,
  canvasLayerPresentation,
  measureCanvasTextWidth
}: GroupCanvasGeometryInput): GroupCanvasGeometry | null => {
  const group = elements.find((element) => element.id === groupId);
  if (!group || !isGroupElement(group)) return null;
  const presentationEvaluation = evaluationWithCanvasPresentationVisibility({
    elements,
    evaluation,
    visibilityProfiles,
    activeVisibilityProfileId,
    canvasLayerPresentation
  });

  return {
    groupId,
    ...containerCanvasGeometry({
      descendantIds: descendantIdsForGroup([...elements], groupId),
      elements,
      evaluation: presentationEvaluation,
      visibilityProfiles,
      activeVisibilityProfileId,
      measureCanvasTextWidth
    })
  };
};
