import type { DslSpan } from "./dslTypes";

export type ScannedArg = {
  /** `null` represents the leading positional argument. */
  key: string | null;
  /** The bare key, without its trailing colon. */
  keySpan: DslSpan | null;
  value: string;
  valueSpan: DslSpan;
};

export type DslArgScanError = {
  message: string;
  span: DslSpan;
};

type NamedArgBoundary = {
  key: string;
  keySpan: DslSpan;
  colon: number;
  missingSpaceAfterColon: boolean;
};

const isWhitespace = (value: string) => /\s/.test(value);
const isIdentifierStart = (value: string) => /[A-Za-z_]/.test(value);
const isIdentifierPart = (value: string) => /[A-Za-z0-9_]/.test(value);

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
    if (source[keyEnd] !== ":") continue;

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

/**
 * Splits v2 call arguments in a projected logical statement. Parsing the call
 * envelope and validating keys belongs to later parser stages; this function
 * only reports a leading positional argument and depth-zero named arguments.
 */
export const scanCallArgs = (
  logicalText: string,
  callSpan: DslSpan,
): { args: ScannedArg[]; errors: DslArgScanError[] } => {
  const boundaries = namedArgBoundaries(logicalText, callSpan);
  const args: ScannedArg[] = [];
  const errors: DslArgScanError[] = [];

  const firstNamedStart = boundaries[0]?.keySpan.start ?? callSpan.end;
  const positionalSpan = trimSpan(logicalText, { start: callSpan.start, end: firstNamedStart });
  if (positionalSpan.start !== positionalSpan.end) {
    args.push({
      key: null,
      keySpan: null,
      value: logicalText.slice(positionalSpan.start, positionalSpan.end),
      valueSpan: positionalSpan,
    });
  }

  for (const [index, boundary] of boundaries.entries()) {
    const nextStart = boundaries[index + 1]?.keySpan.start ?? callSpan.end;
    const valueSpan = trimSpan(logicalText, { start: boundary.colon + 1, end: nextStart });
    args.push({
      key: boundary.key,
      keySpan: boundary.keySpan,
      value: logicalText.slice(valueSpan.start, valueSpan.end),
      valueSpan,
    });

    if (boundary.missingSpaceAfterColon) {
      errors.push({
        message: `引数「${boundary.key}」の「:」の後には空白が必要です。`,
        span: { start: boundary.colon, end: boundary.colon + 1 },
      });
    }
    if (valueSpan.start === valueSpan.end) {
      errors.push({
        message: `引数「${boundary.key}」の値がありません。`,
        span: valueSpan,
      });
    }
  }

  return { args, errors };
};
