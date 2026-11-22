// Flat, single-pass tokenizer for typed scalar expressions. Handles
// operators, parentheses, comma, colon, choice `@option` markers, and bare
// lexical references; delegates every literal-shaped token (quote/digit/identifier start) to
// scanScalarLiteral so literal classification lives in exactly one place.
//
// Stops at the first error (its own, || scanScalarLiteral's) rather than
// attempting recovery - matches expressionParser.ts's exclusive
// success/failure contract, && guarantees termination on malformed input.

import { IDENTIFIER_PATTERN, isScalarIdentifierCharacterAt, scanScalarLiteral, type ScalarLiteralToken, type ScalarSpan } from "./literalScanner";
import type { ScalarExpressionIssueCode } from "./expressionAst";
import { isDslReferencePropertyBoundary, parseDslSourceReferenceAt, type DslSourceReference } from "../dsl/dslReferenceTokens";

export type ScalarExpressionOperatorSymbol =
  | "??"
  | "||"
  | "&&"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "^"
  | "!";

export type ScalarExpressionToken =
  | { readonly kind: "leftParen"; readonly span: ScalarSpan }
  | { readonly kind: "rightParen"; readonly span: ScalarSpan }
  | { readonly kind: "leftBrace"; readonly span: ScalarSpan }
  | { readonly kind: "rightBrace"; readonly span: ScalarSpan }
  | { readonly kind: "leftBracket"; readonly span: ScalarSpan }
  | { readonly kind: "rightBracket"; readonly span: ScalarSpan }
  | { readonly kind: "comma"; readonly span: ScalarSpan }
  | { readonly kind: "colon"; readonly span: ScalarSpan }
  | { readonly kind: "arrow"; readonly span: ScalarSpan }
  | { readonly kind: "operator"; readonly value: ScalarExpressionOperatorSymbol; readonly span: ScalarSpan }
  | { readonly kind: "reference"; readonly name: string; readonly nameSpan: ScalarSpan; readonly span: ScalarSpan }
  | { readonly kind: "geometryProperty"; readonly elementName: string; readonly elementNameSpan: ScalarSpan; readonly property: string; readonly propertySpan: ScalarSpan; readonly span: ScalarSpan }
  | { readonly kind: "postfixProperty"; readonly property: string; readonly propertySpan: ScalarSpan; readonly span: ScalarSpan }
  | { readonly kind: "optionalPostfixProperty"; readonly property: string; readonly propertySpan: ScalarSpan; readonly operatorSpan: ScalarSpan; readonly span: ScalarSpan }
  | { readonly kind: "literal"; readonly literal: ScalarLiteralToken };

export interface ScalarExpressionTokenizeError {
  readonly code: ScalarExpressionIssueCode;
  readonly span: ScalarSpan;
  readonly message: string;
}

export interface ScalarExpressionTokenizeResult {
  readonly tokens: readonly ScalarExpressionToken[];
  readonly error: ScalarExpressionTokenizeError | null;
}

// Checked before 1-char operators so ` && `/` || `/`==`/`!=`/`>=`/`<=` never
// tokenize as two separate single-char operators.
const TWO_CHAR_OPERATORS = new Set(["??", "&&", "||", "==", "!=", ">=", "<="]);
const ONE_CHAR_OPERATORS = new Set(["+", "-", "*", "/", "%", "^", "<", ">", "!"]);
const WORD_OPERATORS: Readonly<Record<string, ScalarExpressionOperatorSymbol>> = {
  and: "&&",
  or: "||",
  not: "!"
};

const isWhitespace = (char: string) => char === " " || char === "\t" || char === "\n" || char === "\r";

const skipWhitespace = (source: string, start: number, end: number): number => {
  let index = start;
  while (index < end && isWhitespace(source[index]!)) index += 1;
  return index;
};

const isOptionalSomeArm = (source: string, wordEnd: number, end: number): boolean => {
  const next = skipWhitespace(source, wordEnd, end);
  if (source.slice(next, next + 2) === "=>") return true;
  const binder = IDENTIFIER_PATTERN.exec(source.slice(next, end))?.[0];
  if (!binder) return false;
  const arrow = skipWhitespace(source, next + binder.length, end);
  return source.slice(arrow, arrow + 2) === "=>";
};

