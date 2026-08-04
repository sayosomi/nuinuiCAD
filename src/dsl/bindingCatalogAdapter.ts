// DSL adapter: compact visibility descriptors only. It never expands a
// binding into every visible scope.
import type { BindingSeed } from "../scalars/bindingCatalog";
import {
  buildCadContainerIndex,
  type CadContainerIndex,
  type ReconciledCadContainerInput
} from "../scalars/containerIndex";
import type { LexicalScopeIndex, ScopeId } from "../scalars/lexicalScopeIndex";
import type { DslStatement } from "./dslTypes";

export type BuildDslBindingAdapterInput = {
  statements: readonly DslStatement[];
  scopeIndex: LexicalScopeIndex;
  stableStatementIdByIndex: ReadonlyMap<number, string>;
  reconciledContainers: ReconciledCadContainerInput;
};
export type DslBindingAdapterResult = {
  iterationBindings: readonly BindingSeed[];
  /** Element-local numeric variables stay outside this catalog. */
  containerIndex: CadContainerIndex;
};

export const buildDslBindingAdapterSeeds = ({
  statements,
  scopeIndex,
  stableStatementIdByIndex,
  reconciledContainers
}: BuildDslBindingAdapterInput): DslBindingAdapterResult => {
  const containerIndex = buildCadContainerIndex({ statements, scopeIndex, reconciled: reconciledContainers });
  const slotByStatementIndex = new Map<number, { scopeId: ScopeId; name: string; nameSpan: BindingSeed["nameSpan"] }>();
  for (const slot of scopeIndex.forGroupIterationSlots.values()) slotByStatementIndex.set(slot.statementIndex, slot);
  const iterationBindings: BindingSeed[] = [];
  // Source-order scan makes the adapter deterministic without sorting maps.
  for (let statementIndex = 0; statementIndex < statements.length; statementIndex += 1) {
    const slot = slotByStatementIndex.get(statementIndex);
    if (slot && slot.name.trim()) {
      const stableStatementId = stableStatementIdByIndex.get(statementIndex);
      if (stableStatementId === undefined) throw new Error(`bindingCatalogAdapter: no stable statement id supplied for forGroup at index ${statementIndex}`);
      iterationBindings.push({ id: `binding:iteration:${stableStatementId}`, kind: "iteration", name: slot.name, nameSpan: slot.nameSpan, statementIndex, sourceOrder: 0, effectiveScopeId: slot.scopeId, visibility: { kind: "iteration", rootScopeId: slot.scopeId } });
    }
  }
  return { iterationBindings, containerIndex };
};
