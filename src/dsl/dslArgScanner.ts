import { isBareDslIdentifierChar } from "./dslTokens";
import type { DslSpan } from "./dslTypes";

export type ScannedArg = {
  /** `null` represents the leading positional argument. */
  key: string | null;
  /** The bare key, without its trailing colon. */
  keySpan: DslSpan | null;
  /** Module-definition-only optional marker after the key. */
  optionalSpan?: DslSpan;
  value: string;
  valueSpan: DslSpan;
  /** See MISSING_ATTRIBUTE_VALUE_CODE below. */
  rawValueSpan?: DslSpan;
};

export type DslArgScanError = {
  message: string;
  span: DslSpan;
  code?: string;
};

export type DslNestingDelimiter = "(" | "[";

export type DslNestingOpener = {
  delimiter: DslNestingDelimiter;
  index: number;
};

export type DslNestingCloser = {
  delimiter: ")" | "]";
  index: number;
};

export type DslMatchedDelimiter = {
  open: DslNestingOpener;
  close: DslNestingCloser;
};

export type DslNestingScan = {
  matchedDelimiters: readonly DslMatchedDelimiter[];
  unmatchedOpeners: readonly DslNestingOpener[];
  unmatchedClosers: readonly DslNestingCloser[];
  /** Positions whose delimiter nesting is zero before the character. */
  topLevelPositions: ReadonlySet<number>;
  topLevelCommas: readonly number[];
};

/** A well-formed but currently-empty named value while the user is editing. */
export const MISSING_ATTRIBUTE_VALUE_CODE = "missing-attribute-value";
/** nui4 requires this token before every subsequent call argument. */
export const MISSING_ARGUMENT_COMMA_CODE = "missing-argument-comma";
/** A comma introduced an empty argument other than an allowed trailing comma. */
export const EMPTY_ARGUMENT_CODE = "empty-argument";

type NamedArgBoundary = {
  key: string;
  keySpan: DslSpan;
  colon: number;
  optionalSpan: DslSpan | null;
};

export type ScanCallArgsOptions = {
  allowOptionalKeys?: boolean;
};

type ArgumentSegment = {
  span: DslSpan;
  /** The top-level comma immediately before this segment, if any. */
  precedingComma: number | null;
};

const isWhitespace = (value: string) => /\s/.test(value);
const isIdentifierStart = isBareDslIdentifierChar;
const isIdentifierPart = isBareDslIdentifierChar;

const isEscaped = (source: string, index: number) => {
  let backslashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) backslashCount += 1;
  return backslashCount % 2 === 1;
};

const matchingCloserFor = (delimiter: DslNestingDelimiter): DslNestingCloser["delimiter"] =>
  delimiter === "(" ? ")" : "]";

/**
 * Shared quote-aware call/list nesting scan. Strings are physical-line-local,
 * matching scanDslSource: an unterminated quote never masks delimiters on the
 * following line. Call argument recovery, tolerant authoring, and future
 * signature-help consumers must use this structure instead of maintaining
 * independent parenthesis/comma walkers.
 */
export const scanDslNesting = (
  source: string,
  span: DslSpan = { start: 0, end: source.length }
): DslNestingScan => {
  const matchedDelimiters: DslMatchedDelimiter[] = [];
  const unmatchedClosers: DslNestingCloser[] = [];
  const stack: DslNestingOpener[] = [];
  const topLevelPositions = new Set<number>();
  const topLevelCommas: number[] = [];
  let quote: string | null = null;

  for (let index = span.start; index < span.end; index += 1) {
    const character = source[index]!;
    if (character === "\n") {
      quote = null;
      if (stack.length === 0) topLevelPositions.add(index);
      continue;
    }
    if (quote) {
      if (character === quote && !isEscaped(source, index)) quote = null;
      continue;
    }
    if ((character === '"' || character === "'") && !isEscaped(source, index)) {
      quote = character;
      continue;
    }

    if (stack.length === 0) topLevelPositions.add(index);
    if (character === "(" || character === "[") {
      stack.push({ delimiter: character, index });
    } else if (character === ")" || character === "]") {
      const opener = stack.at(-1);
      if (!opener || matchingCloserFor(opener.delimiter) !== character) {
        unmatchedClosers.push({ delimiter: character, index });
      } else {
        stack.pop();
        matchedDelimiters.push({ open: opener, close: { delimiter: character, index } });
      }
    } else if (character === "," && stack.length === 0) {
      topLevelCommas.push(index);
    }
  }

  return {
    matchedDelimiters,
    unmatchedOpeners: stack,
    unmatchedClosers,
    topLevelPositions,
    topLevelCommas
  };
};

export const matchingDslDelimiter = (
  source: string,
  open: number,
  end = source.length
): number => {
  const delimiter = source[open];
  if (delimiter !== "(" && delimiter !== "[") return -1;
  const scan = scanDslNesting(source, { start: open, end });
  const pair = scan.matchedDelimiters.find((candidate) =>
    candidate.open.index === open && candidate.open.delimiter === delimiter
  );
  if (!pair || scan.unmatchedClosers.some((closer) => closer.index <= pair.close.index)) return -1;
  return pair.close.index;
};

const trimSpan = (source: string, span: DslSpan): DslSpan => {
  let start = span.start;
  let end = span.end;
  while (start < end && isWhitespace(source[start])) start += 1;
  while (end > start && isWhitespace(source[end - 1])) end -= 1;
  return { start, end };
};

