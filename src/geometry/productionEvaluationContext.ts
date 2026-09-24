import {
  geometryValueOccurrenceKey,
  type GeometryValueProgramEntry
} from "@nuinuicad/nui-language";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import { buildConditionalGroupConditionsByElementId, buildControlBooleanRuntimeEntries } from "./controlBooleanRuntime";
import { buildNumericBindingRuntimeEntries } from "./numericBindingRuntime";
import { buildPropertyBindingRuntimeEntries } from "./propertyBindingRuntime";
import { buildTextPropertyBindingRuntimeEntries, buildTextTemplateEntriesByElementId } from "./textTemplateRuntime";
import { buildConditionalMutationOwners, conditionalOwnerIdByElementId } from "../scalars/conditionalMutationControl";
import { buildForGroupExecutionOwners, forGroupMutationOwnerByElementId as mapForGroupExecutionOwnersByElementId } from "../scalars/forGroupMutationControl";
import type { EvaluateElementsOptions } from "./evaluate";

const geometryTargetsIn = (value: unknown) => {
  const elementIds = new Set<string>();
  const geometryValueKeys = new Set<ReturnType<typeof geometryValueOccurrenceKey>>();
  const bindingIds = new Set<string>();
  const visit = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object") return;
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    const record = candidate as Record<string, unknown>;
    if (record.kind === "geometryValue" && record.occurrence && typeof record.occurrence === "object") {
      geometryValueKeys.add(geometryValueOccurrenceKey(record.occurrence as Parameters<typeof geometryValueOccurrenceKey>[0]));
      return;
    }
    if (typeof record.elementId === "string") elementIds.add(record.elementId);
    if (typeof record.templateElementId === "string") elementIds.add(record.templateElementId);
    if (typeof record.bindingId === "string") bindingIds.add(record.bindingId);
    if ((record.kind === "drawable" || record.kind === undefined) && typeof record.statementId === "string") {
      elementIds.add(record.statementId);
    }
    for (const nested of Object.values(record)) visit(nested);
  };
  visit(value);
  return { elementIds, geometryValueKeys, bindingIds };
};

