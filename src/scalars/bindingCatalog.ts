// Canonical, comparison-sort-free binding catalog. Adapters provide stable
// identities and source positions; this module only uses dense ranks derived
// from the parsed statement stream.
import type { DslSpan } from "../dsl/dslTypes";
import type { LexicalScopeIndex, ScopeId } from "./lexicalScopeIndex";
import type { LegacyContainerIndex } from "./legacyContainerIndex";
import type { ScalarType } from "./types";
import { buildElementLocalRangeIndex, type ElementLocalRangeIndex } from "./elementLocalRangeIndex";

export type BindingId = string;
export type BindingKind = "typed" | "legacy" | "iteration" | "elementLocal";
export type BindingMutability = "const" | "let" | "readonly";
export type BindingVisibility =
  | { kind: "typed"; scopeId: ScopeId }
  | { kind: "global" }
  | { kind: "groupSubtree"; ownerContainerId: string }
  | { kind: "iteration"; rootScopeId: ScopeId }
  | { kind: "outsideGroups" }
  | { kind: "elementLocal"; ownerId: string; startOrder: number; endOrder: number };

export type BindingSeed = {
  id: BindingId;
  kind: Exclude<BindingKind, "typed">;
  name: string;
  nameSpan: DslSpan | null;
  statementIndex: number;
  /** Canonical tie-breaker for multiple adapter seeds on one statement. */
  sourceOrder: number;
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
  effectiveScopeId: ScopeId;
  visibility: BindingVisibility;
  mutability: BindingMutability;
  declaredType: ScalarType | null;
  /** Position in the canonical catalog; all downstream ordering uses this. */
  rank: number;
};

export type BuildBindingCatalogInput = {
  scopeIndex: LexicalScopeIndex;
  stableStatementIdByIndex: ReadonlyMap<number, string>;
  legacyBindings?: readonly BindingSeed[];
  iterationBindings?: readonly BindingSeed[];
  elementLocalBindings?: readonly BindingSeed[];
  containerIndex?: LegacyContainerIndex;
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
  elementLocalBindingsByOwnerAndName: ReadonlyMap<string, ReadonlyMap<string, readonly Binding[]>>;
  elementLocalRangeIndex: ElementLocalRangeIndex;
  containerIndex: LegacyContainerIndex;
  declarationDuplicateBuckets: readonly (readonly Binding[])[];
};

export type BindingLookupNamespaces = {
  /** Registered legacy lanes. Runtime visibility begins only on activation. */
  globalByName: ReadonlyMap<string, readonly Binding[]>;
  /** Selected only for sites outside every CAD group. */
  outsideGroupsByName: ReadonlyMap<string, readonly Binding[]>;
  groupByOwnerAndName: ReadonlyMap<string, ReadonlyMap<string, readonly Binding[]>>;
  /** Iteration slots are structural and become visible when their scope opens. */
  iterationByScopeAndName: ReadonlyMap<ScopeId, ReadonlyMap<string, readonly Binding[]>>;
  legacyByStatementIndex: ReadonlyMap<number, readonly Binding[]>;
};

const emptyContainerIndex: LegacyContainerIndex = {
  ownerContainerIdByStatementIndex: new Map(),
  containerIdByScopeId: new Map(),
  containerKindById: new Map(),
  parentContainerIdById: new Map(),
  effectiveScopeIdByContainerId: new Map()
};

const typedBindingId = (stableStatementId: string): BindingId => `binding:${stableStatementId}`;
const kindLane: Record<BindingKind, number> = { typed: 0, legacy: 1, iteration: 2, elementLocal: 3 };

type Ordered = Omit<Binding, "rank"> & { sourceOrder: number };

