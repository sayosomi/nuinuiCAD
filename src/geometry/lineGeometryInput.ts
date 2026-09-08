import type {
  GeometryInputTarget,
  GeometryValueOccurrence
} from "../types/geometry";
import type { ElementEvaluationContext } from "./elementEvaluatorTypes";
import { isLineLikeGeometryInput, type LineLikeGeometryInput } from "./linePaths";
import { geometryValueOccurrenceKey } from "../model/geometryValueOccurrence";

const valueForOccurrence = (context: ElementEvaluationContext, occurrence: GeometryValueOccurrence) =>
  context.computedGeometryValues?.get(geometryValueOccurrenceKey(occurrence))?.value;

const geometryForTarget = (
  context: ElementEvaluationContext,
  target: GeometryInputTarget
) => {
  if (target.kind === "drawable") return context.computedGeometry.get(target.elementId);
  if (target.kind === "geometryValue") return valueForOccurrence(context, target.occurrence);
  return undefined;
};

export const resolveLineGeometryInputAt = (
  context: ElementEvaluationContext,
  parameterKey: string,
  index: number,
  fallbackElementId: string
): LineLikeGeometryInput | undefined => {
  const target = context.geometryInputTargets?.get(parameterKey);
  if (target && "kind" in target) {
    const geometry = geometryForTarget(context, target);
    return isLineLikeGeometryInput(geometry) ? geometry : undefined;
  }
  if (target) {
    const candidate = target[index];
    if (!candidate) return undefined;
    const geometry = geometryForTarget(context, candidate);
    return isLineLikeGeometryInput(geometry) ? geometry : undefined;
  }
  const geometry = context.computedGeometry.get(fallbackElementId);
  return isLineLikeGeometryInput(geometry) ? geometry : undefined;
};

export const resolveLineGeometryInput = (
  context: ElementEvaluationContext,
  parameterKey: string,
  fallbackElementId: string
): LineLikeGeometryInput | undefined => {
  return resolveLineGeometryInputAt(context, parameterKey, 0, fallbackElementId);
};

export const resolveLineGeometryInputs = (
  context: ElementEvaluationContext,
  parameterKey: string,
  fallbackElementIds: readonly string[]
): LineLikeGeometryInput[] => {
  return fallbackElementIds.flatMap((elementId, index) => {
    const geometry = resolveLineGeometryInputAt(context, parameterKey, index, elementId);
    return geometry ? [geometry] : [];
  });
};
