import type { CadElement, ComputedGeometry, ComputedVariable, DependencyError, ElementId, EvaluationResult, EvaluationWarning } from "../types/geometry";
import {
  isConditionalGroupElement,
  isForGroupElement,
  isGroupElement
} from "../model/groups";
import {
  activityAllowsEvaluation,
  activityAllowsDrawing,
  effectiveElementActivity,
  effectiveElementActivityById
} from "../model/elementActivity";
import { evaluateLocalVariables, numericError } from "./evaluationContext";
import { evaluateElement } from "./elementEvaluators";
import { evaluateVariableElement } from "./variableEvaluator";
import {
  expandForGroupIteration,
  forGroupTemplateDescendantIds
} from "./forGroupExpansion";
import type { ScalarProgram } from "../scalars/scalarProgram";
import { createDocumentScalarBindingResolver } from "./scalarProgramEvaluation";
import {
  groupPropertyBindingRuntimeEntriesByElement,
  materializePropertyBoundElement,
  type PropertyBindingRuntimeEntry
} from "./propertyBindingRuntime";

export type EvaluateElementsOptions = {
  evaluationLimitIndex?: number;
  /**
   * Task 19's compiled declaration program. Task 20 evaluates it (via
   * createDocumentScalarBindingResolver) on this TS reference path only -
   * evaluateElementsWithRust calls the Rust `evaluate_document` command
   * directly and never runs this function, so Rust has no equivalent output
   * until Task 21 gives it one.
   */
  scalarProgram?: ScalarProgram;
  /**
   * Task 23's elementId-keyed standard property bindings (already re-keyed
   * from CompiledDslDocument.propertyBindings by
   * propertyBindingRuntime.ts's buildPropertyBindingRuntimeEntries - never
   * built here). Requires `scalarProgram` to also be present; see the throw
   * below for why that combination is a caller-contract violation rather
   * than a silent no-op.
   */
  propertyBindingEntries?: readonly PropertyBindingRuntimeEntry[];
};

