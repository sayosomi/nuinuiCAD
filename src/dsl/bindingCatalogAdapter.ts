// DSL adapter: compact visibility descriptors only. It never expands a
// binding into every visible scope.
import { bindingIdForStableStatementId, type BindingSeed } from "../scalars/bindingCatalog";
import {
  buildLegacyContainerIndex,
  type LegacyContainerIndex,
  type ReconciledCadContainerInput
} from "../scalars/legacyContainerIndex";
import type { LexicalScopeIndex, ScopeId } from "../scalars/lexicalScopeIndex";
import type { DslStatement } from "./dslTypes";

const attrValue = (statement: DslStatement, key: string) => statement.attrs.find((attr) => attr.key === key)?.value;

const groupVisibility = (index: LexicalScopeIndex, containers: LegacyContainerIndex, statementIndex: number) => {
  const ownerContainerId = containers.ownerContainerIdByStatementIndex.get(statementIndex) ?? null;
  return ownerContainerId
    ? {
        effectiveScopeId: containers.effectiveScopeIdByContainerId.get(ownerContainerId) ?? `container:${ownerContainerId}`,
        visibility: { kind: "groupSubtree" as const, ownerContainerId }
      }
    : { effectiveScopeId: index.rootScopeId, visibility: { kind: "outsideGroups" as const } };
};

export type BuildDslBindingAdapterInput = {
  statements: readonly DslStatement[];
  scopeIndex: LexicalScopeIndex;
  stableStatementIdByIndex: ReadonlyMap<number, string>;
  reconciledContainers: ReconciledCadContainerInput;
};
export type DslBindingAdapterResult = {
  legacyBindings: readonly BindingSeed[];
  iterationBindings: readonly BindingSeed[];
  containerIndex: LegacyContainerIndex;
};

export const buildDslBindingAdapterSeeds = ({
  statements,
  scopeIndex,
  stableStatementIdByIndex,
  reconciledContainers
}: BuildDslBindingAdapterInput): DslBindingAdapterResult => {
  const containerIndex = buildLegacyContainerIndex({ statements, scopeIndex, reconciled: reconciledContainers });
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
      const translated = group
        ? groupVisibility(scopeIndex, containerIndex, statementIndex)
        : { effectiveScopeId: scopeIndex.rootScopeId, visibility: { kind: "global" as const } };
      legacyBindings.push({ id: bindingIdForStableStatementId(stableStatementId), kind: "legacy", name: legacy.name, nameSpan: legacy.nameSpan, statementIndex, sourceOrder: 0, effectiveScopeId: translated.effectiveScopeId, visibility: translated.visibility });
    }
    const slot = slotByStatementIndex.get(statementIndex);
    if (slot && slot.name.trim()) {
      const stableStatementId = stableStatementIdByIndex.get(statementIndex);
      if (stableStatementId === undefined) throw new Error(`bindingCatalogAdapter: no stable statement id supplied for forGroup at index ${statementIndex}`);
      iterationBindings.push({ id: `binding:iteration:${stableStatementId}`, kind: "iteration", name: slot.name, nameSpan: slot.nameSpan, statementIndex, sourceOrder: 0, effectiveScopeId: slot.scopeId, visibility: { kind: "iteration", rootScopeId: slot.scopeId } });
    }
  }
  return { legacyBindings, iterationBindings, containerIndex };
};
