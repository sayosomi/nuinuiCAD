// Flat, single-pass tokenizer for typed scalar expressions. Handles
// operators, parentheses, and the `@name` reference sigil itself; delegates
// every literal-shaped token (quote/digit/identifier start) to
// scanScalarLiteral (Task 09) so literal classification lives in exactly one
// place. See docs/typed-variables/tasks/14-ts-expression-parser.md and
// docs/typed-variables/tasks/09-scalar-literal-scanner.md.
//
// Stops at the first error (its own, or scanScalarLiteral's) rather than
// attempting recovery - matches expressionParser.ts's exclusive
// success/failure contract, and guarantees termination on malformed input.

import { scanScalarLiteral, type ScalarLiteralToken, type ScalarSpan } from "./literalScanner";
import type { ScalarExpressionIssueCode } from "./expressionAst";

export type ScalarExpressionOperatorSymbol =
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
  | "!";

export type ScalarExpressionToken =
  | { readonly kind: "leftParen"; readonly span: ScalarSpan }
  | { readonly kind: "rightParen"; readonly span: ScalarSpan }
  | { readonly kind: "operator"; readonly value: ScalarExpressionOperatorSymbol; readonly span: ScalarSpan }
  | { readonly kind: "reference"; readonly name: string; readonly nameSpan: ScalarSpan; readonly span: ScalarSpan }
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

// Checked before 1-char operators so `&&`/`||`/`==`/`!=`/`>=`/`<=` never
// tokenize as two separate single-char operators.
const TWO_CHAR_OPERATORS = new Set(["&&", "||", "==", "!=", ">=", "<="]);
const ONE_CHAR_OPERATORS = new Set(["+", "-", "*", "/", "<", ">", "!"]);

// Same Unicode-aware identifier shape as literalScanner.ts's own
// IDENTIFIER_PATTERN (user-authored binding names are frequently Japanese),
// deliberately duplicated rather than imported: this tokenizer owns the `@`
// reference sigil, and literalScanner.ts's pattern explicitly excludes `@`
// so the two never need to share a definition.
const REFERENCE_NAME_PATTERN = /^[\p{L}_][\p{L}\p{N}_]*/u;

// Task 51: `@Name.property` (an element-property reference) is legal in the
// legacy numeric-expression grammar but never in a typed scalar expression -
// this evaluator is deliberately geometry-free in both engines (see
// expressionEvaluator.ts and Rust scalars/expression_evaluator.rs). Matches
// the same property-path run the legacy tokenizer accepts
// (numericExpressionParser.ts's referenceMatch second group), so the
// diagnostic span covers the whole `@Name.a.b` occurrence a user would need
// to move to a numeric (legacy) expression instead.
const PROPERTY_PATH_PATTERN = /^[^\s()+*/<>!=&|]*/;

const isWhitespace = (char: string) => char === " " || char === "\t" || char === "\n" || char === "\r";

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

    const twoChar = index + 1 < end ? source.slice(index, index + 2) : "";
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

    if (char === "@") {
      const nameStart = index + 1;
      const match = REFERENCE_NAME_PATTERN.exec(source.slice(nameStart, end));
      if (!match) {
        return {
          tokens,
          error: {
            code: "unexpected-token",
            span: { start: index, end: index + 1 },
            message: "「@」の後にbinding名が必要です。"
          }
        };
      }
      const nameSpan: ScalarSpan = { start: nameStart, end: nameStart + match[0].length };
      if (source[nameSpan.end] === ".") {
        const propertyMatch = PROPERTY_PATH_PATTERN.exec(source.slice(nameSpan.end + 1, end));
        const propertyPath = propertyMatch?.[0] ?? "";
        return {
          tokens,
          error: {
            code: "geometry-property-in-typed-expression",
            span: { start: index, end: nameSpan.end + 1 + propertyPath.length },
            message: `幾何プロパティ参照「@${match[0]}.${propertyPath}」は numeric(legacy)式でのみ使用できます。型付きのconst/let初期化子やset式の中では使用できません。`
          }
        };
      }
      tokens.push({ kind: "reference", name: match[0], nameSpan, span: { start: index, end: nameSpan.end } });
      index = nameSpan.end;
      continue;
    }

    // Everything else (quote, digit, `.digit`, identifier, or any
    // unrecognized character) is scanScalarLiteral's call to make - it
    // already owns the "is this the start of a valid literal" decision.
    const result = scanScalarLiteral(source, { start: index, end });
    if (result.kind === "error") {
      return {
        tokens,
        error: { code: remapLiteralIssueCode(result.issueCode), span: result.span, message: result.message }
      };
    }
    tokens.push({ kind: "literal", literal: result });
    index = result.span.end;
  }

  return { tokens, error: null };
};
