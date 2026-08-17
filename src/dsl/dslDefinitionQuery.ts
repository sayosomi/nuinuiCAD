import type { BindingAnalysis } from "../scalars/bindingAnalysis";
import type { BindingId } from "../scalars/bindingCatalog";
import { referencesIn } from "../scalars/typedDependencyGraph";
import type { ScalarValueSource } from "../scalars/propertyBindingCompiler";
import { parsePropertyBindingOccurrenceKey } from "../scalars/propertyBindingCompiler";
import type { CompiledNumericBinding } from "../scalars/numericBindingCompiler";
import type { TypedScalarExpression } from "../scalars/typedExpressionAst";
import { exactPhysicalSpan } from "./dslDiagnosticSpan";
import type { CompiledDslDocument } from "./dslDocument";
import type { SourceRevision, SourceSnapshot, DslPhysicalSpan } from "./logicalStatementSourceMap";
import {
  createModuleSemanticRangeIndex,
  moduleSemanticDeclarationRange,
  moduleSemanticTargetAt,
  moduleSemanticTargetKey,
  type ModuleSemanticRangeIndex
} from "./moduleSemanticEditor";

export type DslDefinitionRange = { from: number; to: number };

export type DslDefinitionSemanticSnapshot = {
  /** Source revision that produced this semantic snapshot. */
  sourceRevision: SourceRevision;
  /** Optional exact source proof. When omitted, compiled.spans.sourceMap.source is used. */
  sourceText?: string;
  /** Production source semantics for the exact source snapshot. */
  compiled?: CompiledDslDocument;
  /** Optional explicit binding analysis for callers that already hold it. */
  bindingAnalysis?: BindingAnalysis;
};

export type DslDefinitionQueryInput = {
  source: SourceSnapshot;
  position: number;
  semantic?: DslDefinitionSemanticSnapshot;
};

export type DslDefinitionQueryResult = {
  /** Exact source range of the reference identifier, excluding `@`. */
  referenceRange: DslDefinitionRange;
  /** Exact source range of the resolved declaration identifier. */
  declarationRange: DslDefinitionRange;
};

type DefinitionCandidate = {
  referenceRange: DslDefinitionRange;
  declarationRange: DslDefinitionRange;
};

const semanticSourceText = (semantic: DslDefinitionSemanticSnapshot) =>
  semantic.sourceText ?? semantic.compiled?.spans.sourceMap.source;

const semanticIsExact = (source: SourceSnapshot, semantic: DslDefinitionSemanticSnapshot | undefined) => {
  if (!semantic || semantic.sourceRevision !== source.sourceRevision) return false;
  if (semanticSourceText(semantic) !== source.normalizedSource) return false;
  // An explicit sourceText is useful as a proof carried beside a semantic
  // result, but it cannot make a compiled source map from a different source
  // safe for source-range projection.
  return !semantic.compiled || (
    semantic.compiled.spans.sourceMap.source === source.normalizedSource &&
    semantic.compiled.spans.sourceMap.sourceRevision === source.sourceRevision
  );
};

const singlePhysicalRange = (span: DslPhysicalSpan | null | undefined): DslDefinitionRange | null => {
  if (!span || span.segments.length !== 1) return null;
  const [segment] = span.segments;
  return segment ? { from: segment.from, to: segment.to } : null;
};

const physicalRangeFor = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  span: { start: number; end: number }
) => singlePhysicalRange(exactPhysicalSpan(compiled.spans, compiled.statements[statementIndex]!, span));

const declarationRangeForBinding = (
  compiled: CompiledDslDocument,
  bindingAnalysis: BindingAnalysis,
  bindingId: BindingId
): DslDefinitionRange | null => {
  const binding = bindingAnalysis.catalog.bindingsById.get(bindingId);
  if (!binding || binding.nameSpan === null) return null;
  const statement = compiled.statements[binding.statementIndex];
  if (!statement) return null;
  return singlePhysicalRange(statement.namePhysicalSpan) ?? physicalRangeFor(compiled, binding.statementIndex, binding.nameSpan);
};

const physicalReferenceRange = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  span: { start: number; end: number }
) => physicalRangeFor(compiled, statementIndex, span);

const declarationRangeForStatementIdentity = (
  compiled: CompiledDslDocument,
  statementId: string
): DslDefinitionRange | null => {
  const declaration = compiled.sourceLexicalNamespace?.allDeclarations.find(
    (candidate) => candidate.statementId === statementId
  );
  if (!declaration) return null;
  const statement = compiled.statements[declaration.statementIndex];
  if (!statement) return null;
  const nameSpan = declaration.nameSpan ?? statement.nameSpan;
  if (!nameSpan) return null;
  return singlePhysicalRange(statement.namePhysicalSpan) ?? physicalRangeFor(compiled, declaration.statementIndex, nameSpan);
};

