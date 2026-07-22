import type { Binding, BindingCatalog, BindingId } from "./bindingCatalog";
import type { ScopeId } from "./lexicalScopeIndex";

export type BindingReferenceSite = { scopeId: ScopeId; statementIndex: number; initializerBindingId?: BindingId; elementLocal?: { ownerId: string; order: number } };
export type BindingResolution =
  | { kind: "resolved"; binding: Binding }
  | { kind: "undefined"; name: string; scopeId: ScopeId; statementIndex: number }
  | { kind: "forward"; name: string; scopeId: ScopeId; statementIndex: number; bindingIds: readonly BindingId[] }
  | { kind: "self"; name: string; scopeId: ScopeId; statementIndex: number; bindingId: BindingId }
  | { kind: "duplicate"; name: string; scopeId: ScopeId; statementIndex: number; bindingIds: readonly BindingId[] };

export type InitializerResolutionRequest = {
  fromBindingId: BindingId;
  occurrenceIndex: number;
  name: string;
  site: BindingReferenceSite;
};
export type ResolvedInitializerReference = InitializerResolutionRequest & { resolution: BindingResolution };

type ScopeFrame = { scopeId: ScopeId; names: Map<string, Binding[]> };
type CanonicalRequest = InitializerResolutionRequest & { rank: number; key: string };

const keyFor = (bindingId: BindingId, occurrenceIndex: number) => `${bindingId}\u0000${occurrenceIndex}`;
const isAncestor = (catalog: BindingCatalog, ancestorId: ScopeId, descendantId: ScopeId) => {
  const ancestor = catalog.scopeIndex.scopeMetadataById.get(ancestorId);
  const descendant = catalog.scopeIndex.scopeMetadataById.get(descendantId);
  return !!ancestor && !!descendant && ancestor.treeEnter <= descendant.treeEnter && descendant.treeEnter < ancestor.treeExit;
};
const visibleAt = (catalog: BindingCatalog, binding: Binding, site: BindingReferenceSite) => {
  if (binding.visibility.kind === "global" || binding.visibility.kind === "typed") return true;
  if (binding.visibility.kind === "outsideGroups") return catalog.scopeIndex.scopeMetadataById.get(site.scopeId)?.effectiveGroupScopeId === null;
  if (binding.visibility.kind === "subtree") return isAncestor(catalog, binding.visibility.rootScopeId, site.scopeId);
  const local = site.elementLocal;
  return !!local && local.ownerId === binding.visibility.ownerId && local.order >= binding.visibility.startOrder && local.order <= binding.visibility.endOrder;
};

const canonicalize = (catalog: BindingCatalog, requests: readonly InitializerResolutionRequest[]): readonly CanonicalRequest[] => {
  const slotsByBindingId = new Map<BindingId, (InitializerResolutionRequest | undefined)[]>();
  for (const request of requests) {
    const binding = catalog.bindingsById.get(request.fromBindingId);
    if (!binding || binding.kind !== "typed") throw new Error(`bindingResolution: unknown typed binding ${request.fromBindingId}`);
    if (!Number.isInteger(request.occurrenceIndex) || request.occurrenceIndex < 0) throw new Error(`bindingResolution: invalid occurrenceIndex for ${request.fromBindingId}`);
    const slots = slotsByBindingId.get(request.fromBindingId) ?? [];
    if (request.occurrenceIndex >= requests.length || slots[request.occurrenceIndex]) throw new Error(`bindingResolution: duplicate or sparse occurrenceIndex for ${request.fromBindingId}`);
    slots[request.occurrenceIndex] = request; slotsByBindingId.set(request.fromBindingId, slots);
  }
  const canonical: CanonicalRequest[] = [];
  for (const binding of catalog.bindings) {
    const slots = slotsByBindingId.get(binding.id);
    if (!slots) continue;
    for (let occurrenceIndex = 0; occurrenceIndex < slots.length; occurrenceIndex += 1) {
      const request = slots[occurrenceIndex];
      if (!request) throw new Error(`bindingResolution: sparse occurrenceIndex for ${binding.id}`);
      canonical.push({ ...request, rank: binding.rank, key: keyFor(binding.id, occurrenceIndex) });
    }
  }
  return canonical;
};

