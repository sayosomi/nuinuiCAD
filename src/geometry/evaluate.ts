import type { CadElement, ComputedGeometry, ComputedVariable, DependencyError, ElementId, EvaluationResult, EvaluationWarning } from "../types/geometry";
import {
  effectiveEnabledElementIds,
  effectiveVisibleElementIds,
  groupStateByElementId,
  isConditionalGroupElement,
  isGroupElement
} from "../model/groups";
import { evaluateLocalVariables, numericError } from "./evaluationContext";
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
  const baseEffectiveEnabledIds = new Set(
    [...effectiveEnabledElementIds(elements)].filter((id) => evaluatedElementIds.has(id))
  );
  const groupStates = groupStateByElementId(elements);
  const disabledByGroupId = new Map<ElementId, ElementId>(
    elements.flatMap((element) => {
      const disabledBy = groupStates.get(element.id)?.disabledByGroupId;
      return disabledBy ? [[element.id, disabledBy] as const] : [];
    })
  );
  const conditionalGroupStates = new Map<ElementId, "then" | "else" | null>();
  const conditionInactiveElementIds = new Set<ElementId>();
  const effectiveEnabledIds = new Set<ElementId>();

  const inactiveConditionalGroupId = (element: CadElement) => {
    let child = element;
    let parentId = child.parentGroupId;
    const visited = new Set<ElementId>();
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = elementsById.get(parentId);
      if (!parent) return null;
      if (isConditionalGroupElement(parent)) {
        const activeBranch = conditionalGroupStates.get(parent.id);
        const branch = child.conditionalBranch ?? "then";
        if (activeBranch !== branch) return parent.id;
      }
      child = parent;
      parentId = parent.parentGroupId;
    }
    return null;
  };

  for (const element of evaluatedElements) {
    const inactiveGroupId = inactiveConditionalGroupId(element);
    if (inactiveGroupId) {
      conditionInactiveElementIds.add(element.id);
      disabledByGroupId.set(element.id, inactiveGroupId);
      continue;
    }

    if (!baseEffectiveEnabledIds.has(element.id)) {
      continue;
    }
    effectiveEnabledIds.add(element.id);

    const localVariables = evaluateLocalVariables(
      element,
      computedGeometry,
      elementsById,
      errors,
      computedVariables,
      evaluatedElements
    );
    if (!localVariables) continue;

    if (isConditionalGroupElement(element)) {
      const conditionValue = numericError(
        element,
        element.condition,
        computedGeometry,
        elementsById,
        errors,
        localVariables.localVariableValues,
        localVariables.localVariableNames,
        disabledByGroupId,
        computedVariables,
        evaluatedElements
      );
      conditionalGroupStates.set(
        element.id,
        conditionValue === undefined ? null : conditionValue === 0 ? "else" : "then"
      );
      continue;
    }

    if (isGroupElement(element)) {
      continue;
    }

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
    effectiveEnabledElementIds: effectiveEnabledIds,
    conditionInactiveElementIds
  };
};
