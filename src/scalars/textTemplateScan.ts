// Task 26: single forward-pass scan of a `label(text: "...")` raw quoted
// value that resolves string escapes AND template holes (`${...}`) in
// exactly one pass over the characters - never two. See
// docs/typed-variables/tasks/26-text-template-analysis.md.
//
// This is deliberately not built on top of scanScalarLiteral's *output*
// (calling it once for escapes, then walking `raw` a second time for
// braces): that would scan the same characters twice. Instead this module
// reuses literalScanner.ts's own escape table (STRING_ESCAPES, exported for
// this purpose) && reimplements the same character-by-character walk with
// one added concern - brace/hole tracking - checked in the same loop
// iteration as the escape check, so escape detection always takes priority
// over brace detection at every position (D08: a hole scanner "distinguishes
// an escaped brace from a real hole delimiter before string-unescaping").
//
// Literal (non-hole) runs also track a *cooked-coordinate* offset range
// (cookedRange) alongside their raw span, && each hole records a single
// cookedInsertOffset - the position, in that same coordinate space, where
// its (length-unknown-until-evaluated) value will be spliced into the final
// text. Raw && cooked lengths diverge whenever an escape appears (`\n` is
// two raw characters but one cooked character), so downstream tasks
// (27, 43) can map between the two without re-scanning.

import { STRING_ESCAPES, type ScalarSpan, type ScalarStringEscape } from "./literalScanner";

export type TextTemplateRawLiteralSegment = {
  readonly kind: "literal";
  /** Raw span in the original quoted source. */
  readonly span: ScalarSpan;
  /** Offset range in the template's cooked-coordinate space (each hole
   * contributes zero width to this space - its actual rendered length is
   * only known at evaluation time). */
  readonly cookedRange: ScalarSpan;
  /** Fully escape-processed text for this run. */
  readonly cooked: string;
};

export type TextTemplateRawHoleSegment = {
  readonly kind: "hole";
  /** Raw span including both `${` && `}`. */
  readonly span: ScalarSpan;
  /** Raw span of the hole's inner content, excluding `${` && `}`. */
  readonly contentSpan: ScalarSpan;
  /** Position in cooked-coordinate space where this hole's value is spliced in. */
  readonly cookedInsertOffset: number;
};

export type TextTemplateRawSegment = TextTemplateRawLiteralSegment | TextTemplateRawHoleSegment;

export type TextTemplateScanIssueCode =
  | "unterminated-string"
  | "physical-newline-in-string"
  | "invalid-string-escape"
  | "interpolation-nested-not-supported"
  | "interpolation-empty"
  | "unterminated-interpolation";

export type TextTemplateScanError = {
  readonly kind: "error";
  readonly issueCode: TextTemplateScanIssueCode;
  readonly span: ScalarSpan;
  readonly message: string;
};

export type TextTemplateRawStringScan = {
  readonly kind: "string";
  /** Span including both quote characters. */
  readonly span: ScalarSpan;
  readonly quote: '"' | "'";
  /** Exact source text between the quotes, escape sequences unprocessed. */
  readonly raw: string;
  readonly escapes: readonly ScalarStringEscape[];
  readonly segments: readonly TextTemplateRawSegment[];
};

export type TextTemplateScanResult = TextTemplateRawStringScan | TextTemplateScanError;

const isQuoteChar = (char: string): char is '"' | "'" => char === "\"" || char === "'";

const scanError = (issueCode: TextTemplateScanIssueCode, span: ScalarSpan, message: string): TextTemplateScanError => ({
  kind: "error",
  issueCode,
  span,
  message
});

/**
 * Scans exactly one quoted string literal starting at `span.start`, never
 * reading past `span.end`, producing both escape-aware literal/hole segments
 * in one linear pass. Mirrors scanScalarLiteral's string-only error
 * repertoire (unterminated-string / invalid-string-escape /
 * physical-newline-in-string) plus four brace-structure errors this module
 * owns. Single fatal error per call, no recovery - matches every other
 * scalar scanner/parser in this subsystem.
 */
