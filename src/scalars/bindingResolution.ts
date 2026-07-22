import type { Binding, BindingCatalog, BindingId } from "./bindingCatalog";
import type { ScopeId } from "./lexicalScopeIndex";

export type BindingReferenceSite = { scopeId: ScopeId; statementIndex: number; elementLocal?: { ownerId: string; order: number } };
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

type ScopeFrame = {
  scopeId: ScopeId;
  /** Static group-subtree / iteration lane for this exact scope. */
  staticNames: ReadonlyMap<string, readonly Binding[]>;
  /** Typed declarations activated in source order while sweeping. */
  typedNames: Map<string, Binding[]>;
  /** Names currently represented by this frame in activeByName. */
  activeNames: Set<string>;
};
/**
 * `owner` is the single source of truth for initializer self-detection: the
 * binding whose initializer this reference belongs to. It is always a real
 * catalog binding for `resolveInitializerReferences` (validated below) and
 * always `null` for `resolveAtSite`'s plain, non-initializer lookups - never
 * an optional site field carrying the same fact redundantly.
 */
type SweepRequest = { name: string; site: BindingReferenceSite; key: string; owner: Binding | null };
type CanonicalRequest = InitializerResolutionRequest & { rank: number; key: string; owner: Binding };

export type BindingLookupTraceForTests = {
  registeredBindingCount: number;
  requestCount: number;
  emittedCandidateCount: number;
  candidateVisitsByVisibilityKind: ReadonlyMap<Binding["visibility"]["kind"], number>;
};

type LookupObserver = {
  registeredBindingCount: number;
  requestCount: number;
  emittedCandidateCount: number;
  candidateVisitsByVisibilityKind: Map<Binding["visibility"]["kind"], number>;
};

const keyFor = (bindingId: BindingId, occurrenceIndex: number) => `${bindingId}\u0000${occurrenceIndex}`;
const isAncestor = (catalog: BindingCatalog, ancestorId: ScopeId, descendantId: ScopeId) => {
  const ancestor = catalog.scopeIndex.scopeMetadataById.get(ancestorId);
  const descendant = catalog.scopeIndex.scopeMetadataById.get(descendantId);
  return !!ancestor && !!descendant && ancestor.treeEnter <= descendant.treeEnter && descendant.treeEnter < ancestor.treeExit;
};
const localVisibleAt = (binding: Binding, site: BindingReferenceSite) => {
  if (binding.visibility.kind !== "elementLocal") return false;
  const local = site.elementLocal;
  return !!local && local.ownerId === binding.visibility.ownerId && local.order >= binding.visibility.startOrder && local.order <= binding.visibility.endOrder;
};

const createLookupObserver = (): LookupObserver => ({
  registeredBindingCount: 0,
  requestCount: 0,
  emittedCandidateCount: 0,
  candidateVisitsByVisibilityKind: new Map()
});

const recordEmittedCandidates = (observer: LookupObserver | undefined, candidates: readonly Binding[]) => {
  if (!observer) return;
  for (const binding of candidates) {
    observer.emittedCandidateCount += 1;
    const kind = binding.visibility.kind;
    observer.candidateVisitsByVisibilityKind.set(kind, (observer.candidateVisitsByVisibilityKind.get(kind) ?? 0) + 1);
  }
};

const snapshotLookupTrace = (observer: LookupObserver): BindingLookupTraceForTests => ({
  registeredBindingCount: observer.registeredBindingCount,
  requestCount: observer.requestCount,
  emittedCandidateCount: observer.emittedCandidateCount,
  candidateVisitsByVisibilityKind: new Map(observer.candidateVisitsByVisibilityKind)
});

/** Fail-fast validation shared by every caller that claims a binding "owns"
 * an initializer reference: the id must exist, be a typed binding, and its
 * own declaration statement must equal the reference's site - an
 * initializer reference is textually inside its owning declaration, so any
 * mismatch is a caller contract violation, not a legitimate input. */
const validatedOwner = (catalog: BindingCatalog, fromBindingId: BindingId, statementIndex: number): Binding => {
  const binding = catalog.bindingsById.get(fromBindingId);
  if (!binding || binding.kind !== "typed") throw new Error(`bindingResolution: unknown typed binding ${fromBindingId}`);
  if (binding.statementIndex !== statementIndex) {
    throw new Error(
      `bindingResolution: initializer reference site statementIndex ${statementIndex} does not match fromBindingId ${fromBindingId} declaration statement ${binding.statementIndex}`
    );
  }
  return binding;
};

