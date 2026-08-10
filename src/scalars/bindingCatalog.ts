// Canonical, comparison-sort-free binding catalog. Adapters provide stable
// identities and source positions; this module only uses dense ranks derived
// from the parsed statement stream.
import type { DslSpan } from "../dsl/dslTypes";
import type { LexicalScopeIndex, ScopeId } from "./lexicalScopeIndex";
import type { CadContainerIndex } from "./containerIndex";
import type { ScalarType } from "./types";

export type BindingId = string;
export type BindingKind = "typed" | "iteration";
export type BindingMutability = "const" | "let" | "readonly";
export type BindingVisibility =
  | { kind: "typed"; scopeId: ScopeId }
  | { kind: "iteration"; rootScopeId: ScopeId };
/** Whether a binding participates in ordinary source-name resolution. */
export type BindingResolutionMode = "sourceLookup" | "preResolvedOnly";

export type BindingSeed = {
  id: BindingId;
  kind: BindingKind;
  name: string;
  nameSpan: DslSpan | null;
  statementIndex: number;
  /** Canonical tie-breaker for multiple adapter seeds on one statement. */
  sourceOrder: number;
  effectiveScopeId: ScopeId;
  visibility: BindingVisibility;
  mutability?: BindingMutability;
  declaredType?: ScalarType | null;
  /** Explicit declaration-version identity for non-document bindings. */
  declarationVersionId?: string;
  /** Synthetic bindings can remain in the combined graph without entering source lookup. */
  resolutionMode?: BindingResolutionMode;
};

export type Binding = {
  id: BindingId;
  kind: BindingKind;
  name: string;
  nameSpan: DslSpan | null;
  statementIndex: number;
  effectiveScopeId: ScopeId;
  visibility: BindingVisibility;
  mutability: BindingMutability;
  declaredType: ScalarType | null;
  /** Position in the canonical catalog; all downstream ordering uses this. */
  rank: number;
  /** Optional stable declaration-version identity for synthetic bindings. */
  declarationVersionId?: string;
  /** Source-name candidates are explicitly separated from pre-resolved edges. */
  resolutionMode?: BindingResolutionMode;
};

export type BuildBindingCatalogInput = {
  scopeIndex: LexicalScopeIndex;
  stableStatementIdByIndex: ReadonlyMap<number, string>;
  iterationBindings?: readonly BindingSeed[];
  /** Additional already-resolved typed bindings, such as module instances. */
  additionalBindings?: readonly BindingSeed[];
  containerIndex?: CadContainerIndex;
};

export type BindingCatalog = {
  scopeIndex: LexicalScopeIndex;
  bindings: readonly Binding[];
  bindingsById: ReadonlyMap<BindingId, Binding>;
  /**
   * Lookup-only visibility lanes. These are intentionally separate from the
   * effective-scope buckets below: the latter remain the source of truth for
   * document/iteration duplicate diagnostics, while these lanes ensure a
   * lookup never receives bindings that are structurally invisible at its
   * lexical level.
   */
  lookupNamespaces: BindingLookupNamespaces;
  bindingsByEffectiveScopeAndName: ReadonlyMap<ScopeId, ReadonlyMap<string, readonly Binding[]>>;
  containerIndex: CadContainerIndex;
  declarationDuplicateBuckets: readonly (readonly Binding[])[];
};

export type BindingLookupNamespaces = {
  /** Iteration slots are structural and become visible when their scope opens. */
  iterationByScopeAndName: ReadonlyMap<ScopeId, ReadonlyMap<string, readonly Binding[]>>;
};

const emptyContainerIndex: CadContainerIndex = {
  ownerContainerIdByStatementIndex: new Map(),
  containerIdByScopeId: new Map(),
  containerKindById: new Map(),
  parentContainerIdById: new Map(),
  effectiveScopeIdByContainerId: new Map()
};

/**
 * Stable binding IDs are derived only from the reconciler-owned statement
 * identity; runtime element IDs are never used as a binding namespace.
 */
export const bindingIdForStableStatementId = (stableStatementId: string): BindingId => `binding:${stableStatementId}`;
const typedBindingId = bindingIdForStableStatementId;
const kindLane: Record<BindingKind, number> = { typed: 0, iteration: 1 };

type Ordered = Omit<Binding, "rank"> & { sourceOrder: number };

