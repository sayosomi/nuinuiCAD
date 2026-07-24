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
import type { BindingVersionGraph } from "../scalars/bindingVersions";
import { hasLinearSetVersions } from "../scalars/linearMutationEvaluator";
import {
  createDocumentLinearScalarBindingResolver,
  createDocumentScalarBindingResolver
} from "./scalarProgramEvaluation";
import {
  groupPropertyBindingRuntimeEntriesByElement,
  materializePropertyBoundElement,
  type PropertyBindingRuntimeEntry
} from "./propertyBindingRuntime";
import {
  resolveConditionalGroupBranch,
  resolveForGroupEffectiveShowGenerated
} from "./controlBooleanRuntime";
import type { TypedScalarExpression } from "../scalars/typedExpressionAst";
import type { TextTemplateAst } from "../scalars/textTemplate";
import type { BindingId } from "../scalars/bindingCatalog";

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
  /** Task 30 graph; Task 31 consumes it only when it contains a linear set. */
  bindingVersions?: BindingVersionGraph;
  /** Existing compiled element ID -> source statement mapping; never inferred from element order. */
  statementInfoByElementId?: ReadonlyMap<ElementId, { statementIndex: number }>;
  /**
   * Task 23's elementId-keyed standard property bindings (already re-keyed
   * from CompiledDslDocument.propertyBindings by
   * propertyBindingRuntime.ts's buildPropertyBindingRuntimeEntries - never
   * built here). Requires `scalarProgram` to also be present; see the throw
   * below for why that combination is a caller-contract violation rather
   * than a silent no-op.
   */
  propertyBindingEntries?: readonly PropertyBindingRuntimeEntry[];
  /**
   * Task 25's elementId-keyed typed boolean conditions for `conditionalGroup`
   * (already re-keyed from CompiledDslDocument.conditionalGroupConditions by
   * controlBooleanRuntime.ts's buildConditionalGroupConditionsByElementId -
   * never built here). An element with no entry here always uses the legacy
   * `NumericValue` condition path unchanged.
   */
  conditionalGroupConditionsByElementId?: ReadonlyMap<ElementId, TypedScalarExpression>;
  /**
   * Task 25's elementId-keyed `forGroup.showGenerated` bindings (already
   * re-keyed by controlBooleanRuntime.ts's buildControlBooleanRuntimeEntries).
   * Never affects iteration count/rows - presentation-only.
   */
  controlBooleanEntries?: readonly PropertyBindingRuntimeEntry[];
  /**
   * Task 27's elementId-keyed compiled TextTemplateAst (already re-keyed by
   * textTemplateRuntime.ts's buildTextTemplateEntriesByElementId - never
   * built here). Unlike every entry above, this does NOT require
   * `scalarProgram`: Task 26's compileTextTemplates runs for every nui 3
   * document regardless of typed declarations, so an all-legacy-hole
   * template can be present with no scalarProgram at all.
   */
  textTemplateEntriesByElementId?: ReadonlyMap<ElementId, TextTemplateAst>;
  /**
   * Task 27's elementId-keyed bare `@binding` `text.text` property source
   * (already re-keyed by textTemplateRuntime.ts's
   * buildTextPropertyBindingRuntimeEntries). Requires `scalarProgram`, like
   * propertyBindingEntries/controlBooleanEntries above - a bound reference
   * always implies a typed declaration exists.
   */
  textPropertyBindingEntries?: readonly PropertyBindingRuntimeEntry[];
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
  if ((options.controlBooleanEntries?.length || options.conditionalGroupConditionsByElementId?.size) && !options.scalarProgram) {
    throw new Error(
      "evaluateElements: controlBooleanEntries/conditionalGroupConditionsByElementId was given without a " +
        "scalarProgram - a caller must always derive these from the same compiled document (see " +
        "controlBooleanRuntime.ts), never one without the other"
    );
  }
  if (options.textPropertyBindingEntries?.length && !options.scalarProgram) {
    throw new Error(
      "evaluateElements: textPropertyBindingEntries was given without a scalarProgram - " +
        "a caller must always derive both from the same compiled document (see " +
        "textTemplateRuntime.ts's buildTextPropertyBindingRuntimeEntries), never one without the other"
    );
  }
  // textTemplateEntriesByElementId deliberately has no such guard: Task 26's
  // compileTextTemplates runs for every nui 3 document regardless of typed
  // declarations, so it can be non-empty with an all-legacy-hole template
  // and no scalarProgram at all - see EvaluateElementsOptions's doc comment.

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
  const forGroupEffectiveShowGeneratedIds = new Set<ElementId>();
  const templateDescendantIds = forGroupTemplateDescendantIds(elements);
  const forGroupGeneratedRows: EvaluationResult["forGroupGeneratedRows"] = [];

  // Built whenever a scalarProgram is present, independent of whether any
  // property bindings exist - computedScalarBindings is Task 21's own
  // contract and must not depend on Task 23's property wiring.
  const linearMutationEnabled = options.bindingVersions !== undefined && hasLinearSetVersions(options.bindingVersions);
  if (linearMutationEnabled && !options.statementInfoByElementId) {
    throw new Error("evaluateElements: linear binding mutation requires the compiled statementInfoByElementId mapping");
  }
  const linearMutationResolver = linearMutationEnabled
    ? createDocumentLinearScalarBindingResolver(options.bindingVersions!, computedVariables)
    : undefined;
  const declarationResolver = !linearMutationResolver && options.scalarProgram
    ? createDocumentScalarBindingResolver(options.scalarProgram, computedVariables)
    : undefined;
  const scalarBindingResolver = linearMutationResolver ?? declarationResolver;
  const propertyBindingEntriesByElementId = options.propertyBindingEntries
    ? groupPropertyBindingRuntimeEntriesByElement(options.propertyBindingEntries)
    : undefined;
  const controlBooleanEntriesByElementId = options.controlBooleanEntries
    ? groupPropertyBindingRuntimeEntriesByElement(options.controlBooleanEntries)
    : undefined;
  const conditionalGroupConditionsByElementId = options.conditionalGroupConditionsByElementId;
  const textPropertyBindingEntriesByElementId = options.textPropertyBindingEntries
    ? groupPropertyBindingRuntimeEntriesByElement(options.textPropertyBindingEntries)
    : undefined;
  const textTemplateEntriesByElementId = options.textTemplateEntriesByElementId;
  /**
   * A typed text hole can only exist when a typed declaration exists, which
   * implies `scalarProgram` exists (see EvaluateElementsOptions's doc
   * comment on textTemplateEntriesByElementId) - so this is only ever
   * called when scalarBindingResolver is defined. Throws instead of
   * silently mis-evaluating if that invariant is ever violated.
   */
  const resolveScalarBindingForText = scalarBindingResolver
    ? scalarBindingResolver.resolveBinding
    : (bindingId: BindingId) => {
        throw new Error(
          `evaluateElements: a typed text template hole referenced binding "${bindingId}" but no scalarProgram ` +
            "was provided - a typed hole implies a typed declaration, which implies a scalarProgram"
        );
      };

  const advanceLinearBindingsBefore = (element: CadElement, sourceElement?: CadElement) => {
    if (!linearMutationEnabled) return;
    const statement = options.statementInfoByElementId!.get((sourceElement ?? element).id);
    if (!statement) {
      throw new Error(
        `evaluateElements: no compiled statement mapping for linear binding lookup on ${(sourceElement ?? element).id}`
      );
    }
    // `beforeStatement` deliberately excludes a set on this same source line.
    linearMutationResolver!.advanceTo({ kind: "beforeStatement", sourceOrder: statement.statementIndex });
  };

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
    advanceLinearBindingsBefore(element, sourceElement);
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
      // Bound typed conditions live on the template statement/element, not
      // on a forGroup-generated clone's own synthetic id - look up by the
      // template id (sourceElement) exactly like bound properties below, so
      // a conditionalGroup written inside a forGroup template resolves the
      // same active branch on every generated iteration.
      const typedCondition = conditionalGroupConditionsByElementId?.get((sourceElement ?? element).id);
      const activeBranch = typedCondition
        ? resolveConditionalGroupBranch(typedCondition, scalarBindingResolver!.resolveBinding)
        : (() => {
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
            return conditionValue === undefined ? null : conditionValue === 0 ? "else" : "then";
          })();
      conditionalGroupStates.set(element.id, activeBranch);
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

      // Evaluated once per forGroup entry, alongside start/count/step -
      // never re-evaluated per iteration. Presentation-only: never gates or
      // alters the iteration loop below.
      const showGeneratedEntry = controlBooleanEntriesByElementId?.get(element.id)?.[0];
      const effectiveShowGenerated = showGeneratedEntry
        ? resolveForGroupEffectiveShowGenerated(showGeneratedEntry, element.showGenerated, scalarBindingResolver!.resolveBinding)
        : element.showGenerated;
      if (effectiveShowGenerated) forGroupEffectiveShowGeneratedIds.add(element.id);

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

    // Task 27: the bare `@binding` `text.text` property case - its own
    // allowlist (textTemplateRuntime.ts's TEXT_PROPERTY_TARGETS), materialized
    // the same way as standard properties above, chained onto whatever
    // materialization already happened.
    const textPropertyBindingEntriesForElement = textPropertyBindingEntriesByElementId?.get((sourceElement ?? element).id);
    if (textPropertyBindingEntriesForElement?.length) {
      const materialized = materializePropertyBoundElement(
        elementToEvaluate,
        textPropertyBindingEntriesForElement,
        scalarBindingResolver!.resolveBinding
      );
      if (!materialized.ok) {
        errors.push(materialized.error);
        return;
      }
      elementToEvaluate = materialized.element;
    }

    // Task 27: a compiled TextTemplateAst for a quoted text value
    // (`"...{...}..."`) - looked up by the template id, same as bound
    // properties above, so every forGroup iteration resolves the same
    // template.
    const textTemplateForElement = textTemplateEntriesByElementId?.get((sourceElement ?? element).id);

    evaluateElement(elementToEvaluate, {
      computedGeometry,
      elementsById: runtimeElementsById,
      errors,
      warnings,
      disabledByGroupId,
      localVariables,
      computedVariables,
      elements: runtimeElements,
      ...(textTemplateForElement
        ? { textTemplate: textTemplateForElement, resolveScalarBinding: resolveScalarBindingForText }
        : {})
    });
  };

  for (const element of evaluatedElements) {
    if (templateDescendantIds.has(element.id)) continue;
    evaluateRuntimeElement(element);
  }

  const linearFinal = linearMutationResolver
    ? linearMutationResolver.finalize({
        kind: "beforeStatement",
        sourceOrder: options.bindingVersions!.evaluationLimitSourceOrder ?? Number.POSITIVE_INFINITY
      })
    : undefined;
  const computedScalarBindings = linearFinal?.resultsByBindingId ?? declarationResolver?.finalize().resultsByBindingId;

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
    forGroupEffectiveShowGeneratedIds,
    ...(computedScalarBindings ? { computedScalarBindings } : {}),
    ...(linearFinal ? { computedScalarBindingVersions: linearFinal.historyByVersionId } : {})
  };
};
