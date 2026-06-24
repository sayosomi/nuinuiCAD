import type { CadElement, ComputedGeometry, ComputedVariable, DependencyError, ElementId, EvaluationResult, EvaluationWarning } from "../types/geometry";
import {
  effectiveEnabledElementIds,
  effectiveVisibleElementIds,
  groupStateByElementId,
  isGroupElement
} from "../model/groups";
import { evaluateLocalVariables } from "./evaluationContext";
import { evaluateElement } from "./elementEvaluators";
import { evaluateVariableElement } from "./variableEvaluator";

export const evaluateElements = (elements: CadElement[]): EvaluationResult => {
  const computedGeometry = new Map<ElementId, ComputedGeometry>();
  const computedVariables = new Map<ElementId, ComputedVariable>();
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
      errors,
      computedVariables,
      elements
    );
    if (!localVariables) continue;

    if (element.type === "variable") {
      evaluateVariableElement(element, {
        computedGeometry,
        computedVariables,
        elementsById,
        errors,
        disabledByGroupId,
        localVariables
      });
      continue;
    }

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
    computedVariables,
    errors,
    warnings,
    effectiveVisibleElementIds: effectiveVisibleIds,
    effectiveEnabledElementIds: effectiveEnabledIds
  };
};
