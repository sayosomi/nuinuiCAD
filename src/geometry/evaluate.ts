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

export type EvaluateElementsOptions = {
  evaluationLimitIndex?: number;
};

export const evaluateElements = (
  elements: CadElement[],
  options: EvaluateElementsOptions = {}
): EvaluationResult => {
  const evaluationLimitIndex = Math.min(
    Math.max(options.evaluationLimitIndex ?? elements.length, 0),
    elements.length
  );
  const evaluatedElements = elements.slice(0, evaluationLimitIndex);
  const evaluatedElementIds = new Set(evaluatedElements.map((element) => element.id));
  const computedGeometry = new Map<ElementId, ComputedGeometry>();
  const computedVariables = new Map<ElementId, ComputedVariable>();
  const errors: DependencyError[] = [];
  const warnings: EvaluationWarning[] = [];
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const effectiveVisibleIds = new Set(
    [...effectiveVisibleElementIds(elements)].filter((id) => evaluatedElementIds.has(id))
  );
  const effectiveEnabledIds = new Set(
    [...effectiveEnabledElementIds(elements)].filter((id) => evaluatedElementIds.has(id))
  );
  const groupStates = groupStateByElementId(elements);
  const disabledByGroupId = new Map(
    elements.flatMap((element) => {
      const disabledBy = groupStates.get(element.id)?.disabledByGroupId;
      return disabledBy ? [[element.id, disabledBy] as const] : [];
    })
  );

  for (const element of evaluatedElements) {
    if (isGroupElement(element) || !effectiveEnabledIds.has(element.id)) {
      continue;
    }

    const localVariables = evaluateLocalVariables(
      element,
      computedGeometry,
      elementsById,
      errors,
      computedVariables,
      evaluatedElements
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
    evaluatedElementIds,
    evaluationLimitIndex,
    effectiveVisibleElementIds: effectiveVisibleIds,
    effectiveEnabledElementIds: effectiveEnabledIds
  };
};
