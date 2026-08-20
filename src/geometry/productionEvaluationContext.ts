import type { LastGoodDslDocument } from "../document/canonicalDocument";
import { buildConditionalGroupConditionsByElementId, buildControlBooleanRuntimeEntries } from "./controlBooleanRuntime";
import { buildNumericBindingRuntimeEntries } from "./numericBindingRuntime";
import { buildPropertyBindingRuntimeEntries } from "./propertyBindingRuntime";
import { buildTextPropertyBindingRuntimeEntries, buildTextTemplateEntriesByElementId } from "./textTemplateRuntime";
import { buildConditionalMutationOwners, conditionalOwnerIdByElementId } from "../scalars/conditionalMutationControl";
import { buildForGroupMutationOwners, forGroupMutationOwnerByElementId as mapForGroupMutationOwnersByElementId } from "../scalars/forGroupMutationControl";
import type { EvaluateElementsOptions } from "./evaluate";

export type BuildEvaluationOptionsInput = {
  compiledDocument: LastGoodDslDocument;
  evaluationLimitIndex: number | undefined;
};

/**
 * Lowers one last-good compiled document into the metadata consumed by the
 * evaluation engines. Runtime elements stay outside this context so canvas
 * previews can replace them without rebuilding compiled metadata.
 */
export const buildEvaluationOptions = ({
  compiledDocument,
  evaluationLimitIndex
}: BuildEvaluationOptionsInput): EvaluateElementsOptions => {
  const {
    document,
    scalarProgram,
    bindingVersions,
    propertyBindings,
    numericBindings,
    conditionalGroupConditions,
    textTemplates,
    materializedPropertyBindings,
    materializedNumericBindings,
    materializedTextTemplates,
    materializedConditionalGroupConditions,
    moduleConditionalOwnerStatementIdByElementId,
    moduleForGroupMutationOwnerByElementId,
    statementMap
  } = compiledDocument;
  const compiledElements = document.elements;
  const elementIdByStatementIndex = statementMap.elementIdByStatementIndex;
  const statementInfoByElementId = statementMap.byElementId;
  const statementIdByStatementIndex = statementMap.statementIdByStatementIndex;
  const sourceExecutionPositionByElementId =
    compiledDocument.moduleMaterialization?.sourceExecutionPositionByRuntimeElementId;
  const scalarExecutionPositionByElementId = compiledDocument.scalarExecutionPositionByRuntimeElementId;

  const propertyBindingEntries = scalarProgram && propertyBindings
    ? buildPropertyBindingRuntimeEntries(
        { propertyBindings, elementIdByStatementIndex, materializedPropertyBindings },
        compiledElements
      )
    : undefined;
  const controlBooleanEntries = scalarProgram && propertyBindings
    ? buildControlBooleanRuntimeEntries(
        { propertyBindings, elementIdByStatementIndex, materializedPropertyBindings },
        compiledElements
      )
    : undefined;
  const numericBindingEntries = scalarProgram && numericBindings
    ? buildNumericBindingRuntimeEntries(
        { numericBindings, elementIdByStatementIndex, materializedNumericBindings },
        compiledElements
      )
    : undefined;
  const conditionalGroupConditionsByElementId = scalarProgram &&
    (conditionalGroupConditions || materializedConditionalGroupConditions)
    ? new Map([
        ...(conditionalGroupConditions
          ? buildConditionalGroupConditionsByElementId(
              conditionalGroupConditions,
              elementIdByStatementIndex
            )
          : new Map()),
        ...(materializedConditionalGroupConditions ?? []).map((entry) => [entry.elementId, entry.expression] as const)
      ])
    : undefined;
  const textTemplateEntriesByElementId = textTemplates || materializedTextTemplates
    ? buildTextTemplateEntriesByElementId({
        textTemplates: textTemplates ?? new Map(),
        elementIdByStatementIndex,
        materializedTextTemplates
      })
    : undefined;
  const textPropertyBindingEntries = scalarProgram && propertyBindings
    ? buildTextPropertyBindingRuntimeEntries(
        { propertyBindings, elementIdByStatementIndex, materializedPropertyBindings },
        compiledElements
      )
    : undefined;
  const conditionalOwnerStatementIdByElementId = bindingVersions
    ? new Map([
        ...conditionalOwnerIdByElementId(buildConditionalMutationOwners(
          bindingVersions,
          compiledElements,
          statementInfoByElementId,
          statementIdByStatementIndex,
          new Set(moduleConditionalOwnerStatementIdByElementId?.values() ?? [])
        )),
        ...(moduleConditionalOwnerStatementIdByElementId
          ? [...moduleConditionalOwnerStatementIdByElementId]
          : [])
      ])
    : undefined;
  const forGroupMutationOwnerByElementId = bindingVersions
    ? new Map([
        ...mapForGroupMutationOwnersByElementId(buildForGroupMutationOwners(
          bindingVersions,
          compiledElements,
          statementInfoByElementId,
          statementIdByStatementIndex,
          new Set(moduleForGroupMutationOwnerByElementId
            ? [...moduleForGroupMutationOwnerByElementId.values()].map((owner) => owner.ownerStatementId)
            : [])
        )),
        ...(moduleForGroupMutationOwnerByElementId
          ? [...moduleForGroupMutationOwnerByElementId]
          : [])
      ])
    : undefined;

  return {
    evaluationLimitIndex,
    drawingModifiers: document.modifiers ?? [],
    ...(scalarProgram ? { scalarProgram } : {}),
    ...(bindingVersions ? {
      bindingVersions,
      statementInfoByElementId,
      sourceExecutionPositionByElementId,
      scalarExecutionPositionByElementId,
      statementIdByStatementIndex,
      conditionalOwnerStatementIdByElementId,
      forGroupMutationOwnerByElementId,
      moduleConditionalOwnerStatementIdByElementId,
      moduleForGroupMutationOwnerByElementId
    } : {}),
    ...(compiledDocument.moduleMaterialization ? { moduleMaterialization: compiledDocument.moduleMaterialization } : {}),
    ...(propertyBindingEntries?.length ? { propertyBindingEntries } : {}),
    ...(numericBindingEntries?.length ? { numericBindingEntries } : {}),
    ...(controlBooleanEntries?.length ? { controlBooleanEntries } : {}),
    ...(conditionalGroupConditionsByElementId?.size ? { conditionalGroupConditionsByElementId } : {}),
    ...(textTemplateEntriesByElementId?.size ? { textTemplateEntriesByElementId } : {}),
    ...(textPropertyBindingEntries?.length ? { textPropertyBindingEntries } : {})
  };
};
