// Pure initializer dependency graph, SCC (cycle) detection, and per-binding
// issue/status classification over Task 12's already-resolved binding
// references. See docs/typed-variables/tasks/13-binding-diagnostics-initializer-graph.md.
//
// This module never re-parses source text, never calls resolveBindingReference
// itself, and never re-derives undefined/forward/self/duplicate classification -
// it only consumes BindingResolution values a caller already produced. It also
// never uses a comparison sort: every deterministic ordering here is produced
// by single-pass bucket/index placement over bounded integer domains
// (bindingRank = position in catalog.bindings, a fixed small set of issue
// codes/origins, and occurrenceIndex bounded by each binding's own reference
// count), so the whole module stays O(bindings + references) - see the
// "決定的順序" section of the task plan for the full derivation.

import type { DslSpan } from "../dsl/dslTypes";
import type { BindingCatalog, BindingId } from "./bindingCatalog";
import type { BindingResolution } from "./bindingResolution";
import { buildBindingProgramEligibility } from "./bindingProgramEligibility";

export type InitializerReference = {
  /** The typed binding whose initializer text contains this `@name` occurrence. */
  fromBindingId: BindingId;
  /**
   * 0-based, unique, contiguous position of this reference among all
   * references belonging to the same `fromBindingId`'s initializer, in
   * left-to-right source order. Caller-supplied; never re-derived from
   * `span` or source text here. This is the sole ordering key used for
   * per-binding reference order - `span` is never compared for ordering.
   */
  occurrenceIndex: number;
  /** Referenced name text, kept only for message formatting - never re-resolved. */
  name: string;
  /** Exact span of the `@name` token; caller-owned, used only for diagnostic display. */
  span: DslSpan | null;
  /** Task 12's resolution for this exact occurrence; never re-resolved here. */
  resolution: BindingResolution;
};

export type AnalyzeBindingsInput = {
  catalog: BindingCatalog;
  initializerReferences: readonly InitializerReference[];
};

export type InitializerGraphEdge = { toBindingId: BindingId; reference: InitializerReference };

export type InitializerGraph = {
  /** catalog.bindings order (every binding, not just typed ones). */
  nodeIds: readonly BindingId[];
  /**
   * Each entry's edges are ordered by the owning reference's `occurrenceIndex`
   * (forward's multiple candidate targets keep Task 12's own
   * `bindingsByEffectiveScopeAndName` statementIndex order). Bindings with no
   * outgoing edges are absent from this map.
   */
  edgesByFromBindingId: ReadonlyMap<BindingId, readonly InitializerGraphEdge[]>;
};

export type StronglyConnectedComponent = {
  /** Members in bindingRank (catalog.bindings) order. */
  bindingIds: readonly BindingId[];
  /** `length > 1`, or `length === 1` with a self-loop edge. */
  isCycle: boolean;
};

export type BindingIssueCode =
  | "duplicate-binding"
  | "binding-cycle"
  | "self-initialization"
  | "undefined-binding"
  | "forward-binding-reference";

/** `entries[].status.reason` and `issues` ordering both key off this single table. */
export const ISSUE_PRIORITY: readonly BindingIssueCode[] = [
  "duplicate-binding",
  "binding-cycle",
  "self-initialization",
  "undefined-binding",
  "forward-binding-reference"
];

export type BindingIssueOrigin =
  | { kind: "declaration" }
  | { kind: "reference"; reference: InitializerReference };

export type BindingIssue = {
  code: BindingIssueCode;
  /** Binding this issue is attached to: `fromBindingId` for reference-origin, the declared binding itself for declaration-origin. */
  bindingId: BindingId;
  span: DslSpan | null;
  /**
   * declaration-origin `duplicate-binding`/`binding-cycle`: the whole bucket
   * or component array (including self), shared by reference across every
   * issue from that bucket/component - never copied per binding.
   */
  relatedBindingIds: readonly BindingId[];
  origin: BindingIssueOrigin;
};

export type BindingStatus =
  | { kind: "valid" }
  /** `reason` is the primary direct issue by ISSUE_PRIORITY, not the only issue. */
  | { kind: "invalid"; reason: BindingIssueCode };

export type BindingProgramEligibility =
  | { kind: "eligible" }
  | { kind: "ineligible"; reason: "direct-invalid" }
  | { kind: "ineligible"; reason: "invalid-dependency"; invalidDependencyBindingIds: readonly BindingId[] };

export type BindingAnalysisEntry = {
  bindingId: BindingId;
  /** Source diagnostics only; dependency propagation never changes this status. */
  status: BindingStatus;
  programEligibility: BindingProgramEligibility;
};

