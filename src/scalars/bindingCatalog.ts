// Pure binding catalog built only from Task 11's parsed-syntax scope index and
// caller-owned stable identities. It intentionally has no CadElement or
// geometry dependency: adapters own visibility translation at that boundary.

import type { DslSpan } from "../dsl/dslTypes";
import { scopeChain, type LexicalScopeIndex, type ScopeId } from "./lexicalScopeIndex";
import type { ScalarType } from "./types";

export type BindingId = string;
export type BindingKind = "typed" | "legacy" | "iteration" | "elementLocal";
export type BindingMutability = "const" | "let" | "readonly";

export type BindingVisibility =
  | { kind: "typed"; scopeId: ScopeId }
  | { kind: "scopeSet"; scopeIds: readonly ScopeId[] }
  | { kind: "elementLocal"; ownerId: string; startOrder: number; endOrder: number };

export type BindingSeed = {
  id: BindingId;
  kind: Exclude<BindingKind, "typed">;
  name: string;
  nameSpan: DslSpan | null;
  statementIndex: number;
  effectiveScopeId: ScopeId;
  visibility: Exclude<BindingVisibility, { kind: "typed" }>;
  mutability?: BindingMutability;
  declaredType?: ScalarType | null;
};

export type Binding = {
  id: BindingId;
  kind: BindingKind;
  name: string;
  nameSpan: DslSpan | null;
  statementIndex: number;
  /** The namespace bucket used for duplicate and shadow decisions. */
  effectiveScopeId: ScopeId;
  visibility: BindingVisibility;
  mutability: BindingMutability;
  declaredType: ScalarType | null;
};

export type BuildBindingCatalogInput = {
  scopeIndex: LexicalScopeIndex;
  /** Required for every typed declaration; never synthesized from position or text. */
  stableStatementIdByIndex: ReadonlyMap<number, string>;
  legacyBindings?: readonly BindingSeed[];
  iterationBindings?: readonly BindingSeed[];
  elementLocalBindings?: readonly BindingSeed[];
};

export type BindingCatalog = {
  scopeIndex: LexicalScopeIndex;
  bindings: readonly Binding[];
  bindingsById: ReadonlyMap<BindingId, Binding>;
  /** Same-effective-scope name buckets, statement order ascending. */
  bindingsByEffectiveScopeAndName: ReadonlyMap<ScopeId, ReadonlyMap<string, readonly Binding[]>>;
  /** Adapter-owned element-local buckets, never searched through all bindings. */
  elementLocalBindingsByOwnerAndName: ReadonlyMap<string, ReadonlyMap<string, readonly Binding[]>>;
  /** Memoized nearest-to-root chain for every lexical scope. */
  scopeChains: ReadonlyMap<ScopeId, readonly ScopeId[]>;
};

const typedBindingId = (stableStatementId: string): BindingId => `binding:${stableStatementId}`;

const ordered = (bindings: readonly Binding[]) => [...bindings].sort((left, right) => left.statementIndex - right.statementIndex);

export const buildBindingCatalog = ({
  scopeIndex,
  stableStatementIdByIndex,
  legacyBindings = [],
  iterationBindings = [],
  elementLocalBindings = []
}: BuildBindingCatalogInput): BindingCatalog => {
  const typedBindings = scopeIndex.allDeclarations.map((declaration): Binding => {
    const stableStatementId = stableStatementIdByIndex.get(declaration.statementIndex);
    if (stableStatementId === undefined) {
      throw new Error(`bindingCatalog: no stable statement id supplied for typed declaration at index ${declaration.statementIndex}`);
    }
    return {
      id: typedBindingId(stableStatementId),
      kind: "typed",
      name: declaration.name,
      nameSpan: declaration.nameSpan,
      statementIndex: declaration.statementIndex,
      effectiveScopeId: declaration.scopeId,
      visibility: { kind: "typed", scopeId: declaration.scopeId },
      mutability: declaration.bindingKind,
      declaredType: declaration.declaredType
    };
  });

  const adapted = [...legacyBindings, ...iterationBindings, ...elementLocalBindings].map((seed): Binding => ({
    ...seed,
    mutability: seed.mutability ?? "readonly",
    declaredType: seed.declaredType ?? null
  }));
  const bindings = ordered([...typedBindings, ...adapted]);
  const bindingsById = new Map<BindingId, Binding>();
  const mutableBuckets = new Map<ScopeId, Map<string, Binding[]>>();
  const mutableLocalBuckets = new Map<string, Map<string, Binding[]>>();
  for (const binding of bindings) {
    if (bindingsById.has(binding.id)) throw new Error(`bindingCatalog: duplicate binding id ${binding.id}`);
    bindingsById.set(binding.id, binding);
    const names = mutableBuckets.get(binding.effectiveScopeId) ?? new Map<string, Binding[]>();
    const bucket = names.get(binding.name) ?? [];
    bucket.push(binding);
    names.set(binding.name, bucket);
    mutableBuckets.set(binding.effectiveScopeId, names);
    if (binding.visibility.kind === "elementLocal") {
      const localNames = mutableLocalBuckets.get(binding.visibility.ownerId) ?? new Map<string, Binding[]>();
      const localBucket = localNames.get(binding.name) ?? [];
      localBucket.push(binding);
      localNames.set(binding.name, localBucket);
      mutableLocalBuckets.set(binding.visibility.ownerId, localNames);
    }
  }

  const bindingsByEffectiveScopeAndName = new Map<ScopeId, ReadonlyMap<string, readonly Binding[]>>();
  for (const [scopeId, names] of mutableBuckets) {
    bindingsByEffectiveScopeAndName.set(
      scopeId,
      new Map([...names].map(([name, bucket]) => [name, ordered(bucket)]))
    );
  }
  const elementLocalBindingsByOwnerAndName = new Map<string, ReadonlyMap<string, readonly Binding[]>>();
  for (const [ownerId, names] of mutableLocalBuckets) {
    elementLocalBindingsByOwnerAndName.set(
      ownerId,
      new Map([...names].map(([name, bindings]) => [name, ordered(bindings)]))
    );
  }

  const scopeChains = new Map<ScopeId, readonly ScopeId[]>();
  for (const scopeId of scopeIndex.scopes.keys()) scopeChains.set(scopeId, scopeChain(scopeIndex, scopeId));
  return {
    scopeIndex,
    bindings,
    bindingsById,
    bindingsByEffectiveScopeAndName,
    elementLocalBindingsByOwnerAndName,
    scopeChains
  };
};
