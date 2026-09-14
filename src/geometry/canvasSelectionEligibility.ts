import { isGroupElement } from "@nuinuicad/nui-language";
import type { ModuleMaterialization } from "@nuinuicad/nui-language";
import type {
  CadElement,
  ElementId,
  EvaluationResult,
  VisibilityProfile
} from "../types/geometry";
import { canvasPresentationEligibleElementIds } from "./canvasDrawingBounds";
import type { CanvasTextWidthMeasurer } from "./canvasDrawingBounds";
import { groupCanvasGeometry } from "./groupCanvasGeometry";
import { moduleInstanceCanvasGeometry } from "./moduleInstanceCanvasGeometry";

/**
 * Resolves the current Canvas identities that may be selected explicitly.
 * Ordinary drawable elements use the normal presentation boundary. Concrete
 * authored group-like containers additionally qualify when their shared group
 * presentation geometry has a renderable descendant and safe aggregate bounds.
 * Concrete Module instances qualify when their materialized descendant set
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
  showCanvasPoints,
  measureCanvasTextWidth
}: {
  elements: readonly CadElement[];
  evaluation: EvaluationResult;
  moduleMaterialization?: Pick<ModuleMaterialization, "instanceBaseGeometrySnapshots">;
  visibilityProfiles: readonly VisibilityProfile[];
  activeVisibilityProfileId: string | null;
  showCanvasPoints: boolean;
  measureCanvasTextWidth?: CanvasTextWidthMeasurer;
}): Set<ElementId> => {
  const ordinaryIds = canvasPresentationEligibleElementIds({
    elements,
    evaluation,
    visibilityProfiles: [...visibilityProfiles],
    activeVisibilityProfileId,
    showCanvasPoints
  });
  const eligibleIds = new Set(ordinaryIds);
  for (const element of elements) {
    if (!isGroupElement(element)) continue;
    const geometry = groupCanvasGeometry({
      groupId: element.id,
      elements,
      evaluation,
      visibilityProfiles: [...visibilityProfiles],
      activeVisibilityProfileId,
      measureCanvasTextWidth
    });
    if (geometry?.renderableDescendantIds.length && geometry.bounds) {
      eligibleIds.add(element.id);
    }
  }

  if (!moduleMaterialization || ordinaryIds.size === 0) return eligibleIds;

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