export type CompiledProgramBindingSelection = {
  /** Catalog order, containing only bindings safe for compiled-program lowering. */
  bindingIds: readonly BindingId[];
  entries: readonly BindingAnalysisEntry[];
  /** Original outgoing edges for every eligible source; no edge is filtered out. */
  graph: InitializerGraph;
};

export type BindingAnalysis = {
  catalog: BindingCatalog;
  graph: InitializerGraph;
  /** Ordered by each component's smallest-bindingRank member. */
  components: readonly StronglyConnectedComponent[];
  /** catalog.bindings order. */
  entries: readonly BindingAnalysisEntry[];
  entriesById: ReadonlyMap<BindingId, BindingAnalysisEntry>;
  /** Precomputed Task 19 input; use selectCompiledProgramBindings instead of re-analysis. */
  compiledProgram: CompiledProgramBindingSelection;
  /** Ordered by (bindingRank, codeRank, originRank, occurrenceIndex); see module comment. */
  issues: readonly BindingIssue[];
};

export const selectCompiledProgramBindings = (analysis: BindingAnalysis): CompiledProgramBindingSelection => analysis.compiledProgram;

/**
 * Groups references by `fromBindingId`, placing each directly at its
 * `occurrenceIndex` slot (no comparison sort - just index assignment).
 * Throws if a binding's occurrenceIndex values are not exactly `0..k-1`
 * with no duplicates or gaps, mirroring bindingCatalog.ts's fail-fast style
 * for violated caller contracts.
 */
const groupReferencesByFromBinding = (
  references: readonly InitializerReference[]
): ReadonlyMap<BindingId, readonly InitializerReference[]> => {
  const slotsByBindingId = new Map<BindingId, (InitializerReference | undefined)[]>();
  for (const reference of references) {
    const { fromBindingId, occurrenceIndex } = reference;
    if (!Number.isInteger(occurrenceIndex) || occurrenceIndex < 0) {
      throw new Error(
        `bindingAnalysis: occurrenceIndex must be a non-negative integer, got ${occurrenceIndex} for binding ${fromBindingId}`
      );
    }
    const slots = slotsByBindingId.get(fromBindingId) ?? [];
    if (slots[occurrenceIndex] !== undefined) {
      throw new Error(`bindingAnalysis: duplicate occurrenceIndex ${occurrenceIndex} for binding ${fromBindingId}`);
    }
    slots[occurrenceIndex] = reference;
    slotsByBindingId.set(fromBindingId, slots);
  }
  const grouped = new Map<BindingId, readonly InitializerReference[]>();
  for (const [bindingId, slots] of slotsByBindingId) {
    for (let index = 0; index < slots.length; index += 1) {
      if (slots[index] === undefined) {
        throw new Error(`bindingAnalysis: non-contiguous occurrenceIndex for binding ${bindingId}, missing index ${index}`);
      }
    }
    grouped.set(bindingId, slots as InitializerReference[]);
  }
  return grouped;
};

export const buildInitializerGraph = (
  catalog: BindingCatalog,
  references: readonly InitializerReference[]
): InitializerGraph => {
  const grouped = groupReferencesByFromBinding(references);
  const edgesByFromBindingId = new Map<BindingId, readonly InitializerGraphEdge[]>();
  for (const binding of catalog.bindings) {
    const ownReferences = grouped.get(binding.id);
    if (!ownReferences || ownReferences.length === 0) continue;
    const edges: InitializerGraphEdge[] = [];
    for (const reference of ownReferences) {
      const { resolution } = reference;
      if (resolution.kind === "resolved") {
        edges.push({ toBindingId: resolution.binding.id, reference });
      } else if (resolution.kind === "forward") {
        for (const toBindingId of resolution.bindingIds) edges.push({ toBindingId, reference });
      }
      // "self" / "undefined" / "duplicate": no known single target, no edge.
    }
    if (edges.length > 0) edgesByFromBindingId.set(binding.id, edges);
  }
  return { nodeIds: catalog.bindings.map((binding) => binding.id), edgesByFromBindingId };
};

type TarjanFrame = { nodeId: BindingId; edgeIndex: number };

/**
 * Iterative Tarjan (explicit stack, no recursion - see plan section on 1000
 * node scale). Returns raw (non-canonical) component indices plus which
 * bindings have a direct self-loop edge, so the caller can classify 1-node
 * SCCs as cycles only when a self-loop is actually present (the classic
 * Tarjan singleton-SCC pitfall).
 */