export const evaluateElements = (
  elements: CadElement[],
  options: EvaluateElementsOptions = {}
): EvaluationResult => {
  if (options.propertyBindingEntries?.length && !options.scalarProgram) {
    throw new Error(
      "evaluateElements: propertyBindingEntries was given without a scalarProgram - " +
        "a caller must always derive both from the same compiled document (see " +
        "propertyBindingRuntime.ts's buildPropertyBindingRuntimeEntries), never one without the other"
    );
  }

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
  const runtimeElementsById = new Map(elementsById);
  const runtimeElements = [...evaluatedElements];
  const activities = effectiveElementActivityById(elements);
  const effectiveVisibleIds = new Set(elements
    .filter((element) => evaluatedElementIds.has(element.id) &&
      activityAllowsDrawing(effectiveElementActivity(element, activities).activity))
    .map((element) => element.id));
  const baseEffectiveEnabledIds = new Set(elements
    .filter((element) => evaluatedElementIds.has(element.id) &&
      activityAllowsEvaluation(effectiveElementActivity(element, activities).activity))
    .map((element) => element.id));
  const disabledByGroupId = new Map<ElementId, ElementId>(
    elements.flatMap((element) => {
      const disabledBy = effectiveElementActivity(element, activities).disabledByElementId;
      const disabledByElement = disabledBy ? elementsById.get(disabledBy) : undefined;
      return disabledBy && disabledByElement && isGroupElement(disabledByElement)
        ? [[element.id, disabledBy] as const]
        : [];
    })
  );
  const conditionalGroupStates = new Map<ElementId, "then" | "else" | null>();
  const conditionInactiveElementIds = new Set<ElementId>();
  const effectiveEnabledIds = new Set<ElementId>();
  const templateDescendantIds = forGroupTemplateDescendantIds(elements);
  const forGroupGeneratedRows: EvaluationResult["forGroupGeneratedRows"] = [];

  // Built whenever a scalarProgram is present, independent of whether any
  // property bindings exist - computedScalarBindings is Task 21's own
  // contract and must not depend on Task 23's property wiring.
  const scalarBindingResolver = options.scalarProgram
    ? createDocumentScalarBindingResolver(options.scalarProgram, computedVariables)
    : undefined;
  const propertyBindingEntriesByElementId = options.propertyBindingEntries
    ? groupPropertyBindingRuntimeEntriesByElement(options.propertyBindingEntries)
    : undefined;

  const pushGeneratedVisibilityState = (generatedElement: CadElement, templateElement: CadElement) => {
    if (effectiveVisibleIds.has(templateElement.id)) {
      effectiveVisibleIds.add(generatedElement.id);
    }
    if (baseEffectiveEnabledIds.has(templateElement.id)) {
      effectiveEnabledIds.add(generatedElement.id);
    }
  };

  const forGroupIterationCount = (
    element: CadElement,
    countValue: number | undefined
  ) => {
    if (countValue === undefined) return undefined;
    if (!Number.isFinite(countValue) || countValue < 0 || !Number.isInteger(countValue)) {
      errors.push({
        elementId: element.id,
        elementName: element.name,
        missingDependencyId: element.id,
        missingDependencyName: element.name,
        message: `${element.name} の回数は0以上の整数にしてください。`
      });
      return undefined;
    }
    if (countValue > 1000) {
      errors.push({
        elementId: element.id,
        elementName: element.name,
        missingDependencyId: element.id,
        missingDependencyName: element.name,
        message: `${element.name} の回数は1000以下にしてください。`
      });
      return undefined;
    }
    return countValue;
  };

  const inactiveConditionalGroupId = (element: CadElement) => {
    let child = element;
    let parentId = child.parentGroupId;
    const visited = new Set<ElementId>();
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = runtimeElementsById.get(parentId);
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

  const evaluateRuntimeElement = (element: CadElement, sourceElement?: CadElement) => {
    const inactiveGroupId = inactiveConditionalGroupId(element);
    if (inactiveGroupId) {
      conditionInactiveElementIds.add(element.id);
      disabledByGroupId.set(element.id, inactiveGroupId);
      return;
    }

    const enabled = sourceElement
      ? baseEffectiveEnabledIds.has(sourceElement.id)
      : baseEffectiveEnabledIds.has(element.id);
    if (!enabled) {
      return;
    }
    effectiveEnabledIds.add(element.id);

    const localVariables = evaluateLocalVariables(
      element,
      computedGeometry,
      runtimeElementsById,
      errors,
      computedVariables,
      runtimeElements
    );
    if (!localVariables) return;

    if (isConditionalGroupElement(element)) {
      const conditionValue = numericError(
        element,
        element.condition,
        computedGeometry,
        runtimeElementsById,
        errors,
        localVariables.localVariableValues,
        localVariables.localVariableNames,
        disabledByGroupId,
        computedVariables,
        runtimeElements
      );
      conditionalGroupStates.set(
        element.id,
        conditionValue === undefined ? null : conditionValue === 0 ? "else" : "then"
      );
      return;
    }

    if (isForGroupElement(element)) {
      const start = numericError(
        element,
        element.start,
        computedGeometry,
        runtimeElementsById,
        errors,
        localVariables.localVariableValues,
        localVariables.localVariableNames,
        disabledByGroupId,
        computedVariables,
        runtimeElements
      );
      const count = forGroupIterationCount(
        element,
        numericError(
          element,
          element.count,
          computedGeometry,
          runtimeElementsById,
          errors,
          localVariables.localVariableValues,
          localVariables.localVariableNames,
          disabledByGroupId,
          computedVariables,
          runtimeElements
        )
      );
      const step = numericError(
        element,
        element.step,
        computedGeometry,
        runtimeElementsById,
        errors,
        localVariables.localVariableValues,
        localVariables.localVariableNames,
        disabledByGroupId,
        computedVariables,
        runtimeElements
      );
      if (start === undefined || count === undefined || step === undefined) return;

      for (let iterationIndex = 0; iterationIndex < count; iterationIndex += 1) {
        const variableValue = start + iterationIndex * step;
        const { generatedElements, rows } = expandForGroupIteration({
          elements,
          forGroup: element,
          iterationIndex,
          variableValue
        });
        forGroupGeneratedRows.push(...rows);
        for (const generatedElement of generatedElements) {
          const templateElement = elementsById.get(rows.find(
            (row) => row.generatedElementId === generatedElement.id
          )?.templateElementId ?? "") ?? elements.find(
            (candidate) =>
              generatedElement.id === `${candidate.id}@${element.id}:${iterationIndex}`
          );
          runtimeElements.push(generatedElement);
          runtimeElementsById.set(generatedElement.id, generatedElement);
          if (templateElement) pushGeneratedVisibilityState(generatedElement, templateElement);
          evaluateRuntimeElement(generatedElement, templateElement);
        }
      }
      return;
    }

    if (isGroupElement(element)) {
      return;
    }

    if (element.type === "variable") {
      evaluateVariableElement(element, {
        computedGeometry,
        computedVariables,
        elementsById: runtimeElementsById,
        errors,
        disabledByGroupId,
        localVariables
      });
      return;
    }

    // Bound properties live on the template statement/element, not on a
    // forGroup-generated clone's own synthetic id - look up by the template
    // id (sourceElement) when this is a generated instance, so every
    // iteration sees the same resolved value uniformly (boolean/choice
    // bindings never vary per iteration; that is loop-mutation territory,
    // out of scope here).
    const propertyBindingEntriesForElement = propertyBindingEntriesByElementId?.get((sourceElement ?? element).id);
    let elementToEvaluate: CadElement = element;
    if (propertyBindingEntriesForElement?.length) {
      const materialized = materializePropertyBoundElement(
        element,
        propertyBindingEntriesForElement,
        scalarBindingResolver!.resolveBinding
      );
      if (!materialized.ok) {
        errors.push(materialized.error);
        return;
      }
      elementToEvaluate = materialized.element;
    }

    evaluateElement(elementToEvaluate, {
      computedGeometry,
      elementsById: runtimeElementsById,
      errors,
      warnings,
      disabledByGroupId,
      localVariables,
      computedVariables,
      elements: runtimeElements
    });
  };

  for (const element of evaluatedElements) {
    if (templateDescendantIds.has(element.id)) continue;
    evaluateRuntimeElement(element);
  }

  const computedScalarBindings = scalarBindingResolver?.finalize().resultsByBindingId;

  return {
    computedGeometry,
    computedVariables,
    errors,
    warnings,
    evaluatedElementIds,
    evaluationLimitIndex,
    effectiveVisibleElementIds: effectiveVisibleIds,
    effectiveEnabledElementIds: effectiveEnabledIds,
    conditionInactiveElementIds,
    forGroupGeneratedRows,
    ...(computedScalarBindings ? { computedScalarBindings } : {})
  };
};
