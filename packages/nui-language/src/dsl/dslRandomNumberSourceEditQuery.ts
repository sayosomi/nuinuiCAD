import { findNumericExpressionLiteralSpans } from "../geometry/numericExpressionLiteralSpan";
import type { DslPhysicalSegment, SourceSnapshot } from "./logicalStatementSourceMap";
import {
  physicalSpanForLogicalRange,
  physicalToLogicalOffset
} from "./logicalStatementSourceMap";
import type { DslSourceValueStepSemanticSnapshot } from "./dslSourceValueStepQuery";
import { isExactDslSourceSemantic } from "./dslSourceValueStepQuery";
import type { DslSpan, DslStatement } from "./dslTypes";

export type DslRandomNumberSourceEditQueryInput = {
  source: SourceSnapshot;
  semantic?: DslSourceValueStepSemanticSnapshot;
  selections: readonly DslSpan[];
  generatedLiteral: string;
};

export type DslRandomNumberSourceEditPlan = {
  sourceRevision: number;
  edit: { from: number; to: number; expectedText: string; newText: string };
  selection: DslSpan;
};

type ValueExpressionRegion = DslSpan;

const isValidGeneratedLiteral = (literal: string): boolean =>
  /^0(?:\.\d+)?$/.test(literal) && Number.isFinite(Number(literal)) && Number(literal) >= 0 && Number(literal) < 1;

const valueExpressionRegionsFor = (statement: DslStatement): ValueExpressionRegion[] => {
  const spans = [
    ...Object.values(statement.payloadSpans),
    ...statement.attrs.map((attribute) => ({ start: attribute.valueStart, end: attribute.valueEnd })),
    ...(statement.kind === "next" ? [statement.expressionSpan] : [])
  ];
  const seen = new Set<string>();
  return spans.filter((span) => {
    if (span.start < 0 || span.end <= span.start) return false;
    const key = `${span.start}:${span.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const singleSegment = (segments: readonly DslPhysicalSegment[]): DslPhysicalSegment | null =>
  segments.length === 1 ? segments[0] ?? null : null;

const isQuotedText = (text: string): boolean => {
  const trimmed = text.trimStart();
  return trimmed.startsWith("\"") || trimmed.startsWith("'");
};

const plan = (
  source: SourceSnapshot,
  from: number,
  to: number,
  newText: string
): DslRandomNumberSourceEditPlan => ({
  sourceRevision: source.sourceRevision,
  edit: {
    from,
    to,
    expectedText: source.normalizedSource.slice(from, to),
    newText
  },
  selection: { start: from, end: from + newText.length }
});

/** Plans one exact-current generated-number source edit without mutating source. */
export const queryDslRandomNumberSourceEdit = ({
  source,
  semantic,
  selections,
  generatedLiteral
}: DslRandomNumberSourceEditQueryInput): DslRandomNumberSourceEditPlan | null => {
  if (
    !isExactDslSourceSemantic(source, semantic) ||
    selections.length !== 1 ||
    !isValidGeneratedLiteral(generatedLiteral)
  ) return null;

  const selection = selections[0]!;
  if (
    selection.start < 0 || selection.end < selection.start ||
    selection.end > source.normalizedSource.length
  ) return null;

  const compiled = semantic.compiled;
  if (selection.start === selection.end) {
    const mappedStatementStarts = new Set(compiled.statements.map((statement) => statement.documentRange.from));
    const hasUncompiledCodeAtCaret = compiled.spans.sourceMap.statements.some((logical) =>
      logical.segments.some((segment) => selection.start >= segment.from && selection.start <= segment.to) &&
      !mappedStatementStarts.has(logical.range.from)
    );
    if (hasUncompiledCodeAtCaret) return null;
  }

  const literalMatches: DslRandomNumberSourceEditPlan[] = [];
  let uncertainAtSelection = false;

  for (const statement of compiled.statements) {
    const logical = compiled.spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
    if (!logical) continue;
    const logicalStart = physicalToLogicalOffset(compiled.spans.sourceMap, logical, selection.start);
    const logicalEnd = physicalToLogicalOffset(compiled.spans.sourceMap, logical, selection.end);
    if (logicalStart === null || logicalEnd === null) continue;
    const logicalSelection = { start: logicalStart, end: logicalEnd };

    for (const region of valueExpressionRegionsFor(statement)) {
      if (region.end > logical.logicalText.length) continue;
      const expression = logical.logicalText.slice(region.start, region.end);
      if (isQuotedText(expression)) continue;
      const literals = findNumericExpressionLiteralSpans(expression);
      if (!literals) {
        const selectionIsInRegion = selection.start === selection.end
          ? logicalSelection.start >= region.start && logicalSelection.start <= region.end
          : logicalSelection.start >= region.start && logicalSelection.end <= region.end;
        uncertainAtSelection ||= selectionIsInRegion;
        continue;
      }

      for (const literal of literals) {
        const literalRange = { start: region.start + literal.start, end: region.start + literal.end };
        const collapsed = selection.start === selection.end;
        const matches = collapsed
          ? logicalSelection.start >= literalRange.start && logicalSelection.start < literalRange.end
          : logicalSelection.start === literalRange.start && logicalSelection.end === literalRange.end;
        if (!matches) continue;

        const physical = physicalSpanForLogicalRange(compiled.spans.sourceMap, logical, literalRange);
        const segment = physical && singleSegment(physical.segments);
        if (!segment) {
          uncertainAtSelection = true;
          continue;
        }
        literalMatches.push(plan(source, segment.from, segment.to, generatedLiteral));
      }
    }
  }

  if (literalMatches.length > 1) return null;
  if (literalMatches.length === 1) return literalMatches[0]!;
  if (selection.start !== selection.end || uncertainAtSelection) return null;
  return plan(source, selection.start, selection.end, generatedLiteral);
};
