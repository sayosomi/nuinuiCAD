import type { ModuleMaterialization } from "../dsl/moduleMaterialization";
import type {
  CadElement,
  ElementId,
  EvaluationResult,
  VisibilityProfile
} from "../types/geometry";
import { canvasPresentationEligibleElementIds } from "./canvasDrawingBounds";
import { moduleInstanceCanvasGeometry } from "./moduleInstanceCanvasGeometry";

/**
 * Resolves the current Canvas identities that may be selected explicitly.
 * Ordinary drawable elements use the normal presentation boundary. Concrete
 * Module instances additionally qualify when their materialized descendant set
 * contains at least one ordinary drawable presentation.
 *
 * Module instances are identities only: this set does not create overlay or
 * hit-test geometry for them.
 */
export const canvasSelectionEligibleElementIds = ({
  elements,
  evaluation,
  moduleMaterialization,
  visibilityProfiles,
  activeVisibilityProfileId,
  showCanvasPoints
}: {
  elements: readonly CadElement[];
  evaluation: EvaluationResult;
  moduleMaterialization?: Pick<ModuleMaterialization, "instanceBaseGeometrySnapshots">;
  visibilityProfiles: readonly VisibilityProfile[];
  activeVisibilityProfileId: string | null;
  showCanvasPoints: boolean;
}): Set<ElementId> => {
  const ordinaryIds = canvasPresentationEligibleElementIds({
    elements,
    evaluation,
    visibilityProfiles: [...visibilityProfiles],
    activeVisibilityProfileId,
    showCanvasPoints
  });
  if (!moduleMaterialization || ordinaryIds.size === 0) return ordinaryIds;

  const eligibleIds = new Set(ordinaryIds);
  const moduleInstanceIds = elements
    .filter((element) => element.type === "moduleInstance")
    .map((element) => element.id);
  for (const instanceId of moduleInstanceIds) {
    const geometry = moduleInstanceCanvasGeometry({
      instanceId,
      elements,
      evaluation,
      moduleMaterialization,
      visibilityProfiles: [...visibilityProfiles],
      activeVisibilityProfileId
    });
    if (geometry?.descendantIds.some((descendantId) => ordinaryIds.has(descendantId))) {
      eligibleIds.add(instanceId);
    }
  }

  return eligibleIds;
};
