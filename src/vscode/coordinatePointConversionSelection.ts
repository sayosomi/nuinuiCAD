import type { CompiledDslDocument } from "../dsl/dslDocument";
import { sourceOwnerByRuntimeElementId } from "../dsl/sourceOwnership";
import type { ElementId } from "../types/geometry";

/**
 * Resolve ordinary Source statement ownership to the current root runtime IDs
 * after a coordinate-point conversion has changed the compiled element IDs.
 */
export const currentRuntimeElementIdsForSourceStatementIndexes = (
  compiled: CompiledDslDocument,
  sourceStatementIndexes: readonly number[]
): readonly ElementId[] | null => {
  if (!compiled.document || !compiled.statementMap) return null;
  if (
    sourceStatementIndexes.length === 0 ||
    sourceStatementIndexes.some((sourceStatementIndex) =>
      !Number.isInteger(sourceStatementIndex) || sourceStatementIndex < 0
    )
  ) return null;

  const requestedIndexes = new Set<number>();
  for (const sourceStatementIndex of sourceStatementIndexes) {
    if (requestedIndexes.has(sourceStatementIndex)) return null;
    requestedIndexes.add(sourceStatementIndex);
  }

  const rootElementIds = new Set(compiled.document.elements.map((element) => element.id));
  const owners = sourceOwnerByRuntimeElementId({
    statementMap: compiled.statementMap,
    moduleMaterialization: compiled.moduleMaterialization,
    moduleRuntimeContext: compiled.moduleRuntimeContext
  });
  const candidatesBySourceStatementIndex = new Map<number, Array<{
    runtimeElementId: ElementId;
    kind: "ordinary" | "moduleInstance" | "moduleBody";
  }>>();

  for (const runtimeElementId of rootElementIds) {
    const owner = owners.get(runtimeElementId);
    if (!owner) continue;
    const candidates = candidatesBySourceStatementIndex.get(owner.sourceStatementIndex);
    const candidate = { runtimeElementId, kind: owner.kind };
    if (candidates) candidates.push(candidate);
    else candidatesBySourceStatementIndex.set(owner.sourceStatementIndex, [candidate]);
  }

  const resolvedRuntimeElementIds: ElementId[] = [];
  for (const sourceStatementIndex of sourceStatementIndexes) {
    const candidates = candidatesBySourceStatementIndex.get(sourceStatementIndex);
    if (
      candidates?.length !== 1 ||
      candidates[0]?.kind !== "ordinary" ||
      !rootElementIds.has(candidates[0].runtimeElementId)
    ) return null;
    resolvedRuntimeElementIds.push(candidates[0].runtimeElementId);
  }

  return new Set(resolvedRuntimeElementIds).size === resolvedRuntimeElementIds.length
    ? resolvedRuntimeElementIds
    : null;
};
