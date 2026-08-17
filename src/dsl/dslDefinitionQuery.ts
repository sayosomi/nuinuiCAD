import type { BindingAnalysis } from "../scalars/bindingAnalysis";
import type { BindingId } from "../scalars/bindingCatalog";
import { referencesIn } from "../scalars/typedDependencyGraph";
import type { ScalarValueSource } from "../scalars/propertyBindingCompiler";
import { parsePropertyBindingOccurrenceKey } from "../scalars/propertyBindingCompiler";
import type { CompiledNumericBinding } from "../scalars/numericBindingCompiler";
import type { TypedScalarExpression } from "../scalars/typedExpressionAst";
import { getParameterValue } from "../parameters/parameterAccess";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import type { ElementId, PointAnchor } from "../types/geometry";
import { commonArgSpecs, constructionFor } from "./dslConstructions";
import { exactPhysicalSpan } from "./dslDiagnosticSpan";
import type { CompiledDslDocument } from "./dslDocument";
import type { SourceRevision, SourceSnapshot, DslPhysicalSpan } from "./logicalStatementSourceMap";
import { parseDslSourceReference } from "./dslReferenceTokens";
import { splitDslList } from "./dslTokens";
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
  const entry = bindingAnalysis.entriesById.get(bindingId);
  if (entry?.status.kind !== "valid" || binding.declaredType === null) return null;
  const statement = compiled.statements[binding.statementIndex];
  if (!statement) return null;
  return singlePhysicalRange(statement.namePhysicalSpan) ?? physicalRangeFor(compiled, binding.statementIndex, binding.nameSpan);
};

const declarationRangeForElementId = (
  compiled: CompiledDslDocument,
  elementId: ElementId
): DslDefinitionRange | null => {
  const sourceNamespace = compiled.sourceLexicalNamespace;
  const elementIds = compiled.statementMap?.elementIdByStatementIndex;
  if (!sourceNamespace || !elementIds) return null;
  const declaration = sourceNamespace.allDeclarations.find(
    (candidate) => elementIds.get(candidate.statementIndex) === elementId
  );
  if (!declaration || declaration.nameSpan === null) return null;
  const statement = compiled.statements[declaration.statementIndex];
  if (!statement) return null;
  return singlePhysicalRange(statement.namePhysicalSpan) ?? physicalRangeFor(compiled, declaration.statementIndex, declaration.nameSpan);
};

const rangeForSourceReferenceName = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  valueSpan: { start: number; end: number },
  value: string,
  targetId: ElementId
): DefinitionCandidate | null => {
  const parsed = parseDslSourceReference(value);
  if (parsed.kind !== "valid") return null;
  const referenceRange = physicalRangeFor(compiled, statementIndex, {
    start: valueSpan.start + parsed.reference.pathRange.start,
    end: valueSpan.start + parsed.reference.pathRange.end
  });
  const declarationRange = declarationRangeForElementId(compiled, targetId);
  return referenceRange && declarationRange ? { referenceRange, declarationRange } : null;
};

const sourceTextForStatement = (compiled: CompiledDslDocument, statementIndex: number) => {
  const statement = compiled.statements[statementIndex];
  if (!statement) return null;
  return compiled.spans.logicalStatementByRangeFrom.get(statement.documentRange.from)?.logicalText ?? null;
};

const sourceValueFor = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  argName: string
): { value: string; span: { start: number; end: number } } | null => {
  const statement = compiled.statements[statementIndex];
  const source = sourceTextForStatement(compiled, statementIndex);
  const span = statement?.payloadSpans[argName];
  if (!source || !span) return null;
  return { value: source.slice(span.start, span.end), span };
};

const targetIdFromPointAnchor = (anchor: PointAnchor | null | undefined): ElementId | null => {
  if (!anchor) return null;
  return anchor.mode === "reference" || anchor.mode === "derived" ? anchor.mode === "reference" ? anchor.pointId : anchor.elementId : null;
};

