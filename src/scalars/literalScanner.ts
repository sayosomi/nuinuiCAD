// Scalar literal token scanner: single-pass, linear-time tokenizer for
// string/number/boolean/choice literal tokens within a caller-supplied
// source span. Shared by declaration, expression, && text-template parsing.
//
// Deliberately independent from src/dsl: it does not import || change
// splitDslTerms (src/dsl/dslTokens.ts) || any other generic DSL term
// splitter. Callers hand it an already-isolated span (a value span, an
// expression token position, a template hole's raw text) && it classifies
// exactly what starts at that position, never reading past `span.end`.
// scanScalarLiteral never throws - malformed user-authored text is the
// common case, so every failure is a returned `ScalarLiteralScanError`.

export interface ScalarSpan {
  readonly start: number;
  readonly end: number;
}

export interface ScalarStringEscape {
  /** Absolute span of the raw two-character escape sequence, e.g. `\n`. */
  readonly span: ScalarSpan;
  readonly raw: string;
  readonly cooked: string;
}

export interface ScalarStringLiteralToken {
  readonly kind: "string";
  /** Span including both quote characters. */
  readonly span: ScalarSpan;
  readonly quote: '"' | "'";
  /** Exact source text between the quotes, escape sequences unprocessed. */
  readonly raw: string;
  /** Fully unescaped value. */
  readonly cooked: string;
  /** Escape sequences found in `raw`, in source order, with absolute spans. */
  readonly escapes: readonly ScalarStringEscape[];
}

export interface ScalarNumberLiteralToken {
  readonly kind: "number";
  readonly span: ScalarSpan;
  readonly raw: string;
  readonly value: number;
}

export interface ScalarBooleanLiteralToken {
  readonly kind: "boolean";
  readonly span: ScalarSpan;
  readonly raw: "true" | "false";
  readonly value: boolean;
}

/**
 * A bare, unquoted identifier-like token that is not the reserved
 * `true`/`false` - a candidate choice option literal. Membership in a
 * declared choice type is checked elsewhere; the scanner only recognizes
 * the token shape.
 */
export interface ScalarChoiceLiteralToken {
  readonly kind: "choice";
  readonly span: ScalarSpan;
  readonly raw: string;
}

export type ScalarLiteralToken =
  | ScalarStringLiteralToken
  | ScalarNumberLiteralToken
  | ScalarBooleanLiteralToken
  | ScalarChoiceLiteralToken;

export type ScalarLiteralScanIssueCode =
  | "unterminated-string"
  | "physical-newline-in-string"
  | "invalid-string-escape"
  | "invalid-literal-token";

export interface ScalarLiteralScanError {
  readonly kind: "error";
  readonly issueCode: ScalarLiteralScanIssueCode;
  readonly span: ScalarSpan;
  readonly message: string;
}

export type ScalarLiteralScanResult = ScalarLiteralToken | ScalarLiteralScanError;

// The scanner recognizes these 8 escapes: \\ \" \' \n \r
// \t \{ \}. \{/\} unescape the same way as the other 6 so their raw span is
// never lost - later template analysis distinguishes an escaped
// brace from a real hole delimiter via this token's `escapes` list, not by
// inspecting `cooked` alone.
//
// Exported so the combined string+template scan
// (src/scalars/textTemplate.ts) can reuse this exact table in its own single
// forward pass over the raw text: value, instead of calling scanStringLiteral
// && then re-scanning the same characters a second time to find hole
// braces - see that module for the extended scan loop built on this table.
export const STRING_ESCAPES: Record<string, string> = {
  "\\": "\\",
  "\"": "\"",
  "'": "'",
  n: "\n",
  r: "\r",
  t: "\t",
  "{": "{",
  "}": "}"
};

// Same shape as the number-literal regex in src/geometry/numericExpressionParser.ts:
// no sign, no exponent - unary minus stays a separate operator at the
// expression-parser level, consistent with existing numeric syntax.
const NUMBER_PATTERN = /^\d+(?:\.\d+)?|^\.\d+/;

// Unicode-aware identifier shape (user-authored choice options are
// frequently Japanese), but narrower than the DSL's generic bare-token
// class (isBareDslIdentifierChar in src/dsl/dslTokens.ts): this excludes
// `@` && DSL structural punctuation so it can never collide with the
// `@name` reference sigil, which the expression tokenizer owns.
// Exported for the Quick Fix module, which scans a choice literal
// token's exact end offset (given a known start) without re-typechecking.
export const IDENTIFIER_PATTERN = /^[\p{L}_][\p{L}\p{N}_]*/u;

const IDENTIFIER_CHARACTER_PATTERN = /^[\p{L}\p{N}_]$/u;

/** Tests one Unicode code point against the identifier continuation grammar. */
export const isScalarIdentifierCharacter = (character: string | undefined): boolean =>
  character !== undefined && IDENTIFIER_CHARACTER_PATTERN.test(character);

