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
import { parseDslSourceReferenceAt } from "../dsl/dslReferenceTokens";

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
  | { readonly kind: "geometryProperty"; readonly elementName: string; readonly elementNameSpan: ScalarSpan; readonly property: string; readonly propertySpan: ScalarSpan; readonly span: ScalarSpan }
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
      const parsed = parseDslSourceReferenceAt(source, index, end);
      if (parsed.kind === "invalid") {
        return {
          tokens,
          error: {
            code: "unexpected-token",
            span: parsed.error.range,
            message: parsed.error.message
          }
        };
      }
      const reference = parsed.reference;
      const nameSpan: ScalarSpan = reference.pathRange;
      if (reference.path.segments.length > 1 || reference.path.absolute) {
        if (!reference.property) {
          const separatorAt = reference.pathRange.start + reference.pathText.indexOf("::");
          return {
            tokens,
            error: {
              code: "unexpected-token",
              span: { start: separatorAt, end: separatorAt + 2 },
              message: "scoped element name は geometry property の参照でのみ使用できます。"
            }
          };
        }
      }
      if (reference.property && reference.propertyRange) {
        const propertySpan: ScalarSpan = reference.propertyRange;
        tokens.push({ kind: "geometryProperty", elementName: reference.pathText, elementNameSpan: nameSpan, property: reference.property, propertySpan, span: reference.fullRange });
        index = parsed.end;
        continue;
      }
      tokens.push({ kind: "reference", name: reference.pathText, nameSpan, span: reference.fullRange });
      index = parsed.end;
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
