import { compileDslDocument, type CompiledDslDocument } from "./dslDocument";
import { parseDslSnapshot } from "./dslParser";
import {
  createDslSemanticOccurrenceIndex,
  dslSemanticIdentityKey,
  dslSemanticOccurrenceAt,
  dslSemanticDeclarationRange,
  semanticIdentityForModuleTarget,
  type DslSemanticIdentity,
  type DslSemanticOccurrenceIndex,
  type DslSemanticOccurrence
} from "./dslSemanticOccurrenceIndex";
import { queryDslReferences } from "./dslReferencesQuery";
import {
  formatDslReferencePath,
  parseDslSourceReferenceAt,
  readDslReferencePathSegments,
  type DslReferencePath
} from "./dslReferenceTokens";
import {
  resolveSourceLexicalPath,
  resolveSourceLexicalDeclaration,
  type SourceLexicalDeclaration
} from "./sourceLexicalNamespaceIndex";
import {
  resolveModuleLexicalPath,
  type ModuleLexicalParameterOverlay
} from "./moduleLexicalResolution";
import {
  isDerivedPointKeyForGeometryCategory,
  isLineEndpointPointKey
} from "../model/pointAnchors";
import {
  numericGeometryPropertySupportedByStaticTarget,
  numericGeometryStaticTargetForConstruction,
  numericGeometryStaticTargetForModuleInterface
} from "../geometry/numericGeometryProperties";
import {
  isModuleGeometryInterfaceAssignable,
  moduleGeometryInterfaceTypeOf,
  moduleGeometryInterfaceTypeOfElement,
  type ModuleGeometryInterfaceType
} from "./moduleGeometryInterfaces";
import { isGeometryDeclarationCategory, type DslGeometryDeclarationCategory } from "./dslConstructions";
import type { DslStatement } from "./dslTypes";
import type { ModuleDefinitionSemantic } from "./moduleSemanticTypes";
import type { SourceRevision, SourceSnapshot } from "./logicalStatementSourceMap";
import type { BindingAnalysis } from "../scalars/bindingAnalysis";
import { queryDslReferencePickTarget, type DslReferencePickTarget } from "./dslReferencePickQuery";

/** The exact semantic snapshot required by the retarget query. */
export type DslGeometryReferenceRetargetSemanticSnapshot = {
  sourceRevision: SourceRevision;
  sourceText?: string;
  compiled?: CompiledDslDocument;
  bindingAnalysis?: BindingAnalysis;
};

export type DslGeometryReferenceRetargetSnapshot = {
  source: SourceSnapshot;
  semantic?: DslGeometryReferenceRetargetSemanticSnapshot;
};

export type DslGeometryReferenceRetargetOccurrence = {
  /** The compiler-owned semantic occurrence range for A's path segment. */
  semanticRange: { from: number; to: number };
  /** The complete editable geometry path, excluding `@` and any property. */
  pathRange: { from: number; to: number };
  statementIndex: number;
  expectedGeometryInterface: ModuleGeometryInterfaceType;
  role: "geometry" | "endpoint" | "numericPropertyBase";
  property: string | null;
};

export type DslGeometryReferenceRetargetCandidate = {
  identity: DslSemanticIdentity;
  identityKey: string;
  name: string;
  interfaceType: ModuleGeometryInterfaceType;
  /** One correctly scoped source path per occurrence, in occurrence order. */
  referencePaths: readonly string[];
};

export type DslGeometryReferenceRetargetTarget = {
  sourceRevision: SourceRevision;
  identity: DslSemanticIdentity;
  identityKey: string;
  range: { from: number; to: number };
  declarationRange: { from: number; to: number };
  occurrences: readonly DslGeometryReferenceRetargetOccurrence[];
  candidates: readonly DslGeometryReferenceRetargetCandidate[];
};

export type DslGeometryReferenceRetargetEdit = {
  from: number;
  to: number;
  expectedText: string;
  newText: string;
};

export type DslGeometryReferenceRetargetEditPlan = {
  sourceRevision: SourceRevision;
  targetIdentity: DslSemanticIdentity;
  replacementIdentity: DslSemanticIdentity;
  edits: readonly DslGeometryReferenceRetargetEdit[];
  proposedSource: string;
};

export type DslGeometryReferenceRetargetRejection = {
  reason:
    | "stale-source"
    | "unavailable-semantics"
    | "invalid-target"
    | "incomplete-references"
    | "candidate-not-found"
    | "incompatible-candidate"
    | "unreachable-candidate"
    | "proposed-source-verification-failed";
};

