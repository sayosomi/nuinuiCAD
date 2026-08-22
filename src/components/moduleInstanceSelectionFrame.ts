import type { ModuleMaterialization } from "../dsl/moduleMaterialization";
import type { CanvasTextWidthMeasurer } from "../geometry/canvasDrawingBounds";
import { groupCanvasGeometry } from "../geometry/groupCanvasGeometry";
import { moduleInstanceCanvasGeometry } from "../geometry/moduleInstanceCanvasGeometry";
import { isGroupElement } from "../model/groups";
import type { CanvasViewport } from "../state/cadUiStore";
import type { CadElement, ElementId, EvaluationResult, VisibilityProfile } from "../types/geometry";
import { worldToScreen, type ViewportSize } from "./canvasViewport";

export type ModuleInstanceSelectionFrameOverlay = {
  /** Container identity. The legacy field name is retained for the existing CanvasOverlay boundary. */
  instanceId: ElementId;
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

const FRAME_PADDING_PX = 8;

/**
 * Shared selection-frame presentation for Module instances and authored group-like
 * containers. Structural ownership stays in each container geometry resolver; this
 * helper only turns trustworthy world bounds into the established screen-space frame.
 */
export const moduleInstanceSelectionFrameOverlays = ({
  selectedElementIds,
  elements,
  evaluation,
  moduleMaterialization,
  visibilityProfiles,
  activeVisibilityProfileId,
  viewportSize,
  canvasViewport,
  measureCanvasTextWidth
}: {
  selectedElementIds: readonly ElementId[];
  elements: readonly CadElement[];
  evaluation: EvaluationResult;
  moduleMaterialization?: ModuleMaterialization;
  visibilityProfiles: readonly VisibilityProfile[];
  activeVisibilityProfileId: string | null;
  viewportSize: ViewportSize;
  canvasViewport: CanvasViewport;
  measureCanvasTextWidth?: CanvasTextWidthMeasurer;
}): ModuleInstanceSelectionFrameOverlay[] => {
  const elementById = new Map(elements.map((element) => [element.id, element]));

  return selectedElementIds.flatMap((containerId) => {
    const element = elementById.get(containerId);
    if (!element) return [];
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
      : isGroupElement(element)
        ? groupCanvasGeometry({
            groupId: containerId,
            elements,
            evaluation,
            visibilityProfiles,
            activeVisibilityProfileId,
            measureCanvasTextWidth
          })
        : null;
    if (!geometry?.bounds || geometry.renderableDescendantIds.length === 0) return [];

    const { minX, minY, maxX, maxY } = geometry.bounds;
    const corners = [
      worldToScreen({ x: minX, y: minY }, viewportSize, canvasViewport),
      worldToScreen({ x: minX, y: maxY }, viewportSize, canvasViewport),
      worldToScreen({ x: maxX, y: minY }, viewportSize, canvasViewport),
      worldToScreen({ x: maxX, y: maxY }, viewportSize, canvasViewport)
    ];
    const xs = corners.map((point) => point.x);
    const ys = corners.map((point) => point.y);
    const left = Math.min(...xs) - FRAME_PADDING_PX;
    const right = Math.max(...xs) + FRAME_PADDING_PX;
    const top = Math.min(...ys) - FRAME_PADDING_PX;
    const bottom = Math.max(...ys) + FRAME_PADDING_PX;

    return [{
      instanceId: containerId,
      name: element.name,
      left,
      top,
      width: right - left,
      height: bottom - top
    }];
  });
};
