import { exactPhysicalSpan } from "./dslDiagnosticSpan";
import type { CompiledDslDocument } from "./dslDocument";
import { isGeometryDeclarationCategory } from "./dslConstructions";
import { rootCompiledGeometryPropertyOccurrences } from "./dslCompiledGeometryProperty";
import { sourceOwnerByRuntimeElementId } from "./sourceOwnership";
import type { SourceSnapshot } from "./logicalStatementSourceMap";
import type {
  ModuleGeometryPropertyReference,
  ModuleGeometryReferenceSemantic,
  ModuleScalarExpressionSemantic,
  ModuleSemanticAnalysis
} from "./moduleSemanticTypes";

export type DslCanvasRevealFailureReason =
  | "source-mismatch"
  | "invalid-position"
  | "no-target"
  | "no-revealable-runtime-target";

export type DslCanvasRevealRuntimeOmissionCause =
  | "hidden"
  | "disabled"
  | "profile-excluded"
  | "runtime-target-unavailable";

export type DslCanvasRevealOwnerFallbackCause =
  | "unresolved"
  | "ambiguous"
  | DslCanvasRevealRuntimeOmissionCause;

export type DslCanvasRevealDegradation =
  | {
      kind: "owner-fallback";
      cause: DslCanvasRevealOwnerFallbackCause;
      referenceText?: string;
    }
  | {
      kind: "partial-targets";
      omittedCount: number;
      causes: readonly DslCanvasRevealRuntimeOmissionCause[];
    };

export type DslCanvasRevealResult =
  | {
      status: "resolved";
      runtimeElementIds: readonly string[];
      primaryRuntimeElementId: string;
      degradations: readonly DslCanvasRevealDegradation[];
    }
  | {
      status: "failed";
      reason: DslCanvasRevealFailureReason;
    };

export type DslCanvasRevealSemanticTarget =
  | {
      kind: "geometry-reference";
      sourceStatementIndex: number;
      reference: ModuleGeometryReferenceSemantic;
      referenceText: string;
    }
  | {
      kind: "geometry-property";
      sourceStatementIndex: number;
      reference: ModuleGeometryPropertyReference;
      referenceText: string;
    };

export type DslCanvasRevealSourceTarget =
  | {
      kind: "semantic";
      semantic: DslCanvasRevealSemanticTarget;
      ownerSourceStatementIndex: number | null;
    }
  | {
      kind: "statement-owner";
      sourceStatementIndex: number;
    };

export type DslCanvasRevealSourceQueryResult =
  | { status: "resolved"; target: DslCanvasRevealSourceTarget }
  | { status: "failed"; reason: Extract<DslCanvasRevealFailureReason, "source-mismatch" | "invalid-position" | "no-target"> };

export type DslCanvasRevealSourceQueryInput = {
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
  position: number;
};

type SourceRange = { from: number; to: number };
type SemanticCandidate = DslCanvasRevealSemanticTarget & { range: SourceRange };

const sourceAndCompiledMatch = (source: SourceSnapshot, compiled: CompiledDslDocument): boolean =>
  !source.normalizedSource.includes("\r") &&
  compiled.spans.sourceMap.source === source.normalizedSource &&
  compiled.spans.sourceMap.sourceRevision === source.sourceRevision &&
  compiled.statementMap?.sourceRevision === source.sourceRevision;

const exactRange = (
  source: SourceSnapshot,
  compiled: CompiledDslDocument,
  statementIndex: number,
  span: { start: number; end: number }
): SourceRange | null => {
  const statement = compiled.statements[statementIndex];
  if (!statement || statement.sourceRevision !== source.sourceRevision) return null;
  const physical = exactPhysicalSpan(compiled.spans, statement, span);
  if (physical?.sourceRevision !== source.sourceRevision || physical.segments.length !== 1) return null;
  const range = physical.segments[0];
  if (
    !range ||
    !Number.isInteger(range.from) ||
    !Number.isInteger(range.to) ||
    range.from < 0 ||
    range.to <= range.from ||
    range.to > source.normalizedSource.length
  ) return null;
  return range;
};