export const buildBindingCatalog = ({
  scopeIndex,
  stableStatementIdByIndex,
  iterationBindings = [],
  additionalBindings = [],
  containerIndex = emptyContainerIndex
}: BuildBindingCatalogInput): BindingCatalog => {
  const statementCount = scopeIndex.statementRankByIndex.size;
  const lanes: (Map<number, Ordered[]> | undefined)[][] = Array.from({ length: statementCount }, () => []);
  const enqueue = (binding: Ordered) => {
    const statementRank = scopeIndex.statementRankByIndex.get(binding.statementIndex);
    if (statementRank === undefined) throw new Error(`bindingCatalog: unknown statement index ${binding.statementIndex}`);
    const lane = kindLane[binding.kind];
    const slots = lanes[statementRank][lane] ?? new Map<number, Ordered[]>();
    const slot = slots.get(binding.sourceOrder) ?? [];
    slot.push(binding);
    slots.set(binding.sourceOrder, slot);
    lanes[statementRank][lane] = slots;
  };

  for (const declaration of scopeIndex.allDeclarations) {
    const stableStatementId = stableStatementIdByIndex.get(declaration.statementIndex);
    if (stableStatementId === undefined) throw new Error(`bindingCatalog: no stable statement id supplied for typed declaration at index ${declaration.statementIndex}`);
    enqueue({
      id: typedBindingId(stableStatementId), kind: "typed", name: declaration.name, nameSpan: declaration.nameSpan,
      statementIndex: declaration.statementIndex, sourceOrder: 0, effectiveScopeId: declaration.scopeId,
      visibility: { kind: "typed", scopeId: declaration.scopeId }, mutability: declaration.bindingKind,
      declaredType: declaration.declaredType, resolutionMode: "sourceLookup"
    });
  }
  for (const seed of iterationBindings) {
    if (seed.kind !== "iteration") throw new Error(`bindingCatalog: iterationBindings must contain iteration seeds`);
    if (!Number.isInteger(seed.sourceOrder) || seed.sourceOrder < 0) throw new Error(`bindingCatalog: invalid sourceOrder for ${seed.id}`);
    enqueue({ ...seed, mutability: seed.mutability ?? "readonly", declaredType: seed.declaredType ?? null,
      resolutionMode: seed.resolutionMode ?? "sourceLookup" });
  }

  const bindings: Binding[] = [];
  for (const statementLanes of lanes) {
    for (let lane = 0; lane < 2; lane += 1) {
      const slots = statementLanes[lane];
      if (!slots) continue;
      const slotCount = slots.size;
      for (let sourceOrder = 0; sourceOrder < slotCount; sourceOrder += 1) {
        const slot = slots.get(sourceOrder);
        if (!slot || slot.length !== 1) throw new Error("bindingCatalog: sourceOrder must be contiguous and unique per statement/kind");
        bindings.push({ ...slot[0], rank: bindings.length });
      }
    }
  }

  // Synthetic module bindings have no entry in the document-only scope
  // index. They are already ordered by the module execution planner and are
  // appended as an explicit catalog lane; no source name lookup uses them.
  for (const seed of additionalBindings) {
    if (!Number.isInteger(seed.sourceOrder) || seed.sourceOrder < 0) throw new Error(`bindingCatalog: invalid sourceOrder for ${seed.id}`);
    bindings.push({
      ...seed,
      mutability: seed.mutability ?? "const",
      declaredType: seed.declaredType ?? null,
      resolutionMode: seed.resolutionMode ?? "sourceLookup",
      visibility: seed.visibility,
      rank: bindings.length,
      ...(seed.declarationVersionId ? { declarationVersionId: seed.declarationVersionId } : {})
    });
  }

  const bindingsById = new Map<BindingId, Binding>();
  const documentBuckets = new Map<ScopeId, Map<string, Binding[]>>();
  const iterationByScopeAndName = new Map<ScopeId, Map<string, Binding[]>>();
  const addLookupBinding = <K>(index: Map<K, Map<string, Binding[]>>, key: K, binding: Binding) => {
    const names = index.get(key) ?? new Map<string, Binding[]>();
    const bucket = names.get(binding.name) ?? [];
    bucket.push(binding);
    names.set(binding.name, bucket);
    index.set(key, names);
  };
  for (const binding of bindings) {
    if (bindingsById.has(binding.id)) throw new Error(`bindingCatalog: duplicate binding id ${binding.id}`);
    bindingsById.set(binding.id, binding);
    if (binding.resolutionMode !== "preResolvedOnly") {
      const names = documentBuckets.get(binding.effectiveScopeId) ?? new Map<string, Binding[]>();
      const bucket = names.get(binding.name) ?? [];
      bucket.push(binding); names.set(binding.name, bucket); documentBuckets.set(binding.effectiveScopeId, names);
      if (binding.visibility.kind === "iteration") {
        addLookupBinding(iterationByScopeAndName, binding.visibility.rootScopeId, binding);
      }
    }
  }
  const declarationDuplicateBuckets: (readonly Binding[])[] = [];
  const duplicateSeen = new Set<readonly Binding[]>();
  const freezeBuckets = <K>(source: Map<K, Map<string, Binding[]>>) => {
    const result = new Map<K, ReadonlyMap<string, readonly Binding[]>>();
    for (const [key, names] of source) result.set(key, names);
    return result;
  };
  const bindingsByEffectiveScopeAndName = freezeBuckets(documentBuckets);
  const lookupNamespaces: BindingLookupNamespaces = {
    iterationByScopeAndName: freezeBuckets(iterationByScopeAndName)
  };
  // Discover duplicate buckets in catalog rank order, not Map insertion order.
  for (const binding of bindings) {
    const bucket = bindingsByEffectiveScopeAndName.get(binding.effectiveScopeId)?.get(binding.name);
    if (bucket && bucket.length > 1 && !duplicateSeen.has(bucket)) { duplicateSeen.add(bucket); declarationDuplicateBuckets.push(bucket); }
  }
  return { scopeIndex, bindings, bindingsById, lookupNamespaces, bindingsByEffectiveScopeAndName, containerIndex, declarationDuplicateBuckets };
};
