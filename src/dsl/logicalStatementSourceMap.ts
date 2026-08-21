import { matchingDslDelimiter, scanDslNesting } from "./dslArgScanner";
import {
  isUnsafeDslContinuationFragment,
  isUnsafeDslPostDelimiterFragment
} from "./dslStatementKeywords";
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

const lineIndexAt = (starts: readonly number[], position: number) => {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle]! <= position) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(0, high);
};

const codeSourceFor = (lexicalLines: readonly DslLexedLine[]) =>
  lexicalLines.map((line) => line.code).join("\n");

const structuralKind = (code: string): LogicalStatement["structural"] => {
  const trimmed = code.trim();
  if (trimmed === "{") return "open";
  if (trimmed === "}") return "close";
  if (trimmed === "} else {") return "else";
  return null;
};

/**
 * A blank line is harmless only when the currently-open outer delimiter has a
 * real matching closer later in the same safe statement envelope. This is the
 * strict-parser counterpart of dslCallAuthoringContext's tolerant recovery:
 * both use the shared nesting/delimiter scanner and continuation safety rules.
 */
const canContinueAcrossBlank = (
  codeSource: string,
  lexicalLines: readonly DslLexedLine[],
  starts: readonly number[],
  cursor: number,
  nesting: ReturnType<typeof scanDslNesting>,
  allowModuleParameterFragments: boolean
) => {
  const opener = nesting.unmatchedOpeners[0];
  if (!opener) return false;
  const closePhysical = matchingDslDelimiter(codeSource, opener.index);
  if (closePhysical < 0) return false;
  const closeLine = lineIndexAt(starts, closePhysical);

  for (let index = cursor + 1; index <= closeLine; index += 1) {
    const candidate = lexicalLines[index];
    if (!candidate) return false;
    // Preserve SAY-92's fail-closed boundary: a comment-only physical line
    // beyond the blank does not prove that later code belongs to this call.
    if (candidate.codeText.trim() === "" && candidate.text.trim() !== "") return false;
    if (structuralKind(candidate.codeText) !== null) return false;

    const lineStart = starts[index]!;
    const lineEnd = starts[index + 1] ?? codeSource.length;
    const codeBeforeClose = index === closeLine
      ? codeSource.slice(lineStart, closePhysical)
      : codeSource.slice(lineStart, lineEnd);
    if (isUnsafeDslContinuationFragment(codeBeforeClose, {
      allowModuleParameterFragment: allowModuleParameterFragments
    })) return false;
  }

  const closeLineEnd = starts[closeLine + 1] ?? codeSource.length;
  return !isUnsafeDslPostDelimiterFragment(
    codeSource.slice(closePhysical + 1, closeLineEnd)
  );
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
  const codeSource = codeSourceFor(lexicalLines);
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
    while (true) {
      const line = lexicalLines[cursor]!;
      // Full-line comments and safely-contained blank lines contribute no
      // logical code fragment, but remain inside the statement's physical line
      // range. Real code segments keep their exact physical offsets.
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

      const lineEnd = starts[cursor]! + line.text.length;
      const nesting = scanDslNesting(codeSource, {
        start: starts[firstLine]!,
        end: lineEnd
      });
      const continues = nesting.unmatchedOpeners.length > 0;
      if (!continues) break;

      const next = cursor + 1;
      if (next >= lines.length) {
        invalidContinuationLines.push(cursor + 1);
        break;
      }
      const nextLine = lines[next]!;
      const nextCode = lexicalLines[next]!.codeText;
      const nextIsBlank = nextLine.trim() === "";
      const nextIsStructural = structuralKind(nextCode) !== null;
      const allowModuleParameterFragments =
        nesting.unmatchedOpeners.length === 1 &&
        /^\s*module(?:\s|$)/.test(lexicalLines[firstLine]!.codeText);
      if (
        nextIsStructural ||
        (nextIsBlank && !canContinueAcrossBlank(
          codeSource,
          lexicalLines,
          starts,
          cursor,
          nesting,
          allowModuleParameterFragments
        ))
      ) {
        // Containment boundary: structural syntax, EOF, or a blank line whose
        // later closer cannot be proven safe terminates this incomplete
        // statement without swallowing unrelated following code.
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
