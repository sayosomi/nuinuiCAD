import { constructionFor, categoriesForConstruction } from "./dslConstructions";
import type { CompiledDslDocument } from "./dslDocument";
import {
  physicalSpanForLogicalRange,
  physicalToLogicalOffset,
  type DslPhysicalSegment,
  type SourceRevision,
  type SourceSnapshot
} from "./logicalStatementSourceMap";
import { CONSTRUCTION_CATEGORY_MISMATCH_CODE } from "./dslCallParser";
import type { DslDiagnostic, DslStatement } from "./dslTypes";

export type DslConstructionCategoryQuickFixSemanticSnapshot = {
  sourceRevision: SourceRevision;
  sourceText?: string;
  compiled: CompiledDslDocument;
};

export type DslConstructionCategoryQuickFixEdit = {
  from: number;
  to: number;
  expectedText: string;
  newText: string;
};

export type DslConstructionCategoryQuickFixPlan = {
  /** The canonical category is the plan's semantic identity. */
  targetCategory: string;
  edit: DslConstructionCategoryQuickFixEdit;
};

export type DslConstructionCategoryQuickFixQueryInput = {
  source: SourceSnapshot;
  diagnostic: DslDiagnostic;
  semantic: DslConstructionCategoryQuickFixSemanticSnapshot;
};

const semanticSourceText = (semantic: DslConstructionCategoryQuickFixSemanticSnapshot): string | undefined =>
  semantic.sourceText ?? semantic.compiled.spans.sourceMap.source;

const exactSemantic = (
  source: SourceSnapshot,
  semantic: DslConstructionCategoryQuickFixSemanticSnapshot | undefined
): semantic is DslConstructionCategoryQuickFixSemanticSnapshot => Boolean(
  semantic?.compiled &&
  !source.normalizedSource.includes("\r") &&
  semantic.sourceRevision === source.sourceRevision &&
  semanticSourceText(semantic) === source.normalizedSource &&
  semantic.compiled.spans.sourceMap.source === source.normalizedSource &&
  semantic.compiled.spans.sourceMap.sourceRevision === source.sourceRevision
);

const safeSinglePhysicalSegment = (
  source: SourceSnapshot,
  span: { segments: readonly DslPhysicalSegment[]; sourceRevision: SourceRevision } | null | undefined
): DslPhysicalSegment | null => {
  if (!span || span.sourceRevision !== source.sourceRevision || !Array.isArray(span.segments) || span.segments.length !== 1) return null;
  const segment = span.segments[0];
  if (
    !segment ||
    !Number.isInteger(segment.from) ||
    !Number.isInteger(segment.to) ||
    segment.from < 0 ||
    segment.to <= segment.from ||
    segment.to > source.normalizedSource.length
  ) return null;
  return segment;
};

const physicalStatementContains = (
  source: SourceSnapshot,
  statement: DslStatement,
  range: DslPhysicalSegment
): boolean => {
  if (statement.sourceRevision !== source.sourceRevision) return false;
  if (!statement.physicalSpan || statement.physicalSpan.sourceRevision !== source.sourceRevision) return false;
  return statement.physicalSpan.segments.some((segment) =>
    Number.isInteger(segment.from) &&
    Number.isInteger(segment.to) &&
    segment.from >= 0 &&
    segment.to > segment.from &&
    segment.to <= source.normalizedSource.length &&
    range.from >= segment.from &&
    range.to <= segment.to
  );
};

const exactCurrentStatementFor = (
  source: SourceSnapshot,
  compiled: CompiledDslDocument,
  range: DslPhysicalSegment
): DslStatement | null => {
  const matches = compiled.statements.filter((statement) =>
    statement.kind === "element" && physicalStatementContains(source, statement, range)
  );
  return matches.length === 1 ? matches[0]! : null;
};

/**
 * Query exact-current category repairs for a parser-owned construction/category
 * mismatch. The returned edit is deliberately limited to the category token;
 * all source and semantic proof is re-established by each invocation.
 */
export const queryDslConstructionCategoryQuickFixes = ({
  source,
  diagnostic,
  semantic
}: DslConstructionCategoryQuickFixQueryInput): readonly DslConstructionCategoryQuickFixPlan[] => {
  if (
    diagnostic.code !== CONSTRUCTION_CATEGORY_MISMATCH_CODE ||
    diagnostic.exactSpanOnly !== true ||
    !exactSemantic(source, semantic) ||
    diagnostic.sourceRevision !== source.sourceRevision
  ) return [];

  const diagnosticRange = safeSinglePhysicalSegment(source, diagnostic.physicalSpan);
  if (!diagnosticRange) return [];

  const statement = exactCurrentStatementFor(source, semantic.compiled, diagnosticRange);
  if (!statement || statement.kind !== "element") return [];
  if (constructionFor(statement.category, statement.construction)) return [];

  const logical = semantic.compiled.spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
  if (!logical || logical.range.sourceRevision !== source.sourceRevision) return [];
  const logicalDiagnosticStart = physicalToLogicalOffset(
    semantic.compiled.spans.sourceMap,
    logical,
    diagnosticRange.from
  );
  const logicalDiagnosticEnd = physicalToLogicalOffset(
    semantic.compiled.spans.sourceMap,
    logical,
    diagnosticRange.to
  );
  if (
    logicalDiagnosticStart === null ||
    logicalDiagnosticEnd === null ||
    logicalDiagnosticStart >= logicalDiagnosticEnd ||
    logical.logicalText.slice(logicalDiagnosticStart, logicalDiagnosticEnd) !== statement.construction
  ) return [];

  if (
    statement.keywordSpan.start < 0 ||
    statement.keywordSpan.end <= statement.keywordSpan.start ||
    logical.logicalText.slice(statement.keywordSpan.start, statement.keywordSpan.end) !== statement.category
  ) return [];
  const categoryPhysical = physicalSpanForLogicalRange(
    semantic.compiled.spans.sourceMap,
    logical,
    statement.keywordSpan
  );
  const categoryRange = safeSinglePhysicalSegment(source, categoryPhysical);
  if (!categoryRange) return [];
  const expectedText = source.normalizedSource.slice(categoryRange.from, categoryRange.to);
  if (expectedText !== statement.category) return [];

  return categoriesForConstruction(statement.construction).flatMap((category) => {
    if (category === statement.category) return [];
    return [{
      targetCategory: category,
      edit: {
        from: categoryRange.from,
        to: categoryRange.to,
        expectedText,
        newText: category
      }
    }];
  });
};

/** Singular alias for callers that treat the query as one repair operation. */
export const queryDslConstructionCategoryQuickFix = queryDslConstructionCategoryQuickFixes;
