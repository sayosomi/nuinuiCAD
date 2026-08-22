import type { DslReferencePickSourceAnchor } from "../dsl/dslReferencePickQuery";
import type { ModuleOrigin, ModuleMaterialization } from "../dsl/moduleMaterialization";
import type { ElementId } from "../types/geometry";
import {
  isSemanticGeometryCandidateAllowed,
  sourceReferenceForRuntimeElement,
  type CanonicalGeometrySourceReference,
  type ModuleSemanticCandidateContext
} from "./moduleSemanticCandidateBoundary";

const moduleDefinitionForScope = (
  context: ModuleSemanticCandidateContext,
  scopeId: string
): string | null => {
  const scopes = context.sourceLexicalNamespace?.scopeIndex.scopes;
  if (!scopes) return null;
  let current: string | null = scopeId;
  while (current) {
    if (current.startsWith("module:")) return current.slice("module:".length);
    current = scopes.get(current)?.parentId ?? null;
  }
  return null;
};

const proxyTargetOrigin = ({
  candidateOrigin,
  target,
  context
}: {
  candidateOrigin: ModuleOrigin | undefined;
  target: DslReferencePickSourceAnchor;
  context: ModuleSemanticCandidateContext;
}): ModuleOrigin | null => {
  if (!candidateOrigin || candidateOrigin.kind !== "moduleBody") return null;
  const targetModuleDefinitionStatementId = moduleDefinitionForScope(context, target.scopeId);
  if (!targetModuleDefinitionStatementId) return null;

  if (candidateOrigin.moduleDefinitionStatementId === targetModuleDefinitionStatementId) {
    return {
      kind: "moduleBody",
      sourceStatementId: target.statementId,
      sourceStatementIndex: target.statementIndex,
      moduleDefinitionStatementId: targetModuleDefinitionStatementId,
      callerModuleDefinitionStatementId: null,
      instancePath: candidateOrigin.instancePath
    };
  }

  const nestedInstanceStatementId = candidateOrigin.instancePath.at(-1);
  const nestedInstance = nestedInstanceStatementId
    ? context.moduleSemanticAnalysis?.instancesByStatementId.get(nestedInstanceStatementId)
    : undefined;
  if (nestedInstance?.callerModuleDefinitionStatementId !== targetModuleDefinitionStatementId) {
    return null;
  }

  return {
    kind: "moduleBody",
    sourceStatementId: target.statementId,
    sourceStatementIndex: target.statementIndex,
    moduleDefinitionStatementId: targetModuleDefinitionStatementId,
    callerModuleDefinitionStatementId: null,
    instancePath: candidateOrigin.instancePath.slice(0, -1)
  };
};

const contextForSourceTarget = ({
  candidateElementId,
  target,
  context,
  proxyElementId
}: {
  candidateElementId: ElementId;
  target: DslReferencePickSourceAnchor;
  context: ModuleSemanticCandidateContext;
  proxyElementId: ElementId;
}): ModuleSemanticCandidateContext => {
  const statementInfoByElementId = new Map(context.statementInfoByElementId ?? []);
  statementInfoByElementId.set(proxyElementId, { statementIndex: target.statementIndex });

  const materialization = context.moduleMaterialization;
  if (!materialization) return { ...context, statementInfoByElementId };
  const candidateOrigin = materialization.originByRuntimeElementId.get(candidateElementId);
  const targetOrigin = proxyTargetOrigin({ candidateOrigin, target, context });
  if (!targetOrigin) return { ...context, statementInfoByElementId };

  const originByRuntimeElementId = new Map(materialization.originByRuntimeElementId);
  originByRuntimeElementId.set(proxyElementId, targetOrigin);
  const moduleMaterialization: ModuleMaterialization = {
    ...materialization,
    originByRuntimeElementId
  };
  return { ...context, moduleMaterialization, statementInfoByElementId };
};

/**
 * Reuses the existing element-target Module semantic boundary for a Source
 * target that does not necessarily have runtime geometry. The proxy target is
 * candidate-local: when the target is inside a Module definition its concrete
 * instance path is projected from that candidate, so private and direct nested
 * export rules remain exactly the rules owned by moduleSemanticCandidateBoundary.
 */
export const sourceReferenceForRuntimeElementAtSourceAnchor = ({
  runtimeElementId,
  target,
  context,
  pointKey
}: {
  runtimeElementId: ElementId;
  target: DslReferencePickSourceAnchor;
  context: ModuleSemanticCandidateContext;
  pointKey?: string;
}): CanonicalGeometrySourceReference | null => {
  if (!context.moduleMaterialization?.originByRuntimeElementId.has(runtimeElementId)) return null;
  const proxyElementId = `__reference-pick-source-target__:${target.statementId}`;
  const proxyContext = contextForSourceTarget({
    candidateElementId: runtimeElementId,
    target,
    context,
    proxyElementId
  });
  if (!isSemanticGeometryCandidateAllowed({
    candidateElementId: runtimeElementId,
    targetElementId: proxyElementId,
    context: proxyContext
  })) return null;
  return sourceReferenceForRuntimeElement({
    runtimeElementId,
    targetElementId: proxyElementId,
    context: proxyContext,
    pointKey
  });
};
