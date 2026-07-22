// DSL adapter: compact visibility descriptors only. It never expands a
// binding into every visible scope.
import type { BindingSeed } from "../scalars/bindingCatalog";
import type { LexicalScopeIndex, ScopeId } from "../scalars/lexicalScopeIndex";
import type { DslStatement } from "./dslTypes";

const attrValue = (statement: DslStatement, key: string) => statement.attrs.find((attr) => attr.key === key)?.value;
const stableBindingId = (stableStatementId: string) => `binding:${stableStatementId}`;

const groupVisibility = (index: LexicalScopeIndex, declarationScopeId: ScopeId) => {
  const groupScopeId = index.scopeMetadataById.get(declarationScopeId)?.effectiveGroupScopeId;
  return groupScopeId
    ? { effectiveScopeId: groupScopeId, visibility: { kind: "subtree" as const, rootScopeId: groupScopeId } }
    : { effectiveScopeId: index.rootScopeId, visibility: { kind: "outsideGroups" as const } };
};

export type BuildDslBindingAdapterInput = { statements: readonly DslStatement[]; scopeIndex: LexicalScopeIndex; stableStatementIdByIndex: ReadonlyMap<number, string> };
export type DslBindingAdapterResult = { legacyBindings: readonly BindingSeed[]; iterationBindings: readonly BindingSeed[] };

export const buildDslBindingAdapterSeeds = ({ statements, scopeIndex, stableStatementIdByIndex }: BuildDslBindingAdapterInput): DslBindingAdapterResult => {
  const recordByStatementIndex = new Map<number, { scopeId: ScopeId; name: string; nameSpan: BindingSeed["nameSpan"] }>();
  for (const [scopeId, records] of scopeIndex.legacyVariablesByScope) for (const record of records) recordByStatementIndex.set(record.statementIndex, { scopeId, name: record.name, nameSpan: record.nameSpan });
  const slotByStatementIndex = new Map<number, { scopeId: ScopeId; name: string; nameSpan: BindingSeed["nameSpan"] }>();
  for (const slot of scopeIndex.forGroupIterationSlots.values()) slotByStatementIndex.set(slot.statementIndex, slot);
  const legacyBindings: BindingSeed[] = [];
  const iterationBindings: BindingSeed[] = [];
  // Source-order scan makes the adapter deterministic without sorting maps.
  for (let statementIndex = 0; statementIndex < statements.length; statementIndex += 1) {
    const legacy = recordByStatementIndex.get(statementIndex);
    if (legacy) {
      const stableStatementId = stableStatementIdByIndex.get(statementIndex);
      if (stableStatementId === undefined) throw new Error(`bindingCatalogAdapter: no stable statement id supplied for legacy var at index ${statementIndex}`);
      const group = attrValue(statements[statementIndex], "scope") === "group";
      const translated = group ? groupVisibility(scopeIndex, legacy.scopeId) : { effectiveScopeId: scopeIndex.rootScopeId, visibility: { kind: "global" as const } };
      legacyBindings.push({ id: stableBindingId(stableStatementId), kind: "legacy", name: legacy.name, nameSpan: legacy.nameSpan, statementIndex, sourceOrder: 0, effectiveScopeId: translated.effectiveScopeId, visibility: translated.visibility });
    }
    const slot = slotByStatementIndex.get(statementIndex);
    if (slot && slot.name.trim()) {
      const stableStatementId = stableStatementIdByIndex.get(statementIndex);
      if (stableStatementId === undefined) throw new Error(`bindingCatalogAdapter: no stable statement id supplied for forGroup at index ${statementIndex}`);
      iterationBindings.push({ id: `binding:iteration:${stableStatementId}`, kind: "iteration", name: slot.name, nameSpan: slot.nameSpan, statementIndex, sourceOrder: 0, effectiveScopeId: slot.scopeId, visibility: { kind: "subtree", rootScopeId: slot.scopeId } });
    }
  }
  return { legacyBindings, iterationBindings };
};
