import type {
  CadElement,
  ElementId,
  LineEndpointReference,
  PointAnchor
} from "../types/geometry";
import {
  groupStateByElementId,
  isForGroupElement
} from "./groups";
import {
  isLineLikeElement,
  isPointElement
} from "./pointAnchors";

export type ForGroupGeneratedElementReference = {
  forGroupId: ElementId;
  templateElementId: ElementId;
  iterationIndex: number;
};

export const parseForGroupGeneratedElementId = (
  elementId: ElementId
): ForGroupGeneratedElementReference | null => {
  const colonIndex = elementId.lastIndexOf(":");
  const atIndex = elementId.lastIndexOf("@", colonIndex);
  if (atIndex <= 0 || colonIndex <= atIndex + 1 || colonIndex === elementId.length - 1) {
    return null;
  }

  const iterationText = elementId.slice(colonIndex + 1);
  if (!/^\d+$/.test(iterationText)) return null;

  return {
    templateElementId: elementId.slice(0, atIndex),
    forGroupId: elementId.slice(atIndex + 1, colonIndex),
    iterationIndex: Number(iterationText)
  };
};

export const nearestForGroupIdForElement = (
  elements: CadElement[],
  elementId: ElementId
): ElementId | null => {
  const element = elements.find((item) => item.id === elementId);
  if (!element) return null;

  const elementsById = new Map(elements.map((item) => [item.id, item]));
  const state = groupStateByElementId(elements).get(element.id);
  const ancestorIds = [...(state?.ancestorGroupIds ?? [])].reverse();
  return ancestorIds.find((ancestorId) => {
    const ancestor = elementsById.get(ancestorId);
    return ancestor ? isForGroupElement(ancestor) : false;
  }) ?? null;
};

export const generatedElementIdForTargetForGroup = ({
  elements,
  targetElementId,
  pickedElementId
}: {
  elements: CadElement[];
  targetElementId: ElementId;
  pickedElementId: ElementId;
}): ElementId | null => {
  const generated = parseForGroupGeneratedElementId(pickedElementId);
  if (!generated) return pickedElementId;

  const targetForGroupId = nearestForGroupIdForElement(elements, targetElementId);
  if (targetForGroupId !== generated.forGroupId) return null;
  if (!elements.some((element) => element.id === generated.templateElementId)) return null;
  return generated.templateElementId;
};

export const pickedPointAnchorForTargetForGroup = ({
  elements,
  targetElementId,
  anchor
}: {
  elements: CadElement[];
  targetElementId: ElementId;
  anchor: PointAnchor;
}): PointAnchor | null => {
  if (anchor.mode === "coordinate") return anchor;
  if (anchor.mode === "reference") {
    const pointId = generatedElementIdForTargetForGroup({
      elements,
      targetElementId,
      pickedElementId: anchor.pointId
    });
    if (!pointId) return null;
    return { ...anchor, pointId };
  }

  const elementId = generatedElementIdForTargetForGroup({
    elements,
    targetElementId,
    pickedElementId: anchor.elementId
  });
  if (!elementId) return null;
  return { ...anchor, elementId };
};

export const lineEndpointReferenceForPickedAnchor = ({
  elements,
  targetElementId,
  anchor
}: {
  elements: CadElement[];
  targetElementId: ElementId;
  anchor: PointAnchor;
}): LineEndpointReference | null => {
  if (anchor.mode !== "derived" || (anchor.pointKey !== "start" && anchor.pointKey !== "end")) {
    return null;
  }

  const lineId = generatedElementIdForTargetForGroup({
    elements,
    targetElementId,
    pickedElementId: anchor.elementId
  });
  if (!lineId) return null;

  const line = elements.find((element) => element.id === lineId);
  if (!line || !isLineLikeElement(line)) return null;

  return {
    lineId,
    endpointKey: anchor.pointKey
  };
};

export const pickedPointAnchorReferencesTarget = ({
  elements,
  targetElementId,
  anchor
}: {
  elements: CadElement[];
  targetElementId: ElementId;
  anchor: PointAnchor;
}) => {
  if (anchor.mode === "coordinate") return false;
  const normalized = pickedPointAnchorForTargetForGroup({ elements, targetElementId, anchor });
  if (!normalized || normalized.mode === "coordinate") return false;
  return normalized.mode === "reference"
    ? normalized.pointId === targetElementId
    : normalized.elementId === targetElementId;
};

export const isValidPickedPointAnchorForTarget = ({
  elements,
  targetElementId,
  normalizationTargetElementId,
  anchor,
  allowLineEndpoint
}: {
  elements: CadElement[];
  targetElementId: ElementId;
  /**
   * A real element used only to resolve forGroup ancestry for a virtual
   * target.  It must never become the target used by self-reference checks.
   */
  normalizationTargetElementId?: ElementId;
  anchor: PointAnchor;
  allowLineEndpoint: boolean;
}) => {
  const normalizationTargetId = normalizationTargetElementId ?? targetElementId;
  if (allowLineEndpoint) {
    const endpoint = lineEndpointReferenceForPickedAnchor({
      elements,
      targetElementId: normalizationTargetId,
      anchor
    });
    return Boolean(endpoint && endpoint.lineId !== targetElementId);
  }

  const normalized = pickedPointAnchorForTargetForGroup({
    elements,
    targetElementId: normalizationTargetId,
    anchor
  });
  if (!normalized || normalized.mode === "coordinate") return Boolean(normalized);
  if (normalized.mode === "reference") {
    if (normalized.pointId === targetElementId) return false;
    const point = elements.find((element) => element.id === normalized.pointId);
    return Boolean(point && isPointElement(point));
  }
  if (normalized.elementId === targetElementId) return false;
  return elements.some((element) => element.id === normalized.elementId);
};