const canonicalize = (catalog: BindingCatalog, requests: readonly InitializerResolutionRequest[]): readonly CanonicalRequest[] => {
  const slotsByBindingId = new Map<BindingId, (InitializerResolutionRequest | undefined)[]>();
  for (const request of requests) {
    validatedOwner(catalog, request.fromBindingId, request.site.statementIndex);
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
      canonical.push({ ...request, rank: binding.rank, key: keyFor(binding.id, occurrenceIndex), owner: binding });
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
    for (const name of frame.activeNames) activeByName.get(name)?.pop();
  }
  const entering: ScopeId[] = [];
  let current: ScopeId | null = targetScopeId;
  while (current && (!frames.length || current !== frames[frames.length - 1].scopeId)) {
    entering.push(current); current = catalog.scopeIndex.scopeMetadataById.get(current)?.parentId ?? null;
  }
  for (let index = entering.length - 1; index >= 0; index -= 1) {
    const scopeId = entering[index];
    const frame: ScopeFrame = {
      scopeId,
      staticNames: catalog.lookupNamespaces.scopedStaticByScopeAndName.get(scopeId) ?? new Map(),
      typedNames: new Map(),
      activeNames: new Set()
    };
    frames.push(frame); onEnter(frame);
  }
};

const activateName = (frame: ScopeFrame, name: string, activeByName: Map<string, ScopeFrame[]>) => {
  if (frame.activeNames.has(name)) return;
  frame.activeNames.add(name);
  const stack = activeByName.get(name) ?? [];
  stack.push(frame); activeByName.set(name, stack);
};

const addTypedBinding = (frame: ScopeFrame, binding: Binding, activeByName: Map<string, ScopeFrame[]>) => {
  const bucket = frame.typedNames.get(binding.name) ?? [];
  bucket.push(binding);
  frame.typedNames.set(binding.name, bucket);
  activateName(frame, binding.name, activeByName);
};

const activateStaticNames = (catalog: BindingCatalog, frame: ScopeFrame, activeByName: Map<string, ScopeFrame[]>, includeLegacyRootLanes: boolean) => {
  for (const name of frame.staticNames.keys()) activateName(frame, name, activeByName);
  if (!includeLegacyRootLanes || frame.scopeId !== catalog.scopeIndex.rootScopeId) return;
  for (const name of catalog.lookupNamespaces.globalByName.keys()) activateName(frame, name, activeByName);
  for (const name of catalog.lookupNamespaces.outsideGroupsByName.keys()) activateName(frame, name, activeByName);
};

const mergeCatalogOrderedLanes = (lanes: readonly (readonly Binding[] | undefined)[]): readonly Binding[] => {
  let candidateCount = 0;
  let singleton: Binding | undefined;
  for (const lane of lanes) {
    if (!lane?.length) continue;
    candidateCount += lane.length;
    singleton = lane[0];
  }
  if (candidateCount === 0) return [];
  if (candidateCount === 1) return [singleton!];

  const positions = lanes.map(() => 0);
  const merged: Binding[] = [];
  while (merged.length < candidateCount) {
    let nextLane = -1;
    let nextRank = Number.POSITIVE_INFINITY;
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
      const candidate = lanes[laneIndex]?.[positions[laneIndex]];
      if (!candidate || candidate.rank >= nextRank) continue;
      nextLane = laneIndex;
      nextRank = candidate.rank;
    }
    if (nextLane < 0) throw new Error("bindingResolution: lookup lane merge lost a candidate");
    merged.push(lanes[nextLane]![positions[nextLane]++]);
  }
  return merged;
};

const candidateLanesForFrame = (catalog: BindingCatalog, frame: ScopeFrame, name: string, site: BindingReferenceSite) => {
  const lanes: (readonly Binding[] | undefined)[] = [frame.staticNames.get(name), frame.typedNames.get(name)];
  if (frame.scopeId !== catalog.scopeIndex.rootScopeId) return lanes;
  lanes.push(catalog.lookupNamespaces.globalByName.get(name));
  if (catalog.scopeIndex.scopeMetadataById.get(site.scopeId)?.effectiveGroupScopeId === null) {
    lanes.push(catalog.lookupNamespaces.outsideGroupsByName.get(name));
  }
  return lanes;
};