const sourceReferenceToken = (reference: DslSourceReference): ScalarExpressionToken => {
  if (reference.property && reference.propertyRange) {
    return {
      kind: "geometryProperty",
      elementName: reference.pathText,
      elementNameSpan: reference.pathRange,
      property: reference.property,
      propertySpan: reference.propertyRange,
      span: reference.fullRange
    };
  }
  return { kind: "reference", name: reference.pathText, nameSpan: reference.pathRange, span: reference.fullRange };
};

const choiceLiteralToken = (raw: string, span: ScalarSpan): ScalarExpressionToken => ({
  kind: "literal",
  literal: { kind: "choice", raw, span }
});

const wordOperatorAt = (source: string, index: number, start: number, end: number): string | undefined => {
  return Object.keys(WORD_OPERATORS).find((word) => {
    if (!source.startsWith(word, index)) return false;
    const previousIsIdentifier = index > start && isScalarIdentifierCharacterAt(source, index - 1);
    const nextIndex = index + word.length;
    const nextIsIdentifier = nextIndex < end && isScalarIdentifierCharacterAt(source, nextIndex);
    return !previousIsIdentifier && !nextIsIdentifier;
  });
};

/** Shared word-operator scan for expression-shape classification. */
export const containsScalarWordOperator = (source: string): boolean => {
  for (let index = 0; index < source.length; index += 1) {
    if (wordOperatorAt(source, index, 0, source.length)) return true;
  }
  return false;
};

const remapLiteralIssueCode = (issueCode: string): ScalarExpressionIssueCode =>
  issueCode === "invalid-literal-token" ? "unexpected-token" : (issueCode as ScalarExpressionIssueCode);

/**
 * Tokenizes exactly the range `[span.start, span.end)` of `source`, never
 * reading past `span.end`. All token spans are absolute offsets into
 * `source`, matching scanScalarLiteral's own convention.
 */