const rootGeometryPropertyCandidates = (compiled: CompiledDslDocument): DefinitionCandidate[] => {
  const candidates: DefinitionCandidate[] = [];
  const statementIndexById = compiled.statementMap?.statementIndexByStatementId;
  for (const [statementId, site] of compiled.moduleSemanticAnalysis?.rootScalarExpressionsByStatementId ?? []) {
    const statementIndex = statementIndexById?.get(statementId);
    if (statementIndex === undefined) continue;
    for (const reference of site.expression.geometryProperties) {
      if (reference.target?.kind !== "sourceGeometryProperty") continue;
      const referenceRange = physicalReferenceRange(compiled, statementIndex, reference.elementNameSpan);
      const declarationRange = declarationRangeForStatementIdentity(compiled, reference.target.statementId);
      if (referenceRange && declarationRange) candidates.push({ referenceRange, declarationRange });
    }
  }
  return candidates;
};

const bindingCandidatesFromExpression = (
  compiled: CompiledDslDocument,
  bindingAnalysis: BindingAnalysis,
  statementIndex: number,
  expression: TypedScalarExpression
): DefinitionCandidate[] => {
  const candidates: DefinitionCandidate[] = [];
  for (const reference of referencesIn(expression)) {
    if (!reference.bindingId) continue;
    if (statementIndex < 0) continue;
    const referenceRange = physicalReferenceRange(compiled, statementIndex, reference.nameSpan);
    const declarationRange = declarationRangeForBinding(compiled, bindingAnalysis, reference.bindingId);
    if (referenceRange && declarationRange) candidates.push({ referenceRange, declarationRange });
  }
  return candidates;
};

const bindingCandidatesFromNumeric = (
  compiled: CompiledDslDocument,
  bindingAnalysis: BindingAnalysis,
  numeric: CompiledNumericBinding
): DefinitionCandidate[] => numeric.references.flatMap((reference) => {
  const referenceRange = singlePhysicalRange(reference.physicalNameSpan);
  const declarationRange = declarationRangeForBinding(compiled, bindingAnalysis, reference.bindingId);
  return referenceRange && declarationRange ? [{ referenceRange, declarationRange }] : [];
});

const bindingCandidatesFromSource = (
  compiled: CompiledDslDocument,
  bindingAnalysis: BindingAnalysis,
  source: ScalarValueSource,
  statementIndex: number
): DefinitionCandidate[] => {
  if (source.kind === "binding") {
    const referenceRange = physicalReferenceRange(compiled, statementIndex, source.nameSpan);
    const declarationRange = declarationRangeForBinding(compiled, bindingAnalysis, source.bindingId);
    return referenceRange && declarationRange ? [{ referenceRange, declarationRange }] : [];
  }
  if (source.kind === "expression") return bindingCandidatesFromExpression(compiled, bindingAnalysis, statementIndex, source.expression);
  return [];
};

const typedBindingCandidates = (
  compiled: CompiledDslDocument,
  bindingAnalysis: BindingAnalysis
): DefinitionCandidate[] => {
  const candidates: DefinitionCandidate[] = [];
  for (const statement of compiled.scalarProgram?.statements ?? []) {
    candidates.push(...bindingCandidatesFromExpression(
      compiled,
      bindingAnalysis,
      bindingAnalysis.catalog.bindingsById.get(statement.bindingId)?.statementIndex ?? -1,
      statement.declaration.initializer
    ));
  }
  for (const reference of bindingAnalysis.initializerReferences) {
    if (reference.resolution.kind !== "resolved" || !reference.span) continue;
    const statementIndex = bindingAnalysis.catalog.bindingsById.get(reference.fromBindingId)?.statementIndex ?? -1;
    if (statementIndex < 0) continue;
    const referenceRange = physicalRangeFor(compiled, statementIndex, {
      start: reference.span.start + 1,
      end: reference.span.end
    });
    const declarationRange = declarationRangeForBinding(compiled, bindingAnalysis, reference.resolution.binding.id);
    if (referenceRange && declarationRange) candidates.push({ referenceRange, declarationRange });
  }
  return candidates;
};