const resolutionFor = (catalog: BindingCatalog, request: SweepRequest, activeByName: Map<string, ScopeFrame[]>, observer?: LookupObserver): BindingResolution | null => {
  const { name, site } = request;
  if (site.elementLocal) {
    const local = catalog.elementLocalBindingsByOwnerAndName.get(site.elementLocal.ownerId)?.get(name)?.filter((binding) => localVisibleAt(binding, site)) ?? [];
    if (local.length > 1) {
      recordEmittedCandidates(observer, local);
      return { kind: "duplicate", name, scopeId: site.scopeId, statementIndex: site.statementIndex, bindingIds: local.map((binding) => binding.id) } as BindingResolution;
    }
    if (local[0]) {
      recordEmittedCandidates(observer, local);
      return { kind: "resolved", binding: local[0] } as BindingResolution;
    }
  }
  const stack = activeByName.get(name) ?? [];
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const frame = stack[index];
    const candidates = mergeCatalogOrderedLanes(candidateLanesForFrame(catalog, frame, name, site));
    if (!candidates.length) continue;
    recordEmittedCandidates(observer, candidates);
    if (candidates.length > 1) return { kind: "duplicate", name, scopeId: site.scopeId, statementIndex: site.statementIndex, bindingIds: candidates.map((binding) => binding.id) };
    return { kind: "resolved", binding: candidates[0] };
  }
  return null;
};

/** Shared forward+reverse source sweep. `owner` on each request is the sole
 * signal for self-detection (never derived from any site field); requests
 * with `owner: null` can never resolve to "self". No caller sorting or
 * comparison sort is permitted anywhere in this pass. */
const runSweep = (catalog: BindingCatalog, requests: readonly SweepRequest[], observer?: LookupObserver): ReadonlyMap<string, BindingResolution> => {
  const byStatement = new Map<number, SweepRequest[]>();
  for (const request of requests) { const bucket = byStatement.get(request.site.statementIndex) ?? []; bucket.push(request); byStatement.set(request.site.statementIndex, bucket); }
  const typedByStatement = new Map<number, Binding[]>();
  for (const binding of catalog.bindings) {
    if (observer) observer.registeredBindingCount += 1;
    if (binding.kind !== "typed") continue;
    const bucket = typedByStatement.get(binding.statementIndex) ?? [];
    bucket.push(binding);
    typedByStatement.set(binding.statementIndex, bucket);
  }
  if (observer) observer.requestCount += requests.length;
  const statementCount = catalog.scopeIndex.statementRankByIndex.size;
  const direct = new Map<string, BindingResolution>();
  const frames: ScopeFrame[] = [];
  const active = new Map<string, ScopeFrame[]>();
  for (let statementIndex = 0; statementIndex < statementCount; statementIndex += 1) {
    const scopeId = catalog.scopeIndex.scopeOfStatement.get(statementIndex) ?? catalog.scopeIndex.rootScopeId;
    transition(catalog, frames, active, scopeId, (frame) => activateStaticNames(catalog, frame, active, true));
    for (const request of byStatement.get(statementIndex) ?? []) {
      const resolved = resolutionFor(catalog, request, active, observer);
      const directResolution: BindingResolution = resolved ?? (request.owner && request.owner.name === request.name
        ? { kind: "self", name: request.name, scopeId: request.site.scopeId, statementIndex: request.site.statementIndex, bindingId: request.owner.id }
        : { kind: "undefined", name: request.name, scopeId: request.site.scopeId, statementIndex: request.site.statementIndex });
      direct.set(request.key, directResolution);
    }
    for (const binding of typedByStatement.get(statementIndex) ?? []) addTypedBinding(frames[frames.length - 1], binding, active);
  }
  const future = new Map<string, readonly Binding[]>();
  const reverseFrames: ScopeFrame[] = [];
  const reverseActive = new Map<string, ScopeFrame[]>();
  for (let statementIndex = statementCount - 1; statementIndex >= 0; statementIndex -= 1) {
    const scopeId = catalog.scopeIndex.scopeOfStatement.get(statementIndex) ?? catalog.scopeIndex.rootScopeId;
    transition(catalog, reverseFrames, reverseActive, scopeId, () => {});
    for (const request of byStatement.get(statementIndex) ?? []) {
      if (direct.get(request.key)?.kind !== "undefined") continue;
      const stack = reverseActive.get(request.name) ?? [];
      const frame = stack[stack.length - 1];
      const candidates = frame?.typedNames.get(request.name) ?? [];
      // The reverse pass visits statements from last to first, so a scope's
      // same-name bucket accumulates in descending statementIndex (=
      // descending catalog rank) order. Reverse once here - a plain
      // O(candidates.length) reversal, not a comparison sort - to report
      // catalog rank order.
      if (candidates.length) future.set(request.key, [...candidates].reverse());
    }
    for (const binding of typedByStatement.get(statementIndex) ?? []) addTypedBinding(reverseFrames[reverseFrames.length - 1], binding, reverseActive);
  }
  const resolutions = new Map<string, BindingResolution>();
  for (const request of requests) {
    const directResolution = direct.get(request.key)!;
    const candidates = future.get(request.key);
    if (directResolution.kind === "undefined" && candidates?.length) {
      recordEmittedCandidates(observer, candidates);
      resolutions.set(request.key, { kind: "forward", name: request.name, scopeId: request.site.scopeId, statementIndex: request.site.statementIndex, bindingIds: candidates.map((binding) => binding.id) });
    } else {
      resolutions.set(request.key, directResolution);
    }
  }
  return resolutions;
};

