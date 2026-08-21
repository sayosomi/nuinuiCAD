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

/** Returns the call-site identities that participate in direct || indirect recursion. */
export const recursiveModuleInstanceIds = (
  definitions: readonly ModuleDefinitionSemantic[],
  edges: readonly ModuleCallEdge[]
): ReadonlySet<StatementIdentity> => {
  const recursiveInstances = new Set<StatementIdentity>();
  const edgesByCaller = new Map<StatementIdentity, ModuleCallEdge[]>();
  for (const edge of edges) edgesByCaller.set(edge.callerModuleDefinitionStatementId, [...(edgesByCaller.get(edge.callerModuleDefinitionStatementId) ?? []), edge]);
  const visited = new Set<StatementIdentity>();
  const visiting = new Set<StatementIdentity>();
  const path: StatementIdentity[] = [];
  const edgePath: ModuleCallEdge[] = [];
  const visit = (node: StatementIdentity) => {
    if (visiting.has(node)) {
      const start = path.indexOf(node);
      for (let index = Math.max(0, start); index < edgePath.length; index += 1) recursiveInstances.add(edgePath[index].instanceStatementId);
      if (edgePath.length > 0) recursiveInstances.add(edgePath.at(-1)!.instanceStatementId);
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    path.push(node);
    for (const edge of edgesByCaller.get(node) ?? []) {
      edgePath.push(edge);
      visit(edge.calleeModuleDefinitionStatementId);
      edgePath.pop();
    }
    path.pop();
    visiting.delete(node);
    visited.add(node);
  };
  for (const definition of definitions) visit(definition.statementId);
  return recursiveInstances;
};

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
 * Returns one deterministic simple cycle for each call site already selected
 * by the existing recursion diagnostic traversal.
 *
 * The selected primary set is intentionally preserved. The chosen return path
 * follows call-edge/source order, and the returned cycle locations are also
 * reported in global call-edge/source order.
 */
export const moduleRecursionCycles = (
  definitions: readonly ModuleDefinitionSemantic[],
  edges: readonly ModuleCallEdge[]
): ReadonlyMap<StatementIdentity, readonly ModuleCallEdge[]> => {
  const recursiveInstances = recursiveModuleInstanceIds(definitions, edges);
  const edgesByCaller = new Map<StatementIdentity, ModuleCallEdge[]>();
  for (const edge of edges) {
    edgesByCaller.set(
      edge.callerModuleDefinitionStatementId,
      [...(edgesByCaller.get(edge.callerModuleDefinitionStatementId) ?? []), edge]
    );
  }

  const cycles = new Map<StatementIdentity, readonly ModuleCallEdge[]>();
  for (const primary of edges) {
    if (!recursiveInstances.has(primary.instanceStatementId)) continue;
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