const ordinaryGeometryCandidates = (compiled: CompiledDslDocument): DefinitionCandidate[] => {
  const elementIds = compiled.statementMap?.elementIdByStatementIndex;
  const elements = compiled.document?.elements;
  if (!elementIds || !elements) return [];
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const candidates: DefinitionCandidate[] = [];

  const addValueReference = (
    statementIndex: number,
    argName: string,
    targetId: ElementId | null
  ) => {
    if (!targetId) return;
    const value = sourceValueFor(compiled, statementIndex, argName);
    const element = value ? rangeForSourceReferenceName(compiled, statementIndex, value.span, value.value, targetId) : null;
    if (element) candidates.push(element);
  };

  const addReferenceList = (
    statementIndex: number,
    argName: string,
    targetIds: readonly ElementId[] | undefined
  ) => {
    if (!targetIds || targetIds.length === 0) return;
    const value = sourceValueFor(compiled, statementIndex, argName);
    if (!value) return;
    let cursor = 0;
    for (const [index, item] of splitDslList(value.value).entries()) {
      const offset = value.value.indexOf(item, cursor);
      if (offset < 0) continue;
      cursor = offset + item.length;
      const targetId = targetIds[index];
      if (!targetId) continue;
      const candidate = rangeForSourceReferenceName(
        compiled,
        statementIndex,
        { start: value.span.start + offset, end: value.span.start + offset + item.length },
        item,
        targetId
      );
      if (candidate) candidates.push(candidate);
    }
  };

  for (const [statementIndex, statement] of compiled.statements.entries()) {
    if (statement.kind !== "group" && statement.kind !== "element") continue;
    const ownerId = elementIds.get(statementIndex);
    const owner = ownerId ? elementsById.get(ownerId) : undefined;
    if (!owner) continue;
    const spec = statement.kind === "group"
      ? constructionFor("group", "")
      : constructionFor(statement.category, statement.construction);
    if (!spec) continue;

    for (const argSpec of [...spec.args, ...commonArgSpecs]) {
      if (argSpec.special) continue;
      const parameterKey = argSpec.parameterKey ?? argSpec.arg;
      const definition = getParameterDefinitions(owner).find((candidate) => candidate.key === parameterKey);
      if (!definition) continue;
      const value = getParameterValue(owner, parameterKey);
      if (definition.kind === "reference") {
        addValueReference(statementIndex, argSpec.arg, targetIdFromPointAnchor(value as PointAnchor | null | undefined));
      } else if (definition.kind === "lineEndpointReference") {
        addValueReference(statementIndex, argSpec.arg, (value as { lineId?: ElementId } | undefined)?.lineId ?? null);
      } else if (definition.kind === "lineReference") {
        addValueReference(statementIndex, argSpec.arg, typeof value === "string" ? value : null);
      } else if (definition.kind === "lineReferenceList") {
        addReferenceList(statementIndex, argSpec.arg, Array.isArray(value) ? value.filter((item): item is ElementId => typeof item === "string") : undefined);
      }
    }

    // `parent` is a compiler-resolved geometry/container identity even though
    // it is a construction special argument rather than an Inspector parameter.
    addValueReference(statementIndex, "parent", owner.parentGroupId ?? null);
  }

  return candidates;
};

const physicalReferenceRange = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  span: { start: number; end: number }
) => physicalRangeFor(compiled, statementIndex, span);

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
  const declaration = declarationToken ? { from: declarationToken.from, to: declarationToken.to } : null;
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
  const module = moduleCandidateAt(createModuleSemanticRangeIndex(compiled), position);
  if (module) return module;

  const bindingAnalysis = semantic.bindingAnalysis ?? compiled.bindingAnalysis;
  if (bindingAnalysis) {
    const typed = candidateAt([
      ...typedBindingCandidates(compiled, bindingAnalysis),
      ...bindingCandidatesFromCompiledSources(compiled, bindingAnalysis)
    ], position);
    if (typed) return typed;
  }

  return candidateAt(ordinaryGeometryCandidates(compiled), position);
};

export type { SourceRevision, SourceSnapshot } from "./logicalStatementSourceMap";
