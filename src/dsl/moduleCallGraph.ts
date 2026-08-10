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

/** Returns the call-site identities that participate in direct or indirect recursion. */
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
