import type { StatementInfo } from "../dsl/dslDocument";
import { formatDslReferencePath } from "../dsl/dslReferenceTokens";
import type { ModuleMaterialization } from "../dsl/moduleMaterialization";
import type { ModuleSemanticAnalysis } from "../dsl/moduleSemanticTypes";
import type { SourceLexicalNamespaceIndex } from "../dsl/sourceLexicalNamespaceIndex";
import { derivedAnchor, referenceAnchor } from "./pointAnchors";
import type { CadElement, ElementId, PointAnchor } from "../types/geometry";

export type CanonicalGeometrySourceReference = {
  /** Canonical authored reference without a derived-point accessor. */
  base: string;
  /** Structured accessor; never recovered by splitting the formatted token. */
  pointKey?: string;
};

/** Provenance required at the semantic-reference boundary. Runtime element
 * type/name is deliberately not used to infer Module visibility. */
export type ModuleSemanticCandidateContext = {
  moduleMaterialization?: ModuleMaterialization;
  moduleSemanticAnalysis?: ModuleSemanticAnalysis;
  /** Parser/compiler-owned lexical scope tree. */
  sourceLexicalNamespace?: SourceLexicalNamespaceIndex;
  /** Source identity for ordinary (non-materialized) runtime elements. */
  statementInfoByElementId?: ReadonlyMap<ElementId, Pick<StatementInfo, "statementIndex">>;
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

const sourceNameCache = new WeakMap<object, ReadonlyMap<string, string>>();

const sourceNameForOrigin = (
  origin: NonNullable<ReturnType<typeof originFor>>,
  context: ModuleSemanticCandidateContext
) => {
  const namespace = context.sourceLexicalNamespace;
  if (!namespace) return null;
  let names = sourceNameCache.get(namespace);
  if (!names) {
    names = new Map(namespace.allDeclarations.map((declaration) => [declaration.statementId, declaration.name]));
    sourceNameCache.set(namespace, names);
  }
  return names.get(origin.sourceStatementId) ?? null;
};

type SourcePosition = {
  statementIndex: number;
  moduleDefinitionStatementId: string | null;
  scopeId: string;
};

const scopeForStatement = (
  statementIndex: number,
  context: ModuleSemanticCandidateContext
) => context.sourceLexicalNamespace?.scopeIndex.scopeOfStatement.get(statementIndex);

const scopeChainIncludingSelf = (
  context: ModuleSemanticCandidateContext,
  scopeId: string
) => {
  const scopes = context.sourceLexicalNamespace?.scopeIndex.scopes;
  if (!scopes) return [];
  const chain: string[] = [];
  let current: string | null = scopeId;
  while (current) {
    chain.push(current);
    current = scopes.get(current)?.parentId ?? null;
  }
  return chain;
};

const moduleDefinitionForScope = (
  scopeId: string,
  context: ModuleSemanticCandidateContext
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

const sourcePositionFor = (
  elementId: ElementId,
  context: ModuleSemanticCandidateContext
): SourcePosition | null => {
  const origin = originFor(elementId, context);
  const statementIndex = origin?.sourceStatementIndex ?? context.statementInfoByElementId?.get(elementId)?.statementIndex;
  if (statementIndex === undefined) return null;
  return sourcePositionForStatementIndex(statementIndex, origin?.moduleDefinitionStatementId ?? null, context);
};

const sourcePositionForStatementIndex = (
  statementIndex: number,
  moduleDefinitionStatementId: string | null,
  context: ModuleSemanticCandidateContext
): SourcePosition | null => {
  const scopeId = scopeForStatement(statementIndex, context);
  if (!scopeId) return null;
  return {
    statementIndex,
    scopeId,
    moduleDefinitionStatementId: moduleDefinitionStatementId ?? moduleDefinitionForScope(scopeId, context)
  };
};

const lexicallyVisibleFrom = (
  declaration: SourcePosition,
  target: SourcePosition,
  context: ModuleSemanticCandidateContext
) => declaration.statementIndex < target.statementIndex &&
  scopeChainIncludingSelf(context, target.scopeId).includes(declaration.scopeId);

const instanceForPath = (
  instancePath: readonly string[],
  context: ModuleSemanticCandidateContext
) => {
  const statementId = instancePath.at(-1);
  return statementId
    ? context.moduleSemanticAnalysis?.instancesByStatementId.get(statementId)
    : undefined;
};

const isExportVisible = (
  candidateOrigin: NonNullable<ReturnType<typeof originFor>>,
  targetOrigin: NonNullable<ReturnType<typeof originFor>> | undefined,
  targetPosition: SourcePosition | null,
  context: ModuleSemanticCandidateContext
) => {
  if (!exportForOrigin(candidateOrigin, context)) return false;
  const candidatePath = candidateOrigin.instancePath;

  // A root module instance is the only exported runtime member that may cross
  // the document/Module boundary. Its declaration is checked when the target
  // has a known source position; an unknown virtual root target remains the
  // established direct-root export path.
  if (candidatePath.length === 1) {
    const instance = instanceForPath(candidatePath, context);
    if (!instance || instance.callerModuleDefinitionStatementId !== null) return false;
    if (!targetPosition) return true;
    if (targetPosition.moduleDefinitionStatementId !== null) return false;
    const declaration = sourcePositionForStatementIndex(
      instance.statementIndex,
      instance.callerModuleDefinitionStatementId,
      context
    );
    return declaration ? lexicallyVisibleFrom(declaration, targetPosition, context) : false;
  }

  // A nested export is visible only from the caller Module body in which its
  // module instance was authored. It must not leak through materialization to
  // the root document or to a sibling/outer Module body.
  if (!targetOrigin || !targetPosition) return false;
  // Only the instance authored directly in the target Module body may expose
  // one of its callee's exports. A deeper runtime path is transitive and must
  // first be re-exported by each intermediate Module definition.
  if (candidatePath.length !== targetOrigin.instancePath.length + 1) return false;
  if (!targetOrigin.instancePath.every((id, index) => candidatePath[index] === id)) return false;
  const nestedInstanceId = candidatePath.at(-1);
  if (!nestedInstanceId) return false;
  const nestedInstance = context.moduleSemanticAnalysis?.instancesByStatementId.get(nestedInstanceId);
  if (!nestedInstance || nestedInstance.callerModuleDefinitionStatementId !== targetOrigin.moduleDefinitionStatementId) return false;
  const declaration = sourcePositionForStatementIndex(
    nestedInstance.statementIndex,
    nestedInstance.callerModuleDefinitionStatementId,
    context
  );
  return declaration ? lexicallyVisibleFrom(declaration, targetPosition, context) : false;
};

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
  const targetOrigin = originFor(targetElementId, context);
  const targetPosition = sourcePositionFor(targetElementId, context);
  if (isExportVisible(candidateOrigin, targetOrigin, targetPosition, context)) return true;
  if (exportForOrigin(candidateOrigin, context)) return false;

  // Private materialized geometry remains ordinary runtime geometry, but a
  // semantic source reference may cross neither a Module boundary nor a
  // lexical scope. Missing compiler scope metadata is intentionally fail-closed.
  const candidatePosition = sourcePositionFor(candidateElementId, context);
  return Boolean(
    targetOrigin?.kind === "moduleBody" &&
    candidatePosition &&
    targetPosition &&
    sameInstancePath(targetOrigin.instancePath, candidateOrigin.instancePath) &&
    candidateOrigin.moduleDefinitionStatementId === targetOrigin.moduleDefinitionStatementId &&
    lexicallyVisibleFrom(candidatePosition, targetPosition, context)
  );
};

/** Resolve the structured source token that semantic candidate adoption must
 * persist. Exported Module members use the existing qualified Module syntax;
 * private members use their authored lexical name only inside that Module. */
export const sourceReferenceForRuntimeElement = ({
  runtimeElementId,
  targetElementId,
  context,
  pointKey
}: {
  runtimeElementId: ElementId;
  targetElementId: ElementId;
  context: ModuleSemanticCandidateContext;
  pointKey?: string;
}): CanonicalGeometrySourceReference | null => {
  const origin = originFor(runtimeElementId, context);
  if (!origin || origin.kind !== "moduleBody") return null;
  if (!isSemanticGeometryCandidateAllowed({ candidateElementId: runtimeElementId, targetElementId, context })) return null;
  const exported = exportForOrigin(origin, context);

  if (exported) {
    const instanceStatementId = origin.instancePath.at(-1);
    const instanceName = instanceStatementId
      ? context.moduleSemanticAnalysis?.instancesByStatementId.get(instanceStatementId)?.name
      : undefined;
    if (!instanceName) return null;
    const base = formatDslReferencePath({ segments: [instanceName, exported.name], absolute: false });
    return pointKey ? { base, pointKey } : { base };
  }

  // Private source names come from the stable source statement identity, not
  // from the materialized runtime element's display name.
  const sourceName = sourceNameForOrigin(origin, context);
  if (!sourceName) return null;
  const base = formatDslReferencePath({ segments: [sourceName], absolute: false });
  return pointKey ? { base, pointKey } : { base };
};

export const sourceReferenceForAnchor = ({
  anchor,
  targetElementId,
  context
}: {
  anchor: PointAnchor;
  targetElementId: ElementId;
  context: ModuleSemanticCandidateContext;
}): CanonicalGeometrySourceReference | null => {
  if (anchor.mode === "reference") {
    return sourceReferenceForRuntimeElement({
      runtimeElementId: anchor.pointId,
      targetElementId,
      context
    });
  }
  if (anchor.mode === "derived") {
    return sourceReferenceForRuntimeElement({
      runtimeElementId: anchor.elementId,
      targetElementId,
      context,
      pointKey: anchor.pointKey
    });
  }
  return null;
};

export const pointAnchorForSourceReference = (
  sourceReference: CanonicalGeometrySourceReference
): PointAnchor => sourceReference.pointKey
  ? derivedAnchor(sourceReference.base, sourceReference.pointKey)
  : referenceAnchor(sourceReference.base);

export const sourceReferenceText = (
  sourceReference: CanonicalGeometrySourceReference | null
) => sourceReference
  ? `${sourceReference.base}${sourceReference.pointKey ? `.${sourceReference.pointKey}` : ""}`
  : null;

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
    context
  });
  const text = sourceReferenceText(base);
  return text && property ? `${text}.${property}` : text;
};
