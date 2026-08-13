import { isBareDslIdentifierChar } from "./dslTokens";
import type { DslSpan } from "./dslTypes";

export type ScannedArg = {
  /** `null` represents the leading positional argument. */
  key: string | null;
  /** The bare key, without its trailing colon. */
  keySpan: DslSpan | null;
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
  missingSpaceAfterColon: boolean;
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

const trimSpan = (source: string, span: DslSpan): DslSpan => {
  let start = span.start;
  let end = span.end;
  while (start < end && isWhitespace(source[start])) start += 1;
  while (end > start && isWhitespace(source[end - 1])) end -= 1;
  return { start, end };
};

/** Finds whitespace-led `key:` boundaries for recovery && diagnostics. */
const namedArgBoundaries = (source: string, callSpan: DslSpan): NamedArgBoundary[] => {
  const boundaries: NamedArgBoundary[] = [];
  let quote: string | null = null;
  let depth = 0;

  for (let index = callSpan.start; index < callSpan.end; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && !isEscaped(source, index)) quote = null;
      continue;
    }
    if ((character === '"' || character === "'") && !isEscaped(source, index)) {
      quote = character;
      continue;
    }
    if (character === "(" || character === "[") {
      depth += 1;
      continue;
    }
    if (character === ")" || character === "]") {
      depth -= 1;
      continue;
    }
    if (
      depth !== 0 ||
      !isIdentifierStart(character) ||
      (index > callSpan.start && !isWhitespace(source[index - 1]))
    ) continue;

    let keyEnd = index + 1;
    while (keyEnd < callSpan.end && isIdentifierPart(source[keyEnd])) keyEnd += 1;
    // `::` belongs to a qualified reference, not an argument boundary.
    if (source[keyEnd] !== ":" || source[keyEnd + 1] === ":") continue;

    const valueStart = keyEnd + 1;
    boundaries.push({
      key: source.slice(index, keyEnd),
      keySpan: { start: index, end: keyEnd },
      colon: keyEnd,
      missingSpaceAfterColon: valueStart < callSpan.end && !isWhitespace(source[valueStart]),
    });
  }
  return boundaries;
};

/** Splits only depth-zero commas; commas in strings, arrays, && nested calls stay in values. */
const argumentSegments = (source: string, callSpan: DslSpan): ArgumentSegment[] => {
  const segments: ArgumentSegment[] = [];
  let quote: string | null = null;
  let depth = 0;
  let start = callSpan.start;
  let precedingComma: number | null = null;

  for (let index = callSpan.start; index < callSpan.end; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && !isEscaped(source, index)) quote = null;
      continue;
    }
    if ((character === '"' || character === "'") && !isEscaped(source, index)) {
      quote = character;
    } else if (character === "(" || character === "[") {
      depth += 1;
    } else if (character === ")" || character === "]") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      segments.push({ span: { start, end: index }, precedingComma });
      start = index + 1;
      precedingComma = index;
    }
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
    value: source.slice(valueSpan.start, valueSpan.end),
    valueSpan,
    ...(isEmpty ? { rawValueSpan } : {}),
  });
  if (boundary.missingSpaceAfterColon) {
    errors.push({
      message: `引数「${boundary.key}」の「:」の後には空白が必要です。`,
      span: { start: boundary.colon, end: boundary.colon + 1 },
    });
  }
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
    const boundaries = namedArgBoundaries(logicalText, segment.span);
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