export const tokenizeScalarExpression = (source: string, span: ScalarSpan): ScalarExpressionTokenizeResult => {
  const tokens: ScalarExpressionToken[] = [];
  const end = Math.min(span.end, source.length);
  let index = Math.max(span.start, 0);

  while (index < end) {
    const char = source[index];
    if (isWhitespace(char)) {
      index += 1;
      continue;
    }

    if (char === "(") {
      tokens.push({ kind: "leftParen", span: { start: index, end: index + 1 } });
      index += 1;
      continue;
    }
    if (char === ")") {
      tokens.push({ kind: "rightParen", span: { start: index, end: index + 1 } });
      index += 1;
      continue;
    }
    if (char === "{") {
      tokens.push({ kind: "leftBrace", span: { start: index, end: index + 1 } });
      index += 1;
      continue;
    }
    if (char === "}") {
      tokens.push({ kind: "rightBrace", span: { start: index, end: index + 1 } });
      index += 1;
      continue;
    }
    if (char === "[") {
      tokens.push({ kind: "leftBracket", span: { start: index, end: index + 1 } });
      index += 1;
      continue;
    }
    if (char === "]") {
      tokens.push({ kind: "rightBracket", span: { start: index, end: index + 1 } });
      index += 1;
      continue;
    }
    if (source.slice(index, index + 2) === "?.") {
      let propertyEnd = index + 2;
      while (propertyEnd < end && !isDslReferencePropertyBoundary(source[propertyEnd]!)) propertyEnd += 1;
      if (propertyEnd > index + 2) {
        tokens.push({
          kind: "optionalPostfixProperty",
          property: source.slice(index + 2, propertyEnd),
          propertySpan: { start: index + 2, end: propertyEnd },
          operatorSpan: { start: index, end: index + 2 },
          span: { start: index, end: propertyEnd }
        });
        index = propertyEnd;
        continue;
      }
    }
    if (char === "." && index + 1 < end && !/[0-9]/.test(source[index + 1]!)) {
      let propertyEnd = index + 1;
      while (propertyEnd < end && !isDslReferencePropertyBoundary(source[propertyEnd]!)) propertyEnd += 1;
      if (propertyEnd > index + 1) {
        tokens.push({
          kind: "postfixProperty",
          property: source.slice(index + 1, propertyEnd),
          propertySpan: { start: index + 1, end: propertyEnd },
          span: { start: index, end: propertyEnd }
        });
        index = propertyEnd;
        continue;
      }
    }
    if (char === ",") {
      tokens.push({ kind: "comma", span: { start: index, end: index + 1 } });
      index += 1;
      continue;
    }
    if (source.slice(index, index + 2) === "::") {
      const parsed = parseDslSourceReferenceAt(source, index, end, { parseOccurrenceIndex: false });
      if (parsed.kind === "invalid") {
        return { tokens, error: { code: "unexpected-token", span: parsed.error.range, message: parsed.error.message } };
      }
      const reference = parsed.reference;
      const next = skipWhitespace(source, parsed.end, end);
      if (!reference.property && source[next] === "(") {
        tokens.push(choiceLiteralToken(reference.pathText, reference.pathRange));
      } else {
        tokens.push(sourceReferenceToken(reference));
      }
      index = parsed.end;
      continue;
    }
    if (char === ":") {
      tokens.push({ kind: "colon", span: { start: index, end: index + 1 } });
      index += 1;
      continue;
    }

    const twoChar = index + 1 < end ? source.slice(index, index + 2) : "";
    if (twoChar === "=>") {
      tokens.push({ kind: "arrow", span: { start: index, end: index + 2 } });
      index += 2;
      continue;
    }
    if (TWO_CHAR_OPERATORS.has(twoChar)) {
      tokens.push({ kind: "operator", value: twoChar as ScalarExpressionOperatorSymbol, span: { start: index, end: index + 2 } });
      index += 2;
      continue;
    }

    if (ONE_CHAR_OPERATORS.has(char)) {
      tokens.push({ kind: "operator", value: char as ScalarExpressionOperatorSymbol, span: { start: index, end: index + 1 } });
      index += 1;
      continue;
    }

    const wordOperator = wordOperatorAt(source, index, span.start, end);
    if (wordOperator) {
      tokens.push({
        kind: "operator",
        value: WORD_OPERATORS[wordOperator],
        span: { start: index, end: index + wordOperator.length }
      });
      index += wordOperator.length;
      continue;
    }

    if (char === "@") {
      const candidate = scanScalarLiteral(source, { start: index + 1, end });
      if (candidate.kind === "error") {
        return {
          tokens,
          error: {
            code: remapLiteralIssueCode(candidate.issueCode),
            span: candidate.span,
            message: candidate.message
          }
        };
      }
      if (candidate.kind === "string") {
        return {
          tokens,
          error: {
            code: "unexpected-token",
            span: candidate.span,
            message: "choice option は引用符で囲めません。"
          }
        };
      }
      if (!IDENTIFIER_PATTERN.test(candidate.raw)) {
        return {
          tokens,
          error: { code: "unexpected-token", span: candidate.span, message: "「@」の後にchoice option名が必要です。" }
        };
      }
      tokens.push(choiceLiteralToken(candidate.raw, { start: index, end: candidate.span.end }));
      index = candidate.span.end;
      continue;
    }

    // Everything else (quote, digit, `.digit`, identifier, || any
    // unrecognized character) is scanScalarLiteral's call to make - it
    // already owns the "is this the start of a valid literal" decision.
    const result = scanScalarLiteral(source, { start: index, end });
    if (result.kind === "error") {
      return {
        tokens,
        error: { code: remapLiteralIssueCode(result.issueCode), span: result.span, message: result.message }
      };
    }
    if (result.kind === "choice") {
      if (["if", "else", "match", "none"].includes(result.raw) || (result.raw === "some" && isOptionalSomeArm(source, result.span.end, end))) {
        tokens.push({ kind: "literal", literal: result });
        index = result.span.end;
        continue;
      }

      const parsed = parseDslSourceReferenceAt(source, index, end, { parseOccurrenceIndex: false });
      if (parsed.kind === "invalid") {
        return { tokens, error: { code: "unexpected-token", span: parsed.error.range, message: parsed.error.message } };
      }
      const reference = parsed.reference;
      const next = skipWhitespace(source, parsed.end, end);
      const isSimpleRelativeName = !reference.path.absolute && reference.path.segments.length === 1 && reference.property === null;
      if (!reference.property && source[next] === "(") {
        tokens.push(choiceLiteralToken(reference.pathText, reference.pathRange));
      } else if (isSimpleRelativeName && source[next] === ":" && source[next + 1] !== ":") {
        tokens.push(choiceLiteralToken(reference.pathText, reference.pathRange));
      } else {
        tokens.push(sourceReferenceToken(reference));
      }
      index = parsed.end;
      continue;
    }
    tokens.push({ kind: "literal", literal: result });
    index = result.span.end;
  }

  return { tokens, error: null };
};
