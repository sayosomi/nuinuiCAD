import type { ModuleMaterialization } from "../dsl/moduleMaterialization";
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

export type ModuleInstanceCanvasGeometry = {
  instanceId: ElementId;
  descendantIds: readonly ElementId[];
  renderableDescendantIds: readonly ElementId[];
  bounds: CanvasDrawingBounds | null;
};

type ModuleInstanceCanvasGeometryInput = {
  instanceId: ElementId;
  elements: readonly CadElement[];
  evaluation: EvaluationResult;
  moduleMaterialization?: ModuleMaterialization;
  visibilityProfiles: readonly VisibilityProfile[];
  activeVisibilityProfileId: string | null;
  measureCanvasTextWidth?: CanvasTextWidthMeasurer;
};

/**
 * Resolve the exact-current Canvas geometry owned by one concrete Module instance.
 * Recursive membership comes from the evaluator-owned materialization snapshot;
 * shared visibility/generated-row/bounds semantics live in containerCanvasGeometry.
 */
export const moduleInstanceCanvasGeometry = ({
  instanceId,
  elements,
  evaluation,
  moduleMaterialization,
  visibilityProfiles,
  activeVisibilityProfileId,
  measureCanvasTextWidth
}: ModuleInstanceCanvasGeometryInput): ModuleInstanceCanvasGeometry | null => {
  const snapshot = moduleMaterialization?.instanceBaseGeometrySnapshots.find(
    (candidate) => candidate.instanceId === instanceId
  );
  if (!snapshot) return null;

  return {
    instanceId,
    ...containerCanvasGeometry({
      descendantIds: snapshot.descendantIds,
      elements,
      evaluation,
      visibilityProfiles,
      activeVisibilityProfileId,
      measureCanvasTextWidth
    })
  };
};
