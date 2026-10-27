import { buildConditionalGroupConditionsByElementId, buildControlBooleanRuntimeEntries } from "../geometry/controlBooleanRuntime";
import type { EvaluateElementsOptions } from "../geometry/evaluate";
import { buildNumericBindingRuntimeEntries, buildTransformationNumericBindingRuntimeEntries } from "../geometry/numericBindingRuntime";
import { buildPropertyBindingRuntimeEntries } from "../geometry/propertyBindingRuntime";
import { buildTextPropertyBindingRuntimeEntries, buildTextTemplateEntriesByElementId } from "../geometry/textTemplateRuntime";
import { buildBindingControlMetadata, buildBindingVersionGraph, buildTypedDependencyGraph, remapGeometryInputTargetSourceOrders } from "@nuinuicad/nui-language";
import type { ModulePreviewRootResult } from "../dsl/modulePreviewRoot";

/**
 * Lower one already-validated Module Preview root into the same evaluation
 * option shapes consumed by the production Canvas evaluator. The dependency-
 * bearing root retains ordinary source alongside freshly materialized calls;
 * both use existing compiler facts and runtime-entry builders.
 */
export const buildModulePreviewEvaluationOptions = (
  preview: ModulePreviewRootResult
): EvaluateElementsOptions => {
  const runtime = preview.moduleScalarRuntime;
  const source = preview.candidateCompiledDocument;
  const elements = preview.compileResult.elements;
  const statementMap = preview.candidateCompiledDocument.statementMap;
  if (!statementMap) {
    throw new Error("buildModulePreviewEvaluationOptions: missing candidate statement map");
  }
  const elementIdByStatementIndex = preview.moduleMaterialization.elementIdBySourceStatementIndex;
  const propertySource = {
    propertyBindings: source.propertyBindings ?? new Map(),
    elementIdByStatementIndex,
    materializedPropertyBindings: runtime.materializedPropertyBindings
  };
  const bindingVersions = buildBindingVersionGraph({
    scalarProgram: runtime.scalarProgram,
    bindingAnalysis: runtime.bindingAnalysis,
    // Preview retains ordinary document bindings alongside freshly materialized
    // Module bindings. Their source controls need the same merge as the normal
    // document compiler; the Module runtime map owns only qualified call scopes.
    controlByScopeId: new Map([
      ...buildBindingControlMetadata(
        runtime.bindingAnalysis.catalog.scopeIndex,
        statementMap.statementIdByStatementIndex ?? new Map(),
        runtime.scalarExecutionPositionByStatementIndex
      ),
      ...runtime.controlByScopeId
    ]),
    requiresExecutionOrdering: true
  });
  const propertyBindingEntries = buildPropertyBindingRuntimeEntries(propertySource, elements);
  const numericBindingEntries = buildNumericBindingRuntimeEntries({
    numericBindings: source.numericBindings ?? new Map(),
    elementIdByStatementIndex,
    materializedNumericBindings: runtime.materializedNumericBindings
  }, elements);
  const controlBooleanEntries = buildControlBooleanRuntimeEntries(propertySource, elements);
  const conditionalGroupConditionsByElementId = new Map([
    ...buildConditionalGroupConditionsByElementId(source.conditionalGroupConditions ?? new Map(), elementIdByStatementIndex),
    ...runtime.materializedConditionalGroupConditions.map((entry) => [entry.elementId, entry.expression] as const)
  ]);
  const textTemplateEntriesByElementId = buildTextTemplateEntriesByElementId({
    textTemplates: source.textTemplates ?? new Map(),
    elementIdByStatementIndex,
    materializedTextTemplates: runtime.materializedTextTemplates
  });
  const textPropertyBindingEntries = buildTextPropertyBindingRuntimeEntries(propertySource, elements);

  const sourceOrderFor = (order: number) => runtime.scalarExecutionPositionByStatementIndex.get(order) ?? order;
  const remappedRuntimeTargets = new Map([...runtime.geometryInputTargetsByRuntimeElementId].map(([id, targets]) => [id,
    new Map([...targets].map(([key, target]) => [key, Array.isArray(target)
      ? target.map(t => remapGeometryInputTargetSourceOrders(t, sourceOrderFor))
      : remapGeometryInputTargetSourceOrders(target as import("@nuinuicad/nui-language").GeometryInputTarget, sourceOrderFor)]))
  ]));
  const geometryInputTargetsByElementId = new Map([
    ...(source.geometryInputTargetsByElementId ?? []),
    ...preview.moduleGeometryRuntime.geometryInputTargetsByRuntimeElementId,
    ...remappedRuntimeTargets
  ]);
  const transformationRecipes = preview.compileResult.runtimeTransformationRecipes ?? [];
  const typedDependencyGraph = buildTypedDependencyGraph({
    elements, drawingModifiers: preview.compileResult.modifiers,
    elementIdByStatementIndex, statementIdByStatementIndex: statementMap.statementIdByStatementIndex,
    bindingAnalysis: runtime.bindingAnalysis, bindingVersions,
    propertyBindings: source.propertyBindings,
    numericBindings: source.numericBindings,
    materializedNumericBindings: runtime.materializedNumericBindings,
    transformationNumericBindings: runtime.materializedTransformationNumericBindings,
    textTemplates: source.textTemplates,
    conditionalGroupConditions: source.conditionalGroupConditions,
    scalarProgram: runtime.scalarProgram,
    geometryInputTargets: geometryInputTargetsByElementId,
    geometryCollectionNodesByValueId: runtime.geometryCollectionNodesByValueId,
    geometryValueProgram: runtime.geometryValueProgram,
    transformationRecipes,
    moduleMaterialization: preview.moduleMaterialization
  });

  return {
    evaluationLimitIndex: undefined,
    drawingModifiers: preview.compileResult.modifiers ?? [],
    scalarProgram: runtime.scalarProgram,
    bindingVersions,
    statementInfoByElementId: statementMap.byElementId,
    statementIdByStatementIndex: statementMap.statementIdByStatementIndex,
    sourceExecutionPositionByElementId:
      preview.moduleMaterialization.sourceExecutionPositionByRuntimeElementId,
    scalarExecutionPositionByElementId: runtime.scalarExecutionPositionByRuntimeElementId,
    conditionalOwnerStatementIdByElementId: runtime.conditionalOwnerStatementIdByElementId,
    forGroupMutationOwnerByElementId: runtime.forGroupMutationOwnerByElementId,
    moduleConditionalOwnerStatementIdByElementId: runtime.conditionalOwnerStatementIdByElementId,
    moduleForGroupExecutionOwnerByElementId: runtime.forGroupMutationOwnerByElementId,
    moduleMaterialization: preview.moduleMaterialization,
    transformationRecipes,
    typedDependencyGraph,
    evaluationOrder: typedDependencyGraph?.evaluationOrder,
    transformationDependencyPlans: typedDependencyGraph?.transformationPlans,
    transformationNumericBindingEntries: buildTransformationNumericBindingRuntimeEntries(runtime.materializedTransformationNumericBindings),
    geometryInputTargetsByElementId,
    geometryValueProgram: runtime.geometryValueProgram,
    geometryCollectionNodesByValueId: runtime.geometryCollectionNodesByValueId,
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
