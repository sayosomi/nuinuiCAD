import type { StatementIdentity } from "../document/statementIdentity";
import type { CompiledDslDocument } from "../dsl/dslDocument";
import type { DslPhysicalSpan } from "../dsl/logicalStatementSourceMap";
import { sourceOwnerForRuntimeElementId, type SourceOwner } from "../dsl/sourceOwnership";
import type { CadElementType, ElementId, EvaluationResult } from "../types/geometry";

export type GeometrySourceFlowStep = {
  kind: "construction" | "mutation";
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
  if (!statementMap) return new Map();

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
    kind: GeometrySourceFlowStep["kind"]
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

  return new Map(
    Array.from(mutableFlows, ([runtimeElementId, steps]) => [
      runtimeElementId,
      { runtimeElementId, steps: [...steps] }
    ])
  );
};
