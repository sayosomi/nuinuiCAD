import { runtimeOnlyElementTypes } from "../types/geometry";
import type {
  CadElement,
  ComputedImage,
  ElementId,
  EvaluationResult,
  VisibilityProfile
} from "../types/geometry";
import {
  canvasDrawingBoundsForVisibleIds,
  effectiveCanvasVisibleElementIds,
  type CanvasDrawingBounds,
  type CanvasTextWidthMeasurer
} from "./canvasDrawingBounds";
import { imageWorldCorners } from "./imageGeometry";

export type ContainerCanvasGeometry = {
  descendantIds: readonly ElementId[];
  renderableDescendantIds: readonly ElementId[];
  bounds: CanvasDrawingBounds | null;
};

type ContainerCanvasGeometryInput = {
  descendantIds: readonly ElementId[];
  elements: readonly CadElement[];
  evaluation: EvaluationResult;
  visibilityProfiles: readonly VisibilityProfile[];
  activeVisibilityProfileId: string | null;
  measureCanvasTextWidth?: CanvasTextWidthMeasurer;
};

const includePoint = (
  bounds: CanvasDrawingBounds | null,
  point: { x: number; y: number }
): CanvasDrawingBounds | null => {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return bounds;
  if (!bounds) {
    return {
      minX: point.x,
      minY: point.y,
      maxX: point.x,
      maxY: point.y
    };
  }
  return {
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y)
  };
};

const mergeBounds = (
  first: CanvasDrawingBounds | null,
  second: CanvasDrawingBounds | null
): CanvasDrawingBounds | null => {
  if (!first) return second;
  if (!second) return first;
  return {
    minX: Math.min(first.minX, second.minX),
    minY: Math.min(first.minY, second.minY),
    maxX: Math.max(first.maxX, second.maxX),
    maxY: Math.max(first.maxY, second.maxY)
  };
};

const imageBounds = (images: readonly ComputedImage[]): CanvasDrawingBounds | null =>
  images.reduce<CanvasDrawingBounds | null>(
    (bounds, image) => imageWorldCorners(image).reduce(includePoint, bounds),
    null
  );

/**
 * Resolve trustworthy Canvas geometry for an already-resolved container descendant set.
 *
 * The caller owns structural membership. This helper owns the shared presentation rules:
 * generated for-group rows inherit membership from their authored template, effective
 * Canvas activity/profile visibility is respected, image bounds are included, and a
 * visible non-image descendant with unknown bounds makes the aggregate fail closed.
 */
export const containerCanvasGeometry = ({
  descendantIds: structuralDescendantIds,
  elements,
  evaluation,
  visibilityProfiles,
  activeVisibilityProfileId,
  measureCanvasTextWidth
}: ContainerCanvasGeometryInput): ContainerCanvasGeometry => {
  const visibleIds = effectiveCanvasVisibleElementIds({
    elements,
    evaluation,
    visibilityProfiles: [...visibilityProfiles],
    activeVisibilityProfileId
  });
  const elementById = new Map(elements.map((element) => [element.id, element]));
  const staticDescendantIds = new Set(structuralDescendantIds);
  const generatedTemplateIdById = new Map<ElementId, ElementId>(
    (evaluation.forGroupGeneratedRows ?? [])
      .filter((row) => staticDescendantIds.has(row.templateElementId))
      .map((row) => [row.generatedElementId, row.templateElementId])
  );
  const descendantIds = [...new Set([
    ...structuralDescendantIds,
    ...generatedTemplateIdById.keys()
  ])];
  const renderableDescendantIds = descendantIds.filter((id) => {
    if (!visibleIds.has(id) || !evaluation.computedGeometry.has(id)) return false;
    const element = elementById.get(id) ?? elementById.get(generatedTemplateIdById.get(id) ?? "");
    return Boolean(element && !runtimeOnlyElementTypes.has(element.type));
  });

  const imageIds = new Set<ElementId>();
  const images: ComputedImage[] = [];
  for (const id of renderableDescendantIds) {
    const geometry = evaluation.computedGeometry.get(id);
    if (geometry?.kind !== "image") continue;
    imageIds.add(id);
    images.push(geometry);
  }

  const nonImageIds = renderableDescendantIds.filter((id) => !imageIds.has(id));
  const nonImageBounds = nonImageIds.length === 0
    ? null
    : canvasDrawingBoundsForVisibleIds({
        evaluation,
        visibleIds: new Set(nonImageIds),
        elementById,
        measureCanvasTextWidth
      });

  const bounds = nonImageIds.length > 0 && !nonImageBounds
    ? null
    : mergeBounds(nonImageBounds, imageBounds(images));

  return {
    descendantIds,
    renderableDescendantIds,
    bounds
  };
};