const bindingCandidatesFromCompiledSources = (
  compiled: CompiledDslDocument,
  bindingAnalysis: BindingAnalysis
): DefinitionCandidate[] => {
  const candidates: DefinitionCandidate[] = [];
  for (const [key, source] of compiled.propertyBindings ?? []) {
    const parsed = parsePropertyBindingOccurrenceKey(key);
    if (parsed) candidates.push(...bindingCandidatesFromSource(compiled, bindingAnalysis, source, parsed.statementIndex));
  }
  for (const numeric of compiled.numericBindings?.values() ?? []) candidates.push(...bindingCandidatesFromNumeric(compiled, bindingAnalysis, numeric));
  for (const [key, expression] of compiled.conditionalGroupConditions ?? []) {
    const parsed = parsePropertyBindingOccurrenceKey(key);
    if (parsed) candidates.push(...bindingCandidatesFromExpression(compiled, bindingAnalysis, parsed.statementIndex, expression));
  }
  for (const [key, template] of compiled.textTemplates ?? []) {
    const parsed = parsePropertyBindingOccurrenceKey(key);
    if (!parsed) continue;
    for (const segment of template.segments) {
      if (segment.kind === "hole" && segment.holeKind !== "numeric") {
        candidates.push(...bindingCandidatesFromExpression(compiled, bindingAnalysis, parsed.statementIndex, segment.expression));
      }
    }
  }
  for (const [statementIndex, set] of compiled.setStatements ?? []) {
    const targetRange = physicalReferenceRange(compiled, statementIndex, set.targetSpan);
    const targetDeclaration = declarationRangeForBinding(compiled, bindingAnalysis, set.targetBindingId);
    if (targetRange && targetDeclaration) candidates.push({ referenceRange: targetRange, declarationRange: targetDeclaration });
    candidates.push(...bindingCandidatesFromExpression(compiled, bindingAnalysis, statementIndex, set.expression));
  }
  return candidates;
};

const moduleCandidateAt = (
  compiled: CompiledDslDocument,
  index: ModuleSemanticRangeIndex,
  position: number
): DefinitionCandidate | null => {
  const target = moduleSemanticTargetAt(index, position);
  if (!target) return null;
  const key = moduleSemanticTargetKey(target);
  const token = index.tokens
    .filter((candidate) => candidate.from <= position && position <= candidate.to && moduleSemanticTargetKey(candidate.target) === key)
    .sort((left, right) => (left.to - left.from) - (right.to - right.from))[0];
  if (!token) return null;
  const declarationToken = moduleSemanticDeclarationRange(index, target);
  const declaration = declarationToken
    ? { from: declarationToken.from, to: declarationToken.to }
    : target.kind === "moduleSource"
      ? declarationRangeForStatementIdentity(compiled, target.statementId)
      : null;
  if (!declaration || (declaration.from === token.from && declaration.to === token.to)) return null;
  return { referenceRange: { from: token.from, to: token.to }, declarationRange: declaration };
};

const candidateAt = (candidates: readonly DefinitionCandidate[], position: number) => {
  const matches = candidates.filter((candidate) => candidate.referenceRange.from <= position && position <= candidate.referenceRange.to);
  if (matches.length === 0) return null;
  const shortest = Math.min(...matches.map((candidate) => candidate.referenceRange.to - candidate.referenceRange.from));
  return matches.find((candidate) => candidate.referenceRange.to - candidate.referenceRange.from === shortest) ?? null;
};

/** Query a resolved DSL reference without importing VS Code, CodeMirror, or Tauri. */
export const queryDslDefinition = ({ source, position, semantic }: DslDefinitionQueryInput): DslDefinitionQueryResult | null => {
  if (source.normalizedSource.includes("\r") || position < 0 || position > source.normalizedSource.length) return null;
  if (!semanticIsExact(source, semantic) || !semantic?.compiled) return null;
  const compiled = semantic.compiled;
  const sourceSemanticCompiled = compiled.moduleSemanticAnalysis || !compiled.sourceSemanticAnalysis
    ? compiled
    : { ...compiled, moduleSemanticAnalysis: compiled.sourceSemanticAnalysis };
  const module = moduleCandidateAt(sourceSemanticCompiled, createModuleSemanticRangeIndex(sourceSemanticCompiled), position);
  if (module) return module;

  const geometryProperty = candidateAt(rootGeometryPropertyCandidates(sourceSemanticCompiled), position);
  if (geometryProperty) return geometryProperty;

  const bindingAnalysis = semantic.bindingAnalysis ?? compiled.bindingAnalysis;
  if (bindingAnalysis) {
    const typed = candidateAt([
      ...typedBindingCandidates(compiled, bindingAnalysis),
      ...bindingCandidatesFromCompiledSources(compiled, bindingAnalysis)
    ], position);
    if (typed) return typed;
  }

  return null;
};

export type { SourceRevision, SourceSnapshot } from "./logicalStatementSourceMap";