const runIterativeTarjan = (
  graph: InitializerGraph
): { componentIndexOf: Map<BindingId, number>; componentCount: number; selfLoopBindingIds: Set<BindingId> } => {
  const indices = new Map<BindingId, number>();
  const lowlinks = new Map<BindingId, number>();
  const onStack = new Set<BindingId>();
  const sccStack: BindingId[] = [];
  const componentIndexOf = new Map<BindingId, number>();
  const selfLoopBindingIds = new Set<BindingId>();
  let nextIndex = 0;
  let componentCount = 0;

  for (const startId of graph.nodeIds) {
    if (indices.has(startId)) continue;
    const workStack: TarjanFrame[] = [{ nodeId: startId, edgeIndex: 0 }];
    indices.set(startId, nextIndex);
    lowlinks.set(startId, nextIndex);
    nextIndex += 1;
    sccStack.push(startId);
    onStack.add(startId);

    while (workStack.length > 0) {
      const frame = workStack[workStack.length - 1];
      const edges = graph.edgesByFromBindingId.get(frame.nodeId) ?? [];
      if (frame.edgeIndex < edges.length) {
        const edge = edges[frame.edgeIndex];
        frame.edgeIndex += 1;
        const targetId = edge.toBindingId;
        if (targetId === frame.nodeId) selfLoopBindingIds.add(frame.nodeId);
        if (!indices.has(targetId)) {
          indices.set(targetId, nextIndex);
          lowlinks.set(targetId, nextIndex);
          nextIndex += 1;
          sccStack.push(targetId);
          onStack.add(targetId);
          workStack.push({ nodeId: targetId, edgeIndex: 0 });
        } else if (onStack.has(targetId)) {
          lowlinks.set(frame.nodeId, Math.min(lowlinks.get(frame.nodeId)!, indices.get(targetId)!));
        }
      } else {
        workStack.pop();
        const parentFrame = workStack[workStack.length - 1];
        if (parentFrame) {
          lowlinks.set(parentFrame.nodeId, Math.min(lowlinks.get(parentFrame.nodeId)!, lowlinks.get(frame.nodeId)!));
        }
        if (lowlinks.get(frame.nodeId) === indices.get(frame.nodeId)) {
          const currentComponentIndex = componentCount;
          componentCount += 1;
          while (true) {
            const memberId = sccStack.pop()!;
            onStack.delete(memberId);
            componentIndexOf.set(memberId, currentComponentIndex);
            if (memberId === frame.nodeId) break;
          }
        }
      }
    }
  }

  return { componentIndexOf, componentCount, selfLoopBindingIds };
};

export const findStronglyConnectedComponents = (graph: InitializerGraph): readonly StronglyConnectedComponent[] => {
  const { componentIndexOf, selfLoopBindingIds } = runIterativeTarjan(graph);
  // Canonicalize purely by first-encounter while scanning nodeIds in their
  // already-canonical bindingRank order - no sort, single pass.
  const canonicalIndexOfRaw = new Map<number, number>();
  const membersByCanonicalIndex: BindingId[][] = [];
  for (const bindingId of graph.nodeIds) {
    const rawIndex = componentIndexOf.get(bindingId)!;
    let canonicalIndex = canonicalIndexOfRaw.get(rawIndex);
    if (canonicalIndex === undefined) {
      canonicalIndex = membersByCanonicalIndex.length;
      canonicalIndexOfRaw.set(rawIndex, canonicalIndex);
      membersByCanonicalIndex.push([]);
    }
    membersByCanonicalIndex[canonicalIndex].push(bindingId);
  }
  return membersByCanonicalIndex.map((bindingIds) => ({
    bindingIds,
    isCycle: bindingIds.length > 1 || (bindingIds.length === 1 && selfLoopBindingIds.has(bindingIds[0]))
  }));
};

type MutableIssueBuckets = {
  duplicateDeclaration?: BindingIssue;
  duplicateReference: BindingIssue[];
  cycle?: BindingIssue;
  self: BindingIssue[];
  undefinedRef: BindingIssue[];
  forward: BindingIssue[];
};