export type DslGeometryReferenceRetargetEditPlanResult =
  | { status: "ok"; plan: DslGeometryReferenceRetargetEditPlan }
  | { status: "rejected"; rejection: DslGeometryReferenceRetargetRejection };

type ExactSnapshot = {
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
};

type SourceGeometryCandidate = {
  identity: DslSemanticIdentity;
  identityKey: string;
  name: string;
  interfaceType: ModuleGeometryInterfaceType;
  statementIndex: number;
  ownerModuleDefinitionIndex: number | null;
  declaration: SourceLexicalDeclaration;
  category: DslGeometryDeclarationCategory;
  moduleExportAliases: ModuleExportAlias[];
};

type ModuleExportAlias = {
  instanceStatementId: string;
  instanceStatementIndex: number;
  instanceName: string;
  ownerModuleDefinitionIndex: number | null;
  exportName: string;
};

type ModuleParameterCandidate = {
  identity: DslSemanticIdentity;
  identityKey: string;
  name: string;
  interfaceType: ModuleGeometryInterfaceType;
  statementIndex: number;
  ownerModuleDefinitionIndex: number;
  parameterIndex: number;
};

type GeometryCandidate = SourceGeometryCandidate | ModuleParameterCandidate;
type ModuleSemanticParameter = ModuleDefinitionSemantic["parameters"][number];

type ParsedOccurrence = DslGeometryReferenceRetargetOccurrence & {
  semanticOccurrence: DslSemanticOccurrence;
};

type CandidateResolution = {
  path: string;
};

const semanticSourceText = (semantic: DslGeometryReferenceRetargetSemanticSnapshot) =>
  semantic.sourceText ?? semantic.compiled?.spans.sourceMap.source;

const exactSnapshot = (
  snapshot: DslGeometryReferenceRetargetSnapshot
): { snapshot: ExactSnapshot; rejection: null } | { snapshot: null; rejection: DslGeometryReferenceRetargetRejection } => {
  const { source, semantic } = snapshot;
  if (source.normalizedSource.includes("\r") || semantic?.sourceRevision !== source.sourceRevision) {
    return { snapshot: null, rejection: { reason: "stale-source" } };
  }
  if (!semantic?.compiled || semanticSourceText(semantic) !== source.normalizedSource) {
    return { snapshot: null, rejection: { reason: "unavailable-semantics" } };
  }
  const compiled = semantic.bindingAnalysis && semantic.compiled.bindingAnalysis !== semantic.bindingAnalysis
    ? { ...semantic.compiled, bindingAnalysis: semantic.bindingAnalysis }
    : semantic.compiled;
  if (
    compiled.spans.sourceMap.source !== source.normalizedSource ||
    compiled.spans.sourceMap.sourceRevision !== source.sourceRevision ||
    !compiled.statementMap ||
    compiled.statementMap.sourceRevision !== source.sourceRevision ||
    !compiled.sourceLexicalNamespace
  ) {
    return { snapshot: null, rejection: { reason: "unavailable-semantics" } };
  }
  return { snapshot: { source, compiled }, rejection: null };
};

const moduleOwnerIndexOf = (statements: readonly DslStatement[], statementIndex: number): number | null => {
  const visited = new Set<number>();
  let enclosing = statements[statementIndex]?.enclosing ?? null;
  while (enclosing && !visited.has(enclosing.statementIndex)) {
    visited.add(enclosing.statementIndex);
    if (statements[enclosing.statementIndex]?.kind === "moduleDefinition") return enclosing.statementIndex;
    enclosing = statements[enclosing.statementIndex]?.enclosing ?? null;
  }
  return null;
};

const statementIndexAt = (compiled: CompiledDslDocument, from: number, to: number): number | null => {
  const matches = compiled.statements.flatMap((statement, statementIndex) =>
    statement.physicalSpan.segments.some((segment) => from >= segment.from && to <= segment.to)
      ? [statementIndex]
      : []
  );
  return matches.length === 1 ? matches[0]! : null;
};

const namespacePathForDeclaration = (
  compiled: CompiledDslDocument,
  declaration: SourceLexicalDeclaration
): readonly string[] => {
  const namespace = compiled.sourceLexicalNamespace;
  if (!namespace) return [declaration.name];
  const names: string[] = [];
  let scopeId = declaration.scopeId;
  const visited = new Set<string>();
  while (!visited.has(scopeId)) {
    visited.add(scopeId);
    const scope = namespace.scopeIndex.scopes.get(scopeId);
    if (!scope) break;
    if (scope.kind === "group" || scope.kind === "forGroup" || scope.kind === "then" || scope.kind === "else") {
      const opening = scope.openingStatementIndex === null
        ? undefined
        : compiled.statements[scope.openingStatementIndex];
      if (opening?.name) names.unshift(opening.name);
    }
    if (!scope.parentId) break;
    scopeId = scope.parentId;
  }
  names.push(declaration.name);
  return names;
};

