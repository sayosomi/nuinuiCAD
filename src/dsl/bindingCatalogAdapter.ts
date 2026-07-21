// DSL-only adapter for Task 12. It translates already-parsed legacy `var`
// records and forGroup slots into the geometry-free binding catalog inputs.
// It never parses or scans source text.

import type { BindingSeed } from "../scalars/bindingCatalog";
import type { LexicalScopeIndex, ScopeId } from "../scalars/lexicalScopeIndex";
import type { DslStatement } from "./dslTypes";

const attrValue = (statement: DslStatement, key: string) => statement.attrs.find((attr) => attr.key === key)?.value;

const stableBindingId = (stableStatementId: string) => `binding:${stableStatementId}`;

const scopeIdsFor = (index: LexicalScopeIndex, predicate: (scopeId: ScopeId) => boolean) =>
  [...index.scopes.keys()].filter(predicate);

const chainFor = (index: LexicalScopeIndex, scopeId: ScopeId): readonly ScopeId[] => {
  const chain: ScopeId[] = [];
  let current: ScopeId | null = scopeId;
  while (current !== null) {
    chain.push(current);
    current = index.scopes.get(current)?.parentId ?? null;
  }
  return chain;
};

const groupVisibility = (index: LexicalScopeIndex, declarationScopeId: ScopeId) => {
  const nearestGroupScopeId = chainFor(index, declarationScopeId).find((scopeId) => index.scopes.get(scopeId)?.kind === "group");
  if (nearestGroupScopeId) {
    return {
      effectiveScopeId: nearestGroupScopeId,
      scopeIds: scopeIdsFor(index, (scopeId) => chainFor(index, scopeId).includes(nearestGroupScopeId))
    };
  }
  // Legacy group vars with no CAD parent group are visible to every consumer
  // whose parentGroupId is absent: root and conditional/for scopes not nested
  // under a real group. This is the scope-index equivalent of variableIsInScope.
  return {
    effectiveScopeId: index.rootScopeId,
    scopeIds: scopeIdsFor(index, (scopeId) => !chainFor(index, scopeId).some((id) => index.scopes.get(id)?.kind === "group"))
  };
};

export type BuildDslBindingAdapterInput = {
  statements: readonly DslStatement[];
  scopeIndex: LexicalScopeIndex;
  stableStatementIdByIndex: ReadonlyMap<number, string>;
};

export type DslBindingAdapterResult = {
  legacyBindings: readonly BindingSeed[];
  iterationBindings: readonly BindingSeed[];
};

export const buildDslBindingAdapterSeeds = ({
  statements,
  scopeIndex,
  stableStatementIdByIndex
}: BuildDslBindingAdapterInput): DslBindingAdapterResult => {
  const legacyBindings: BindingSeed[] = [];
  for (const records of scopeIndex.legacyVariablesByScope.values()) {
    for (const record of records) {
      const statement = statements[record.statementIndex];
      const stableStatementId = stableStatementIdByIndex.get(record.statementIndex);
      if (!statement || stableStatementId === undefined) {
        throw new Error(`bindingCatalogAdapter: no stable statement id supplied for legacy var at index ${record.statementIndex}`);
      }
      const isGroupScoped = attrValue(statement, "scope") === "group";
      const visibility = isGroupScoped
        ? groupVisibility(scopeIndex, record.scopeId)
        : { effectiveScopeId: scopeIndex.rootScopeId, scopeIds: [...scopeIndex.scopes.keys()] };
      legacyBindings.push({
        id: stableBindingId(stableStatementId),
        kind: "legacy",
        name: record.name,
        nameSpan: record.nameSpan,
        statementIndex: record.statementIndex,
        effectiveScopeId: visibility.effectiveScopeId,
        visibility: { kind: "scopeSet", scopeIds: visibility.scopeIds }
      });
    }
  }

  const iterationBindings: BindingSeed[] = [];
  for (const slot of scopeIndex.forGroupIterationSlots.values()) {
    if (!slot.name.trim()) continue;
    const stableStatementId = stableStatementIdByIndex.get(slot.statementIndex);
    if (stableStatementId === undefined) {
      throw new Error(`bindingCatalogAdapter: no stable statement id supplied for forGroup at index ${slot.statementIndex}`);
    }
    iterationBindings.push({
      id: `binding:iteration:${stableStatementId}`,
      kind: "iteration",
      name: slot.name,
      nameSpan: slot.nameSpan,
      statementIndex: slot.statementIndex,
      effectiveScopeId: slot.scopeId,
      visibility: {
        kind: "scopeSet",
        scopeIds: scopeIdsFor(scopeIndex, (scopeId) => chainFor(scopeIndex, scopeId).includes(slot.scopeId))
      }
    });
  }
  return { legacyBindings, iterationBindings };
};
