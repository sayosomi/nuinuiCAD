import type { DslReferencePickTarget } from "../dsl/dslReferencePickQuery";
import type { CompiledDslDocument } from "../dsl/dslDocument";
import {
  isModuleGeometryInterfaceAssignable,
  moduleGeometryInterfaceTypeOfElement,
  type ModuleGeometryInterfaceType
} from "../dsl/moduleGeometryInterfaces";
import { formatDslReferencePath } from "../dsl/dslReferenceTokens";
import {
  resolveSourceLexicalPath,
  type SourceLexicalDeclaration,
  type SourceLexicalNamespaceIndex
} from "../dsl/sourceLexicalNamespaceIndex";
import type { MaterializedExecutionStatement, ModuleOrigin } from "../dsl/moduleMaterialization";
import { effectiveEnabledElementIds, effectiveVisibleElementIds } from "./groups";
import {
  effectiveVisibleElementIdsForProfile,
  visibilityProfileById
} from "./visibilityProfiles";
import { elementQualifiedNameParts } from "./elementNames";
import {
  isLineEndpointPointKey,
  selectablePointsForGeometry
} from "./pointAnchors";
import type {
  CadElement,
  ComputedPoint,
  ElementId,
  EvaluationResult,
  PointAnchor
} from "../types/geometry";
import type { CanonicalGeometrySourceReference } from "./moduleSemanticCandidateBoundary";

export type ReferencePickPointOption = {
  kind: "point";
  label: string;
  anchor: PointAnchor;
  point: ComputedPoint;
  reference: CanonicalGeometrySourceReference;
};

export type ReferencePickGeometryOption = {
  kind: "geometry";
  label: string;
  reference: CanonicalGeometrySourceReference;
};

export type ReferencePickCandidateOption = ReferencePickPointOption | ReferencePickGeometryOption;

export type ReferencePickCandidate = {
  elementId: ElementId;
  actualGeometryInterface: ModuleGeometryInterfaceType;
  options: readonly ReferencePickCandidateOption[];
};

type CandidateContext = {
  target: DslReferencePickTarget;
  namespace: SourceLexicalNamespaceIndex;
  compiled: CompiledDslDocument;
  elements: readonly CadElement[];
};

const moduleDefinitionForScope = (
  namespace: SourceLexicalNamespaceIndex,
  scopeId: string
): string | null => {
  let current: string | null = scopeId;
  while (current) {
    if (current.startsWith("module:")) return current.slice("module:".length);
    current = namespace.scopeIndex.scopes.get(current)?.parentId ?? null;
  }
  return null;
};

const declarationByStatementId = (
  namespace: SourceLexicalNamespaceIndex,
  statementId: string
) => namespace.allDeclarations.find((declaration) => declaration.statementId === statementId);

const lexicallyVisibleFromTarget = (
  declaration: Pick<SourceLexicalDeclaration, "scopeId" | "statementIndex">,
  target: DslReferencePickTarget,
  namespace: SourceLexicalNamespaceIndex
) => {
  if (declaration.statementIndex >= target.sourceAnchor.sourceOrderIndex) return false;
  let current: string | null = target.sourceAnchor.scopeId;
  while (current) {
    if (current === declaration.scopeId) return true;
    current = namespace.scopeIndex.scopes.get(current)?.parentId ?? null;
  }
  return false;
};

const ordinarySourceReference = (
  entry: MaterializedExecutionStatement,
  element: CadElement,
  context: CandidateContext
): CanonicalGeometrySourceReference | null => {
  if (entry.instancePath.length !== 0) return null;
  if (moduleDefinitionForScope(context.namespace, context.target.sourceAnchor.scopeId) !== null) {
    return null;
  }
  const declaration = declarationByStatementId(context.namespace, entry.sourceStatementId);
  if (!declaration || declaration.kind !== "geometry") return null;

  const candidates = [
    [declaration.name],
    elementQualifiedNameParts(element, [...context.elements])
  ];
  for (const segments of candidates) {
    if (segments.length === 0) continue;
    const resolution = resolveSourceLexicalPath(
      context.namespace,
      context.target.sourceAnchor.statementIndex,
      { absolute: false, segments }
    );
    if (
      resolution.kind === "resolved" &&
      resolution.declaration.statementId === declaration.statementId
    ) {
      return { base: formatDslReferencePath({ absolute: false, segments }) };
    }
  }
  return null;
};

const exportedSourceReference = (
  origin: ModuleOrigin,
  targetModuleDefinitionStatementId: string | null,
  context: CandidateContext
): CanonicalGeometrySourceReference | null => {
  const analysis = context.compiled.moduleSemanticAnalysis;
  if (!analysis) return null;
  const definition = analysis.definitionsByStatementId.get(origin.moduleDefinitionStatementId);
  const exported = definition?.exports.find(
    (candidate) => candidate.exportedStatementId === origin.sourceStatementId
  );
  if (!exported) return null;

  const instanceStatementId = origin.instancePath.at(-1);
  const instance = instanceStatementId
    ? analysis.instancesByStatementId.get(instanceStatementId)
    : undefined;
  if (!instance) return null;

  if (targetModuleDefinitionStatementId === null) {
    if (
      origin.instancePath.length !== 1 ||
      instance.callerModuleDefinitionStatementId !== null
    ) return null;
  } else if (instance.callerModuleDefinitionStatementId !== targetModuleDefinitionStatementId) {
    return null;
  }

  const instanceDeclaration = declarationByStatementId(context.namespace, instance.statementId);
  if (!instanceDeclaration || !lexicallyVisibleFromTarget(instanceDeclaration, context.target, context.namespace)) {
    return null;
  }

  return {
    base: formatDslReferencePath({
      absolute: false,
      segments: [instance.name, exported.name]
    })
  };
};