const geometryCandidatesFor = (compiled: CompiledDslDocument): GeometryCandidate[] => {
  const namespace = compiled.sourceLexicalNamespace;
  const candidates = new Map<string, GeometryCandidate>();
  if (!namespace) return [];

  for (const declaration of namespace.allDeclarations) {
    if (
      declaration.kind !== "geometry" ||
      declaration.statement.kind !== "element" ||
      !isGeometryDeclarationCategory(declaration.statement.category)
    ) continue;
    const interfaceType = moduleGeometryInterfaceTypeOfElement(declaration.statement);
    if (!interfaceType) continue;
    const identity = semanticIdentityForModuleTarget(compiled, {
      kind: "moduleSource",
      statementId: declaration.statementId
    });
    if (!identity) continue;
    const identityKey = dslSemanticIdentityKey(identity);
    candidates.set(identityKey, {
      identity,
      identityKey,
      name: declaration.name,
      interfaceType,
      statementIndex: declaration.statementIndex,
      ownerModuleDefinitionIndex: moduleOwnerIndexOf(compiled.statements, declaration.statementIndex),
      declaration,
      category: declaration.statement.category,
      moduleExportAliases: []
    });
  }

  const analysis = compiled.moduleSemanticAnalysis ?? compiled.sourceSemanticAnalysis;
  for (const definition of analysis?.definitions ?? []) {
    for (const [parameterIndex, parameter] of definition.parameters.entries()) {
      const interfaceType = moduleGeometryInterfaceTypeOf(parameter.type);
      if (!interfaceType) continue;
      const identity = semanticIdentityForModuleTarget(compiled, {
        kind: "moduleParameter",
        slot: {
          definitionStatementId: definition.statementId,
          parameterIndex
        }
      });
      if (!identity) continue;
      const identityKey = dslSemanticIdentityKey(identity);
      candidates.set(identityKey, {
        identity,
        identityKey,
        name: parameter.name,
        interfaceType,
        statementIndex: definition.statementIndex,
        ownerModuleDefinitionIndex: definition.statementIndex,
        parameterIndex
      });
    }
  }

  // A module export can be reached through any current same-document module
  // instance. Keep the export's semantic identity as B, while retaining the
  // instance path as an existing compiler-owned lexical alias for later path
  // generation.
  const moduleAnalysis = compiled.moduleSemanticAnalysis;
  if (moduleAnalysis) {
    for (const instance of moduleAnalysis.instances) {
      if (!instance.callee) continue;
      const definition = moduleAnalysis.definitionsByStatementId.get(instance.callee.definitionStatementId);
      if (!definition) continue;
      for (const exported of definition.exports) {
        if (exported.kind !== "geometry") continue;
        const identity = semanticIdentityForModuleTarget(compiled, {
          kind: "moduleSource",
          statementId: exported.exportedStatementId
        });
        if (!identity) continue;
        const candidate = candidates.get(dslSemanticIdentityKey(identity));
        if (!candidate || !("declaration" in candidate)) continue;
        candidate.moduleExportAliases.push({
          instanceStatementId: instance.statementId,
          instanceStatementIndex: instance.statementIndex,
          instanceName: instance.name,
          ownerModuleDefinitionIndex: moduleOwnerIndexOf(compiled.statements, instance.statementIndex),
          exportName: exported.name
        });
      }
    }
  }

  return [...candidates.values()].sort((left, right) =>
    left.statementIndex - right.statementIndex || left.identityKey.localeCompare(right.identityKey)
  );
};

const moduleParameterOverlaysFor = (
  analysis: { definitions: readonly ModuleDefinitionSemantic[] } | undefined
): readonly ModuleLexicalParameterOverlay<ModuleSemanticParameter, ModuleDefinitionSemantic>[] =>
  (analysis?.definitions ?? []).map((definition) => ({
    bodyScopeId: definition.bodyScopeId,
    value: definition,
    parameters: definition.parameters.map((parameter, index) => ({ index, name: parameter.name, value: parameter }))
  }));

// The candidate union above is intentionally kept free of compiled state in
// its public shape. Attach it only in this private helper so path generation
// continues to use the current lexical owner, not authored-name matching.
const candidatePathOptionsFor = (
  compiled: CompiledDslDocument,
  candidate: GeometryCandidate
): readonly DslReferencePath[] => {
  if ("declaration" in candidate) {
    const full = [...namespacePathForDeclaration(compiled, candidate.declaration)];
    const result: DslReferencePath[] = [{ absolute: false, segments: [candidate.name] }];
    for (let index = full.length - 2; index >= 0; index -= 1) {
      result.push({ absolute: false, segments: full.slice(index) });
    }
    result.push({ absolute: true, segments: full });
    return result;
  }
  return [{ absolute: false, segments: [candidate.name] }];
};