export const buildBindingCatalog = ({
  scopeIndex,
  stableStatementIdByIndex,
  legacyBindings = [],
  iterationBindings = [],
  elementLocalBindings = [],
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
      visibility: { kind: "typed", scopeId: declaration.scopeId }, mutability: declaration.bindingKind, declaredType: declaration.declaredType
    });
  }
  for (const seed of [...legacyBindings, ...iterationBindings, ...elementLocalBindings]) {
    if (!Number.isInteger(seed.sourceOrder) || seed.sourceOrder < 0) throw new Error(`bindingCatalog: invalid sourceOrder for ${seed.id}`);
    enqueue({ ...seed, mutability: seed.mutability ?? "readonly", declaredType: seed.declaredType ?? null });
  }

  const bindings: Binding[] = [];
  for (const statementLanes of lanes) {
    for (let lane = 0; lane < 4; lane += 1) {
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

  const bindingsById = new Map<BindingId, Binding>();
  const documentBuckets = new Map<ScopeId, Map<string, Binding[]>>();
  const localBuckets = new Map<string, Map<string, Binding[]>>();
  const globalByName = new Map<string, Binding[]>();
  const outsideGroupsByName = new Map<string, Binding[]>();
  const groupByOwnerAndName = new Map<string, Map<string, Binding[]>>();
  const iterationByScopeAndName = new Map<ScopeId, Map<string, Binding[]>>();
  const legacyByStatementIndex = new Map<number, Binding[]>();
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
    if (binding.visibility.kind === "elementLocal") {
      const names = localBuckets.get(binding.visibility.ownerId) ?? new Map<string, Binding[]>();
      const bucket = names.get(binding.name) ?? [];
      bucket.push(binding); names.set(binding.name, bucket); localBuckets.set(binding.visibility.ownerId, names);
    } else {
      const names = documentBuckets.get(binding.effectiveScopeId) ?? new Map<string, Binding[]>();
      const bucket = names.get(binding.name) ?? [];
      bucket.push(binding); names.set(binding.name, bucket); documentBuckets.set(binding.effectiveScopeId, names);
      if (binding.visibility.kind === "global") {
        const globalBucket = globalByName.get(binding.name) ?? [];
        globalBucket.push(binding);
        globalByName.set(binding.name, globalBucket);
      } else if (binding.visibility.kind === "outsideGroups") {
        const outsideBucket = outsideGroupsByName.get(binding.name) ?? [];
        outsideBucket.push(binding);
        outsideGroupsByName.set(binding.name, outsideBucket);
      } else if (binding.visibility.kind === "groupSubtree") {
        addLookupBinding(groupByOwnerAndName, binding.visibility.ownerContainerId, binding);
      } else if (binding.visibility.kind === "iteration") {
        addLookupBinding(iterationByScopeAndName, binding.visibility.rootScopeId, binding);
      }
      if (binding.kind === "legacy") {
        const statementBindings = legacyByStatementIndex.get(binding.statementIndex) ?? [];
        statementBindings.push(binding);
        legacyByStatementIndex.set(binding.statementIndex, statementBindings);
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
  const elementLocalBindingsByOwnerAndName = freezeBuckets(localBuckets);
  const elementLocalRangeIndex = buildElementLocalRangeIndex(elementLocalBindingsByOwnerAndName);
  const lookupNamespaces: BindingLookupNamespaces = {
    globalByName,
    outsideGroupsByName,
    groupByOwnerAndName: freezeBuckets(groupByOwnerAndName),
    iterationByScopeAndName: freezeBuckets(iterationByScopeAndName),
    legacyByStatementIndex
  };
  // Discover duplicate buckets in catalog rank order, not Map insertion order.
  for (const binding of bindings) {
    const bucket = binding.visibility.kind === "elementLocal"
      ? elementLocalBindingsByOwnerAndName.get(binding.visibility.ownerId)?.get(binding.name)
      : bindingsByEffectiveScopeAndName.get(binding.effectiveScopeId)?.get(binding.name);
    if (bucket && bucket.length > 1 && !duplicateSeen.has(bucket)) { duplicateSeen.add(bucket); declarationDuplicateBuckets.push(bucket); }
  }
  return { scopeIndex, bindings, bindingsById, lookupNamespaces, bindingsByEffectiveScopeAndName, elementLocalBindingsByOwnerAndName, elementLocalRangeIndex, containerIndex, declarationDuplicateBuckets };
};
