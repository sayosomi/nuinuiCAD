import { formatDslReferencePath } from "../dsl/dslReferenceTokens";
import type { ModuleMaterialization } from "../dsl/moduleMaterialization";
import type { ModuleSemanticAnalysis } from "../dsl/moduleSemanticTypes";
import type { CadElement, ElementId, PointAnchor } from "../types/geometry";

/** Provenance required at the semantic-reference boundary. Runtime element
 * type/name is deliberately not used to infer Module visibility. */
export type ModuleSemanticCandidateContext = {
  moduleMaterialization?: ModuleMaterialization;
  moduleSemanticAnalysis?: ModuleSemanticAnalysis;
};

const sameInstancePath = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((entry, index) => entry === right[index]);

const originFor = (elementId: ElementId, context: ModuleSemanticCandidateContext) =>
  context.moduleMaterialization?.originByRuntimeElementId.get(elementId);

const exportForOrigin = (
  origin: NonNullable<ReturnType<typeof originFor>>,
  context: ModuleSemanticCandidateContext
) => context.moduleSemanticAnalysis?.definitionsByStatementId
  .get(origin.moduleDefinitionStatementId)
  ?.exports.find((entry) => entry.exportedStatementId === origin.sourceStatementId);

/** Returns false only at the semantic candidate boundary. Drawing and normal
 * hit testing remain independent and continue to see the runtime geometry. */
export const isSemanticGeometryCandidateAllowed = ({
  candidateElementId,
  targetElementId,
  context
}: {
  candidateElementId: ElementId;
  targetElementId: ElementId;
  context: ModuleSemanticCandidateContext;
}) => {
  const candidateOrigin = originFor(candidateElementId, context);
  if (!candidateOrigin || candidateOrigin.kind !== "moduleBody") return true;
  if (exportForOrigin(candidateOrigin, context)) return true;

  const targetOrigin = originFor(targetElementId, context);
  return Boolean(
    targetOrigin?.kind === "moduleBody" &&
    sameInstancePath(targetOrigin.instancePath, candidateOrigin.instancePath)
  );
};

/** Resolve the source token that a semantic candidate adoption must persist.
 * Exported Module members use the existing qualified Module syntax. Private
 * members are only exposed to a lexical sibling in the same materialized
 * instance, where their authored name is the valid source token. */
export const sourceReferenceForRuntimeElement = ({
  runtimeElementId,
  targetElementId,
  context,
  fallbackSourceName,
  pointKey
}: {
  runtimeElementId: ElementId;
  targetElementId: ElementId;
  context: ModuleSemanticCandidateContext;
  fallbackSourceName?: string;
  pointKey?: string;
}) => {
  const origin = originFor(runtimeElementId, context);
  if (!origin || origin.kind !== "moduleBody") return null;
  const exported = exportForOrigin(origin, context);
  const targetOrigin = originFor(targetElementId, context);

  if (exported) {
    const instanceStatementId = origin.instancePath.at(-1);
    const instanceName = instanceStatementId
      ? context.moduleSemanticAnalysis?.instancesByStatementId.get(instanceStatementId)?.name
      : undefined;
    if (!instanceName) return null;
    const base = formatDslReferencePath({ segments: [instanceName, exported.name], absolute: false });
    return pointKey ? `${base}.${pointKey}` : base;
  }

  if (
    targetOrigin?.kind !== "moduleBody" ||
    !sameInstancePath(targetOrigin.instancePath, origin.instancePath) ||
    !fallbackSourceName
  ) return null;
  const base = formatDslReferencePath({ segments: [fallbackSourceName], absolute: false });
  return pointKey ? `${base}.${pointKey}` : base;
};

export const sourceReferenceForAnchor = ({
  anchor,
  targetElementId,
  context,
  fallbackSourceName
}: {
  anchor: PointAnchor;
  targetElementId: ElementId;
  context: ModuleSemanticCandidateContext;
  fallbackSourceName?: string;
}) => {
  if (anchor.mode === "reference") {
    return sourceReferenceForRuntimeElement({
      runtimeElementId: anchor.pointId,
      targetElementId,
      context,
      fallbackSourceName
    });
  }
  if (anchor.mode === "derived") {
    return sourceReferenceForRuntimeElement({
      runtimeElementId: anchor.elementId,
      targetElementId,
      context,
      fallbackSourceName,
      pointKey: anchor.pointKey
    });
  }
  return null;
};

export const sourceReferenceForElement = ({
  element,
  targetElementId,
  context,
  property
}: {
  element: CadElement;
  targetElementId: ElementId;
  context: ModuleSemanticCandidateContext;
  property?: string;
}) => {
  const base = sourceReferenceForRuntimeElement({
    runtimeElementId: element.id,
    targetElementId,
    context,
    fallbackSourceName: element.name
  });
  return base && property ? `${base}.${property}` : base;
};