const moduleSourceReference = (
  origin: ModuleOrigin,
  context: CandidateContext
): CanonicalGeometrySourceReference | null => {
  if (origin.kind !== "moduleBody") return null;
  const targetModuleDefinitionStatementId = moduleDefinitionForScope(
    context.namespace,
    context.target.sourceAnchor.scopeId
  );
  const sourceDeclaration = declarationByStatementId(context.namespace, origin.sourceStatementId);
  if (!sourceDeclaration || sourceDeclaration.kind !== "geometry") return null;

  if (
    targetModuleDefinitionStatementId === origin.moduleDefinitionStatementId &&
    lexicallyVisibleFromTarget(sourceDeclaration, context.target, context.namespace)
  ) {
    return {
      base: formatDslReferencePath({ absolute: false, segments: [sourceDeclaration.name] })
    };
  }

  return exportedSourceReference(origin, targetModuleDefinitionStatementId, context);
};

const canonicalReferenceForEntry = (
  entry: MaterializedExecutionStatement,
  element: CadElement,
  context: CandidateContext
): CanonicalGeometrySourceReference | null => entry.origin?.kind === "moduleBody"
  ? moduleSourceReference(entry.origin, context)
  : ordinarySourceReference(entry, element, context);

const candidateVisibility = (
  elements: readonly CadElement[],
  evaluation: EvaluationResult,
  compiled: CompiledDslDocument
) => {
  const sourceElements = [...elements];
  const enabled = evaluation.effectiveEnabledElementIds ?? effectiveEnabledElementIds(sourceElements);
  const visible = evaluation.effectiveVisibleElementIds ?? effectiveVisibleElementIds(sourceElements);
  const evaluated = evaluation.evaluatedElementIds;
  const document = compiled.document!;
  const profile = visibilityProfileById(
    document.visibilityProfiles,
    document.activeVisibilityProfileId
  );
  const profileVisible = effectiveVisibleElementIdsForProfile({ elements: sourceElements, profile });
  return (elementId: ElementId) =>
    enabled.has(elementId) &&
    visible.has(elementId) &&
    profileVisible.has(elementId) &&
    (!evaluated || evaluated.has(elementId)) &&
    evaluation.computedGeometry.has(elementId);
};

const referenceWithPointKey = (
  reference: CanonicalGeometrySourceReference,
  anchor: PointAnchor
): CanonicalGeometrySourceReference | null => {
  if (anchor.mode === "reference") return reference;
  if (anchor.mode !== "derived") return null;
  return { base: reference.base, pointKey: anchor.pointKey };
};

export const referencePickCandidates = ({
  compiled,
  evaluation,
  target
}: {
  compiled: CompiledDslDocument;
  evaluation: EvaluationResult;
  target: DslReferencePickTarget;
}): ReferencePickCandidate[] => {
  const document = compiled.document;
  const materialization = compiled.moduleMaterialization;
  const namespace = compiled.sourceLexicalNamespace;
  if (!document || !materialization || !namespace) return [];
  if (target.sourceAnchor.sourceRevision !== compiled.spans.sourceMap.sourceRevision) return [];

  const elements = document.elements;
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const entriesByRuntimeId = new Map(
    materialization.executionStatements.map((entry) => [entry.runtimeElementId, entry])
  );
  const isVisible = candidateVisibility(elements, evaluation, compiled);
  const context: CandidateContext = { target, namespace, compiled, elements };
  const candidates: ReferencePickCandidate[] = [];

  for (const element of elements) {
    const entry = entriesByRuntimeId.get(element.id);
    const geometry = evaluation.computedGeometry.get(element.id);
    if (!entry || !geometry || !isVisible(element.id)) continue;
    const actualGeometryInterface = moduleGeometryInterfaceTypeOfElement(entry.statement);
    if (!actualGeometryInterface) continue;
    const reference = canonicalReferenceForEntry(entry, element, context);
    if (!reference) continue;

    if (target.expectedGeometryInterface === "point") {
      const pointOptions = selectablePointsForGeometry(geometry, elementsById)
        .filter((point) =>
          target.role !== "endpoint" ||
          (point.anchor.mode === "derived" && isLineEndpointPointKey(point.anchor.pointKey))
        )
        .flatMap<ReferencePickPointOption>((point) => {
          const pointReference = referenceWithPointKey(reference, point.anchor);
          return pointReference
            ? [{
                kind: "point",
                label: point.label,
                anchor: point.anchor,
                point: point.point,
                reference: pointReference
              }]
            : [];
        });
      if (pointOptions.length > 0) {
        candidates.push({ elementId: element.id, actualGeometryInterface, options: pointOptions });
      }
      continue;
    }

    if (!isModuleGeometryInterfaceAssignable(actualGeometryInterface, target.expectedGeometryInterface)) {
      continue;
    }
    candidates.push({
      elementId: element.id,
      actualGeometryInterface,
      options: [{ kind: "geometry", label: geometry.name, reference }]
    });
  }

  return candidates;
};
