import type { Binding } from "./bindingCatalog";

const RADIX_BITS = 11;
const RADIX_SIZE = 2 ** RADIX_BITS;
const RADIX_PASSES = 5;

export type ElementLocalRangeBucket = {
  bindingsByRank: readonly Binding[];
  bindingsByStartOrder: readonly Binding[];
  bindingsByEndOrder: readonly Binding[];
  ordinalByBindingId: ReadonlyMap<string, number>;
};

export type ElementLocalRangeIndex = ReadonlyMap<string, ReadonlyMap<string, ElementLocalRangeBucket>>;

export type ElementLocalRangeQuery = {
  key: string;
  ownerId: string;
  name: string;
  order: number;
};

export const assertElementLocalOrder = (order: number, label: string) => {
  if (!Number.isSafeInteger(order) || order < 0) {
    throw new Error(`bindingResolution: ${label} must be a non-negative safe integer, got ${order}`);
  }
};

const stableRadixByOrder = <T>(items: readonly T[], orderOf: (item: T) => number): readonly T[] => {
  if (items.length < 2) return [...items];
  let source = [...items];
  let target = new Array<T>(items.length);
  let divisor = 1;

  for (let pass = 0; pass < RADIX_PASSES; pass += 1) {
    const counts = new Uint32Array(RADIX_SIZE);
    for (const item of source) counts[Math.floor(orderOf(item) / divisor) % RADIX_SIZE] += 1;
    let offset = 0;
    for (let digit = 0; digit < RADIX_SIZE; digit += 1) {
      const count = counts[digit];
      counts[digit] = offset;
      offset += count;
    }
    for (const item of source) {
      const digit = Math.floor(orderOf(item) / divisor) % RADIX_SIZE;
      target[counts[digit]++] = item;
    }
    [source, target] = [target, source];
    divisor *= RADIX_SIZE;
  }
  return source;
};

export const buildElementLocalRangeIndex = (
  bindingsByOwnerAndName: ReadonlyMap<string, ReadonlyMap<string, readonly Binding[]>>
): ElementLocalRangeIndex => {
  const result = new Map<string, ReadonlyMap<string, ElementLocalRangeBucket>>();
  for (const [ownerId, names] of bindingsByOwnerAndName) {
    const indexedNames = new Map<string, ElementLocalRangeBucket>();
    for (const [name, bindings] of names) {
      const ordinalByBindingId = new Map<string, number>();
      for (let ordinal = 0; ordinal < bindings.length; ordinal += 1) {
        const binding = bindings[ordinal];
        if (binding.visibility.kind !== "elementLocal") {
          throw new Error(`bindingCatalog: non-local binding ${binding.id} entered the element-local index`);
        }
        assertElementLocalOrder(binding.visibility.startOrder, `startOrder for ${binding.id}`);
        assertElementLocalOrder(binding.visibility.endOrder, `endOrder for ${binding.id}`);
        ordinalByBindingId.set(binding.id, ordinal);
      }
      indexedNames.set(name, {
        bindingsByRank: bindings,
        bindingsByStartOrder: stableRadixByOrder(bindings, (binding) =>
          binding.visibility.kind === "elementLocal" ? binding.visibility.startOrder : 0),
        bindingsByEndOrder: stableRadixByOrder(bindings, (binding) =>
          binding.visibility.kind === "elementLocal" ? binding.visibility.endOrder : 0),
        ordinalByBindingId
      });
    }
    result.set(ownerId, indexedNames);
  }
  return result;
};

export const resolveElementLocalRangeQueries = (
  index: ElementLocalRangeIndex,
  queries: readonly ElementLocalRangeQuery[],
  onCandidateInspection?: (binding: Binding) => void
): ReadonlyMap<string, readonly Binding[]> => {
  const queriesByOwnerAndName = new Map<string, Map<string, ElementLocalRangeQuery[]>>();
  for (const query of queries) {
    assertElementLocalOrder(query.order, `site order for ${query.ownerId}/${query.name}`);
    const names = queriesByOwnerAndName.get(query.ownerId) ?? new Map<string, ElementLocalRangeQuery[]>();
    const bucket = names.get(query.name) ?? [];
    bucket.push(query);
    names.set(query.name, bucket);
    queriesByOwnerAndName.set(query.ownerId, names);
  }

  const candidatesByQueryKey = new Map<string, Binding[]>();
  for (const [ownerId, names] of queriesByOwnerAndName) {
    const indexedNames = index.get(ownerId);
    if (!indexedNames) continue;
    for (const [name, unsortedQueries] of names) {
      const localBucket = indexedNames.get(name);
      if (!localBucket) continue;
      const sortedQueries = stableRadixByOrder(unsortedQueries, (query) => query.order);
      const firstQueryByBindingOrdinal = new Array<number>(localBucket.bindingsByRank.length);
      const lastQueryByBindingOrdinal = new Array<number>(localBucket.bindingsByRank.length);

      let queryIndex = 0;
      for (const binding of localBucket.bindingsByStartOrder) {
        const visibility = binding.visibility;
        if (visibility.kind !== "elementLocal") continue;
        while (queryIndex < sortedQueries.length && sortedQueries[queryIndex].order < visibility.startOrder) queryIndex += 1;
        firstQueryByBindingOrdinal[localBucket.ordinalByBindingId.get(binding.id)!] = queryIndex;
      }

      queryIndex = 0;
      for (const binding of localBucket.bindingsByEndOrder) {
        const visibility = binding.visibility;
        if (visibility.kind !== "elementLocal") continue;
        while (queryIndex < sortedQueries.length && sortedQueries[queryIndex].order <= visibility.endOrder) queryIndex += 1;
        lastQueryByBindingOrdinal[localBucket.ordinalByBindingId.get(binding.id)!] = queryIndex;
      }

      for (let ordinal = 0; ordinal < localBucket.bindingsByRank.length; ordinal += 1) {
        const binding = localBucket.bindingsByRank[ordinal];
        const firstQuery = firstQueryByBindingOrdinal[ordinal];
        const lastQuery = lastQueryByBindingOrdinal[ordinal];
        for (let index = firstQuery; index < lastQuery; index += 1) {
          const query = sortedQueries[index];
          const candidates = candidatesByQueryKey.get(query.key) ?? [];
          candidates.push(binding);
          candidatesByQueryKey.set(query.key, candidates);
          onCandidateInspection?.(binding);
        }
      }
    }
  }
  return candidatesByQueryKey;
};
