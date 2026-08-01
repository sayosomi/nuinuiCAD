// Pure live-buffer visibility for typed-binding completion. The caller owns
// editor range mapping; this module deliberately accepts only plain offsets,
// scope IDs, and catalog data so it remains independent of CodeMirror.

import type { Binding, BindingCatalog, BindingId } from "./bindingCatalog";
import { scopeChain, type ScopeId } from "./lexicalScopeIndex";

export type LiveTypedBindingVisibilityInput = {
  catalog: BindingCatalog;
  containingScopeId: ScopeId;
  cursorOffset: number;
  offsetForBinding: (bindingId: BindingId) => number | undefined;
  excludedBindingIds?: ReadonlySet<BindingId>;
};

type VisibleBinding = { binding: Binding; scopeDistance: number; offset: number };

/**
 * Returns one typed binding declared at or before the live cursor per visible
 * name. A binding is usable only when its catalog identity still has a mapped
 * live offset, which keeps
 * stale metadata fail-closed without asking this pure layer to inspect an
 * editor document or change description.
 */
export const visibleTypedBindingsAtLivePosition = (
  input: LiveTypedBindingVisibilityInput,
  accepts: (binding: Binding) => boolean
): readonly Binding[] => {
  const chain = scopeChain(input.catalog.scopeIndex, input.containingScopeId);
  const distanceByScope = new Map(chain.map((scopeId, index) => [scopeId, index]));
  const bestByName = new Map<string, VisibleBinding>();

  for (const binding of input.catalog.bindings) {
    if (binding.kind !== "typed" || input.excludedBindingIds?.has(binding.id) || !accepts(binding)) continue;
    const scopeDistance = distanceByScope.get(binding.effectiveScopeId);
    const offset = input.offsetForBinding(binding.id);
    if (scopeDistance === undefined || offset === undefined || offset > input.cursorOffset) continue;

    const current = bestByName.get(binding.name);
    if (current && (current.scopeDistance < scopeDistance || (current.scopeDistance === scopeDistance && current.offset >= offset))) continue;
    bestByName.set(binding.name, { binding, scopeDistance, offset });
  }

  return [...bestByName.values()].map((entry) => entry.binding);
};
