import type { StatementIdentity } from "../document/statementIdentity";
import type { ModuleCallEdge, ModuleDefinitionSemantic, ModuleInstanceSemantic } from "./moduleSemanticTypes";

export const moduleCallEdges = (instances: readonly ModuleInstanceSemantic[]): readonly ModuleCallEdge[] =>
  instances.flatMap((instance) => instance.callerModuleDefinitionStatementId && instance.callee
    ? [{
        callerModuleDefinitionStatementId: instance.callerModuleDefinitionStatementId,
        calleeModuleDefinitionStatementId: instance.callee.definitionStatementId,
        instanceStatementId: instance.statementId
      }]
    : []);

const findSimpleCallPath = (
  edgesByCaller: ReadonlyMap<StatementIdentity, readonly ModuleCallEdge[]>,
  from: StatementIdentity,
  target: StatementIdentity,
  visiting: Set<StatementIdentity>
): readonly ModuleCallEdge[] | null => {
  if (from === target) return [];
  for (const edge of edgesByCaller.get(from) ?? []) {
    const next = edge.calleeModuleDefinitionStatementId;
    if (next === target) return [edge];
    if (visiting.has(next)) continue;
    visiting.add(next);
    const tail = findSimpleCallPath(edgesByCaller, next, target, visiting);
    visiting.delete(next);
    if (tail) return [edge, ...tail];
  }
  return null;
};

/**
 * Returns one deterministic simple cycle for every recursive call site.
 *
 * The chosen return path follows call-edge/source order. Cycle edges are then
 * reported in that same global edge order so downstream diagnostics stay
 * stable even when an SCC contains multiple possible cycles.
 */
export const moduleRecursionCycles = (
  edges: readonly ModuleCallEdge[]
): ReadonlyMap<StatementIdentity, readonly ModuleCallEdge[]> => {
  const edgesByCaller = new Map<StatementIdentity, ModuleCallEdge[]>();
  for (const edge of edges) {
    edgesByCaller.set(
      edge.callerModuleDefinitionStatementId,
      [...(edgesByCaller.get(edge.callerModuleDefinitionStatementId) ?? []), edge]
    );
  }

  const cycles = new Map<StatementIdentity, readonly ModuleCallEdge[]>();
  for (const primary of edges) {
    const returnPath = findSimpleCallPath(
      edgesByCaller,
      primary.calleeModuleDefinitionStatementId,
      primary.callerModuleDefinitionStatementId,
      new Set([primary.calleeModuleDefinitionStatementId])
    );
    if (returnPath === null) continue;
    const cycleCallSites = new Set([primary, ...returnPath].map((edge) => edge.instanceStatementId));
    cycles.set(
      primary.instanceStatementId,
      edges.filter((edge) => cycleCallSites.has(edge.instanceStatementId))
    );
  }
  return cycles;
};

/** Returns the call-site identities that participate in direct || indirect recursion. */
export const recursiveModuleInstanceIds = (
  _definitions: readonly ModuleDefinitionSemantic[],
  edges: readonly ModuleCallEdge[]
): ReadonlySet<StatementIdentity> => new Set(moduleRecursionCycles(edges).keys());
