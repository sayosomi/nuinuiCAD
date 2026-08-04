import type { Binding, BindingCatalog, BindingId } from "./bindingCatalog";
import type { ScopeId } from "./lexicalScopeIndex";
import {
  activateFrameNames,
  addTypedBinding,
  addTypedBindingToFrame,
  transitionScopeFrames,
  type ScopeFrame
} from "./bindingResolutionSweepState";
import {
  emptyElementLocalRangeIndex,
  resolveElementLocalRangeQueries,
  type ElementLocalBinding,
  type ElementLocalRangeIndex,
  type ElementLocalRangeQuery
} from "./elementLocalRangeIndex";

export type BindingReferenceSite = {
  scopeId: ScopeId;
  statementIndex: number;
  /** When set, the site's owning element's local numeric variables (a
   * neutral namespace resolved via elementLocalRangeIndex.ts, never part of
   * BindingCatalog itself) take priority over document/iteration lexical
   * resolution (decisions.md D05). */
  elementLocal?: { ownerId: string; order: number };
};
export type BindingResolution =
  | { kind: "resolved"; binding: Binding }
  /** An element-local numeric variable match - deliberately not a `Binding`,
   * since element-local variables never enter BindingCatalog's own lanes. */
  | { kind: "resolvedLocal"; name: string; local: ElementLocalBinding }
  | { kind: "undefined"; name: string; scopeId: ScopeId; statementIndex: number }
  | { kind: "forward"; name: string; scopeId: ScopeId; statementIndex: number; bindingIds: readonly BindingId[] }
  | { kind: "self"; name: string; scopeId: ScopeId; statementIndex: number; bindingId: BindingId }
  | { kind: "duplicate"; name: string; scopeId: ScopeId; statementIndex: number; bindingIds: readonly string[] };

export type InitializerResolutionRequest = {
  fromBindingId: BindingId;
  occurrenceIndex: number;
  name: string;
  site: BindingReferenceSite;
};
export type ResolvedInitializerReference = InitializerResolutionRequest & { resolution: BindingResolution };

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
  siteTraversalCount: number;
  candidateInspectionCount: number;
  emittedCandidateCount: number;
  /** Keyed by `Binding["visibility"]["kind"]` or the literal `"elementLocal"`
   * for an element-local candidate visit (element-local candidates are never
   * `Binding`s, so they cannot share the `visibility.kind` type itself). */
  candidateVisitsByVisibilityKind: ReadonlyMap<string, number>;
};

type LookupObserver = {
  registeredBindingCount: number;
  requestCount: number;
  siteTraversalCount: number;
  candidateInspectionCount: number;
  emittedCandidateCount: number;
  candidateVisitsByVisibilityKind: Map<string, number>;
};

const keyFor = (bindingId: BindingId, occurrenceIndex: number) => `${bindingId}\u0000${occurrenceIndex}`;
const createLookupObserver = (): LookupObserver => ({
  registeredBindingCount: 0,
  requestCount: 0,
  siteTraversalCount: 0,
  candidateInspectionCount: 0,
  emittedCandidateCount: 0,
  candidateVisitsByVisibilityKind: new Map()
});

const recordCandidateInspection = (observer: LookupObserver | undefined, binding: Binding) => {
  if (!observer) return;
  observer.candidateInspectionCount += 1;
  const kind = binding.visibility.kind;
  observer.candidateVisitsByVisibilityKind.set(kind, (observer.candidateVisitsByVisibilityKind.get(kind) ?? 0) + 1);
};

const recordLocalCandidateInspection = (observer: LookupObserver | undefined) => {
  if (!observer) return;
  observer.candidateInspectionCount += 1;
  observer.candidateVisitsByVisibilityKind.set("elementLocal", (observer.candidateVisitsByVisibilityKind.get("elementLocal") ?? 0) + 1);
};

const recordEmittedCandidateCount = (observer: LookupObserver | undefined, count: number) => {
  if (observer) observer.emittedCandidateCount += count;
};

