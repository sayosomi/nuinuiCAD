import type { StatementIdentity } from "../document/statementIdentity";
import type { DocumentQualifiedSemanticIdentity } from "../document/multiDocumentPrimitives";
import type { ModuleCallEdge, ModuleDefinitionSemantic, ModuleInstanceSemantic } from "./moduleSemanticTypes";

export const moduleCallEdges = (instances: readonly ModuleInstanceSemantic[]): readonly ModuleCallEdge[] =>
  instances.flatMap((instance) => instance.callerModuleDefinitionStatementId && instance.callee
      ? [{
        callerModuleDefinitionStatementId: instance.callerModuleDefinitionStatementId,
        calleeModuleDefinitionStatementId: instance.callee.definitionStatementId,
        instanceStatementId: instance.statementId,
        ...(instance.callerModuleDefinitionIdentity ? { callerIdentity: instance.callerModuleDefinitionIdentity } : {}),
        ...(instance.callee.definitionIdentity ? { calleeIdentity: instance.callee.definitionIdentity } : {}),
        ...(instance.identity ? { instanceIdentity: instance.identity } : {})
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

export type DocumentQualifiedModuleCallEdge = {
  caller: DocumentQualifiedSemanticIdentity<string>;
  callee: DocumentQualifiedSemanticIdentity<string>;
  instance: DocumentQualifiedSemanticIdentity<string>;
  callerModuleDefinitionStatementId: string;
  calleeModuleDefinitionStatementId: string;
  instanceStatementId: string;
};

/** Document-qualified counterpart of the existing call-graph recursion
 * traversal. The same deterministic DFS rules apply across document owners. */
export const recursiveDocumentQualifiedModuleInstanceIds = (
  definitions: readonly ModuleDefinitionSemantic[],
  edges: readonly DocumentQualifiedModuleCallEdge[]
): ReadonlySet<string> => {
  const definitionIds = new Set(
    definitions.flatMap((definition) => definition.identity ? [JSON.stringify([definition.identity.documentId, definition.identity.localIdentity])] : [])
  );
  const identityKey = (identity: DocumentQualifiedSemanticIdentity<string>) =>
    JSON.stringify([identity.documentId, identity.localIdentity]);
  const edgesByCaller = new Map<string, DocumentQualifiedModuleCallEdge[]>();
  for (const edge of edges) {
    if (!definitionIds.has(identityKey(edge.caller))) continue;
    const key = identityKey(edge.caller);
    edgesByCaller.set(key, [...(edgesByCaller.get(key) ?? []), edge]);
  }
  const recursive = new Set<string>();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: DocumentQualifiedModuleCallEdge[] = [];
  const visit = (identity: string) => {
    if (visiting.has(identity)) {
      const start = stack.findIndex((edge) => identityKey(edge.caller) === identity);
      for (const edge of stack.slice(Math.max(0, start))) recursive.add(identityKey(edge.instance));
      if (stack.length > 0) recursive.add(identityKey(stack.at(-1)!.instance));
      return;
    }
    if (visited.has(identity)) return;
    visiting.add(identity);
    for (const edge of edgesByCaller.get(identity) ?? []) {
      stack.push(edge);
      visit(identityKey(edge.callee));
      stack.pop();
    }
    visiting.delete(identity);
    visited.add(identity);
  };
  for (const definition of definitions) {
    if (definition.identity) visit(identityKey(definition.identity));
  }
  return recursive;
};
