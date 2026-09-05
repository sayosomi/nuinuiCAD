// Task 48: the single exact-span projection every typed-variable diagnostic
// producer uses. Deliberately fail-closed - a diagnostic whose logical span
// cannot be projected onto real source (missing LogicalStatement mapping,
// revision mismatch, out-of-range offsets) gets no physicalSpan at all,
// never `statement.physicalSpan` as a substitute. A whole-statement span is
// a *different*, wrong position for a diagnostic about one token inside it;
// showing nothing is safer than showing the wrong thing.
import type { DslSpan, DslStatement } from "./dslTypes";
import { physicalSpanForLogicalRange, type DslPhysicalSpan, type LogicalStatement, type LogicalStatementSourceMap } from "./logicalStatementSourceMap";

/** The parse-time span index every typed-variable diagnostic producer needs
 * to project a statement-local DslSpan onto its exact physical source
 * position - built once per compileDslDocument call (parseDslSnapshot),
 * never re-derived by a diagnostic producer. */
export type DiagnosticSpanContext = {
  sourceMap: LogicalStatementSourceMap;
  logicalStatementByRangeFrom: ReadonlyMap<number, LogicalStatement>;
};

export const exactPhysicalSpan = (
  spans: DiagnosticSpanContext,
  statement: Pick<DslStatement, "documentRange">,
  span: DslSpan
): DslPhysicalSpan | null => {
  const logical = spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
  if (!logical) return null;
  return physicalSpanForLogicalRange(spans.sourceMap, logical, span);
};