const transition = (
  catalog: BindingCatalog, frames: ScopeFrame[], activeByName: Map<string, ScopeFrame[]>, targetScopeId: ScopeId,
  onEnter: (frame: ScopeFrame) => void
) => {
  while (frames.length && !isAncestor(catalog, frames[frames.length - 1].scopeId, targetScopeId)) {
    const frame = frames.pop()!;
    for (const name of frame.names.keys()) activeByName.get(name)?.pop();
  }
  const entering: ScopeId[] = [];
  let current: ScopeId | null = targetScopeId;
  while (current && (!frames.length || current !== frames[frames.length - 1].scopeId)) {
    entering.push(current); current = catalog.scopeIndex.scopeMetadataById.get(current)?.parentId ?? null;
  }
  for (let index = entering.length - 1; index >= 0; index -= 1) {
    const frame = { scopeId: entering[index], names: new Map<string, Binding[]>() };
    frames.push(frame); onEnter(frame);
  }
};

const addBinding = (frame: ScopeFrame, binding: Binding, activeByName: Map<string, ScopeFrame[]>) => {
  const bucket = frame.names.get(binding.name);
  if (bucket) { bucket.push(binding); return; }
  frame.names.set(binding.name, [binding]);
  const stack = activeByName.get(binding.name) ?? [];
  stack.push(frame); activeByName.set(binding.name, stack);
};

const resolutionFor = (catalog: BindingCatalog, request: CanonicalRequest, activeByName: Map<string, ScopeFrame[]>): BindingResolution | null => {
  const { name, site } = request;
  if (site.elementLocal) {
    const local = catalog.elementLocalBindingsByOwnerAndName.get(site.elementLocal.ownerId)?.get(name)?.filter((binding) => visibleAt(catalog, binding, site)) ?? [];
    if (local.length > 1) return { kind: "duplicate", name, scopeId: site.scopeId, statementIndex: site.statementIndex, bindingIds: local.map((binding) => binding.id) } as BindingResolution;
    if (local[0]) return { kind: "resolved", binding: local[0] } as BindingResolution;
  }
  const self = site.initializerBindingId ? catalog.bindingsById.get(site.initializerBindingId) : undefined;
  const stack = activeByName.get(name) ?? [];
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const frame = stack[index];
    // The declaration being initialized is not registered yet; this check
    // only protects malformed caller input that registered it prematurely.
    const candidates = frame.names.get(name)!.filter((binding) => visibleAt(catalog, binding, site) && binding.id !== self?.id);
    if (!candidates.length) continue;
    if (candidates.length > 1) return { kind: "duplicate", name, scopeId: site.scopeId, statementIndex: site.statementIndex, bindingIds: candidates.map((binding) => binding.id) };
    return { kind: "resolved", binding: candidates[0] };
  }
  return null;
};

/** Canonicalizes shuffled requests by binding rank/occurrence index, then runs
 * forward and reverse source sweeps. No caller sorting or comparison sort is
 * permitted. */