export const scanTextTemplateLiteral = (source: string, span: ScalarSpan): TextTemplateScanResult => {
  const boundEnd = Math.min(span.end, source.length);
  const start = span.start;

  if (start < 0 || start >= boundEnd || !isQuoteChar(source[start])) {
    return scanError("unterminated-string", { start, end: Math.max(start + 1, boundEnd) }, "expected a string literal");
  }
  const quote = source[start] as '"' | "'";
  const contentStart = start + 1;

  const escapes: ScalarStringEscape[] = [];
  const segments: TextTemplateRawSegment[] = [];
  let cookedParts: string[] = [];
  let cookedCursor = 0;

  let segStart = contentStart; // raw start of the current literal run
  let runStart = contentStart; // raw start of the pending plain sub-run awaiting flush
  let holeSpanStart = -1;
  let holeContentStart = -1;
  let inHole = false;

  const flushPlainRun = (rawEnd: number) => {
    if (rawEnd > runStart) cookedParts.push(source.slice(runStart, rawEnd));
  };

  const commitLiteralSegment = (rawEnd: number) => {
    flushPlainRun(rawEnd);
    if (rawEnd > segStart) {
      const cooked = cookedParts.join("");
      segments.push({
        kind: "literal",
        span: { start: segStart, end: rawEnd },
        cookedRange: { start: cookedCursor, end: cookedCursor + cooked.length },
        cooked
      });
      cookedCursor += cooked.length;
    }
    cookedParts = [];
  };

  let index = contentStart;
  while (index < boundEnd) {
    const char = source[index];

    if (char === "\\") {
      if (index + 1 >= boundEnd) break; // dangling backslash at the boundary: unterminated below
      const escapedChar = source[index + 1];
      const replacement = STRING_ESCAPES[escapedChar];
      if (replacement === undefined) {
        return scanError("invalid-string-escape", { start: index, end: index + 2 }, `unknown string escape \\${escapedChar}`);
      }
      if (!inHole) flushPlainRun(index);
      escapes.push({ span: { start: index, end: index + 2 }, raw: source.slice(index, index + 2), cooked: replacement });
      if (!inHole) cookedParts.push(replacement);
      index += 2;
      if (!inHole) runStart = index;
      continue;
    }

    if (char === "\n" || char === "\r") {
      return scanError(
        "physical-newline-in-string",
        { start: index, end: index + 1 },
        "string literals cannot contain a physical newline; use \\n || \\r"
      );
    }

    if (char === quote) {
      if (inHole) {
        return scanError("unterminated-interpolation", { start: holeSpanStart, end: index }, "text template hole is missing its closing '}'");
      }
      commitLiteralSegment(index);
      return { kind: "string", span: { start, end: index + 1 }, quote, raw: source.slice(contentStart, index), escapes, segments };
    }

    if (char === "$" && source[index + 1] === "{") {
      if (inHole) {
        return scanError("interpolation-nested-not-supported", { start: index, end: index + 1 }, "nested interpolation is not supported inside a text template hole");
      }
      commitLiteralSegment(index);
      inHole = true;
      holeSpanStart = index;
      holeContentStart = index + 2;
      index += 2;
      continue;
    }

    if (char === "}") {
      if (!inHole) {
        index += 1;
        continue;
      }
      if (index === holeContentStart) {
        return scanError("interpolation-empty", { start: holeSpanStart, end: index + 1 }, "text template hole cannot be empty");
      }
      segments.push({
        kind: "hole",
        span: { start: holeSpanStart, end: index + 1 },
        contentSpan: { start: holeContentStart, end: index },
        cookedInsertOffset: cookedCursor
      });
      inHole = false;
      segStart = index + 1;
      runStart = index + 1;
      index += 1;
      continue;
    }

    index += 1;
  }

  if (inHole) {
    return scanError("unterminated-interpolation", { start: holeSpanStart, end: boundEnd }, "text template hole is missing its closing '}'");
  }
  return scanError("unterminated-string", { start, end: boundEnd }, "string literal is missing its closing quote");
};