export const analyzeBindings = (input: AnalyzeBindingsInput): BindingAnalysis => {
  const { catalog, initializerReferences } = input;
  const graph = buildInitializerGraph(catalog, initializerReferences);
  const components = findStronglyConnectedComponents(graph);

  const componentByBindingId = new Map<BindingId, StronglyConnectedComponent>();
  for (const component of components) {
    for (const bindingId of component.bindingIds) componentByBindingId.set(bindingId, component);
  }

  const bucketsByBindingId = new Map<BindingId, MutableIssueBuckets>();
  const bucketFor = (bindingId: BindingId): MutableIssueBuckets => {
    let bucket = bucketsByBindingId.get(bindingId);
    if (!bucket) {
      bucket = { duplicateReference: [], self: [], undefinedRef: [], forward: [] };
      bucketsByBindingId.set(bindingId, bucket);
    }
    return bucket;
  };

  // Declaration-origin duplicate-binding: consume catalog's precomputed
  // namespace-correct buckets rather than re-deriving duplicate rules here.
  // Each issue shares the bucket's one related-id array, preserving O(bindings).
  for (const bucketBindings of catalog.declarationDuplicateBuckets) {
    const relatedIds = bucketBindings.map((item) => item.id);
    for (const binding of bucketBindings) {
      bucketFor(binding.id).duplicateDeclaration = {
        code: "duplicate-binding",
        bindingId: binding.id,
        span: binding.nameSpan,
        relatedBindingIds: relatedIds,
        origin: { kind: "declaration" }
      }
    }
  }

  // Reference-anchored issues (self/undefined/forward/reference-duplicate),
  // one occurrence at a time, already in occurrenceIndex order per binding.
  const groupedReferences = groupReferencesByFromBinding(initializerReferences);
  for (const [fromBindingId, references] of groupedReferences) {
    const bucket = bucketFor(fromBindingId);
    const ownComponent = componentByBindingId.get(fromBindingId);
    for (const reference of references) {
      const { resolution } = reference;
      if (resolution.kind === "self") {
        bucket.self.push({
          code: "self-initialization",
          bindingId: fromBindingId,
          span: reference.span,
          relatedBindingIds: [resolution.bindingId],
          origin: { kind: "reference", reference }
        });
      } else if (resolution.kind === "undefined") {
        bucket.undefinedRef.push({
          code: "undefined-binding",
          bindingId: fromBindingId,
          span: reference.span,
          relatedBindingIds: [],
          origin: { kind: "reference", reference }
        });
      } else if (resolution.kind === "duplicate") {
        bucket.duplicateReference.push({
          code: "duplicate-binding",
          bindingId: fromBindingId,
          span: reference.span,
          relatedBindingIds: resolution.bindingIds,
          origin: { kind: "reference", reference }
        });
      } else if (resolution.kind === "forward") {
        // Suppressed only when at least one forward candidate shares this
        // binding's own cycle component - a plain forward chain outside any
        // SCC is never suppressed (see plan "forward抑制ルール" derivation).
        const suppressedByCycle =
          ownComponent?.isCycle === true &&
          resolution.bindingIds.some((targetId) => componentByBindingId.get(targetId) === ownComponent);
        if (!suppressedByCycle) {
          bucket.forward.push({
            code: "forward-binding-reference",
            bindingId: fromBindingId,
            span: reference.span,
            relatedBindingIds: resolution.bindingIds,
            origin: { kind: "reference", reference }
          });
        }
      }
      // "resolved": success, no issue.
    }
  }

  // binding-cycle: one per cycle-member binding, sharing component.bindingIds.
  for (const component of components) {
    if (!component.isCycle) continue;
    for (const bindingId of component.bindingIds) {
      const binding = catalog.bindingsById.get(bindingId);
      const fallbackSpan =
        graph.edgesByFromBindingId
          .get(bindingId)
          ?.find((edge) => componentByBindingId.get(edge.toBindingId) === component)?.reference.span ?? null;
      bucketFor(bindingId).cycle = {
        code: "binding-cycle",
        bindingId,
        span: binding?.nameSpan ?? fallbackSpan,
        relatedBindingIds: component.bindingIds,
        origin: { kind: "declaration" }
      };
    }
  }

  // Assemble in catalog.bindings order; within a binding, concatenate the
  // five code buckets in ISSUE_PRIORITY order (fixed-order concatenation,
  // never a comparison sort).
  const directEntries: { bindingId: BindingId; status: BindingStatus }[] = [];
  const issues: BindingIssue[] = [];
  for (const binding of catalog.bindings) {
    const bucket = bucketsByBindingId.get(binding.id);
    const bindingIssues: BindingIssue[] = [];
    if (bucket) {
      if (bucket.duplicateDeclaration) bindingIssues.push(bucket.duplicateDeclaration);
      bindingIssues.push(...bucket.duplicateReference);
      if (bucket.cycle) bindingIssues.push(bucket.cycle);
      bindingIssues.push(...bucket.self);
      bindingIssues.push(...bucket.undefinedRef);
      bindingIssues.push(...bucket.forward);
    }
    issues.push(...bindingIssues);
    const entry: { bindingId: BindingId; status: BindingStatus } = bindingIssues[0]
      ? { bindingId: binding.id, status: { kind: "invalid", reason: bindingIssues[0].code } }
      : { bindingId: binding.id, status: { kind: "valid" } };
    directEntries.push(entry);
  }

  const { entries, entriesById, compiledProgram } = buildBindingProgramEligibility(graph, directEntries);
  return { catalog, graph, components, entries, entriesById, compiledProgram, issues };
};