export const resolveInitializerReferences = (catalog: BindingCatalog, requests: readonly InitializerResolutionRequest[]): readonly ResolvedInitializerReference[] => {
  const canonical = canonicalize(catalog, requests);
  const byStatement = new Map<number, CanonicalRequest[]>();
  for (const request of canonical) { const bucket = byStatement.get(request.site.statementIndex) ?? []; bucket.push(request); byStatement.set(request.site.statementIndex, bucket); }
  const staticByScope = new Map<ScopeId, Binding[]>();
  const typedByStatement = new Map<number, Binding[]>();
  for (const binding of catalog.bindings) {
    if (binding.kind === "typed") { const bucket = typedByStatement.get(binding.statementIndex) ?? []; bucket.push(binding); typedByStatement.set(binding.statementIndex, bucket); continue; }
    if (binding.visibility.kind === "elementLocal") continue;
    const rootScopeId = binding.visibility.kind === "subtree" ? binding.visibility.rootScopeId : catalog.scopeIndex.rootScopeId;
    const bucket = staticByScope.get(rootScopeId) ?? []; bucket.push(binding); staticByScope.set(rootScopeId, bucket);
  }
  const direct = new Map<string, BindingResolution>();
  const frames: ScopeFrame[] = [];
  const active = new Map<string, ScopeFrame[]>();
  for (let statementIndex = 0; statementIndex < catalog.scopeIndex.statementRankByIndex.size; statementIndex += 1) {
    const scopeId = catalog.scopeIndex.scopeOfStatement.get(statementIndex) ?? catalog.scopeIndex.rootScopeId;
    transition(catalog, frames, active, scopeId, (frame) => { for (const binding of staticByScope.get(frame.scopeId) ?? []) addBinding(frame, binding, active); });
    for (const request of byStatement.get(statementIndex) ?? []) {
      const resolved = resolutionFor(catalog, request, active);
      const self = request.site.initializerBindingId ? catalog.bindingsById.get(request.site.initializerBindingId) : undefined;
      const directResolution: BindingResolution = resolved ?? (self?.kind === "typed" && self.name === request.name
        ? { kind: "self", name: request.name, scopeId: request.site.scopeId, statementIndex: request.site.statementIndex, bindingId: self.id }
        : { kind: "undefined", name: request.name, scopeId: request.site.scopeId, statementIndex: request.site.statementIndex });
      direct.set(request.key, directResolution);
    }
    for (const binding of typedByStatement.get(statementIndex) ?? []) addBinding(frames[frames.length - 1], binding, active);
  }
  const future = new Map<string, readonly BindingId[]>();
  const reverseFrames: ScopeFrame[] = [];
  const reverseActive = new Map<string, ScopeFrame[]>();
  for (let statementIndex = catalog.scopeIndex.statementRankByIndex.size - 1; statementIndex >= 0; statementIndex -= 1) {
    const scopeId = catalog.scopeIndex.scopeOfStatement.get(statementIndex) ?? catalog.scopeIndex.rootScopeId;
    transition(catalog, reverseFrames, reverseActive, scopeId, () => {});
    for (const request of byStatement.get(statementIndex) ?? []) {
      if (direct.get(request.key)?.kind !== "undefined") continue;
      const stack = reverseActive.get(request.name) ?? [];
      const frame = stack[stack.length - 1];
      const candidates = frame?.names.get(request.name) ?? [];
      if (candidates.length) future.set(request.key, candidates.map((binding) => binding.id));
    }
    for (const binding of typedByStatement.get(statementIndex) ?? []) addBinding(reverseFrames[reverseFrames.length - 1], binding, reverseActive);
  }
  return canonical.map((request) => {
    const directResolution = direct.get(request.key)!;
    const ids = future.get(request.key);
    const resolution = directResolution.kind === "undefined" && ids?.length
      ? { kind: "forward" as const, name: request.name, scopeId: request.site.scopeId, statementIndex: request.site.statementIndex, bindingIds: ids }
      : directResolution;
    return { ...request, resolution };
  });
};

/** Transitional focused-test helper. It delegates to the canonical batch
 * resolver and contains no legacy scope walk; production callers use the
 * plural API above. */
export const resolveBindingReference = (catalog: BindingCatalog, name: string, site: BindingReferenceSite): BindingResolution => {
  const owner = site.initializerBindingId ?? catalog.bindings.find((binding) => binding.kind === "typed")?.id;
  if (!owner) return { kind: "undefined", name, scopeId: site.scopeId, statementIndex: site.statementIndex };
  const statementCount = catalog.scopeIndex.statementRankByIndex.size;
  const scheduledSite = site.statementIndex >= 0 && site.statementIndex < statementCount ? site : { ...site, statementIndex: Math.max(0, statementCount - 1) };
  const resolution = resolveInitializerReferences(catalog, [{ fromBindingId: owner, occurrenceIndex: 0, name, site: scheduledSite }])[0]?.resolution;
  if (!resolution) return { kind: "undefined", name, scopeId: site.scopeId, statementIndex: site.statementIndex };
  return resolution.kind === "resolved" ? resolution : { ...resolution, scopeId: site.scopeId, statementIndex: site.statementIndex };
};

export const visibleBindingsAt = (catalog: BindingCatalog, site: BindingReferenceSite): readonly Binding[] => {
  const resolved = new Map<string, Binding>();
  for (const binding of catalog.bindings) {
    if (resolved.has(binding.name)) continue;
    const result = resolveBindingReference(catalog, binding.name, site);
    if (result.kind === "resolved") resolved.set(binding.name, result.binding);
  }
  return [...resolved.values()];
};