/** Finds whitespace-led `key:` boundaries for recovery && diagnostics. */
const namedArgBoundaries = (source: string, callSpan: DslSpan, options: ScanCallArgsOptions): NamedArgBoundary[] => {
  const boundaries: NamedArgBoundary[] = [];
  const nesting = scanDslNesting(source, callSpan);

  for (let index = callSpan.start; index < callSpan.end; index += 1) {
    const character = source[index];
    if (
      !nesting.topLevelPositions.has(index) ||
      !isIdentifierStart(character) ||
      (index > callSpan.start && !isWhitespace(source[index - 1]))
    ) continue;

    let keyEnd = index + 1;
    while (keyEnd < callSpan.end && isIdentifierPart(source[keyEnd]) && source[keyEnd] !== "?") keyEnd += 1;
    const optional = options.allowOptionalKeys === true && source[keyEnd] === "?" && source[keyEnd + 1] === ":";
    const colon = optional ? keyEnd + 1 : keyEnd;
    // `::` belongs to a qualified reference, not an argument boundary.
    if (source[colon] !== ":" || source[colon + 1] === ":") continue;

    boundaries.push({
      key: source.slice(index, keyEnd),
      keySpan: { start: index, end: keyEnd },
      colon,
      optionalSpan: optional ? { start: keyEnd, end: keyEnd + 1 } : null,
    });
  }
  return boundaries;
};

/** Splits only depth-zero commas; commas in strings, arrays, && nested calls stay in values. */
const argumentSegments = (source: string, callSpan: DslSpan): ArgumentSegment[] => {
  const segments: ArgumentSegment[] = [];
  const nesting = scanDslNesting(source, callSpan);
  let start = callSpan.start;
  let precedingComma: number | null = null;

  for (const index of nesting.topLevelCommas) {
    segments.push({ span: { start, end: index }, precedingComma });
    start = index + 1;
    precedingComma = index;
  }
  segments.push({ span: { start, end: callSpan.end }, precedingComma });
  return segments;
};

const addNamedArg = (
  source: string,
  boundary: NamedArgBoundary,
  end: number,
  args: ScannedArg[],
  errors: DslArgScanError[],
) => {
  const rawValueSpan = { start: boundary.colon + 1, end };
  const valueSpan = trimSpan(source, rawValueSpan);
  const isEmpty = valueSpan.start === valueSpan.end;
  args.push({
    key: boundary.key,
    keySpan: boundary.keySpan,
    ...(boundary.optionalSpan ? { optionalSpan: boundary.optionalSpan } : {}),
    value: source.slice(valueSpan.start, valueSpan.end),
    valueSpan,
    ...(isEmpty ? { rawValueSpan } : {}),
  });
  if (isEmpty) {
    errors.push({
      message: `引数「${boundary.key}」の値がありません。`,
      span: valueSpan,
      code: MISSING_ATTRIBUTE_VALUE_CODE,
    });
  }
};

/**
 * Splits call arguments on top-level commas. Recovery retains whitespace-led
 * `key:` boundaries && reports every missing comma while retaining the
 * recovered argument spans for editor features.
 */
export const scanCallArgs = (
  logicalText: string,
  callSpan: DslSpan,
  options: ScanCallArgsOptions = {},
): { args: ScannedArg[]; errors: DslArgScanError[] } => {
  const args: ScannedArg[] = [];
  const errors: DslArgScanError[] = [];
  const segments = argumentSegments(logicalText, callSpan);

  for (const [segmentIndex, segment] of segments.entries()) {
    const trimmed = trimSpan(logicalText, segment.span);
    const isTrailingSegment = segmentIndex === segments.length - 1;
    if (trimmed.start === trimmed.end) {
      if (segments.length === 1 && segment.precedingComma === null) continue;
      // One optional comma may appear directly before the closing paren.
      if (!(isTrailingSegment && segment.precedingComma !== null)) {
        const marker = segment.precedingComma ?? trimmed.start;
        errors.push({
          message: "空の引数があります。",
          span: { start: marker, end: Math.min(marker + 1, callSpan.end) },
          code: EMPTY_ARGUMENT_CODE,
        });
      }
      continue;
    }

    // Keep the segment's outer whitespace for an empty value's rawValueSpan.
    // Completion relies on that span when a delete leaves `key: , next:`.
    const boundaries = namedArgBoundaries(logicalText, segment.span, options);
    const firstNamedStart = boundaries[0]?.keySpan.start ?? trimmed.end;
    const positionalSpan = trimSpan(logicalText, { start: trimmed.start, end: firstNamedStart });
    if (positionalSpan.start !== positionalSpan.end) {
      args.push({
        key: null,
        keySpan: null,
        value: logicalText.slice(positionalSpan.start, positionalSpan.end),
        valueSpan: positionalSpan,
      });
    }

    for (const [boundaryIndex, boundary] of boundaries.entries()) {
      if (boundaryIndex > 0 || positionalSpan.start !== positionalSpan.end) {
        errors.push({
          message: `引数「${boundary.key}」の前に「,」が必要です。`,
          span: boundary.keySpan,
          code: MISSING_ARGUMENT_COMMA_CODE,
        });
      }
      const end = boundaries[boundaryIndex + 1]?.keySpan.start ?? segment.span.end;
      addNamedArg(logicalText, boundary, end, args, errors);
    }
  }
  return { args, errors };
};
