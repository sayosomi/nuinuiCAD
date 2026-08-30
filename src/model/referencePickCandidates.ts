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
  type SourceLexicalNamespaceIndex
} from "../dsl/sourceLexicalNamespaceIndex";
import type { MaterializedExecutionStatement } from "../dsl/moduleMaterialization";
import { effectiveCanvasVisibleElementIds } from "../geometry/canvasDrawingBounds";
import { effectiveEnabledElementIds } from "./groups";
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
import type {
  CanonicalGeometrySourceReference,
  ModuleSemanticCandidateContext
} from "./moduleSemanticCandidateBoundary";
import { sourceReferenceForRuntimeElementAtSourceAnchor } from "./sourceAnchoredModuleSemanticCandidate";

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

type ReferencePickExecutionEntry = Pick<
  MaterializedExecutionStatement,
  "statement" | "sourceStatementId" | "sourceStatementIndex" | "runtimeElementId" | "instancePath" | "origin"
>;

type CandidateContext = {
  target: DslReferencePickTarget;
  namespace: SourceLexicalNamespaceIndex;
  moduleSemanticContext: ModuleSemanticCandidateContext | null;
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

const ordinarySourceReference = (
  entry: ReferencePickExecutionEntry,
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

const canonicalReferenceForEntry = (
  entry: ReferencePickExecutionEntry,
  element: CadElement,
  context: CandidateContext
): CanonicalGeometrySourceReference | null => entry.origin?.kind === "moduleBody"
  ? context.moduleSemanticContext
    ? sourceReferenceForRuntimeElementAtSourceAnchor({
        runtimeElementId: entry.runtimeElementId,
        target: context.target.sourceAnchor,
        context: context.moduleSemanticContext
      })
    : null
  : ordinarySourceReference(entry, element, context);

const candidateVisibility = (
  elements: readonly CadElement[],
  evaluation: EvaluationResult,
  compiled: CompiledDslDocument,
  includeHidden: boolean
) => {
  const sourceElements = [...elements];
  const enabled = evaluation.effectiveEnabledElementIds ?? effectiveEnabledElementIds(sourceElements);
  const evaluated = evaluation.evaluatedElementIds;
  const document = compiled.document!;
  const canvasVisible = effectiveCanvasVisibleElementIds({
    elements: sourceElements,
    evaluation,
    visibilityProfiles: document.visibilityProfiles,
    activeVisibilityProfileId: document.activeVisibilityProfileId
  });
  return (elementId: ElementId) =>
    enabled.has(elementId) &&
    (includeHidden || canvasVisible.has(elementId)) &&
    (!evaluated || evaluated.has(elementId)) &&
    evaluation.computedGeometry.has(elementId);
};

const sourceExecutionEntries = (
  compiled: CompiledDslDocument,
  namespace: SourceLexicalNamespaceIndex
): ReferencePickExecutionEntry[] => {
  const statementMap = compiled.statementMap;
  if (!statementMap) return [];

  return [...statementMap.elementIdByStatementIndex.entries()].flatMap(([sourceStatementIndex, runtimeElementId]) => {
    const statement = compiled.statements[sourceStatementIndex];
    const declaration = namespace.allDeclarations.find((candidate) =>
      candidate.statementIndex === sourceStatementIndex && candidate.kind === "geometry"
    );
    if (!statement || !declaration) return [];
    return [{
      statement,
      sourceStatementId: declaration.statementId,
      sourceStatementIndex,
      runtimeElementId,
      instancePath: []
    } satisfies ReferencePickExecutionEntry];
  });
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
  target,
  includeHidden = false
}: {
  compiled: CompiledDslDocument;
  evaluation: EvaluationResult;
  target: DslReferencePickTarget;
  /** Semantic consumers may reference hidden geometry; visual pickers retain the default filter. */
  includeHidden?: boolean;
}): ReferencePickCandidate[] => {
  const document = compiled.document;
  const namespace = compiled.sourceLexicalNamespace;
  if (!document || !namespace || !compiled.statementMap) return [];
  if (target.sourceAnchor.sourceRevision !== compiled.spans.sourceMap.sourceRevision) return [];

  const materialization = compiled.moduleMaterialization;
  const elements = document.elements;
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const entriesByRuntimeId = new Map<ElementId, ReferencePickExecutionEntry>(
    sourceExecutionEntries(compiled, namespace).map((entry) => [entry.runtimeElementId, entry])
  );
  for (const entry of materialization?.executionStatements ?? []) {
    entriesByRuntimeId.set(entry.runtimeElementId, entry);
  }
  const isVisible = candidateVisibility(elements, evaluation, compiled, includeHidden);
  const moduleSemanticContext: ModuleSemanticCandidateContext | null = materialization
    ? {
        moduleMaterialization: materialization,
        moduleSemanticAnalysis: compiled.moduleSemanticAnalysis,
        sourceLexicalNamespace: namespace,
        statementInfoByElementId: compiled.statementMap.byElementId
      }
    : null;
  const context: CandidateContext = {
    target,
    namespace,
    moduleSemanticContext,
    elements
  };
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