const sourceDeclarationIdentity = (
  compiled: CompiledDslDocument,
  declaration: SourceLexicalDeclaration
): DslSemanticIdentity | null => semanticIdentityForModuleTarget(compiled, {
  kind: "moduleSource",
  statementId: declaration.statementId
});

const moduleExportAliasResolvesToCandidate = (
  compiled: CompiledDslDocument,
  occurrence: ParsedOccurrence,
  alias: ModuleExportAlias,
  candidate: SourceGeometryCandidate
) => {
  const occurrenceOwner = moduleOwnerIndexOf(compiled.statements, occurrence.statementIndex);
  if (alias.ownerModuleDefinitionIndex !== occurrenceOwner) return false;
  const sourceNamespace = compiled.sourceLexicalNamespace;
  if (!sourceNamespace) return false;
  const statementIds = compiled.statementMap?.statementIdByStatementIndex;
  const analysis = compiled.moduleSemanticAnalysis;
  if (!statementIds || !analysis) return false;
  const path = { absolute: false, segments: [alias.instanceName] };
  const lookup = occurrenceOwner === null
    ? resolveSourceLexicalDeclaration(sourceNamespace, occurrence.statementIndex, alias.instanceName)
    : resolveModuleLexicalPath(
        {
          sourceNamespace,
          stableStatementIdByIndex: statementIds,
          parameterOverlays: moduleParameterOverlaysFor(analysis)
        },
        occurrence.statementIndex,
        path
      );
  if (lookup.kind !== "resolved" || lookup.declaration.kind !== "moduleInstance" || lookup.declaration.statementId !== alias.instanceStatementId) return false;
  const instance = analysis.instancesByStatementId.get(alias.instanceStatementId);
  const exported = instance?.callee
    ? analysis.definitionsByStatementId.get(instance.callee.definitionStatementId)?.exports.find((entry) =>
        entry.kind === "geometry" && entry.name === alias.exportName
      )
    : undefined;
  if (!exported || exported.kind !== "geometry") return false;
  const identity = semanticIdentityForModuleTarget(compiled, {
    kind: "moduleSource",
    statementId: exported.exportedStatementId
  });
  return identity ? dslSemanticIdentityKey(identity) === candidate.identityKey : false;
};

const lookupMatchesCandidate = (
  compiled: CompiledDslDocument,
  lookup: ReturnType<typeof resolveSourceLexicalPath> | ReturnType<typeof resolveModuleLexicalPath<ModuleSemanticParameter, ModuleDefinitionSemantic>>,
  candidate: GeometryCandidate
) => {
  if ("declaration" in lookup && lookup.kind === "resolved") {
    const identity = sourceDeclarationIdentity(compiled, lookup.declaration);
    return identity ? dslSemanticIdentityKey(identity) === candidate.identityKey : false;
  }
  if (lookup.kind === "parameter") {
    const target = lookup.parameter;
    const identity = semanticIdentityForModuleTarget(compiled, {
      kind: "moduleParameter",
      slot: {
        definitionStatementId: lookup.definition.value.statementId,
        parameterIndex: target.index
      }
    });
    return identity ? dslSemanticIdentityKey(identity) === candidate.identityKey : false;
  }
  return false;
};

const resolveCandidatePath = (
  compiled: CompiledDslDocument,
  occurrence: ParsedOccurrence,
  candidate: GeometryCandidate
): CandidateResolution | null => {
  const occurrenceOwner = moduleOwnerIndexOf(compiled.statements, occurrence.statementIndex);
  const sourceNamespace = compiled.sourceLexicalNamespace;
  const statementIds = compiled.statementMap?.statementIdByStatementIndex;
  if (!sourceNamespace || !statementIds) return null;
  const analysis = compiled.moduleSemanticAnalysis ?? compiled.sourceSemanticAnalysis;
  const overlays = moduleParameterOverlaysFor(analysis);
  if (candidate.ownerModuleDefinitionIndex === occurrenceOwner) {
    for (const path of candidatePathOptionsFor(compiled, candidate)) {
      const lookup = occurrenceOwner === null
        ? resolveSourceLexicalPath(sourceNamespace, occurrence.statementIndex, path)
        : resolveModuleLexicalPath(
            {
              sourceNamespace,
              stableStatementIdByIndex: statementIds,
              parameterOverlays: overlays
            },
            occurrence.statementIndex,
            path
          );
      if (lookupMatchesCandidate(compiled, lookup, candidate)) {
        return { path: formatDslReferencePath(path) };
      }
    }
  }
  if ("declaration" in candidate) {
    for (const alias of candidate.moduleExportAliases) {
      if (moduleExportAliasResolvesToCandidate(compiled, occurrence, alias, candidate)) {
        return { path: formatDslReferencePath({ absolute: false, segments: [alias.instanceName, alias.exportName] }) };
      }
    }
  }
  return null;
};

