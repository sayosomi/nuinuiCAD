// Neutral local-resolution owner for element-local numeric variables
// (`vars: [...]`). This module is deliberately independent of BindingCatalog:
// element-local variables are an element-owned local numeric namespace, never
// document-wide bindings, and must never re-enter the document/iteration
// catalog lanes those share (see docs/typed-variables/decisions.md D05 and
// the Task 52 legacy-removal manifest's explicit "outside the document
// binding catalog" contract for this namespace).
import type { CadElement } from "../types/geometry";

const RADIX_BITS = 11;
const RADIX_SIZE = 2 ** RADIX_BITS;
const RADIX_PASSES = 5;

export type ElementLocalBinding = {
  id: string;
  name: string;
  ownerId: string;
  startOrder: number;
  endOrder: number;
};

export type ElementLocalRangeBucket = {
  bindingsByRank: readonly ElementLocalBinding[];
  bindingsByStartOrder: readonly ElementLocalBinding[];
  bindingsByEndOrder: readonly ElementLocalBinding[];
  ordinalByBindingId: ReadonlyMap<string, number>;
};

export type ElementLocalRangeIndex = ReadonlyMap<string, ReadonlyMap<string, ElementLocalRangeBucket>>;

export type ElementLocalRangeQuery = {
  key: string;
  ownerId: string;
  name: string;
  order: number;
};

/** Source-order name lookup shared by source semantic analysis and the
 * runtime-owned local namespace. The caller chooses how many entries are
 * visible; no runtime identity or BindingCatalog entry is involved. */
export type ElementLocalVariableNameEntry = {
  name: string;
  variableIndex: number;
};

export const elementLocalVariableAtSourceOrder = (
  entries: readonly ElementLocalVariableNameEntry[],
  name: string,
  visibleCount = entries.length
): ElementLocalVariableNameEntry | null => {
  for (let index = Math.min(visibleCount, entries.length) - 1; index >= 0; index -= 1) {
    if (entries[index].name === name) return entries[index];
  }
  return null;
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
  bindingsByOwnerAndName: ReadonlyMap<string, ReadonlyMap<string, readonly ElementLocalBinding[]>>
): ElementLocalRangeIndex => {
  const result = new Map<string, ReadonlyMap<string, ElementLocalRangeBucket>>();
  for (const [ownerId, names] of bindingsByOwnerAndName) {
    const indexedNames = new Map<string, ElementLocalRangeBucket>();
    for (const [name, bindings] of names) {
      const ordinalByBindingId = new Map<string, number>();
      for (let ordinal = 0; ordinal < bindings.length; ordinal += 1) {
        const binding = bindings[ordinal];
        assertElementLocalOrder(binding.startOrder, `startOrder for ${binding.id}`);
        assertElementLocalOrder(binding.endOrder, `endOrder for ${binding.id}`);
        ordinalByBindingId.set(binding.id, ordinal);
      }
      indexedNames.set(name, {
        bindingsByRank: bindings,
        bindingsByStartOrder: stableRadixByOrder(bindings, (binding) => binding.startOrder),
        bindingsByEndOrder: stableRadixByOrder(bindings, (binding) => binding.endOrder),
        ordinalByBindingId
      });
    }
    result.set(ownerId, indexedNames);
  }
  return result;
};

/**
 * The one production entry point: scans every element's own
 * `numericVariables` directly, with no BindingCatalog/BindingSeed
 * involvement at all. `startOrder`/`endOrder` stay `[0, MAX_SAFE_INTEGER]`
 * for every variable - an element-local variable is visible to every
 * geometry/text reference on its owning element, regardless of the
 * variable's own declaration order within `vars: [...]` (matching the
 * runtime numeric evaluator, which resolves every local by name without
 * regard to declaration position).
 */
export const buildElementLocalRangeIndexFromElements = (elements: readonly CadElement[]): ElementLocalRangeIndex => {
  const bindingsByOwnerAndName = new Map<string, Map<string, ElementLocalBinding[]>>();
  for (const element of elements) {
    for (const variable of element.numericVariables ?? []) {
      const names = bindingsByOwnerAndName.get(element.id) ?? new Map<string, ElementLocalBinding[]>();
      const bucket = names.get(variable.name) ?? [];
      bucket.push({
        id: `binding:element-local:${element.id}:${variable.id}`,
        name: variable.name,
        ownerId: element.id,
        startOrder: 0,
        endOrder: Number.MAX_SAFE_INTEGER
      });
      names.set(variable.name, bucket);
      bindingsByOwnerAndName.set(element.id, names);
    }
  }
  return buildElementLocalRangeIndex(bindingsByOwnerAndName);
};

export const emptyElementLocalRangeIndex: ElementLocalRangeIndex = new Map();

export const resolveElementLocalRangeQueries = (
  index: ElementLocalRangeIndex,
  queries: readonly ElementLocalRangeQuery[],
  onCandidateInspection?: (binding: ElementLocalBinding) => void
): ReadonlyMap<string, readonly ElementLocalBinding[]> => {
  const queriesByOwnerAndName = new Map<string, Map<string, ElementLocalRangeQuery[]>>();
  for (const query of queries) {
    assertElementLocalOrder(query.order, `site order for ${query.ownerId}/${query.name}`);
    const names = queriesByOwnerAndName.get(query.ownerId) ?? new Map<string, ElementLocalRangeQuery[]>();
    const bucket = names.get(query.name) ?? [];
    bucket.push(query);
    names.set(query.name, bucket);
    queriesByOwnerAndName.set(query.ownerId, names);
  }

  const candidatesByQueryKey = new Map<string, ElementLocalBinding[]>();
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
        while (queryIndex < sortedQueries.length && sortedQueries[queryIndex].order < binding.startOrder) queryIndex += 1;
        firstQueryByBindingOrdinal[localBucket.ordinalByBindingId.get(binding.id)!] = queryIndex;
      }

      queryIndex = 0;
      for (const binding of localBucket.bindingsByEndOrder) {
        while (queryIndex < sortedQueries.length && sortedQueries[queryIndex].order <= binding.endOrder) queryIndex += 1;
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
