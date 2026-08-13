import {
  generatedElementIdForTargetForGroup
} from "./forGroupGeneratedReferences";
import {
  runtimeOnlyElementTypes,
  type CadElement,
  type ComputedGeometry,
  type ElementId,
  type EvaluationResult
} from "../types/geometry";

export type PickCandidateGeometry = {
  templateElement: CadElement;
  geometry: ComputedGeometry;
  /** Present only when this geometry is a forGroup runtime instance. */
  referenceElementId?: ElementId;
};

/**
 * Resolves each eligible document template to its drawable geometry. Runtime
 * forGroup instances come from evaluator-owned rows, ordered explicitly by
 * iteration rather than by generated-id text || Map insertion order.
 */
export const pickCandidateGeometries = ({
  elements,
  evaluation,
  referenceElements,
  normalizationTargetElementId
}: {
  elements: CadElement[];
  evaluation: EvaluationResult;
  referenceElements: readonly CadElement[];
  normalizationTargetElementId: ElementId;
}): PickCandidateGeometry[] => {
  return referenceElements
    .filter((templateElement) => !runtimeOnlyElementTypes.has(templateElement.type))
    .flatMap((templateElement) => {
      const direct = evaluation.computedGeometry.get(templateElement.id);
      const generated = (evaluation.forGroupGeneratedRows ?? [])
        // `forGroupGeneratedRows` is evaluator-owned metadata, not a traversal
        // of `computedGeometry`; iterationIndex is the explicit runtime order.
        // A template belongs to one forGroup, so equal iteration indexes cannot
        // occur for this filtered source.
        .filter((row) => row.templateElementId === templateElement.id)
        .filter((row) => generatedElementIdForTargetForGroup({
          elements,
          targetElementId: normalizationTargetElementId,
          pickedElementId: row.generatedElementId
        }) === templateElement.id)
        .sort((left, right) => left.iterationIndex - right.iterationIndex)
        .flatMap((row) => {
          const geometry = evaluation.computedGeometry.get(row.generatedElementId);
          return geometry ? [{ templateElement, geometry, referenceElementId: templateElement.id }] : [];
        });

      return [
        ...(direct ? [{ templateElement, geometry: direct }] : []),
        ...generated
      ];
      });
};

/** `selectablePointsForGeometry` needs element metadata for Bezier intermediates.
 * Runtime geometry deliberately retains its instance id, while this alias map
 * supplies the immutable template shape for that lookup. */
export const elementsByIdForPickCandidateGeometries = (
  elements: CadElement[],
  candidates: readonly PickCandidateGeometry[]
) => {
  const result = new Map(elements.map((element) => [element.id, element]));
  for (const candidate of candidates) {
    if (candidate.referenceElementId) result.set(candidate.geometry.elementId, candidate.templateElement);
  }
  return result;
};