const candidateSupportsOccurrence = (
  candidate: GeometryCandidate,
  occurrence: ParsedOccurrence
) => {
  if (occurrence.role === "numericPropertyBase") {
    const target = "declaration" in candidate
      ? numericGeometryStaticTargetForConstruction(
          candidate.category,
          candidate.declaration.statement.kind === "element"
            ? candidate.declaration.statement.construction
            : ""
        )
      : numericGeometryStaticTargetForModuleInterface(candidate.interfaceType);
    return isModuleGeometryInterfaceAssignable(candidate.interfaceType, "path") &&
      occurrence.property !== null &&
      numericGeometryPropertySupportedByStaticTarget(target, occurrence.property);
  }

  if (occurrence.role === "endpoint") {
    if (!isModuleGeometryInterfaceAssignable(candidate.interfaceType, "path") || !occurrence.property || !isLineEndpointPointKey(occurrence.property)) return false;
    return "declaration" in candidate
      ? isDerivedPointKeyForGeometryCategory(candidate.category, occurrence.property)
      : true;
  }

  if (occurrence.property) {
    if ("declaration" in candidate) {
      return isDerivedPointKeyForGeometryCategory(candidate.category, occurrence.property);
    }
    return isLineEndpointPointKey(occurrence.property) &&
      isModuleGeometryInterfaceAssignable(candidate.interfaceType, "path");
  }
  return isModuleGeometryInterfaceAssignable(candidate.interfaceType, occurrence.expectedGeometryInterface);
};

const parseOccurrence = (
  source: SourceSnapshot,
  compiled: CompiledDslDocument,
  occurrence: DslSemanticOccurrence
): ParsedOccurrence | null => {
  const statementIndex = statementIndexAt(compiled, occurrence.from, occurrence.to);
  if (statementIndex === null) return null;
  const positionCandidates = [occurrence.from + 1, occurrence.to, occurrence.from]
    .filter((position, index, positions) => position >= 0 && position <= source.normalizedSource.length && positions.indexOf(position) === index);
  const pickTarget = positionCandidates
    .map((position) => queryDslReferencePickTarget({
      source,
      position,
      semantic: {
        sourceRevision: source.sourceRevision,
        sourceText: source.normalizedSource,
        compiled
      }
    }))
    .find((target): target is DslReferencePickTarget => Boolean(target && target.sourceAnchor.statementIndex === statementIndex && target.range.from <= occurrence.from && target.range.to >= occurrence.to));
  if (!pickTarget) return null;

  const at = source.normalizedSource.lastIndexOf("@", occurrence.from);
  if (at < 0) return null;
  const parsed = parseDslSourceReferenceAt(source.normalizedSource, at);
  if (parsed.kind !== "valid") return null;
  const ranges = readDslReferencePathSegments(
    source.normalizedSource,
    parsed.reference.pathRange.start,
    parsed.reference.pathRange.end
  );
  if (ranges.kind !== "valid" || ranges.segments.length !== parsed.reference.path.segments.length) return null;
  const finalSegment = ranges.segments.at(-1);
  if (!finalSegment || finalSegment.start !== occurrence.from || finalSegment.end !== occurrence.to) return null;
  if (pickTarget.sourceAnchor.statementIndex !== statementIndex) return null;
  return {
    semanticOccurrence: occurrence,
    semanticRange: { from: occurrence.from, to: occurrence.to },
    pathRange: { from: parsed.reference.pathRange.start, to: parsed.reference.pathRange.end },
    statementIndex,
    expectedGeometryInterface: pickTarget.expectedGeometryInterface,
    role: pickTarget.role,
    property: parsed.reference.property,
  };
};

const editsAreSafe = (edits: readonly DslGeometryReferenceRetargetEdit[]) => {
  const ordered = [...edits].sort((left, right) => left.from - right.from || left.to - right.to);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index]!.from < ordered[index - 1]!.to) return false;
  }
  return new Set(ordered.map((edit) => `${edit.from}:${edit.to}`)).size === ordered.length;
};