const semanticRangeContains = (source: SourceSnapshot, range: SourceRange, position: number): boolean =>
  range.from <= position && (position < range.to || (position === range.to && source.normalizedSource[range.to] === ","));

const statementIndexForId = (compiled: CompiledDslDocument, statementId: string): number | null =>
  compiled.statementMap?.statementIndexByStatementId?.get(statementId) ?? null;

const addExpressionCandidates = (
  source: SourceSnapshot,
  compiled: CompiledDslDocument,
  result: SemanticCandidate[],
  statementIndex: number,
  expression: ModuleScalarExpressionSemantic
) => {
  for (const reference of expression.geometryProperties) {
    const range = exactRange(source, compiled, statementIndex, reference.span);
    if (!range) continue;
    result.push({
      kind: "geometry-property",
      sourceStatementIndex: statementIndex,
      reference,
      referenceText: source.normalizedSource.slice(range.from, range.to),
      range
    });
  }
  for (const argument of expression.geometryBuiltinArguments) {
    const range = exactRange(source, compiled, statementIndex, argument.reference.span);
    if (!range) continue;
    result.push({
      kind: "geometry-reference",
      sourceStatementIndex: statementIndex,
      reference: argument.reference,
      referenceText: source.normalizedSource.slice(range.from, range.to),
      range
    });
  }
};

const addRootCompiledGeometryPropertyCandidates = (
  source: SourceSnapshot,
  compiled: CompiledDslDocument,
  result: SemanticCandidate[]
) => {
  for (const occurrence of rootCompiledGeometryPropertyOccurrences(compiled)) {
    const targetStatement = compiled.statements[occurrence.targetSourceOrder];
    const targetStatementId = compiled.statementMap?.statementIdByStatementIndex?.get(occurrence.targetSourceOrder);
    if (
      targetStatement?.kind !== "element" ||
      !isGeometryDeclarationCategory(targetStatement.category) ||
      !targetStatementId
    ) continue;
    const reference: ModuleGeometryPropertyReference = {
      geometryName: occurrence.elementName,
      property: occurrence.property,
      elementNameSpan: occurrence.elementNameSpan,
      propertySpan: occurrence.propertySpan,
      span: occurrence.span,
      target: {
        kind: "sourceGeometryProperty",
        statementId: targetStatementId,
        statementIndex: occurrence.targetSourceOrder,
        category: targetStatement.category,
        property: occurrence.property
      },
      type: occurrence.type,
      resolution: "resolved"
    };
    const range = exactRange(source, compiled, occurrence.statementIndex, reference.span);
    if (!range) continue;
    result.push({
      kind: "geometry-property",
      sourceStatementIndex: occurrence.statementIndex,
      reference,
      referenceText: source.normalizedSource.slice(range.from, range.to),
      range
    });
  }
};

