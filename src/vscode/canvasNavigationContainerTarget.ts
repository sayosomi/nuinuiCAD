import type { ModuleMaterialization } from "../dsl/moduleMaterialization";
import type { CanvasTextWidthMeasurer } from "../geometry/canvasDrawingBounds";
import { groupCanvasGeometry } from "../geometry/groupCanvasGeometry";
import { moduleInstanceCanvasGeometry } from "../geometry/moduleInstanceCanvasGeometry";
import { isGroupElement } from "../model/groups";
import type {
  CadElement,
  ElementId,
  EvaluationResult,
  VisibilityProfile
} from "../types/geometry";
import type { CanvasDrawingBounds } from "../geometry/canvasDrawingBounds";

export type CanvasNavigationContainerTarget =
  | { status: "ordinary" }
  | { status: "stale" }
  | { status: "no-renderable-geometry" }
  | {
      status: "ready";
      containerId: ElementId;
      bounds: CanvasDrawingBounds;
    };

/**
 * Resolve only container-specific Reveal semantics before any selection mutation.
 * Ordinary geometry remains on the established element-bounds path in VSCodeApp.
 */
export const canvasNavigationContainerTarget = ({
  runtimeElementIds,
  elements,
  evaluation,
  evaluationIsCurrent,
  moduleMaterialization,
  visibilityProfiles,
  activeVisibilityProfileId,
  measureCanvasTextWidth
}: {
  runtimeElementIds: readonly ElementId[];
  elements: readonly CadElement[];
  evaluation: EvaluationResult;
  evaluationIsCurrent: boolean;
  moduleMaterialization?: ModuleMaterialization;
  visibilityProfiles: readonly VisibilityProfile[];
  activeVisibilityProfileId: string | null;
  measureCanvasTextWidth?: CanvasTextWidthMeasurer;
}): CanvasNavigationContainerTarget => {
  const elementById = new Map(elements.map((element) => [element.id, element]));
  const moduleInstanceId = runtimeElementIds.find(
    (id) => elementById.get(id)?.type === "moduleInstance"
  );
  const groupId = runtimeElementIds.find((id) => {
    const element = elementById.get(id);
    return Boolean(element && isGroupElement(element));
  });
  const containerId = moduleInstanceId ?? groupId;
  if (!containerId) return { status: "ordinary" };
  if (!evaluationIsCurrent || !(evaluation.computedGeometry instanceof Map)) {
    return { status: "stale" };
  }

  const element = elementById.get(containerId)!;
  const geometry = element.type === "moduleInstance"
    ? moduleInstanceCanvasGeometry({
        instanceId: containerId,
        elements,
        evaluation,
        moduleMaterialization,
        visibilityProfiles,
        activeVisibilityProfileId,
        measureCanvasTextWidth
      })
    : groupCanvasGeometry({
        groupId: containerId,
        elements,
        evaluation,
        visibilityProfiles,
        activeVisibilityProfileId,
        measureCanvasTextWidth
      });

  if (!geometry?.bounds || geometry.renderableDescendantIds.length === 0) {
    return { status: "no-renderable-geometry" };
  }
  return {
    status: "ready",
    containerId,
    bounds: geometry.bounds
  };
};
