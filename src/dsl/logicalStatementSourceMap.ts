import { scanDslSource, type DslLexedLine } from "./dslTokens";

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
  lexicalLines: readonly DslLexedLine[];
  unterminatedBlockComment: { line: number; column: number } | null;
  statements: readonly LogicalStatement[];
  invalidContinuationLines: readonly number[];
};

export type SourceMapResult<T> = { ok: true; value: T } | { ok: false; reason: "revision-mismatch" };

/** Maps a logical offset to a real source position. A normalized continuation
 * separator is associated with the preceding || following physical fragment. */
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
 * trailing comment, a full-line comment inside an open call, || trimmed
 * continuation-line indentation) have no logical counterpart && return null. */
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

/** Net depth-zero-relative change in unclosed `(`/`[` nesting contributed by
 * a single line's code (quote-aware; `)`/`]` inside a quoted string do not
 * count). A statement's call envelope continues onto the next physical line
 * while the running depth across its lines so far is still above zero. */
const netDepthDelta = (code: string) => {
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < code.length; index += 1) {
    const char = code[index];
    if ((char === "\"" || char === "'") && code[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
      continue;
    }
    if (quote) continue;
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
  }
  return depth;
};

/**
 * Derived projection only. Callers retain ownership of the normalized source &&
 * revision; all multi-line parsing clients must consume this projection rather
 * than reimplementing continuation recognition.
 */
export const createLogicalStatementSourceMap = (snapshot: SourceSnapshot): LogicalStatementSourceMap => {
  if (snapshot.normalizedSource.includes("\r")) {
    throw new Error("logicalStatementSourceMap requires LF-normalized source.");
  }
  const source = snapshot.normalizedSource;
  const lines = source.split("\n");
  const lexical = scanDslSource(source);
  const lexicalLines = lexical.lines;
  const starts = lineStarts(source);
  const statements: LogicalStatement[] = [];
  const invalidContinuationLines: number[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const firstLine = index;
    const first = lexicalLines[index]!;
    const firstStructural = structuralKind(first.codeText);
    if (firstStructural) {
      statements.push({
        logicalText: first.codeText,
        range: { from: starts[index], to: starts[index] + lines[index].length, startLine: index + 1, endLine: index + 1, sourceRevision: snapshot.sourceRevision },
        segments: first.codeSegments.map((segment) => ({ from: starts[index] + segment.start, to: starts[index] + segment.end })),
        continuationLines: [],
        structural: firstStructural
      });
      continue;
    }

    const fragments: string[] = [];
    const segments: DslPhysicalSegment[] = [];
    const continuationLines: number[] = [];
    let cursor = index;
    let depth = 0;
    while (true) {
      const line = lexicalLines[cursor]!;
      // A full-line comment inside an otherwise-open call contributes no
      // code (and no depth change) but still belongs to the statement's
      // physical line range. A truly blank line is never absorbed here: it
      // is caught by the blank/structural lookahead below instead, which
      // reports an unclosed call rather than silently swallowing the line.
      const isCommentOnlyLine = line.codeText.trim() === "" && line.text.trim() !== "";
      if (!isCommentOnlyLine && line.codeText.trim()) {
        for (const codeSegment of line.codeSegments) {
          const segmentText = codeSegment.text;
          const leading = segmentText.length - segmentText.trimStart().length;
          const trailing = segmentText.length - segmentText.trimEnd().length;
          if (leading >= segmentText.length - trailing) continue;
          // Preserve ordinary single-fragment lines verbatim so existing
          // line-relative parser spans remain stable. Comment-separated
          // fragments use the same normalized separator as continuations.
          fragments.push(segmentText.slice(leading, segmentText.length - trailing));
          segments.push({
            from: starts[cursor] + codeSegment.start + leading,
            to: starts[cursor] + codeSegment.end - trailing
          });
        }
      }
      depth += netDepthDelta(line.codeText);
      const continues = depth > 0;
      if (!continues) break;
      const next = cursor + 1;
      const nextLine = next < lines.length ? lines[next] : null;
      const nextIsBlank = nextLine === null || nextLine.trim() === "";
      const nextCode = nextLine !== null ? lexicalLines[next]!.codeText : "";
      const nextIsStructural = nextLine !== null && structuralKind(nextCode) !== null;
      if (nextIsBlank || nextIsStructural) {
        // Containment boundary: a blank line, a structural line, || EOF
        // terminates an unclosed call as an error scoped to this statement
        // only, instead of swallowing the rest of the document.
        invalidContinuationLines.push(cursor + 1);
        break;
      }
      continuationLines.push(cursor + 1);
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
  }
  return {
    sourceRevision: snapshot.sourceRevision,
    source,
    lexicalLines,
    unterminatedBlockComment: lexical.unterminatedBlockComment,
    statements,
    invalidContinuationLines
  };
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
