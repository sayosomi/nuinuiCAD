// 凍結コピー。編集禁止。削除条件は docs/dsl2/tasks/f4-legacy-removal.md 参照。

import { splitDslComment } from "./dslTokens";

export type SourceRevision = number;

export type SourceSnapshot = {
  normalizedSource: string;
  sourceRevision: SourceRevision;
};

export type DocumentRange = {
  from: number;
  to: number;
  startLine: number;
  endLine: number;
  sourceRevision: SourceRevision;
};

export type DslPhysicalSegment = { from: number; to: number };

export type DslPhysicalSpan = {
  segments: readonly DslPhysicalSegment[];
  sourceRevision: SourceRevision;
};

export type LogicalStatement = {
  logicalText: string;
  range: DocumentRange;
  /** Each source fragment is a real physical-code interval, in logical order. */
  segments: readonly DslPhysicalSegment[];
  continuationLines: readonly number[];
  structural: "open" | "close" | "else" | null;
};

export type LogicalStatementSourceMap = {
  sourceRevision: SourceRevision;
  source: string;
  statements: readonly LogicalStatement[];
  invalidContinuationLines: readonly number[];
};

export type SourceMapResult<T> = { ok: true; value: T } | { ok: false; reason: "revision-mismatch" };

/** Maps a logical offset to a real source position. A normalized continuation
 * separator is associated with the preceding or following physical fragment. */
export const logicalOffsetToPhysical = (
  map: LogicalStatementSourceMap,
  statement: LogicalStatement,
  logicalOffset: number,
  association: -1 | 1 = 1
): number | null => {
  if (statement.range.sourceRevision !== map.sourceRevision || logicalOffset < 0 || logicalOffset > statement.logicalText.length) return null;
  let logicalStart = 0;
  for (const [index, segment] of statement.segments.entries()) {
    const text = map.source.slice(segment.from, segment.to);
    const logicalEnd = logicalStart + text.length;
    if (logicalOffset >= logicalStart && logicalOffset <= logicalEnd) return segment.from + logicalOffset - logicalStart;
    if (logicalOffset === logicalEnd + 1 && index < statement.segments.length - 1) {
      return association < 0 ? segment.to : statement.segments[index + 1].from;
    }
    logicalStart = logicalEnd + 1;
  }
  return null;
};

/** Inverse of logicalOffsetToPhysical: maps a real source position to its
 * logical offset. Positions that fall outside every physical fragment (a
 * trailing comment, the continuation backslash itself, or trimmed
 * continuation-line indentation) have no logical counterpart and return null. */
export const physicalToLogicalOffset = (
  map: LogicalStatementSourceMap,
  statement: LogicalStatement,
  physicalOffset: number
): number | null => {
  if (statement.range.sourceRevision !== map.sourceRevision) return null;
  let logicalStart = 0;
  for (const segment of statement.segments) {
    const length = segment.to - segment.from;
    if (physicalOffset >= segment.from && physicalOffset <= segment.to) return logicalStart + (physicalOffset - segment.from);
    logicalStart += length + 1;
  }
  return null;
};

const lineStarts = (source: string) => {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) if (source[index] === "\n") starts.push(index + 1);
  return starts;
};

const structuralKind = (code: string): LogicalStatement["structural"] => {
  const trimmed = code.trim();
  if (trimmed === "{") return "open";
  if (trimmed === "}") return "close";
  if (trimmed === "} else {") return "else";
  return null;
};

const isContinuation = (code: string) => {
  const trimmed = code.trimEnd();
  return trimmed.endsWith("\\") && !trimmed.endsWith("\\\\");
};

/**
 * Derived projection only. Callers retain ownership of the normalized source and
 * revision; all multi-line parsing clients must consume this projection rather
 * than reimplementing continuation recognition.
 */