/**
 * The only production-facing resolver. Every request is a real initializer
 * reference: `fromBindingId` must name a typed binding whose own
 * declaration statement is `site.statementIndex` (validated, fail-fast).
 * Canonicalizes shuffled requests by binding rank/occurrence index before
 * sweeping, so output order never depends on input order.
 */
export const resolveInitializerReferences = (catalog: BindingCatalog, requests: readonly InitializerResolutionRequest[]): readonly ResolvedInitializerReference[] => {
  const canonical = canonicalize(catalog, requests);
  const resolutions = runSweep(catalog, canonical);
  return canonical.map((request) => ({ ...request, resolution: resolutions.get(request.key)! }));
};

/** Test-only batch trace. This deliberately shares canonicalization and the
 * production sweep rather than recreating a single-site compatibility path. */
export const resolveInitializerReferencesWithTraceForTests = (
  catalog: BindingCatalog,
  requests: readonly InitializerResolutionRequest[]
): { references: readonly ResolvedInitializerReference[]; trace: BindingLookupTraceForTests } => {
  const canonical = canonicalize(catalog, requests);
  const observer = createLookupObserver();
  const resolutions = runSweep(catalog, canonical, observer);
  return {
    references: canonical.map((request) => ({ ...request, resolution: resolutions.get(request.key)! })),
    trace: snapshotLookupTrace(observer)
  };
};

/** Internal, non-exported: a plain reference lookup with no initializer
 * owner and therefore no self semantics. This backs `visibleBindingsAt`
 * (Task 39's bulk-visibility query, which has no initializer concept and
 * may legitimately ask about a site with no corresponding declaration at
 * all) and is intentionally not part of the production-facing API surface -
 * see `resolveBindingReferenceForTests` below for the test-only escape
 * hatch that reuses this same sweep. */
const resolveAtSite = (catalog: BindingCatalog, name: string, site: BindingReferenceSite): BindingResolution => {
  const statementCount = catalog.scopeIndex.statementRankByIndex.size;
  const scheduledSite = site.statementIndex >= 0 && site.statementIndex < statementCount ? site : { ...site, statementIndex: Math.max(0, statementCount - 1) };
  const key = "single";
  const resolution = runSweep(catalog, [{ name, site: scheduledSite, key, owner: null }]).get(key);
  if (!resolution) return { kind: "undefined", name, scopeId: site.scopeId, statementIndex: site.statementIndex };
  return resolution.kind === "resolved" ? resolution : { ...resolution, scopeId: site.scopeId, statementIndex: site.statementIndex };
};

/**
 * Test-only. Production code must use `resolveInitializerReferences`
 * (initializer-owner-bound) or `visibleBindingsAt` (bulk visibility);
 * neither exposes exact `duplicate`/`forward`/`undefined` resolution detail
 * for a single arbitrary name/site pair, which is what most focused tests
 * need to assert. `fromBindingId`, when given, is validated exactly like
 * the batch API (fail-fast on an unknown/non-typed/statement-mismatched
 * owner) and only then can the result be `self`; omitted, the lookup can
 * never produce `self`. This export is locked out of non-test source by
 * bindingResolutionPublicSurface.test.ts.
 */
export const resolveBindingReferenceForTests = (catalog: BindingCatalog, name: string, site: BindingReferenceSite, fromBindingId?: BindingId): BindingResolution => {
  if (fromBindingId === undefined) return resolveAtSite(catalog, name, site);
  const owner = validatedOwner(catalog, fromBindingId, site.statementIndex);
  const key = "single";
  const resolution = runSweep(catalog, [{ name, site, key, owner }]).get(key)!;
  return resolution.kind === "resolved" ? resolution : { ...resolution, scopeId: site.scopeId, statementIndex: site.statementIndex };
};

export const visibleBindingsAt = (catalog: BindingCatalog, site: BindingReferenceSite): readonly Binding[] => {
  const resolved = new Map<string, Binding>();
  for (const binding of catalog.bindings) {
    if (resolved.has(binding.name)) continue;
    const result = resolveAtSite(catalog, binding.name, site);
    if (result.kind === "resolved") resolved.set(binding.name, result.binding);
  }
  return [...resolved.values()];
};