const applyEdits = (source: string, edits: readonly DslGeometryReferenceRetargetEdit[]) =>
  [...edits]
    .sort((left, right) => right.from - left.from || right.to - left.to)
    .reduce((current, edit) => `${current.slice(0, edit.from)}${edit.newText}${current.slice(edit.to)}`, source);

type CandidateEditProjection =
  | {
      ok: true;
      edits: readonly DslGeometryReferenceRetargetEdit[];
      proposedSource: string;
    }
  | {
      ok: false;
      reason: "incomplete-references" | "stale-source" | "unreachable-candidate";
    };

/** Build the exact source projection shared by candidate applicability and
 * the final plan. It only consumes ranges and paths already proven by the
 * semantic/lexical owners above. */
const candidateEditProjection = (
  source: SourceSnapshot,
  target: Pick<DslGeometryReferenceRetargetTarget, "occurrences">,
  candidate: DslGeometryReferenceRetargetCandidate
): CandidateEditProjection => {
  if (candidate.referencePaths.length !== target.occurrences.length) {
    return { ok: false, reason: "unreachable-candidate" };
  }
  const edits = target.occurrences.map((occurrence, index) => ({
    from: occurrence.pathRange.from,
    to: occurrence.pathRange.to,
    expectedText: source.normalizedSource.slice(occurrence.pathRange.from, occurrence.pathRange.to),
    newText: candidate.referencePaths[index]!
  }));
  if (edits.some((edit) =>
    edit.from < 0 ||
    edit.to <= edit.from ||
    edit.to > source.normalizedSource.length ||
    !edit.expectedText
  )) {
    return { ok: false, reason: "incomplete-references" };
  }
  if (edits.some((edit) => source.normalizedSource.slice(edit.from, edit.to) !== edit.expectedText)) {
    return { ok: false, reason: "stale-source" };
  }
  return { ok: true, edits, proposedSource: applyEdits(source.normalizedSource, edits) };
};

const compilerGeometryIdentityIsUsable = (
  compiled: CompiledDslDocument,
  identity: DslSemanticIdentity
) => {
  if (identity.kind !== "element") return true;
  const element = compiled.document?.elements.find((candidate) => candidate.id === identity.elementId);
  return element !== undefined && element.activity !== "disabled";
};

const targetFor = (
  exact: ExactSnapshot,
  sourceOffset: number
): DslGeometryReferenceRetargetTarget | null => {
  if (sourceOffset < 0 || sourceOffset >= exact.source.normalizedSource.length) return null;
  const index = createDslSemanticOccurrenceIndex(exact.compiled, exact.compiled.bindingAnalysis);
  const selected = dslSemanticOccurrenceAt(index, sourceOffset);
  if (!selected || selected.kind !== "reference") return null;

  const references = queryDslReferences({
    source: exact.source,
    position: sourceOffset,
    semantic: {
      sourceRevision: exact.source.sourceRevision,
      sourceText: exact.source.normalizedSource,
      compiled: exact.compiled
    }
  });
  if (!references) return null;

  const candidates = geometryCandidatesFor(exact.compiled);
  const candidateByIdentity = new Map(candidates.map((candidate) => [candidate.identityKey, candidate]));
  const identityKey = dslSemanticIdentityKey(selected.identity);
  if (!candidateByIdentity.has(identityKey)) return null;
  const declarationRange = dslSemanticDeclarationRange(index, selected.identity);
  if (!declarationRange) return null;

  const referenceOccurrences = index.occurrences.filter((occurrence) =>
    occurrence.kind === "reference" && dslSemanticIdentityKey(occurrence.identity) === identityKey
  );
  if (referenceOccurrences.length === 0) return null;
  const referenceRangeKeys = new Set(references.referenceRanges.map((range) => `${range.from}:${range.to}`));
  if (
    referenceRangeKeys.size !== referenceOccurrences.length ||
    referenceOccurrences.some((occurrence) => !referenceRangeKeys.has(`${occurrence.from}:${occurrence.to}`))
  ) return null;
  const parsedOccurrences = referenceOccurrences.map((occurrence) => parseOccurrence(exact.source, exact.compiled, occurrence));
  if (parsedOccurrences.some((occurrence): occurrence is null => occurrence === null)) return null;
  const occurrences = parsedOccurrences as ParsedOccurrence[];
  const target = {
    sourceRevision: exact.source.sourceRevision,
    identity: selected.identity,
    identityKey,
    range: { from: selected.from, to: selected.to },
    declarationRange,
    occurrences: occurrences.map(({ semanticOccurrence, pathRange, statementIndex, expectedGeometryInterface, role, property }) => ({
      semanticRange: { from: semanticOccurrence.from, to: semanticOccurrence.to },
      pathRange,
      statementIndex,
      expectedGeometryInterface,
      role,
      property
    })),
    candidates: [] as DslGeometryReferenceRetargetCandidate[]
  } satisfies Omit<DslGeometryReferenceRetargetTarget, "candidates"> & {
    candidates: DslGeometryReferenceRetargetCandidate[];
  };
  const applicableCandidates: DslGeometryReferenceRetargetCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.identityKey === identityKey) continue;
    if (!compilerGeometryIdentityIsUsable(exact.compiled, candidate.identity)) continue;
    const resolutions = occurrences.map((occurrence) =>
      candidateSupportsOccurrence(candidate, occurrence)
        ? resolveCandidatePath(exact.compiled, occurrence, candidate)
        : null
    );
    if (resolutions.every((resolution): resolution is CandidateResolution => resolution !== null)) {
      const publicCandidate = {
        identity: candidate.identity,
        identityKey: candidate.identityKey,
        name: candidate.name,
        interfaceType: candidate.interfaceType,
        referencePaths: resolutions.map((resolution) => resolution.path)
      } satisfies DslGeometryReferenceRetargetCandidate;
      applicableCandidates.push(publicCandidate);
    }
  }

  return {
    ...target,
    candidates: applicableCandidates
  };
};

