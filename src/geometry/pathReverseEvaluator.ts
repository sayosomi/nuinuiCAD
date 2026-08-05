import type { CadElement } from "../types/geometry";
import { elementDisplayName } from "../model/elementNames";
import { forGroupAncestorIds } from "../model/groups";
import { dependencyError, forGroupAncestorError, geometryError } from "./evaluationContext";
import type { ElementEvaluationContext } from "./elementEvaluatorTypes";
import { reverseComputedPathGeometry } from "./reversePathGeometry";

/**
 * Reverses the target line's already-computed geometry in place. Unlike
 * every other evaluator in this module, this never writes computedGeometry
 * under its own element id (see elementActivity.ts's
 * elementTypesWithoutOwnDrawableGeometry) - the target keeps its own id, and
 * every statement after this one in document order observes the reversed
 * traversal.
 */
export const evaluatePathReverseElement = (
  element: CadElement,
  context: ElementEvaluationContext
): boolean => {
  if (element.type !== "pathReverse") return false;

  const { computedGeometry, elementsById, errors, disabledByGroupId } = context;

  const target = elementsById.get(element.targetLineId);
  if (target) {
    const reverseAncestors = forGroupAncestorIds(elementsById, element);
    const targetAncestors = forGroupAncestorIds(elementsById, target);
    if ([...reverseAncestors].some((id) => !targetAncestors.has(id))) {
      errors.push(forGroupAncestorError(element, target));
      return true;
    }
  }

  const current = computedGeometry.get(element.targetLineId);
  if (!current) {
    errors.push(dependencyError(element, element.targetLineId, elementsById, disabledByGroupId));
    return true;
  }

  const reversed = reverseComputedPathGeometry(current);
  if (!reversed) {
    const target = elementsById.get(element.targetLineId);
    errors.push(geometryError(
      element,
      `${elementDisplayName(element)} の対象「${target ? elementDisplayName(target) : element.targetLineId}」は線または曲線ではないため反転できません。`
    ));
    return true;
  }

  computedGeometry.set(element.targetLineId, reversed);
  return true;
};
