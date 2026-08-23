import { buildConditionalGroupConditionsByElementId, buildControlBooleanRuntimeEntries } from "../geometry/controlBooleanRuntime";
import type { EvaluateElementsOptions } from "../geometry/evaluate";
import { buildNumericBindingRuntimeEntries } from "../geometry/numericBindingRuntime";
import { buildPropertyBindingRuntimeEntries } from "../geometry/propertyBindingRuntime";
import { buildTextPropertyBindingRuntimeEntries, buildTextTemplateEntriesByElementId } from "../geometry/textTemplateRuntime";
import { buildBindingVersionGraph } from "../scalars/bindingVersions";
import type { ModulePreviewRootResult } from "../dsl/modulePreviewRoot";

/**
 * Lower one already-validated Module Preview root into the same evaluation
 * option shapes consumed by the production Canvas evaluator. The Preview root
 * owns only materialized occurrences, so no second binding/parser/evaluator
 * path is introduced here.
 */
export const buildModulePreviewEvaluationOptions = (
  preview: ModulePreviewRootResult
): EvaluateElementsOptions => {
  const runtime = preview.moduleScalarRuntime;
  const elements = preview.compileResult.elements;
  const elementIdByStatementIndex = preview.moduleMaterialization.elementIdBySourceStatementIndex;
  const propertySource = {
    propertyBindings: new Map(),
    elementIdByStatementIndex,
    materializedPropertyBindings: runtime.materializedPropertyBindings
  };
  const bindingVersions = buildBindingVersionGraph({
    scalarProgram: runtime.scalarProgram,
    bindingAnalysis: runtime.bindingAnalysis,
    setStatements: new Map(
      runtime.moduleSetStatements.map((set, index) => [-(index + 1), set] as const)
    ),
    controlByScopeId: runtime.controlByScopeId,
    requiresExecutionOrdering: true
  });
  const propertyBindingEntries = buildPropertyBindingRuntimeEntries(propertySource, elements);
  const numericBindingEntries = buildNumericBindingRuntimeEntries({
    numericBindings: new Map(),
    elementIdByStatementIndex,
    materializedNumericBindings: runtime.materializedNumericBindings
  }, elements);
  const controlBooleanEntries = buildControlBooleanRuntimeEntries(propertySource, elements);
  const conditionalGroupConditionsByElementId = buildConditionalGroupConditionsByElementId(
    new Map(),
    elementIdByStatementIndex,
    runtime.materializedConditionalGroupConditions
  );
  const textTemplateEntriesByElementId = buildTextTemplateEntriesByElementId({
    textTemplates: new Map(),
    elementIdByStatementIndex,
    materializedTextTemplates: runtime.materializedTextTemplates
  });
  const textPropertyBindingEntries = buildTextPropertyBindingRuntimeEntries(propertySource, elements);

  return {
    evaluationLimitIndex: undefined,
    drawingModifiers: preview.compileResult.modifiers ?? [],
    scalarProgram: runtime.scalarProgram,
    bindingVersions,
    sourceExecutionPositionByElementId:
      preview.moduleMaterialization.sourceExecutionPositionByRuntimeElementId,
    scalarExecutionPositionByElementId: runtime.scalarExecutionPositionByRuntimeElementId,
    conditionalOwnerStatementIdByElementId: runtime.conditionalOwnerStatementIdByElementId,
    forGroupMutationOwnerByElementId: runtime.forGroupMutationOwnerByElementId,
    moduleConditionalOwnerStatementIdByElementId: runtime.conditionalOwnerStatementIdByElementId,
    moduleForGroupMutationOwnerByElementId: runtime.forGroupMutationOwnerByElementId,
    moduleMaterialization: preview.moduleMaterialization,
    ...(propertyBindingEntries.length ? { propertyBindingEntries } : {}),
    ...(numericBindingEntries.length ? { numericBindingEntries } : {}),
    ...(controlBooleanEntries.length ? { controlBooleanEntries } : {}),
    ...(conditionalGroupConditionsByElementId.size
      ? { conditionalGroupConditionsByElementId }
      : {}),
    ...(textTemplateEntriesByElementId.size ? { textTemplateEntriesByElementId } : {}),
    ...(textPropertyBindingEntries.length ? { textPropertyBindingEntries } : {})
  };
};