export const queryDslGeometryReferenceRetargetTarget = (
  snapshot: DslGeometryReferenceRetargetSnapshot,
  sourceOffset: number
): DslGeometryReferenceRetargetTarget | null => {
  const exact = exactSnapshot(snapshot);
  if (!exact.snapshot) return null;
  try {
    return targetFor(exact.snapshot, sourceOffset);
  } catch {
    return null;
  }
};

const mapsMatch = <Value>(before: ReadonlyMap<number, Value>, after: ReadonlyMap<number, Value>) =>
  before.size === after.size && [...before].every(([index, value]) => after.get(index) === value);

const mappedRangeAfterEdits = (
  range: { from: number; to: number },
  edits: readonly DslGeometryReferenceRetargetEdit[]
) => {
  const delta = edits
    .filter((edit) => edit.from < range.from)
    .reduce((sum, edit) => sum + edit.newText.length - (edit.to - edit.from), 0);
  const edit = edits.find((candidate) => candidate.from === range.from && candidate.to === range.to);
  return edit
    ? { from: range.from + delta, to: range.from + delta + edit.newText.length }
    : null;
};

const proposedSourceIsVerified = (
  exact: ExactSnapshot,
  target: DslGeometryReferenceRetargetTarget,
  replacement: DslGeometryReferenceRetargetCandidate,
  edits: readonly DslGeometryReferenceRetargetEdit[],
  proposedSource: string
) => {
  if (!editsAreSafe(edits)) return false;
  if (applyEdits(exact.source.normalizedSource, edits) !== proposedSource) return false;
  const statementMap = exact.compiled.statementMap;
  if (!statementMap) return false;
  let after: CompiledDslDocument;
  try {
    const parsed = parseDslSnapshot({ normalizedSource: proposedSource, sourceRevision: exact.source.sourceRevision });
    after = compileDslDocument(proposedSource, {
      preparsed: parsed,
      sourceRevision: exact.source.sourceRevision,
      assignedElementIds: statementMap.elementIdByStatementIndex,
      assignedStatementIds: statementMap.statementIdByStatementIndex
    });
  } catch {
    return false;
  }
  if (
    after.diagnostics.some((diagnostic) => diagnostic.severity === "error") ||
    !after.document ||
    !after.statementMap ||
    !after.sourceLexicalNamespace ||
    after.spans.sourceMap.source !== proposedSource ||
    after.spans.sourceMap.sourceRevision !== exact.source.sourceRevision ||
    !mapsMatch(statementMap.elementIdByStatementIndex, after.statementMap.elementIdByStatementIndex) ||
    (statementMap.statementIdByStatementIndex &&
      (!after.statementMap.statementIdByStatementIndex ||
        !mapsMatch(statementMap.statementIdByStatementIndex, after.statementMap.statementIdByStatementIndex)))
  ) return false;
  if (!compilerGeometryIdentityIsUsable(after, replacement.identity)) return false;

  let beforeIndex: DslSemanticOccurrenceIndex;
  let afterIndex: DslSemanticOccurrenceIndex;
  try {
    beforeIndex = createDslSemanticOccurrenceIndex(exact.compiled, exact.compiled.bindingAnalysis);
    afterIndex = createDslSemanticOccurrenceIndex(after, after.bindingAnalysis);
  } catch {
    return false;
  }
  const targetKey = target.identityKey;
  const replacementKey = replacement.identityKey;
  const beforeTargetReferences = beforeIndex.occurrences.filter((occurrence) =>
    occurrence.kind === "reference" && dslSemanticIdentityKey(occurrence.identity) === targetKey
  );
  if (beforeTargetReferences.length !== target.occurrences.length) return false;
  if (afterIndex.occurrences.some((occurrence) =>
    occurrence.kind === "reference" && dslSemanticIdentityKey(occurrence.identity) === targetKey
  )) return false;

  const beforeDeclaration = dslSemanticDeclarationRange(beforeIndex, target.identity);
  const afterDeclaration = dslSemanticDeclarationRange(afterIndex, target.identity);
  if (!beforeDeclaration || !afterDeclaration) return false;
  if (exact.source.normalizedSource.slice(beforeDeclaration.from, beforeDeclaration.to) !==
      proposedSource.slice(afterDeclaration.from, afterDeclaration.to)) return false;

  for (const edit of edits) {
    const afterRange = mappedRangeAfterEdits(edit, edits);
    if (!afterRange || proposedSource.slice(afterRange.from, afterRange.to) !== edit.newText) return false;
    const parsedReference = parseDslSourceReferenceAt(proposedSource, afterRange.from - 1);
    if (parsedReference.kind !== "valid" ||
        parsedReference.reference.pathRange.start !== afterRange.from ||
        parsedReference.reference.pathRange.end !== afterRange.to) return false;
    const ranges = readDslReferencePathSegments(
      proposedSource,
      parsedReference.reference.pathRange.start,
      parsedReference.reference.pathRange.end
    );
    if (ranges.kind !== "valid") return false;
    const finalSegment = ranges.segments.at(-1);
    if (!finalSegment) return false;
    const occurrence = afterIndex.occurrences.find((candidateOccurrence) =>
      candidateOccurrence.kind === "reference" &&
      dslSemanticIdentityKey(candidateOccurrence.identity) === replacementKey &&
      candidateOccurrence.from === finalSegment.start &&
      candidateOccurrence.to === finalSegment.end
    );
    if (!occurrence) return false;
  }

  const verifiedReplacementReferences = afterIndex.occurrences.filter((occurrence) =>
    occurrence.kind === "reference" && dslSemanticIdentityKey(occurrence.identity) === replacementKey
  );
  return verifiedReplacementReferences.length >= edits.length;
};