const geometryProgramWithExecutionPositions = (
  program: readonly GeometryValueProgramEntry[] | undefined,
  compiledDocument: LastGoodDslDocument,
  scalarExecutionPositionByElementId: ReadonlyMap<string, number> | undefined
): readonly GeometryValueProgramEntry[] | undefined => {
  if (!program?.length) return program;

  const document = compiledDocument.document;
  const graphOrder = compiledDocument.typedDependencyGraph?.evaluationOrder ?? [];
  const orderedIds = [...graphOrder];
  const orderedIdSet = new Set(orderedIds);
  for (const element of document.elements) {
    if (!orderedIdSet.has(element.id)) {
      orderedIds.push(element.id);
      orderedIdSet.add(element.id);
    }
  }
  const elementExecutionPositionById = new Map(orderedIds.map((id, index) => [id, index] as const));
  const moduleInstancePositionByPath = new Map<string, number>();
  for (const entry of compiledDocument.moduleMaterialization?.executionStatements ?? []) {
    if (entry.type !== "moduleInstance") continue;
    const path = entry.runtimeInstancePath ?? entry.instancePath;
    const position = elementExecutionPositionById.get(entry.runtimeElementId);
    if (position !== undefined) moduleInstancePositionByPath.set(JSON.stringify(path), position);
  }
  const sourceEventOrders = new Map<number, number[]>();
  const addSourceEvent = (statementIndex: number | undefined, sourceOrder: number | undefined) => {
    if (statementIndex === undefined || sourceOrder === undefined) return;
    const orders = sourceEventOrders.get(statementIndex) ?? [];
    orders.push(sourceOrder);
    sourceEventOrders.set(statementIndex, orders);
  };
  for (const [statementIndex, elementId] of compiledDocument.statementMap.elementIdByStatementIndex) {
    addSourceEvent(statementIndex, scalarExecutionPositionByElementId?.get(elementId));
  }
  const rootStatementIdByIndex = compiledDocument.statementMap.statementIdByStatementIndex;
  for (const version of compiledDocument.bindingVersions?.versions ?? []) {
    const binding = compiledDocument.bindingAnalysis?.catalog.bindingsById.get(version.bindingId);
    if (!binding) continue;
    if (rootStatementIdByIndex?.get(binding.statementIndex) !== binding.id.replace(/^binding:/, "")) continue;
    addSourceEvent(binding.statementIndex, version.sourceOrder);
  }
  const sourcePositionForStatement = (statementIndex: number): number => {
    const exact = sourceEventOrders.get(statementIndex);
    if (exact?.length) return Math.min(...exact);
    const candidates = [...sourceEventOrders.entries()].sort((left, right) => left[0] - right[0]);
    const next = candidates.find(([candidate]) => candidate > statementIndex);
    if (next?.[1].length) return Math.max(0, Math.min(...next[1]) - 0.5);
    const previous = candidates.filter(([candidate]) => candidate < statementIndex).at(-1);
    if (previous?.[1].length) return Math.max(0, Math.max(...previous[1]) + 0.5);
    return 0;
  };

  const entryByOccurrence = new Map(program.map((entry) => [
    geometryValueOccurrenceKey(entry.occurrence),
    entry
  ] as const));
  const sourcePositionByOccurrence = new Map(program.map((entry) => [
    geometryValueOccurrenceKey(entry.occurrence),
    entry.sourceExecutionPosition ?? sourcePositionForStatement(entry.sourceStatementIndex)
  ] as const));
  const bindingEdgesById = new Map<string, NonNullable<typeof compiledDocument.typedDependencyGraph>['edges'][number][]>();
  for (const edge of compiledDocument.typedDependencyGraph?.edges ?? []) {
    if (edge.from.kind !== "binding") continue;
    const edges = bindingEdgesById.get(edge.from.id) ?? [];
    edges.push(edge);
    bindingEdgesById.set(edge.from.id, edges);
  }
  const bindingDependencyElementIdsById = new Map<string, ReadonlySet<string>>();
  const bindingDependencyElementIds = (bindingId: string, activeBindings = new Set<string>()): Set<string> => {
    if (activeBindings.has(bindingId)) return new Set();
    const cached = bindingDependencyElementIdsById.get(bindingId);
    if (cached) return new Set(cached);
    activeBindings.add(bindingId);
    const result = new Set<string>();
    for (const edge of bindingEdgesById.get(bindingId) ?? []) {
      if (edge.to.kind === "element") result.add(edge.to.id);
      else if (edge.to.kind === "geometry-stage") result.add(edge.to.ownerId);
      else if (edge.to.kind === "binding") {
        for (const elementId of bindingDependencyElementIds(edge.to.id, activeBindings)) result.add(elementId);
      }
    }
    activeBindings.delete(bindingId);
    bindingDependencyElementIdsById.set(bindingId, result);
    return result;
  };
  const epsilon = 0.5 / (program.length + 1);
  const executionPositionByOccurrence = new Map<ReturnType<typeof geometryValueOccurrenceKey>, number>();
  const active = new Set<string>();
  const executionPositionFor = (entry: GeometryValueProgramEntry): number => {
    const key = geometryValueOccurrenceKey(entry.occurrence);
    const existing = executionPositionByOccurrence.get(key);
    if (existing !== undefined) return existing;
    if (active.has(key)) return -0.5;
    active.add(key);
    const targets = geometryTargetsIn(entry.construction);
    const positions = [...targets.elementIds]
      .map((elementId) => elementExecutionPositionById.get(elementId))
      .filter((position): position is number => position !== undefined);
    for (let pathLength = 1; pathLength <= entry.occurrence.instancePath.length; pathLength += 1) {
      const moduleInstancePosition = moduleInstancePositionByPath.get(
        JSON.stringify(entry.occurrence.instancePath.slice(0, pathLength))
      );
      if (moduleInstancePosition !== undefined) positions.push(moduleInstancePosition);
    }
    for (const bindingId of targets.bindingIds) {
      for (const elementId of bindingDependencyElementIds(bindingId)) {
        const dependencyPosition = elementExecutionPositionById.get(elementId);
        if (dependencyPosition !== undefined) positions.push(dependencyPosition);
      }
    }
    for (const dependencyKey of targets.geometryValueKeys) {
      const dependency = entryByOccurrence.get(dependencyKey);
      if (dependency) positions.push(executionPositionFor(dependency));
    }
    const position = (positions.length > 0 ? Math.max(...positions) : -0.5) + epsilon;
    active.delete(key);
    executionPositionByOccurrence.set(key, position);
    return position;
  };

  return program.map((entry) => ({
      ...entry,
      sourceExecutionPosition: sourcePositionByOccurrence.get(geometryValueOccurrenceKey(entry.occurrence)),
      executionPosition: executionPositionFor(entry)
    }));
};

export type BuildEvaluationOptionsInput = {
  compiledDocument: LastGoodDslDocument;
  evaluationLimitIndex: number | undefined;
  selectedDrawingProfileId?: string;
};

