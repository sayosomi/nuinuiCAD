import type { StatementIdentity } from "../document/statementIdentity";
import type { CompiledDslDocument } from "../dsl/dslDocument";
import type { DslPhysicalSpan } from "../dsl/logicalStatementSourceMap";
import { sourceOwnerForRuntimeElementId, type SourceOwner } from "../dsl/sourceOwnership";
import type { CadElementType, ElementId, EvaluationResult } from "../types/geometry";
import { transformationElementType, type TransformationRecipe } from "../../packages/nui-language/src/dsl/transformationRecipes";

export type GeometrySourceFlowStep = {
  kind: "construction" | "mutation" | "transformation";
  /** Canonical source-semantic construction/mutation name (`segment`, `move`, `reverse`, ...). */
  operation: string;
  elementType: CadElementType;
  /** Runtime occurrence that executed this source operation. */
  runtimeOperationElementId: ElementId;
  /** Reconciler/source-ownership identity of the authoritative authored statement. */
  sourceStatementId: StatementIdentity;
  sourceStatementIndex: number;
  /** Exact current-revision authored statement span. */
  sourceSpan: DslPhysicalSpan;
};

export type GeometrySourceFlow = {
  runtimeElementId: ElementId;
  steps: readonly GeometrySourceFlowStep[];
};

/**
 * Joins exact-current runtime mutation facts to authoritative source ownership.
 * No source text search, runtime-id parsing, or geometry re-evaluation occurs here.
 */
export const buildGeometrySourceFlowByRuntimeElementId = (
  compiledDocument: CompiledDslDocument,
  evaluation: EvaluationResult
): ReadonlyMap<ElementId, GeometrySourceFlow> => {
  const statementMap = compiledDocument.statementMap;
  const document = compiledDocument.document;
  if (!statementMap || !document) return new Map();

  const generatedTemplateByRuntimeElementId = new Map(
    (evaluation.forGroupGeneratedRows ?? []).map((row) => [row.generatedElementId, row.templateElementId] as const)
  );
  const ownershipDocument = {
    statementMap,
    moduleMaterialization: compiledDocument.moduleMaterialization
  };

  const sourceOwner = (runtimeElementId: ElementId): SourceOwner | null => {
    let currentId: ElementId | undefined = runtimeElementId;
    const visited = new Set<ElementId>();
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const owner = sourceOwnerForRuntimeElementId(ownershipDocument, currentId);
      if (owner) return owner;
      currentId = generatedTemplateByRuntimeElementId.get(currentId);
    }
    return null;
  };

  const sourceStep = (
    runtimeOperationElementId: ElementId,
    kind: Exclude<GeometrySourceFlowStep["kind"], "transformation">
  ): GeometrySourceFlowStep | null => {
    const owner = sourceOwner(runtimeOperationElementId);
    if (!owner) return null;
    const statement = compiledDocument.statements[owner.sourceStatementIndex];
    if (!statement || statement.kind !== "element" || !statement.type) return null;
    return {
      kind,
      operation: statement.construction,
      elementType: statement.type,
      runtimeOperationElementId,
      sourceStatementId: owner.sourceStatementId,
      sourceStatementIndex: owner.sourceStatementIndex,
      sourceSpan: statement.physicalSpan
    };
  };

  const sourceTransformationStep = (
    recipe: TransformationRecipe
  ): GeometrySourceFlowStep | null => {
    const statement = compiledDocument.statements[recipe.sourceStatementIndex];
    if (!statement || statement.kind !== "transformation") return null;
    const sourceStatementId = recipe.sourceStatementId ?? statementMap.statementIdByStatementIndex?.get(recipe.sourceStatementIndex);
    if (!sourceStatementId) return null;
    return {
      kind: "transformation",
      operation: recipe.construction,
      elementType: transformationElementType(recipe.construction),
      runtimeOperationElementId: recipe.id,
      sourceStatementId,
      sourceStatementIndex: recipe.sourceStatementIndex,
      sourceSpan: statement.physicalSpan
    };
  };

  const runtimeTargetIdsFor = (recipe: TransformationRecipe, targetIndex: number): Set<ElementId> => {
    const target = recipe.targets[targetIndex];
    if (!target) return new Set();
    const rows = (evaluation.forGroupGeneratedRows ?? [])
      .filter((row) => row.templateElementId === target.ownerId);
    if (target.occurrenceIndex !== undefined) {
      const occurrence = Number(target.occurrenceIndex);
      const row = Number.isInteger(occurrence) && occurrence >= 0 ? rows[occurrence] : undefined;
      return row ? new Set([row.generatedElementId]) : new Set();
    }
    return rows.length > 0
      ? new Set(rows.map((row) => row.generatedElementId))
      : new Set([target.ownerId]);
  };

  const mutableFlows = new Map<ElementId, GeometrySourceFlowStep[]>();
  for (const runtimeElementId of evaluation.computedGeometry.keys()) {
    const construction = sourceStep(runtimeElementId, "construction");
    if (!construction) continue;
    mutableFlows.set(runtimeElementId, [construction]);
  }

  for (const mutation of evaluation.geometryMutationExecutions ?? []) {
    const step = sourceStep(mutation.mutationElementId, "mutation");
    if (!step) continue;
    for (const targetElementId of mutation.targetElementIds) {
      mutableFlows.get(targetElementId)?.push(step);
    }
  }

  for (const recipe of [...(document.transformationRecipes ?? [])]
    .sort((left, right) => left.sourceStatementIndex - right.sourceStatementIndex)) {
    if (!recipe.enabled || evaluation.errors.some((error) => error.elementId === recipe.id)) continue;
    const step = sourceTransformationStep(recipe);
    if (!step) continue;
    const runtimeTargets = recipe.targets.map((_, index) => runtimeTargetIdsFor(recipe, index));
    for (const [runtimeElementId, steps] of mutableFlows) {
      if (!runtimeTargets.some((targetIds) => targetIds.has(runtimeElementId))) continue;
      steps.push(step);
    }
  }

  return new Map(
    Array.from(mutableFlows, ([runtimeElementId, steps]) => [
      runtimeElementId,
      { runtimeElementId, steps: [...steps] }
    ])
  );
};
