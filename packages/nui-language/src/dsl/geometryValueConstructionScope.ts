import type { LexicalScopeIndex } from "../scalars/lexicalScopeIndex";

/**
 * Construction values are currently scheduled as document/runtime entries,
 * so executable lexical control owners cannot be represented by that
 * program. The lexical scope index is the sole source of this decision.
 */
export const geometryValueConstructionControlFlowUnsupported = (
  scopeIndex: LexicalScopeIndex,
  statementIndex: number
): boolean => {
  let scopeId = scopeIndex.scopeOfStatement.get(statementIndex);
  const visited = new Set<string>();
  while (scopeId && !visited.has(scopeId)) {
    visited.add(scopeId);
    const scope = scopeIndex.scopes.get(scopeId);
    if (!scope) break;
    if (scope.kind === "then" || scope.kind === "else" || scope.kind === "forGroup") return true;
    scopeId = scope.parentId ?? undefined;
  }
  return false;
};