/**
 * Lowers one last-good compiled document into the metadata consumed by the
 * evaluation engines. Runtime elements stay outside this context so canvas
 * previews can replace them without rebuilding compiled metadata.
 */
export const buildEvaluationOptions = ({
  compiledDocument,
  evaluationLimitIndex,
  selectedDrawingProfileId
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
    moduleForGroupExecutionOwnerByElementId,
    statementMap
  } = compiledDocument;
  const compiledElements = document.elements;
  const elementIdByStatementIndex = statementMap.elementIdByStatementIndex;
  const statementInfoByElementId = statementMap.byElementId;
  const statementIdByStatementIndex = statementMap.statementIdByStatementIndex;
  const sourceExecutionPositionByElementId =
    compiledDocument.moduleMaterialization?.sourceExecutionPositionByRuntimeElementId;
  const scalarExecutionPositionByElementId = compiledDocument.scalarExecutionPositionByRuntimeElementId;
  const geometryValueProgram = geometryProgramWithExecutionPositions(
    compiledDocument.geometryValueProgram,
    compiledDocument,
    scalarExecutionPositionByElementId
  );

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
        ...mapForGroupExecutionOwnersByElementId(buildForGroupExecutionOwners(
          bindingVersions,
          compiledElements,
          statementInfoByElementId,
          statementIdByStatementIndex,
          new Set(moduleForGroupExecutionOwnerByElementId
            ? [...moduleForGroupExecutionOwnerByElementId.values()].map((owner) => owner.ownerStatementId)
            : [])
        )),
        ...(moduleForGroupExecutionOwnerByElementId
          ? [...moduleForGroupExecutionOwnerByElementId]
          : [])
      ])
    : undefined;

  return {
    evaluationLimitIndex,
    ...(compiledDocument.typedDependencyGraph
      ? { typedDependencyGraph: compiledDocument.typedDependencyGraph }
      : {}),
    ...(compiledDocument.typedDependencyGraph?.evaluationOrder
      ? { evaluationOrder: compiledDocument.typedDependencyGraph.evaluationOrder }
      : {}),
    ...(compiledDocument.typedDependencyGraph?.transformationPlans
      ? { transformationDependencyPlans: compiledDocument.typedDependencyGraph.transformationPlans }
      : {}),
    ...((compiledDocument.runtimeTransformationRecipes ?? document.transformationRecipes)?.length
      ? { transformationRecipes: compiledDocument.runtimeTransformationRecipes ?? document.transformationRecipes }
      : {}),
    statementInfoByElementId,
    drawingModifiers: document.modifiers ?? [],
    ...(selectedDrawingProfileId ? { selectedDrawingProfileId } : {}),
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
      moduleForGroupExecutionOwnerByElementId
    } : {}),
    ...(compiledDocument.moduleMaterialization ? { moduleMaterialization: compiledDocument.moduleMaterialization } : {}),
    ...(sourceExecutionPositionByElementId ? { sourceExecutionPositionByElementId } : {}),
    ...(scalarExecutionPositionByElementId ? { scalarExecutionPositionByElementId } : {}),
    ...((compiledDocument.geometryInputTargetsByElementId || compiledDocument.moduleGeometryRuntime?.geometryInputTargetsByRuntimeElementId)
      ? {
          geometryInputTargetsByElementId: new Map([
            ...(compiledDocument.geometryInputTargetsByElementId ?? []),
            ...(compiledDocument.moduleGeometryRuntime?.geometryInputTargetsByRuntimeElementId ?? [])
          ])
        }
      : {}),
    ...(compiledDocument.moduleGeometryRuntime?.geometryCollectionNodesByValueId
      ? { geometryCollectionNodesByValueId: compiledDocument.moduleGeometryRuntime.geometryCollectionNodesByValueId }
      : {}),
    ...(geometryValueProgram ? { geometryValueProgram } : {}),
    ...(propertyBindingEntries?.length ? { propertyBindingEntries } : {}),
    ...(numericBindingEntries?.length ? { numericBindingEntries } : {}),
    ...(controlBooleanEntries?.length ? { controlBooleanEntries } : {}),
    ...(conditionalGroupConditionsByElementId?.size ? { conditionalGroupConditionsByElementId } : {}),
    ...(textTemplateEntriesByElementId?.size ? { textTemplateEntriesByElementId } : {}),
    ...(textPropertyBindingEntries?.length ? { textPropertyBindingEntries } : {})
  };
};
