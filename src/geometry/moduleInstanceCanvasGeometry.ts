import type { ModuleMaterialization } from "../dsl/moduleMaterialization";
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
 * Resolve the exact-current Canvas geometry owned by one concrete Module instance.
 *
 * Recursive membership comes from the evaluator-owned materialization snapshot.
 * Generated for-group rows inherit ownership from their materialized template.
 * Canvas visibility comes from the same activity/profile owner as DrawingCanvas.
 * Fit Drawing intentionally excludes reference images, so this helper adds image
 * corners only for the instance-specific aggregate without changing Fit Drawing.
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

  const visibleIds = effectiveCanvasVisibleElementIds({
    elements,
    evaluation,
    visibilityProfiles: [...visibilityProfiles],
    activeVisibilityProfileId
  });
  const elementById = new Map(elements.map((element) => [element.id, element]));
  const staticDescendantIds = new Set(snapshot.descendantIds);
  const generatedTemplateIdById = new Map<ElementId, ElementId>(
    (evaluation.forGroupGeneratedRows ?? [])
      .filter((row) => staticDescendantIds.has(row.templateElementId))
      .map((row) => [row.generatedElementId, row.templateElementId])
  );
  const descendantIds = [...new Set([
    ...snapshot.descendantIds,
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

  // A visible non-image descendant with no trustworthy bounds must fail closed.
  // This preserves the parent contract that a future instance selection frame
  // never pretends to cover only part of the instance.
  const bounds = nonImageIds.length > 0 && !nonImageBounds
    ? null
    : mergeBounds(nonImageBounds, imageBounds(images));

  return {
    instanceId,
    descendantIds,
    renderableDescendantIds,
    bounds
  };
};