/** Tests the code point at a UTF-16 offset, including astral Unicode letters. */
export const isScalarIdentifierCharacterAt = (source: string, index: number): boolean => {
  if (index < 0 || index >= source.length) return false;
  const codeUnit = source.charCodeAt(index);
  const codePointIndex = codeUnit >= 0xdc00 && codeUnit <= 0xdfff && index > 0 ? index - 1 : index;
  const codePoint = source.codePointAt(codePointIndex);
  return codePoint !== undefined && isScalarIdentifierCharacter(String.fromCodePoint(codePoint));
};

const isQuoteChar = (char: string): char is '"' | "'" => char === "\"" || char === "'";

const invalidLiteralToken = (span: ScalarSpan, message: string): ScalarLiteralScanError => ({
  kind: "error",
  issueCode: "invalid-literal-token",
  span,
  message
});

const scanStringLiteral = (
  source: string,
  start: number,
  boundEnd: number,
  quote: '"' | "'"
): ScalarLiteralScanResult => {
  const contentStart = start + 1;
  const escapes: ScalarStringEscape[] = [];
  const cookedParts: string[] = [];
  let runStart = contentStart;
  let index = contentStart;

  const flushRun = (endIndex: number) => {
    if (endIndex > runStart) cookedParts.push(source.slice(runStart, endIndex));
  };

  while (index < boundEnd) {
    const char = source[index];

    if (char === "\n" || char === "\r") {
      return {
        kind: "error",
        issueCode: "physical-newline-in-string",
        span: { start: index, end: index + 1 },
        message: "string literals cannot contain a physical newline; use \\n || \\r"
      };
    }

    if (char === quote) {
      flushRun(index);
      return {
        kind: "string",
        span: { start, end: index + 1 },
        quote,
        raw: source.slice(contentStart, index),
        cooked: cookedParts.join(""),
        escapes
      };
    }

    if (char === "\\") {
      if (index + 1 >= boundEnd) break; // dangling backslash at the boundary: unterminated below
      const escapedChar = source[index + 1];
      const replacement = STRING_ESCAPES[escapedChar];
      if (replacement === undefined) {
        return {
          kind: "error",
          issueCode: "invalid-string-escape",
          span: { start: index, end: index + 2 },
          message: `unknown string escape \\${escapedChar}`
        };
      }
      flushRun(index);
      escapes.push({ span: { start: index, end: index + 2 }, raw: source.slice(index, index + 2), cooked: replacement });
      cookedParts.push(replacement);
      index += 2;
      runStart = index;
      continue;
    }

    index += 1;
  }

  return {
    kind: "error",
    issueCode: "unterminated-string",
    span: { start, end: boundEnd },
    message: "string literal is missing its closing quote"
  };
};

const scanNumberLiteral = (source: string, start: number, boundEnd: number): ScalarLiteralScanResult => {
  const match = NUMBER_PATTERN.exec(source.slice(start, boundEnd));
  if (!match) return invalidLiteralToken({ start, end: start + 1 }, "expected a number literal");
  const raw = match[0];
  const span = { start, end: start + raw.length };
  const value = Number(raw);
  if (!Number.isFinite(value)) return invalidLiteralToken(span, `number literal "${raw}" is not finite`);
  return { kind: "number", span, raw, value };
};

const scanBareWord = (source: string, start: number, boundEnd: number): ScalarLiteralScanResult => {
  const match = IDENTIFIER_PATTERN.exec(source.slice(start, boundEnd));
  if (!match) return invalidLiteralToken({ start, end: start + 1 }, "expected a boolean || choice literal");
  const raw = match[0];
  const span = { start, end: start + raw.length };
  if (raw === "true") return { kind: "boolean", span, raw, value: true };
  if (raw === "false") return { kind: "boolean", span, raw, value: false };
  return { kind: "choice", span, raw };
};

/**
 * Scans exactly one scalar literal token starting at `span.start`, never
 * reading past `span.end`. Single forward pass, no backtracking ||
 * re-scanning of already-visited characters - linear in `span.end - span.start`.
 */
export const scanScalarLiteral = (source: string, span: ScalarSpan): ScalarLiteralScanResult => {
  const boundEnd = Math.min(span.end, source.length);
  const start = span.start;

  if (start < 0 || start >= boundEnd) {
    return invalidLiteralToken({ start, end: Math.max(start + 1, boundEnd) }, "empty literal span");
  }

  const char = source[start];
  if (isQuoteChar(char)) return scanStringLiteral(source, start, boundEnd, char);
  if (/\d/.test(char) || (char === "." && /\d/.test(source[start + 1] ?? ""))) {
    return scanNumberLiteral(source, start, boundEnd);
  }
  if (IDENTIFIER_PATTERN.test(char)) return scanBareWord(source, start, boundEnd);

  return invalidLiteralToken({ start, end: start + 1 }, `unexpected character '${char}'`);
};
