import type { Binding, BindingCatalog, BindingId } from "./bindingCatalog";
import type { ScopeId } from "./lexicalScopeIndex";

export type BindingReferenceSite = {
  scopeId: ScopeId;
  statementIndex: number;
  /** Set only while resolving a typed declaration's initializer. */
  initializerBindingId?: BindingId;
  /** Adapter-owned element-local lookup range; no geometry types leak here. */
  elementLocal?: { ownerId: string; order: number };
};

export type BindingResolution =
  | { kind: "resolved"; binding: Binding }
  | { kind: "undefined"; name: string; scopeId: ScopeId; statementIndex: number }
  | { kind: "forward"; name: string; scopeId: ScopeId; statementIndex: number; bindingIds: readonly BindingId[] }
  | { kind: "self"; name: string; scopeId: ScopeId; statementIndex: number; bindingId: BindingId }
  | { kind: "duplicate"; name: string; scopeId: ScopeId; statementIndex: number; bindingIds: readonly BindingId[] };

const bucket = (catalog: BindingCatalog, scopeId: ScopeId, name: string) =>
  catalog.bindingsByEffectiveScopeAndName.get(scopeId)?.get(name) ?? [];

const visibleAt = (catalog: BindingCatalog, binding: Binding, site: BindingReferenceSite): boolean => {
  if (binding.visibility.kind === "typed") return site.scopeId === binding.visibility.scopeId ||
    (catalog.scopeChains.get(site.scopeId)?.includes(binding.visibility.scopeId) ?? false);
  if (binding.visibility.kind === "scopeSet") return binding.visibility.scopeIds.includes(site.scopeId);
  const local = site.elementLocal;
  return local !== undefined &&
    local.ownerId === binding.visibility.ownerId &&
    local.order >= binding.visibility.startOrder &&
    local.order <= binding.visibility.endOrder;
};

type BucketLookup = { visible: BindingResolution | null; forward: BindingResolution | null };

const lookupScopeBucket = (catalog: BindingCatalog, scopeId: ScopeId, name: string, site: BindingReferenceSite): BucketLookup => {
  const bindings = bucket(catalog, scopeId, name);
  const visible = bindings.filter((binding) =>
    visibleAt(catalog, binding, site) && (binding.kind !== "typed" || binding.statementIndex < site.statementIndex)
  );
  if (visible.length > 1) {
    return {
      visible: { kind: "duplicate", name, scopeId: site.scopeId, statementIndex: site.statementIndex, bindingIds: visible.map((item) => item.id) },
      forward: null
    };
  }
  const only = visible[0];
  if (only) {
    return { visible: { kind: "resolved", binding: only }, forward: null };
  }
  const futureTyped = bindings
    .filter((binding) => binding.kind === "typed" && binding.statementIndex >= site.statementIndex);
  return {
    visible: null,
    forward: futureTyped.length === 0
      ? null
      : { kind: "forward", name, scopeId: site.scopeId, statementIndex: site.statementIndex, bindingIds: futureTyped.map((item) => item.id) }
  };
};

const resolveInitializerSelf = (catalog: BindingCatalog, name: string, site: BindingReferenceSite, self: Binding): BindingResolution => {
  const chain = catalog.scopeChains.get(site.scopeId) ?? [];
  for (const scopeId of chain.filter((scopeId) => scopeId !== self.effectiveScopeId)) {
    const outer = lookupScopeBucket(catalog, scopeId, name, site).visible;
    if (outer?.kind === "resolved") return outer;
  }
  return { kind: "self", name, scopeId: site.scopeId, statementIndex: site.statementIndex, bindingId: self.id };
};

export const resolveBindingReference = (
  catalog: BindingCatalog,
  name: string,
  site: BindingReferenceSite
): BindingResolution => {
  const self = site.initializerBindingId ? catalog.bindingsById.get(site.initializerBindingId) : undefined;
  if (self?.kind === "typed" && self.name === name) return resolveInitializerSelf(catalog, name, site, self);

  // Element-local bindings are explicitly adapter-scoped and always win. A
  // same-owner duplicate remains ambiguous; it never falls back to document
  // or iteration bindings.
  if (site.elementLocal) {
    const localBucket = (catalog.elementLocalBindingsByOwnerAndName.get(site.elementLocal.ownerId)?.get(name) ?? [])
      .filter((binding) => visibleAt(catalog, binding, site));
    if (localBucket.length > 1) {
      return { kind: "duplicate", name, scopeId: site.scopeId, statementIndex: site.statementIndex, bindingIds: localBucket.map((item) => item.id) };
    }
    if (localBucket[0]) return { kind: "resolved", binding: localBucket[0] };
  }

  let deferredForward: BindingResolution | null = null;
  for (const scopeId of catalog.scopeChains.get(site.scopeId) ?? []) {
    const lookup = lookupScopeBucket(catalog, scopeId, name, site);
    if (lookup.visible) return lookup.visible;
    if (!deferredForward && lookup.forward) deferredForward = lookup.forward;
  }
  return deferredForward ?? { kind: "undefined", name, scopeId: site.scopeId, statementIndex: site.statementIndex };
};

export const visibleBindingsAt = (catalog: BindingCatalog, site: BindingReferenceSite): readonly Binding[] => {
  const names = new Map<string, Binding>();
  const candidateNames = new Set<string>();
  if (site.elementLocal) {
    for (const name of catalog.elementLocalBindingsByOwnerAndName.get(site.elementLocal.ownerId)?.keys() ?? []) candidateNames.add(name);
  }
  for (const scopeId of catalog.scopeChains.get(site.scopeId) ?? []) {
    for (const name of catalog.bindingsByEffectiveScopeAndName.get(scopeId)?.keys() ?? []) candidateNames.add(name);
  }
  for (const name of candidateNames) {
    const result = resolveBindingReference(catalog, name, site);
    if (result.kind === "resolved") names.set(name, result.binding);
  }
  return [...names.values()];
};
