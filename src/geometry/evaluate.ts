import type { CadElement, ComputedGeometry, DependencyError, ElementId, EvaluationResult, EvaluationWarning } from "../types/geometry";
import {
  effectiveEnabledElementIds,
  effectiveVisibleElementIds,
  groupStateByElementId,
  isGroupElement
} from "../model/groups";
import { evaluateLocalVariables } from "./evaluationContext";
import { evaluateElement } from "./elementEvaluators";

export const evaluateElements = (elements: CadElement[]): EvaluationResult => {
  const computedGeometry = new Map<ElementId, ComputedGeometry>();
  const errors: DependencyError[] = [];
  const warnings: EvaluationWarning[] = [];
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const effectiveVisibleIds = effectiveVisibleElementIds(elements);
  const effectiveEnabledIds = effectiveEnabledElementIds(elements);
  const groupStates = groupStateByElementId(elements);
  const disabledByGroupId = new Map(
    elements.flatMap((element) => {
      const disabledBy = groupStates.get(element.id)?.disabledByGroupId;
      return disabledBy ? [[element.id, disabledBy] as const] : [];
    })
  );

  for (const element of elements) {
    if (isGroupElement(element) || !effectiveEnabledIds.has(element.id)) {
      continue;
    }

    const localVariables = evaluateLocalVariables(
      element,
      computedGeometry,
      elementsById,
      errors
    );
    if (!localVariables) continue;

    evaluateElement(element, {
      computedGeometry,
      elementsById,
      errors,
      warnings,
      disabledByGroupId,
      localVariables
    });
  }

  return {
    computedGeometry,
    errors,
    warnings,
    effectiveVisibleElementIds: effectiveVisibleIds,
    effectiveEnabledElementIds: effectiveEnabledIds
  };
};