const rejection = (reason: DslGeometryReferenceRetargetRejection["reason"]): DslGeometryReferenceRetargetEditPlanResult => ({
  status: "rejected",
  rejection: { reason }
});

export const planDslGeometryReferenceRetargetEditsResult = (
  snapshot: DslGeometryReferenceRetargetSnapshot,
  sourceOffset: number,
  replacementIdentity: DslSemanticIdentity
): DslGeometryReferenceRetargetEditPlanResult => {
  const exact = exactSnapshot(snapshot);
  if (!exact.snapshot) return rejection(exact.rejection.reason);
  let target: DslGeometryReferenceRetargetTarget | null;
  try {
    target = targetFor(exact.snapshot, sourceOffset);
  } catch {
    return rejection("unavailable-semantics");
  }
  if (!target) return rejection("invalid-target");
  const replacementKey = dslSemanticIdentityKey(replacementIdentity);
  const candidate = target.candidates.find((entry) => entry.identityKey === replacementKey);
  if (!candidate) return rejection("candidate-not-found");
  const projection = candidateEditProjection(exact.snapshot.source, target, candidate);
  if (!projection.ok) return rejection(projection.reason);
  const { edits, proposedSource } = projection;
  if (!proposedSourceIsVerified(exact.snapshot, target, candidate, edits, proposedSource)) {
    return rejection("proposed-source-verification-failed");
  }
  return {
    status: "ok",
    plan: {
      sourceRevision: exact.snapshot.source.sourceRevision,
      targetIdentity: target.identity,
      replacementIdentity: candidate.identity,
      edits,
      proposedSource
    }
  };
};

/** Nullable convenience wrapper for hosts that only need an applicable plan. */
export const planDslGeometryReferenceRetargetEdits = (
  snapshot: DslGeometryReferenceRetargetSnapshot,
  sourceOffset: number,
  replacementIdentity: DslSemanticIdentity
): DslGeometryReferenceRetargetEditPlan | null => {
  const result = planDslGeometryReferenceRetargetEditsResult(snapshot, sourceOffset, replacementIdentity);
  return result.status === "ok" ? result.plan : null;
};
