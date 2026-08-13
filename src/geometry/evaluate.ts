import type { CadElement, ComputedGeometry, DependencyError, ElementId, EvaluationResult, EvaluationWarning, ForGroupGeneratedRow, NumericVariable } from "../types/geometry";
import {
  isConditionalGroupElement,
  isForGroupElement,
  isContainerElement
} from "../model/groups";
import {
  activityAllowsEvaluation,
  activityAllowsDrawing,
  effectiveElementActivity,
  effectiveElementActivityById
} from "../model/elementActivity";
import { evaluateLocalVariables, numericError } from "./evaluationContext";
import { evaluateElement } from "./elementEvaluators";
import {
  expandForGroupIteration,
  forGroupOwnedTemplateElements,
  forGroupTemplateDescendantIds
} from "./forGroupExpansion";
import type { ScalarProgram } from "../scalars/scalarProgram";
import type { BindingVersionGraph } from "../scalars/bindingVersions";
import { hasSetVersions } from "../scalars/linearMutationEvaluator";
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
  groupNumericBindingRuntimeEntriesByElement,
  materializeNumericBindingElement,
  type NumericBindingRuntimeEntry
} from "./numericBindingRuntime";
import {
  resolveConditionalGroupBranch,
  resolveForGroupEffectiveShowGenerated
} from "./controlBooleanRuntime";
import type { TypedScalarExpression } from "../scalars/typedExpressionAst";
import type { TextTemplateAst } from "../scalars/textTemplate";
import type { BindingId } from "../scalars/bindingCatalog";
import type { ForGroupMutationOwner } from "../scalars/forGroupMutationControl";
import type { ForGroupMutationStatement } from "../scalars/linearMutationEvaluator";

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
  /** Task 5 runtime-only source execution positions for materialized module elements. */
  sourceExecutionPositionByElementId?: ReadonlyMap<ElementId, number>;
  /** Inner scalar execution order for materialized module occurrences. */
  scalarExecutionPositionByElementId?: ReadonlyMap<ElementId, number>;
  statementIdByStatementIndex?: ReadonlyMap<number, string>;
  /** Task 33's completed static join from conditional element id to owner statement id. */
  conditionalOwnerStatementIdByElementId?: ReadonlyMap<ElementId, string>;
  /** Task 35's compiled stable join; never inferred from element array order. */
  forGroupMutationOwnerByElementId?: ReadonlyMap<ElementId, ForGroupMutationOwner>;
  /** Explicit joins for materialized module control owners. */
  moduleConditionalOwnerStatementIdByElementId?: ReadonlyMap<ElementId, string>;
  moduleForGroupMutationOwnerByElementId?: ReadonlyMap<ElementId, ForGroupMutationOwner>;
  /**
   * Schema-driven elementId-keyed property sources (already re-keyed from
   * CompiledDslDocument.propertyBindings by
   * propertyBindingRuntime.ts's buildPropertyBindingRuntimeEntries - never
   * built here). Requires `scalarProgram` to also be present; see the throw
   * below for why that combination is a caller-contract violation rather
   * than a silent no-op.
   */
  propertyBindingEntries?: readonly PropertyBindingRuntimeEntry[];
  /** General numeric parameter occurrences compiled to BindingId slots. */
  numericBindingEntries?: readonly NumericBindingRuntimeEntry[];
  /**
   * Task 25's elementId-keyed typed boolean conditions for `conditionalGroup`
   * (already re-keyed from CompiledDslDocument.conditionalGroupConditions by
   * controlBooleanRuntime.ts's buildConditionalGroupConditionsByElementId -
   * never built here). An element with no entry here uses its literal
   * `NumericValue` condition.
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
   * document regardless of typed declarations, so an all-numeric-hole
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
  if (options.numericBindingEntries?.length && !options.scalarProgram) {
    throw new Error("evaluateElements: numericBindingEntries was given without a scalarProgram");
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
  // declarations, so it can be non-empty with an all-numeric-hole template
  // and no scalarProgram at all - see EvaluateElementsOptions's doc comment.

  const evaluationLimitIndex = Math.min(
    Math.max(options.evaluationLimitIndex ?? elements.length, 0),
    elements.length
  );
  const evaluatedElements = elements.slice(0, evaluationLimitIndex);
  const evaluatedElementIds = new Set(evaluatedElements.map((element) => element.id));
  const computedGeometry = new Map<ElementId, ComputedGeometry>();
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
      return disabledBy && disabledByElement && isContainerElement(disabledByElement)
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
  const linearMutationEnabled = options.bindingVersions !== undefined &&
    (hasSetVersions(options.bindingVersions) || options.bindingVersions.requiresExecutionOrdering === true);
  if (linearMutationEnabled && !options.statementInfoByElementId &&
    !options.sourceExecutionPositionByElementId && !options.scalarExecutionPositionByElementId) {
    throw new Error("evaluateElements: binding mutation requires compiled source execution positions");
  }
  const linearMutationResolver = linearMutationEnabled
    ? createDocumentLinearScalarBindingResolver(options.bindingVersions!, { computedGeometry, elementsById })
    : undefined;
  const declarationResolver = !linearMutationResolver && options.scalarProgram
    ? createDocumentScalarBindingResolver(options.scalarProgram, { computedGeometry, elementsById })
    : undefined;
  const scalarBindingResolver = linearMutationResolver ?? declarationResolver;
  const propertyBindingEntriesByElementId = options.propertyBindingEntries
    ? groupPropertyBindingRuntimeEntriesByElement(options.propertyBindingEntries)
    : undefined;
  const numericBindingEntriesByElementId = options.numericBindingEntries
    ? groupNumericBindingRuntimeEntriesByElement(options.numericBindingEntries)
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
    const sourceId = (sourceElement ?? element).id;
    const statement = options.statementInfoByElementId?.get(sourceId);
    const sourceOrder = options.scalarExecutionPositionByElementId?.get(sourceId) ??
      options.scalarExecutionPositionByElementId?.get(element.id) ??
      statement?.statementIndex ?? options.sourceExecutionPositionByElementId?.get(element.id);
    if (sourceOrder === undefined) {
      throw new Error(
        `evaluateElements: no compiled source execution position for ${sourceId}`
      );
    }
    // `beforeStatement` deliberately excludes a set on this same source line.
    linearMutationResolver!.advanceTo({ kind: "beforeStatement", sourceOrder });
  };

  const pushGeneratedVisibilityState = (
    generatedElement: CadElement,
    templateElement: CadElement,
    showGenerated: boolean,
    forGroupElement: CadElement
  ) => {
    if (
      showGenerated &&
      effectiveVisibleIds.has(forGroupElement.id) &&
      effectiveVisibleIds.has(templateElement.id)
    ) {
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

  const evaluateRuntimeElement = (
    element: CadElement,
    sourceElement?: CadElement,
    ancestorIterationVariables: NumericVariable[] = [],
    ancestorElementIdMap: ReadonlyMap<ElementId, ElementId> = new Map()
  ) => {
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

    const numericEntriesForElement = numericBindingEntriesByElementId?.get((sourceElement ?? element).id);
    if (numericEntriesForElement?.length) {
      const materialized = materializeNumericBindingElement(
        element,
        numericEntriesForElement,
        scalarBindingResolver!.resolveBinding
      );
      if (!materialized.ok) {
        errors.push(materialized.error);
        return;
      }
      element = materialized.element;
    }

    const localVariables = evaluateLocalVariables(
      element,
      computedGeometry,
      runtimeElementsById,
      errors,
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
              runtimeElements
            );
            return conditionValue === undefined ? null : conditionValue === 0 ? "else" : "then";
          })();
      conditionalGroupStates.set(element.id, activeBranch);
      const ownerStatementId = options.conditionalOwnerStatementIdByElementId?.get((sourceElement ?? element).id);
      if (ownerStatementId) linearMutationResolver!.registerConditionalResult(ownerStatementId, activeBranch);
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
        runtimeElements
      );
      if (start === undefined || count === undefined || step === undefined) return;

      // Evaluated once per forGroup entry, alongside start/count/step -
      // never re-evaluated per iteration. Presentation-only: never gates or
      // alters the iteration loop below.
      const showGeneratedEntry = controlBooleanEntriesByElementId?.get((sourceElement ?? element).id)?.[0];
      const effectiveShowGenerated = showGeneratedEntry
        ? resolveForGroupEffectiveShowGenerated(showGeneratedEntry, element.showGenerated, scalarBindingResolver!.resolveBinding)
        : element.showGenerated;
      if (effectiveShowGenerated) forGroupEffectiveShowGeneratedIds.add(element.id);

      const mutationOwner = options.forGroupMutationOwnerByElementId?.get((sourceElement ?? element).id);
      if (linearMutationResolver && mutationOwner) {
        if (!options.statementInfoByElementId) {
          throw new Error("evaluateElements: forGroup mutation requires compiled generated statement mapping");
        }
        const templates = forGroupOwnedTemplateElements(elements, (sourceElement ?? element).id);
        const ownedTemplateIds = new Set(templates.map((templateElement) => templateElement.id));
        const statements: ForGroupMutationStatement[] = templates.map((templateElement) => {
          const statement = options.statementInfoByElementId!.get(templateElement.id);
          const sourceOrder = options.scalarExecutionPositionByElementId?.get(templateElement.id) ?? statement?.statementIndex;
          if (sourceOrder === undefined) throw new Error(`evaluateElements: no compiled execution mapping for forGroup template ${templateElement.id}`);
          return { kind: "element" as const, sourceOrder, templateElementId: templateElement.id };
        });
        statements.push({ kind: "exit", sourceOrder: mutationOwner.exitSourceOrder });
        let expandedIteration = -1;
        let generatedByTemplateId = new Map<ElementId, CadElement>();
        let rowByTemplateId = new Map<ElementId, ForGroupGeneratedRow>();
        let childAncestorIterationVariables: NumericVariable[] = ancestorIterationVariables;
        let childAncestorElementIdMap: Map<ElementId, ElementId> = new Map(ancestorElementIdMap);
        const outcome = linearMutationResolver.runForGroup({
          ownerStatementId: mutationOwner.ownerStatementId,
          loopScopeId: mutationOwner.scopeId,
          // This is the compiler's established iteration binding identity.
          iterationBindingId: mutationOwner.iterationBindingId ?? `binding:iteration:${mutationOwner.ownerStatementId}`,
          iterationValues: Array.from({ length: count }, (_, iterationIndex) => start + iterationIndex * step),
          statements
        }, (statement, context) => {
          if (options.bindingVersions!.evaluationLimitSourceOrder !== undefined &&
            statement.sourceOrder >= options.bindingVersions!.evaluationLimitSourceOrder) return "stopped";
          if (statement.kind === "exit") return "completed";
          if (expandedIteration !== context.iterationIndex) {
            expandedIteration = context.iterationIndex;
            generatedByTemplateId = new Map();
            rowByTemplateId = new Map();
            const expanded = expandForGroupIteration({
              elements,
              forGroup: element,
              templateForGroupId: sourceElement?.id,
              iterationIndex: context.iterationIndex,
              variableValue: context.iterationValue,
              ancestorIterationVariables,
              ancestorElementIdMap
            });
            childAncestorIterationVariables = [...ancestorIterationVariables, expanded.iterationVariable];
            childAncestorElementIdMap = new Map(ancestorElementIdMap);
            for (const generatedElement of expanded.generatedElements) {
              const templateElementId = expanded.templateElementIdByGeneratedId.get(generatedElement.id);
              if (templateElementId && ownedTemplateIds.has(templateElementId)) {
                generatedByTemplateId.set(templateElementId, generatedElement);
                childAncestorElementIdMap.set(templateElementId, generatedElement.id);
              }
            }
            for (const row of expanded.rows) {
              if (ownedTemplateIds.has(row.templateElementId)) rowByTemplateId.set(row.templateElementId, row);
            }
          }
          const generatedElement = generatedByTemplateId.get(statement.templateElementId!);
          const templateElement = elementsById.get(statement.templateElementId!);
          if (!generatedElement || !templateElement) return "completed";
          const row = rowByTemplateId.get(templateElement.id);
          if (row) forGroupGeneratedRows.push(row);
          runtimeElements.push(generatedElement);
          runtimeElementsById.set(generatedElement.id, generatedElement);
          pushGeneratedVisibilityState(generatedElement, templateElement, effectiveShowGenerated, element);
          evaluateRuntimeElement(generatedElement, templateElement, childAncestorIterationVariables, childAncestorElementIdMap);
          return "completed";
        });
        if (outcome === "stopped") return;
        return;
      }

      const ownedTemplateIds = new Set(
        forGroupOwnedTemplateElements(elements, (sourceElement ?? element).id).map((templateElement) => templateElement.id)
      );

      for (let iterationIndex = 0; iterationIndex < count; iterationIndex += 1) {
        const variableValue = start + iterationIndex * step;
        const { generatedElements, rows, templateElementIdByGeneratedId, iterationVariable } = expandForGroupIteration({
          elements,
          forGroup: element,
          templateForGroupId: sourceElement?.id,
          iterationIndex,
          variableValue,
          ancestorIterationVariables,
          ancestorElementIdMap
        });
        const childAncestorIterationVariables = [...ancestorIterationVariables, iterationVariable];
        const childAncestorElementIdMap = new Map(ancestorElementIdMap);
        for (const [generatedId, templateElementId] of templateElementIdByGeneratedId) {
          if (ownedTemplateIds.has(templateElementId)) childAncestorElementIdMap.set(templateElementId, generatedId);
        }
        for (const row of rows) {
          if (ownedTemplateIds.has(row.templateElementId)) forGroupGeneratedRows.push(row);
        }
        for (const generatedElement of generatedElements) {
          const templateElementId = templateElementIdByGeneratedId.get(generatedElement.id);
          if (!templateElementId || !ownedTemplateIds.has(templateElementId)) continue;
          const templateElement = elementsById.get(templateElementId);
          runtimeElements.push(generatedElement);
          runtimeElementsById.set(generatedElement.id, generatedElement);
          if (templateElement) {
            pushGeneratedVisibilityState(generatedElement, templateElement, effectiveShowGenerated, element);
          }
          evaluateRuntimeElement(generatedElement, templateElement, childAncestorIterationVariables, childAncestorElementIdMap);
        }
      }
      return;
    }

    if (isContainerElement(element)) {
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

    // Task 27: the bare/compound `text.text` property case is materialized
    // through its remaining dedicated physical route, chained onto whatever
    // common property materialization already happened.
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