export const createLogicalStatementSourceMap = (snapshot: SourceSnapshot): LogicalStatementSourceMap => {
  if (snapshot.normalizedSource.includes("\r")) {
    throw new Error("logicalStatementSourceMap requires LF-normalized source.");
  }
  const source = snapshot.normalizedSource;
  const lines = source.split("\n");
  const starts = lineStarts(source);
  const statements: LogicalStatement[] = [];
  const invalidContinuationLines: number[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const firstLine = index;
    const first = splitDslComment(lines[index]);
    const firstStructural = structuralKind(first.code);
    if (firstStructural) {
      statements.push({
        logicalText: first.code,
        range: { from: starts[index], to: starts[index] + lines[index].length, startLine: index + 1, endLine: index + 1, sourceRevision: snapshot.sourceRevision },
        segments: [{ from: starts[index], to: starts[index] + first.code.length }],
        continuationLines: [],
        structural: firstStructural
      });
      continue;
    }

    const fragments: string[] = [];
    const segments: DslPhysicalSegment[] = [];
    const continuationLines: number[] = [];
    let cursor = index;
    let validContinuation = false;
    while (true) {
      const line = lines[cursor];
      const { code } = splitDslComment(line);
      const continues = isContinuation(code);
      const content = continues ? code.trimEnd().slice(0, -1).trimEnd() : code;
      if (content.trim()) {
        const leading = content.length - content.trimStart().length;
        const trailing = content.length - content.trimEnd().length;
        // Preserve the first physical line verbatim so existing line-relative
        // parser spans remain valid for ordinary one-line statements. Only
        // continuation fragments lose their leading indentation.
        fragments.push(cursor === firstLine ? content : content.trim());
        segments.push({ from: starts[cursor] + leading, to: starts[cursor] + content.length - trailing });
      }
      if (!continues) break;
      const next = cursor + 1;
      const nextCode = next < lines.length ? splitDslComment(lines[next]).code : "";
      if (next >= lines.length || !nextCode.trim() || structuralKind(nextCode)) {
        invalidContinuationLines.push(cursor + 1);
        break;
      }
      continuationLines.push(cursor + 1);
      validContinuation = true;
      cursor = next;
    }
    index = cursor;
    statements.push({
      logicalText: fragments.join(" "),
      range: { from: starts[firstLine], to: starts[cursor] + lines[cursor].length, startLine: firstLine + 1, endLine: cursor + 1, sourceRevision: snapshot.sourceRevision },
      segments,
      continuationLines,
      structural: null
    });
    void validContinuation;
  }
  return { sourceRevision: snapshot.sourceRevision, source, statements, invalidContinuationLines };
};

export const assertSourceMapRevision = <T>(
  map: LogicalStatementSourceMap,
  snapshot: SourceSnapshot,
  value: T
): SourceMapResult<T> =>
  map.sourceRevision === snapshot.sourceRevision && map.source === snapshot.normalizedSource
    ? { ok: true, value }
    : { ok: false, reason: "revision-mismatch" };

export const physicalSpanForStatement = (statement: LogicalStatement): DslPhysicalSpan => ({
  segments: statement.segments,
  sourceRevision: statement.range.sourceRevision
});

/** Projects a logical half-open range into its real physical source segments.
 * A logical separator introduced for a continuation never becomes editable
 * source; ranges which include it are represented by the neighbouring
 * physical segments instead. */
export const physicalSpanForLogicalRange = (
  map: LogicalStatementSourceMap,
  statement: LogicalStatement,
  range: { start: number; end: number }
): DslPhysicalSpan | null => {
  if (statement.range.sourceRevision !== map.sourceRevision || range.start < 0 || range.end < range.start || range.end > statement.logicalText.length) return null;
  const segments: DslPhysicalSegment[] = [];
  let logicalStart = 0;
  for (const segment of statement.segments) {
    const length = segment.to - segment.from;
    const logicalEnd = logicalStart + length;
    const from = Math.max(range.start, logicalStart);
    const to = Math.min(range.end, logicalEnd);
    if (to > from) segments.push({ from: segment.from + from - logicalStart, to: segment.from + to - logicalStart });
    logicalStart = logicalEnd + 1;
  }
  return { segments, sourceRevision: map.sourceRevision };
};