const semanticCandidates = (
  source: SourceSnapshot,
  compiled: CompiledDslDocument,
  analysis: ModuleSemanticAnalysis
): readonly SemanticCandidate[] => {
  const result: SemanticCandidate[] = [];
  const seen = new Set<string>();
  const addReference = (statementIndex: number, reference: ModuleGeometryReferenceSemantic) => {
    const range = exactRange(source, compiled, statementIndex, reference.span);
    if (!range) return;
    result.push({
      kind: "geometry-reference",
      sourceStatementIndex: statementIndex,
      reference,
      referenceText: source.normalizedSource.slice(range.from, range.to),
      range
    });
  };
  const addExpression = (statementIndex: number, expression: ModuleScalarExpressionSemantic) =>
    addExpressionCandidates(source, compiled, result, statementIndex, expression);

  for (const [statementId, sites] of analysis.rootGeometryReferencesByStatementId) {
    const statementIndex = statementIndexForId(compiled, statementId);
    if (statementIndex === null) continue;
    for (const site of sites) addReference(statementIndex, site.reference);
  }
  for (const [statementId, site] of analysis.rootScalarExpressionsByStatementId) {
    const statementIndex = statementIndexForId(compiled, statementId);
    if (statementIndex !== null) addExpression(statementIndex, site.expression);
  }
  addRootCompiledGeometryPropertyCandidates(source, compiled, result);
  for (const definition of analysis.definitions) {
    for (const body of definition.bodyStatements) {
      for (const site of body.geometryReferences) addReference(body.statementIndex, site.reference);
      for (const site of body.scalarExpressions) addExpression(body.statementIndex, site.expression);
      for (const hole of body.textTemplateHoles) addExpression(body.statementIndex, hole.expression);
    }
  }
  for (const instance of analysis.instancesByStatementId.values()) {
    for (const binding of instance.parameterBindings) {
      if (!binding.value) continue;
      if (binding.value.kind === "geometry") addReference(instance.statementIndex, binding.value.reference);
      else if (binding.value.kind === "scalar") addExpression(instance.statementIndex, binding.value.expression);
    }
  }

  return result.filter((candidate) => {
    const key = `${candidate.kind}:${candidate.sourceStatementIndex}:${candidate.range.from}:${candidate.range.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const ownerAt = (
  source: SourceSnapshot,
  compiled: CompiledDslDocument,
  position: number
): number | null => {
  if (!compiled.statementMap) return null;
  const owners = sourceOwnerByRuntimeElementId({
    statementMap: compiled.statementMap,
    moduleMaterialization: compiled.moduleMaterialization
  });
  const runtimeStatementIndexes = new Set([...owners.values()].map((owner) => owner.sourceStatementIndex));

  for (const [statementIndex, statement] of compiled.statements.entries()) {
    if (!runtimeStatementIndexes.has(statementIndex) || statement.sourceRevision !== source.sourceRevision) continue;
    const logical = compiled.spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
    const finalCodeEnd = logical?.segments.at(-1)?.to;
    if (finalCodeEnd === undefined) continue;
    if (statement.documentRange.from <= position && position < finalCodeEnd) return statementIndex;
  }
  return null;
};

/**
 * Reveal-specific source-position resolver. It intentionally does not reuse
 * queryDslCanvasSourceTarget(): Bake keeps statement-owner semantics, while
 * Reveal gives exact semantic geometry references precedence and uses the
 * authored statement envelope only as a fallback.
 */
export const queryDslCanvasRevealSourceTarget = ({
  source,
  compiled,
  position
}: DslCanvasRevealSourceQueryInput): DslCanvasRevealSourceQueryResult => {
  if (!sourceAndCompiledMatch(source, compiled)) return { status: "failed", reason: "source-mismatch" };
  if (!Number.isInteger(position) || position < 0 || position > source.normalizedSource.length) {
    return { status: "failed", reason: "invalid-position" };
  }

  const ownerSourceStatementIndex = ownerAt(source, compiled, position);
  const analysis = compiled.moduleSemanticAnalysis ?? compiled.sourceSemanticAnalysis;
  if (analysis) {
    const matches = semanticCandidates(source, compiled, analysis)
      .filter((candidate) => semanticRangeContains(source, candidate.range, position))
      .sort((left, right) =>
        (left.range.to - left.range.from) - (right.range.to - right.range.from) ||
        left.range.from - right.range.from ||
        left.sourceStatementIndex - right.sourceStatementIndex
      );
    const semantic = matches[0];
    if (semantic) {
      const target: DslCanvasRevealSemanticTarget = semantic.kind === "geometry-reference"
        ? {
            kind: semantic.kind,
            sourceStatementIndex: semantic.sourceStatementIndex,
            reference: semantic.reference,
            referenceText: semantic.referenceText
          }
        : {
            kind: semantic.kind,
            sourceStatementIndex: semantic.sourceStatementIndex,
            reference: semantic.reference,
            referenceText: semantic.referenceText
          };
      return {
        status: "resolved",
        target: { kind: "semantic", semantic: target, ownerSourceStatementIndex }
      };
    }
  }

  return ownerSourceStatementIndex === null
    ? { status: "failed", reason: "no-target" }
    : { status: "resolved", target: { kind: "statement-owner", sourceStatementIndex: ownerSourceStatementIndex } };
};
