import { parseDslSnapshot } from "./dslParser";
import {
  assertSourceMapRevision,
  physicalSpanForLogicalRange,
  physicalToLogicalOffset,
  type DslPhysicalSpan,
  type SourceMapResult,
  type SourceSnapshot
} from "./logicalStatementSourceMap";
import type { DslSpan, DslStatement } from "./dslTypes";

export type StatementProjection = {
  snapshot: SourceSnapshot;
  parsed: ReturnType<typeof parseDslSnapshot>;
  statement: DslStatement;
};

/** The only bridge from parser logical offsets to editor physical offsets. */
export const statementProjectionAt = (
  snapshot: SourceSnapshot,
  position: number
): SourceMapResult<StatementProjection | null> => {
  const parsed = parseDslSnapshot(snapshot);
  const checked = assertSourceMapRevision(parsed.sourceMap, snapshot, null);
  if (!checked.ok) return checked;
  const statement = parsed.statements.find((candidate) =>
    position >= candidate.documentRange.from && position <= candidate.documentRange.to
  ) ?? null;
  return { ok: true, value: statement ? { snapshot, parsed, statement } : null };
};

export const physicalSpanForStatementRange = (
  projection: StatementProjection,
  span: DslSpan
): DslPhysicalSpan | null => {
  const logical = projection.parsed.sourceMap.statements.find((candidate) =>
    candidate.range.from === projection.statement.documentRange.from &&
    candidate.range.to === projection.statement.documentRange.to
  );
  return logical ? physicalSpanForLogicalRange(projection.parsed.sourceMap, logical, span) : null;
};

export const logicalTextForProjection = (projection: StatementProjection): string | null =>
  projection.parsed.sourceMap.statements.find((candidate) =>
    candidate.range.from === projection.statement.documentRange.from &&
    candidate.range.to === projection.statement.documentRange.to
  )?.logicalText ?? null;

/** Maps a real source position within the projected statement to its logical
 * (row-joined) offset, e.g. to translate a CodeMirror cursor on any physical
 * row of a multi-line statement into a position resolveParameterTargetAt can use. */
export const logicalOffsetForPhysicalPosition = (
  projection: StatementProjection,
  physicalOffset: number
): number | null => {
  const logical = projection.parsed.sourceMap.statements.find((candidate) =>
    candidate.range.from === projection.statement.documentRange.from &&
    candidate.range.to === projection.statement.documentRange.to
  );
  return logical ? physicalToLogicalOffset(projection.parsed.sourceMap, logical, physicalOffset) : null;
};

/** CodeMirror can directly select a token only when its projection is contiguous. */
export const singlePhysicalSegment = (
  snapshot: SourceSnapshot,
  span: DslPhysicalSpan | null
): SourceMapResult<{ from: number; to: number } | null> => {
  if (!span || span.sourceRevision !== snapshot.sourceRevision || span.segments.length !== 1) {
    return span && span.sourceRevision !== snapshot.sourceRevision
      ? { ok: false, reason: "revision-mismatch" }
      : { ok: true, value: null };
  }
  return { ok: true, value: span.segments[0] };
};
