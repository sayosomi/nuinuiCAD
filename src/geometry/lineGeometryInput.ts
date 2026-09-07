import type {
  GeometryValueOccurrence
} from "../types/geometry";
import type { ElementEvaluationContext } from "./elementEvaluatorTypes";
import { isLineLikeGeometryInput, type LineLikeGeometryInput } from "./linePaths";
import { geometryValueOccurrenceKey } from "../model/geometryValueOccurrence";

const valueForOccurrence = (context: ElementEvaluationContext, occurrence: GeometryValueOccurrence) =>
  context.computedGeometryValues?.get(geometryValueOccurrenceKey(occurrence))?.value;

export const resolveLineGeometryInput = (
  context: ElementEvaluationContext,
  parameterKey: string,
  fallbackElementId: string
): LineLikeGeometryInput | undefined => {
  const target = context.geometryInputTargets?.get(parameterKey);
  if (target && "kind" in target) {
    const geometry = target.kind === "drawable"
      ? context.computedGeometry.get(target.elementId)
      : valueForOccurrence(context, target.occurrence);
    return isLineLikeGeometryInput(geometry) ? geometry : undefined;
  }
  const geometry = context.computedGeometry.get(fallbackElementId);
  return isLineLikeGeometryInput(geometry) ? geometry : undefined;
};

export const resolveLineGeometryInputs = (
  context: ElementEvaluationContext,
  parameterKey: string,
  fallbackElementIds: readonly string[]
): LineLikeGeometryInput[] => {
  const target = context.geometryInputTargets?.get(parameterKey);
  if (target && !("kind" in target)) {
    return target.flatMap((candidate) => {
      const geometry = candidate.kind === "drawable"
        ? context.computedGeometry.get(candidate.elementId)
        : valueForOccurrence(context, candidate.occurrence);
      return isLineLikeGeometryInput(geometry) ? [geometry] : [];
    });
  }
  return fallbackElementIds.flatMap((elementId) => {
    const geometry = context.computedGeometry.get(elementId);
    return isLineLikeGeometryInput(geometry) ? [geometry] : [];
  });
};
