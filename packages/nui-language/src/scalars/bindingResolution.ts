import type { Binding, BindingCatalog, BindingId } from "./bindingCatalog";
import { parseDslReferenceToken } from "../dsl/dslReferenceTokens";
import { scopeChain, type ScopeId } from "./lexicalScopeIndex";

export type BindingReferenceSite = {
  scopeId: ScopeId;
  statementIndex: number;
};
export type BindingResolution =
  | { kind: "resolved"; binding: Binding }
  | { kind: "undefined"; name: string; scopeId: ScopeId; statementIndex: number }
  | { kind: "forward"; name: string; scopeId: ScopeId; statementIndex: number; bindingIds: readonly BindingId[] }
  | { kind: "self"; name: string; scopeId: ScopeId; statementIndex: number; bindingId: BindingId }
  | { kind: "duplicate"; name: string; scopeId: ScopeId; statementIndex: number; bindingIds: readonly string[] }
  /** A source declaration won the unified namespace, but it is not usable as
   * a scalar binding. Downstream scalar consumers fail closed; they must not
   * continue to an outer scalar || to the materialized geometry namespace. */
  | {
      kind: "namespace";
      name: string;
      scopeId: ScopeId;
      statementIndex: number;
      reason: "forward" | "ambiguous" | "incompatible" | "invalidTraversal" | "private";
      declarationKind?: string;
      statementId?: string;
    };

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
 * catalog binding for `resolveInitializerReferences` (validated below) &&
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
  /** Keyed by `Binding["visibility"]["kind"]`. */
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
 * an initializer reference: the id must exist, be a typed binding, && its
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
    if (request.occurrenceIndex >= requests.length || slots[request.occurrenceIndex]) throw new Error(`bindingResolution: duplicate || sparse occurrenceIndex for ${request.fromBindingId}`);
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

const resolutionFor = (
  catalog: BindingCatalog,
  request: SweepRequest,
  observer?: LookupObserver
): BindingResolution | null => {
  const { name, site } = request;
  if (request.owner && request.owner.resolutionMode !== "preResolvedOnly" && request.owner.name === name && request.owner.statementIndex === site.statementIndex) {
    return {
      kind: "self",
      name,
      scopeId: site.scopeId,
      statementIndex: site.statementIndex,
      bindingId: request.owner.id
    };
  }

  const sourceLookup = catalog.sourceNamespaceBindingResolver?.(name, site.statementIndex, site.scopeId);
  if (sourceLookup?.kind === "resolved") {
    const binding = catalog.bindingsById.get(sourceLookup.bindingId);
    const path = parseDslReferenceToken(name);
    const finalName = path.segments.at(-1);
    if (binding && (binding.name === name || binding.name === finalName)) return { kind: "resolved", binding };
  } else if (sourceLookup?.kind === "blocked") {
    return {
      kind: "namespace",
      name,
      scopeId: site.scopeId,
      statementIndex: site.statementIndex,
      reason: sourceLookup.reason,
      ...(sourceLookup.declarationKind ? { declarationKind: sourceLookup.declarationKind } : {}),
      ...(sourceLookup.statementId ? { statementId: sourceLookup.statementId } : {})
    };
  }

  for (const scopeId of scopeChain(catalog.scopeIndex, site.scopeId)) {
    if (observer) observer.siteTraversalCount += 1;
    const candidates = catalog.bindings.filter((binding) =>
      binding.effectiveScopeId === scopeId &&
      binding.name === name &&
      binding.resolutionMode !== "preResolvedOnly"
    );
    if (candidates.length === 0) continue;
    for (const binding of candidates) recordCandidateInspection(observer, binding);
    recordEmittedCandidateCount(observer, candidates.length);
    if (candidates.length > 1) return { kind: "duplicate", name, scopeId: site.scopeId, statementIndex: site.statementIndex, bindingIds: candidates.map((binding) => binding.id) };
    return { kind: "resolved", binding: candidates[0] };
  }
  return null;
};

/** Shared declarative binding lookup. `owner` on each request is the sole
 * signal for self-detection; requests with `owner: null` can never resolve to
 * `self`. Lexical scope ownership, not source position, selects a binding. */