const snapshotLookupTrace = (observer: LookupObserver): BindingLookupTraceForTests => ({
  registeredBindingCount: observer.registeredBindingCount,
  requestCount: observer.requestCount,
  siteTraversalCount: observer.siteTraversalCount,
  candidateInspectionCount: observer.candidateInspectionCount,
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

const mergeCatalogOrderedLanes = (
  lanes: readonly (readonly Binding[] | undefined)[],
  observer?: LookupObserver
): readonly Binding[] => {
  let candidateCount = 0;
  let singleton: Binding | undefined;
  for (const lane of lanes) {
    if (!lane?.length) continue;
    candidateCount += lane.length;
    singleton = lane[0];
  }
  if (candidateCount === 0) return [];
  if (candidateCount === 1) {
    recordCandidateInspection(observer, singleton!);
    return [singleton!];
  }

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
    const binding = lanes[nextLane]![positions[nextLane]++];
    recordCandidateInspection(observer, binding);
    merged.push(binding);
  }
  return merged;
};

const candidateLaneGroupsForFrame = (
  catalog: BindingCatalog,
  frame: ScopeFrame,
  name: string
): readonly (readonly (readonly Binding[] | undefined)[])[] => {
  const lexical: (readonly Binding[] | undefined)[] = [frame.iterationNames.get(name), frame.typedNames.get(name)];
  return [lexical];
};

const resolutionFor = (
  catalog: BindingCatalog,
  request: SweepRequest,
  activeByName: Map<string, ScopeFrame[]>,
  localCandidatesByRequestKey: ReadonlyMap<string, readonly ElementLocalBinding[]>,
  observer?: LookupObserver
): BindingResolution | null => {
  const { name, site } = request;
  if (site.elementLocal) {
    const local = localCandidatesByRequestKey.get(request.key) ?? [];
    if (local.length > 1) {
      recordEmittedCandidateCount(observer, local.length);
      return { kind: "duplicate", name, scopeId: site.scopeId, statementIndex: site.statementIndex, bindingIds: local.map((binding) => binding.id) };
    }
    if (local[0]) {
      recordEmittedCandidateCount(observer, 1);
      return { kind: "resolvedLocal", name, local: local[0] };
    }
  }
  const stack = activeByName.get(name) ?? [];
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const frame = stack[index];
    for (const lanes of candidateLaneGroupsForFrame(catalog, frame, name)) {
      const candidates = mergeCatalogOrderedLanes(lanes, observer);
      if (!candidates.length) continue;
      recordEmittedCandidateCount(observer, candidates.length);
      if (candidates.length > 1) return { kind: "duplicate", name, scopeId: site.scopeId, statementIndex: site.statementIndex, bindingIds: candidates.map((binding) => binding.id) };
      return { kind: "resolved", binding: candidates[0] };
    }
  }
  return null;
};

/** Shared forward+reverse source sweep. `owner` on each request is the sole
 * signal for self-detection (never derived from any site field); requests
 * with `owner: null` can never resolve to "self". No caller sorting or
 * comparison sort is permitted anywhere in this pass. */
