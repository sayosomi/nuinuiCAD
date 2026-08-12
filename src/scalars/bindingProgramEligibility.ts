// Compiled-program eligibility is intentionally separate from source issues:
// it propagates unusability through the initializer graph but never creates
// diagnostics or changes BindingStatus. See Task 13R-2.

import type { BindingId } from "./bindingCatalog";
import type {
  BindingAnalysisEntry,
  BindingProgramEligibility,
  BindingStatus,
  CompiledProgramBindingSelection,
  InitializerGraph,
  InitializerGraphEdge
} from "./bindingAnalysis";

type DirectStatusEntry = { bindingId: BindingId; status: BindingStatus };

type EligibilityResult = {
  entries: readonly BindingAnalysisEntry[];
  entriesById: ReadonlyMap<BindingId, BindingAnalysisEntry>;
  compiledProgram: CompiledProgramBindingSelection;
};

const buildReverseAdjacency = (graph: InitializerGraph): ReadonlyMap<BindingId, readonly BindingId[]> => {
  const dependentsByTargetId = new Map<BindingId, BindingId[]>();
  for (const fromBindingId of graph.nodeIds) {
    for (const edge of graph.edgesByFromBindingId.get(fromBindingId) ?? []) {
      const dependents = dependentsByTargetId.get(edge.toBindingId) ?? [];
      dependents.push(fromBindingId);
      dependentsByTargetId.set(edge.toBindingId, dependents);
    }
  }
  return dependentsByTargetId;
};

const findUnavailableBindingIds = (
  graph: InitializerGraph,
  directEntries: readonly DirectStatusEntry[],
  initiallyUnavailableBindingIds?: ReadonlySet<BindingId>
): ReadonlySet<BindingId> => {
  const unavailableBindingIds = new Set(initiallyUnavailableBindingIds);
  const worklist: BindingId[] = [];
  for (const bindingId of unavailableBindingIds) worklist.push(bindingId);
  for (const entry of directEntries) {
    if (entry.status.kind !== "invalid") continue;
    unavailableBindingIds.add(entry.bindingId);
    worklist.push(entry.bindingId);
  }

  const dependentsByTargetId = buildReverseAdjacency(graph);
  for (let index = 0; index < worklist.length; index += 1) {
    const unavailableBindingId = worklist[index];
    for (const dependentBindingId of dependentsByTargetId.get(unavailableBindingId) ?? []) {
      if (unavailableBindingIds.has(dependentBindingId)) continue;
      unavailableBindingIds.add(dependentBindingId);
      worklist.push(dependentBindingId);
    }
  }
  return unavailableBindingIds;
};

const unavailableOutgoingTargetIds = (
  graph: InitializerGraph,
  bindingId: BindingId,
  unavailableBindingIds: ReadonlySet<BindingId>
): readonly BindingId[] => {
  const targetIds: BindingId[] = [];
  const seenTargetIds = new Set<BindingId>();
  for (const edge of graph.edgesByFromBindingId.get(bindingId) ?? []) {
    if (!unavailableBindingIds.has(edge.toBindingId) || seenTargetIds.has(edge.toBindingId)) continue;
    seenTargetIds.add(edge.toBindingId);
    targetIds.push(edge.toBindingId);
  }
  return targetIds;
};

const buildProgramSelection = (
  graph: InitializerGraph,
  entries: readonly BindingAnalysisEntry[]
): CompiledProgramBindingSelection => {
  const bindingIds: BindingId[] = [];
  const selectedEntries: BindingAnalysisEntry[] = [];
  const eligibleBindingIds = new Set<BindingId>();
  for (const entry of entries) {
    if (entry.programEligibility.kind !== "eligible") continue;
    bindingIds.push(entry.bindingId);
    selectedEntries.push(entry);
    eligibleBindingIds.add(entry.bindingId);
  }

  const edgesByFromBindingId = new Map<BindingId, readonly InitializerGraphEdge[]>();
  for (const fromBindingId of bindingIds) {
    const edges = graph.edgesByFromBindingId.get(fromBindingId);
    if (!edges || edges.length === 0) continue;
    for (const edge of edges) {
      if (!eligibleBindingIds.has(edge.toBindingId)) {
        throw new Error(
          `bindingAnalysis: program-eligible binding ${fromBindingId} depends on unavailable binding ${edge.toBindingId}`
        );
      }
    }
    edgesByFromBindingId.set(fromBindingId, edges);
  }

  return {
    bindingIds,
    entries: selectedEntries,
    graph: { nodeIds: bindingIds, edgesByFromBindingId }
  };
};

export const buildBindingProgramEligibility = (
  graph: InitializerGraph,
  directEntries: readonly DirectStatusEntry[],
  initiallyUnavailableBindingIds?: ReadonlySet<BindingId>
): EligibilityResult => {
  const unavailableBindingIds = findUnavailableBindingIds(graph, directEntries, initiallyUnavailableBindingIds);
  const entries: BindingAnalysisEntry[] = [];
  const entriesById = new Map<BindingId, BindingAnalysisEntry>();

  // This is deliberately a second graph traversal after closure calculation:
  // each dependency-derived entry records every directly referenced unavailable
  // target, not whichever target happened to discover it during propagation.
  for (const directEntry of directEntries) {
    const programEligibility: BindingProgramEligibility =
      directEntry.status.kind === "invalid"
        ? { kind: "ineligible", reason: "direct-invalid" }
        : unavailableBindingIds.has(directEntry.bindingId)
          ? {
              kind: "ineligible",
              reason: "invalid-dependency",
              invalidDependencyBindingIds: unavailableOutgoingTargetIds(
                graph,
                directEntry.bindingId,
                unavailableBindingIds
              )
            }
          : { kind: "eligible" };
    const entry = { ...directEntry, programEligibility };
    entries.push(entry);
    entriesById.set(entry.bindingId, entry);
  }

  return { entries, entriesById, compiledProgram: buildProgramSelection(graph, entries) };
};