const runSweep = (
  catalog: BindingCatalog,
  requests: readonly SweepRequest[],
  observer?: LookupObserver
): ReadonlyMap<string, BindingResolution> => {
  if (observer) observer.registeredBindingCount += catalog.bindings.length;
  if (observer) observer.requestCount += requests.length;
  const resolutions = new Map<string, BindingResolution>();
  for (const request of requests) {
    const resolved = resolutionFor(catalog, request, observer);
    resolutions.set(request.key, resolved ?? { kind: "undefined", name: request.name, scopeId: request.site.scopeId, statementIndex: request.site.statementIndex });
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
  requests: readonly InitializerResolutionRequest[]
): readonly ResolvedInitializerReference[] => {
  const canonical = canonicalize(catalog, requests);
  const resolutions = runSweep(catalog, canonical);
  return canonical.map((request) => ({ ...request, resolution: resolutions.get(request.key)! }));
};

/** Test-only batch trace. This deliberately shares canonicalization && the
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

export type SiteReferenceRequest = { key: string; name: string; site: BindingReferenceSite };

/**
 * Batch resolver for non-initializer, single-name reference sites (e.g. a
 * Task 22 property value that is exactly one `@name`). Every request has no
 * "owner" binding (unlike `resolveInitializerReferences`), so `self`
 * resolution never occurs; otherwise this shares the exact same forward+
 * reverse `runSweep` pass `resolveInitializerReferences` uses, so
 * declaration-line-onward visibility, shadowing, && forward-reference
 * detection all match `@name` resolution everywhere else in the language.
 * One shared sweep over the whole batch of requests, not one
 * `visibleBindingsAt` call per request - see `runSweep`'s own O(n) batching.
 */
export const resolveReferencesAtSites = (
  catalog: BindingCatalog,
  requests: readonly SiteReferenceRequest[]
): ReadonlyMap<string, BindingResolution> =>
  runSweep(catalog, requests.map((request) => ({ name: request.name, site: request.site, key: request.key, owner: null })));

/** Internal, non-exported single-name oracle for focused tests only. The
 * production bulk queries below never call this compatibility path. */
const resolveAtSite = (
  catalog: BindingCatalog,
  name: string,
  site: BindingReferenceSite
): BindingResolution => {
  const key = "single";
  const resolution = runSweep(catalog, [{ name, site, key, owner: null }]).get(key);
  if (!resolution) return { kind: "undefined", name, scopeId: site.scopeId, statementIndex: site.statementIndex };
  return resolution.kind === "resolved" ? resolution : { ...resolution, scopeId: site.scopeId, statementIndex: site.statementIndex };
};

/**
 * Test-only. Production code must use `resolveInitializerReferences`
 * (initializer-owner-bound), `visibleBindingsAt` (bulk visibility), ||
 * `resolveReferencesAtSites` (batch, owner-less, non-initializer sites);
 * none of the three exposes exact `duplicate`/`forward`/`undefined`
 * resolution detail for a single arbitrary name/site pair, which is what
 * most focused tests need to assert. `fromBindingId`, when given, is validated exactly like
 * the batch API (fail-fast on an unknown/non-typed/statement-mismatched
 * owner) && only then can the result be `self`; omitted, the lookup can
 * never produce `self`. This export is locked out of non-test source by
 * bindingResolutionPublicSurface.test.ts.
 */
export const resolveBindingReferenceForTests = (
  catalog: BindingCatalog,
  name: string,
  site: BindingReferenceSite,
  fromBindingId?: BindingId
): BindingResolution => {
  if (fromBindingId === undefined) return resolveAtSite(catalog, name, site);
  const owner = validatedOwner(catalog, fromBindingId, site.statementIndex);
  const key = "single";
  const resolution = runSweep(catalog, [{ name, site, key, owner }]).get(key)!;
  return resolution.kind === "resolved" ? resolution : { ...resolution, scopeId: site.scopeId, statementIndex: site.statementIndex };
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
  const shadowedNames = new Set<string>();
  const selectedBindingIds = new Set<BindingId>();
  for (const scopeId of scopeChain(catalog.scopeIndex, site.scopeId)) {
    if (observer) observer.siteTraversalCount += 1;
    const namesAtLevel = new Map<string, Binding[]>();
    for (const binding of catalog.bindings) {
      if (binding.effectiveScopeId !== scopeId) continue;
      const candidates = namesAtLevel.get(binding.name) ?? [];
      candidates.push(binding);
      namesAtLevel.set(binding.name, candidates);
    }
    for (const [name, candidates] of namesAtLevel) {
      if (shadowedNames.has(name) || candidates.length === 0) continue;
      shadowedNames.add(name);
      for (const binding of candidates) recordCandidateInspection(observer, binding);
      if (candidates.length === 1) {
        selectedBindingIds.add(candidates[0].id);
        recordEmittedCandidateCount(observer, 1);
      }
    }
  }

  const visible: Binding[] = [];
  for (const binding of catalog.bindings) if (selectedBindingIds.has(binding.id)) visible.push(binding);
  return visible;
};

/**
 * True bulk query: one source/site traversal regardless of visible name count.
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