const runSweep = (
  catalog: BindingCatalog,
  requests: readonly SweepRequest[],
  elementLocalRangeIndex: ElementLocalRangeIndex,
  observer?: LookupObserver
): ReadonlyMap<string, BindingResolution> => {
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
  const localQueries: ElementLocalRangeQuery[] = requests
    .filter((request) => request.site.elementLocal)
    .map((request) => ({
      key: request.key,
      ownerId: request.site.elementLocal!.ownerId,
      name: request.name,
      order: request.site.elementLocal!.order
    }));
  const localCandidatesByRequestKey = localQueries.length
    ? resolveElementLocalRangeQueries(elementLocalRangeIndex, localQueries, () => recordLocalCandidateInspection(observer))
    : new Map<string, readonly ElementLocalBinding[]>();
  const statementCount = catalog.scopeIndex.statementRankByIndex.size;
  const direct = new Map<string, BindingResolution>();
  const frames: ScopeFrame[] = [];
  const active = new Map<string, ScopeFrame[]>();
  for (let statementIndex = 0; statementIndex < statementCount; statementIndex += 1) {
    const scopeId = catalog.scopeIndex.scopeOfStatement.get(statementIndex) ?? catalog.scopeIndex.rootScopeId;
    transitionScopeFrames(catalog, frames, active, scopeId, (frame) => activateFrameNames(frame, active));
    for (const request of byStatement.get(statementIndex) ?? []) {
      const resolved = resolutionFor(catalog, request, active, localCandidatesByRequestKey, observer);
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
    transitionScopeFrames(catalog, reverseFrames, reverseActive, scopeId, () => {});
    for (const request of byStatement.get(statementIndex) ?? []) {
      if (direct.get(request.key)?.kind !== "undefined") continue;
      const frame = reverseFrames[reverseFrames.length - 1];
      const candidates = frame?.typedNames.get(request.name) ?? [];
      // The reverse pass visits statements from last to first. Reading only
      // this current frame is the exact-scope rule: ancestor and sibling
      // frames can never contribute forward candidates. This scope's
      // same-name bucket accumulates in descending statementIndex (=
      // descending catalog rank) order. Reverse once here - a plain
      // O(candidates.length) reversal, not a comparison sort - to report
      // catalog rank order.
      if (candidates.length) future.set(request.key, [...candidates].reverse());
    }
    for (const binding of typedByStatement.get(statementIndex) ?? []) {
      addTypedBindingToFrame(reverseFrames[reverseFrames.length - 1], binding);
    }
  }
  const resolutions = new Map<string, BindingResolution>();
  for (const request of requests) {
    const directResolution = direct.get(request.key)!;
    const candidates = future.get(request.key);
    if (directResolution.kind === "undefined" && candidates?.length) {
      for (const binding of candidates) recordCandidateInspection(observer, binding);
      recordEmittedCandidateCount(observer, candidates.length);
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
export const resolveInitializerReferences = (
  catalog: BindingCatalog,
  requests: readonly InitializerResolutionRequest[],
  elementLocalRangeIndex: ElementLocalRangeIndex = emptyElementLocalRangeIndex
): readonly ResolvedInitializerReference[] => {
  const canonical = canonicalize(catalog, requests);
  const resolutions = runSweep(catalog, canonical, elementLocalRangeIndex);
  return canonical.map((request) => ({ ...request, resolution: resolutions.get(request.key)! }));
};

/** Test-only batch trace. This deliberately shares canonicalization and the
 * production sweep rather than recreating a single-site compatibility path. */
export const resolveInitializerReferencesWithTraceForTests = (
  catalog: BindingCatalog,
  requests: readonly InitializerResolutionRequest[],
  elementLocalRangeIndex: ElementLocalRangeIndex = emptyElementLocalRangeIndex
): { references: readonly ResolvedInitializerReference[]; trace: BindingLookupTraceForTests } => {
  const canonical = canonicalize(catalog, requests);
  const observer = createLookupObserver();
  const resolutions = runSweep(catalog, canonical, elementLocalRangeIndex, observer);
  return {
    references: canonical.map((request) => ({ ...request, resolution: resolutions.get(request.key)! })),
    trace: snapshotLookupTrace(observer)
  };
};

export type SiteReferenceRequest = { key: string; name: string; site: BindingReferenceSite };

/**
 * Batch resolver for non-initializer, single-name reference sites (e.g. a
 * Task 22 property value that is exactly one `@name`). Every request has no
 * "owner" binding (unlike `resolveInitializerReferences`), so `self`
 * resolution never occurs; otherwise this shares the exact same forward+
 * reverse `runSweep` pass `resolveInitializerReferences` uses, so
 * declaration-line-onward visibility, shadowing, and forward-reference
 * detection all match `@name` resolution everywhere else in the language.
 * One shared sweep over the whole batch of requests, not one
 * `visibleBindingsAt` call per request - see `runSweep`'s own O(n) batching.
 * `elementLocalRangeIndex` is optional and only consulted for requests whose
 * `site.elementLocal` is set - callers that never set it (most of them) pay
 * no cost and never need to pass it.
 */
export const resolveReferencesAtSites = (
  catalog: BindingCatalog,
  requests: readonly SiteReferenceRequest[],
  elementLocalRangeIndex: ElementLocalRangeIndex = emptyElementLocalRangeIndex
): ReadonlyMap<string, BindingResolution> =>
  runSweep(catalog, requests.map((request) => ({ name: request.name, site: request.site, key: request.key, owner: null })), elementLocalRangeIndex);

/** Internal, non-exported single-name oracle for focused tests only. The
 * production bulk queries below never call this compatibility path. */
const resolveAtSite = (
  catalog: BindingCatalog,
  name: string,
  site: BindingReferenceSite,
  elementLocalRangeIndex: ElementLocalRangeIndex
): BindingResolution => {
  const statementCount = catalog.scopeIndex.statementRankByIndex.size;
  const scheduledSite = site.statementIndex >= 0 && site.statementIndex < statementCount ? site : { ...site, statementIndex: Math.max(0, statementCount - 1) };
  const key = "single";
  const resolution = runSweep(catalog, [{ name, site: scheduledSite, key, owner: null }], elementLocalRangeIndex).get(key);
  if (!resolution) return { kind: "undefined", name, scopeId: site.scopeId, statementIndex: site.statementIndex };
  return resolution.kind === "resolved" || resolution.kind === "resolvedLocal" ? resolution : { ...resolution, scopeId: site.scopeId, statementIndex: site.statementIndex };
};

/**
 * Test-only. Production code must use `resolveInitializerReferences`
 * (initializer-owner-bound), `visibleBindingsAt` (bulk visibility), or
 * `resolveReferencesAtSites` (batch, owner-less, non-initializer sites);
 * none of the three exposes exact `duplicate`/`forward`/`undefined`
 * resolution detail for a single arbitrary name/site pair, which is what
 * most focused tests need to assert. `fromBindingId`, when given, is validated exactly like
 * the batch API (fail-fast on an unknown/non-typed/statement-mismatched
 * owner) and only then can the result be `self`; omitted, the lookup can
 * never produce `self`. This export is locked out of non-test source by
 * bindingResolutionPublicSurface.test.ts.
 */
export const resolveBindingReferenceForTests = (
  catalog: BindingCatalog,
  name: string,
  site: BindingReferenceSite,
  fromBindingId?: BindingId,
  elementLocalRangeIndex: ElementLocalRangeIndex = emptyElementLocalRangeIndex
): BindingResolution => {
  if (fromBindingId === undefined) return resolveAtSite(catalog, name, site, elementLocalRangeIndex);
  const owner = validatedOwner(catalog, fromBindingId, site.statementIndex);
  const key = "single";
  const resolution = runSweep(catalog, [{ name, site, key, owner }], elementLocalRangeIndex).get(key)!;
  return resolution.kind === "resolved" || resolution.kind === "resolvedLocal" ? resolution : { ...resolution, scopeId: site.scopeId, statementIndex: site.statementIndex };
};

const visibleBindingsAtInternal = (
  catalog: BindingCatalog,
  site: BindingReferenceSite,
  observer?: LookupObserver
): readonly Binding[] => {
  if (observer) {
    observer.registeredBindingCount += catalog.bindings.length;
    observer.requestCount += 1;
    observer.siteTraversalCount += 1;
  }
  const statementCount = catalog.scopeIndex.statementRankByIndex.size;
  if (statementCount === 0) return [];
  const scheduledStatementIndex = site.statementIndex >= 0 && site.statementIndex < statementCount
    ? site.statementIndex
    : Math.max(0, statementCount - 1);

  const typedByStatement = new Map<number, Binding[]>();
  for (const binding of catalog.bindings) {
    if (binding.kind !== "typed") continue;
    const bucket = typedByStatement.get(binding.statementIndex) ?? [];
    bucket.push(binding);
    typedByStatement.set(binding.statementIndex, bucket);
  }

  const frames: ScopeFrame[] = [];
  const activeByName = new Map<string, ScopeFrame[]>();
  for (let statementIndex = 0; statementIndex <= scheduledStatementIndex; statementIndex += 1) {
    const scopeId = catalog.scopeIndex.scopeOfStatement.get(statementIndex) ?? catalog.scopeIndex.rootScopeId;
    transitionScopeFrames(catalog, frames, activeByName, scopeId, (frame) => activateFrameNames(frame, activeByName));
    if (statementIndex === scheduledStatementIndex) break;
    for (const binding of typedByStatement.get(statementIndex) ?? []) addTypedBinding(frames[frames.length - 1], binding, activeByName);
  }

  const shadowedNames = new Set<string>();
  const selectedBindingIds = new Set<BindingId>();
  for (let frameIndex = frames.length - 1; frameIndex >= 0; frameIndex -= 1) {
    const frame = frames[frameIndex];
    const namesAtLevel = new Set<string>();
    for (const name of frame.iterationNames.keys()) namesAtLevel.add(name);
    for (const name of frame.typedNames.keys()) namesAtLevel.add(name);
    for (const name of namesAtLevel) {
      if (shadowedNames.has(name)) continue;
      for (const lanes of candidateLaneGroupsForFrame(catalog, frame, name)) {
        const candidates = mergeCatalogOrderedLanes(lanes, observer);
        if (candidates.length === 0) continue;
        shadowedNames.add(name);
        if (candidates.length === 1) {
          selectedBindingIds.add(candidates[0].id);
          recordEmittedCandidateCount(observer, 1);
        }
        break;
      }
    }
  }

  const visible: Binding[] = [];
  for (const binding of catalog.bindings) if (selectedBindingIds.has(binding.id)) visible.push(binding);
  return visible;
};

/**
 * True bulk query: one source/site traversal regardless of visible name
 * count. Deliberately never consults element-local variables (`vars: [...]`):
 * no production caller of this function (candidate/completion listing) ever
 * sets `site.elementLocal`, and element-local resolution lives outside
 * BindingCatalog entirely - see `resolveReferencesAtSites`'s
 * `elementLocalRangeIndex` parameter for the resolution path that does.
 */
export const visibleBindingsAt = (catalog: BindingCatalog, site: BindingReferenceSite): readonly Binding[] =>
  visibleBindingsAtInternal(catalog, site);

/** Test-only observer for the production bulk implementation. */
export const visibleBindingsAtWithTraceForTests = (
  catalog: BindingCatalog,
  site: BindingReferenceSite
): { bindings: readonly Binding[]; trace: BindingLookupTraceForTests } => {
  const observer = createLookupObserver();
  const bindings = visibleBindingsAtInternal(catalog, site, observer);
  return { bindings, trace: snapshotLookupTrace(observer) };
};
