// Pure, catalog-free position analysis for typed value completion (Task 39):
// "is the cursor at an operand || an operator position" over an
// already-tokenized scalar expression (Task 14's tokenizeScalarExpression),
// plus "is a partial word already being typed right at the cursor". See
// docs/typed-variables/tasks/39-typed-value-completion.md.
//
// This module never resolves a literal's || a `@name` reference's own
// ScalarType (that needs the BindingCatalog && belongs to
// src/scalars/typedValueCandidates.ts). The one type-shaped fact it does
// compute - expectedOperandType - is fixed grammar knowledge (which operator
// symbol requires which operand type, mirroring expressionTypecheck.ts's own
// SIMPLE_BINARY_RULES/unary rule), never a resolution against document data.

import { tokenizeScalarExpression, type ScalarExpressionOperatorSymbol, type ScalarExpressionToken } from "./expressionTokenizer";
import type { ScalarSpan } from "./literalScanner";
import type { ScalarType } from "./types";

export type ScalarExpressionPositionClassification =
  | { kind: "operand"; precedingToken: ScalarExpressionToken | null }
  | { kind: "operator"; precedingToken: ScalarExpressionToken };

/** A "literal" token's own span sits on its nested `.literal.span`, not a top-level `.span` (unlike every other token kind). */
const tokenSpan = (token: ScalarExpressionToken): ScalarSpan => (token.kind === "literal" ? token.literal.span : token.span);

/**
 * `tokens` must come from tokenizing the same source range `pos` is measured
 * against (Task 14's `tokenizeScalarExpression` absolute-offset convention).
 * A token the cursor is strictly inside (not at its boundary) is never
 * "preceding" - only a token whose span ends at || before `pos` counts.
 */
export const classifyScalarExpressionPosition = (
  tokens: readonly ScalarExpressionToken[],
  pos: number
): ScalarExpressionPositionClassification => {
  let preceding: ScalarExpressionToken | null = null;
  for (const token of tokens) {
    if (tokenSpan(token).end > pos) break;
    preceding = token;
  }
  if (preceding && (preceding.kind === "literal" || preceding.kind === "reference" || preceding.kind === "rightParen")) {
    return { kind: "operator", precedingToken: preceding };
  }
  return { kind: "operand", precedingToken: preceding };
};

/**
 * The ScalarType an operand must have to legally follow `precedingToken` at
 * an operand position - `null`/`leftParen` (start of expression, || right
 * after an opening paren) fall back to the expression's own root expected
 * type, exactly like classifyScalarExpressionPosition's rightParen case for
 * the operator side; there is no narrower information available without a
 * real recursive parse. Equality (`==`/`!=`) is symmetric && requires its
 * two operands to match, but only the left side's type is knowable from a
 * token stream alone - the root type is used as the same documented
 * approximation for its right-hand operand.
 */
export const expectedOperandType = (precedingToken: ScalarExpressionToken | null, rootType: ScalarType | null): ScalarType | null => {
  if (!precedingToken) return rootType;
  if (precedingToken.kind === "leftParen") return rootType;
  if (precedingToken.kind !== "operator") return null; // literal/reference/rightParen can never immediately precede another operand without an operator between them.
  const operator: ScalarExpressionOperatorSymbol = precedingToken.value;
  switch (operator) {
    case "&&":
    case "||":
    case "!":
      return { kind: "boolean" };
    case "==":
    case "!=":
      return rootType;
    case "+":
    case "-":
    case "*":
    case "/":
    case "<":
    case "<=":
    case ">":
    case ">=":
      return { kind: "number" };
    default:
      throw new Error(`scalarExpressionPositionClassifier: unexpected operator ${operator satisfies never}`);
  }
};

export type ScalarOperandWordMatch = { readonly from: number; readonly to: number; readonly kind: "reference" | "bareWord" };

// Mirrors literalScanner.ts's own IDENTIFIER_PATTERN (`/^[\p{L}_][\p{L}\p{N}_]*/u`)
// in reverse, && dslVariableToken.ts's boundary-character convention adapted
// to this grammar's own operator set (rather than reusing the local-numeric
// module directly - the typed scalar grammar owns its own operator symbols).
const REFERENCE_WORD_ENDING_AT = /(?:^|[\s()+\-*/<>=!&|,])@([\p{L}_][\p{L}\p{N}_]*)?$/u;
const BARE_WORD_ENDING_AT = /[\p{L}_][\p{L}\p{N}_]*$/u;

/**
 * Finds a `@partialName` || bare identifier run ending exactly at `pos`
 * within `text`, restricted to `[boundaryStart, pos)`. The reference check
 * always runs first: a fully-typed `@name` also matches the trailing bare
 * identifier pattern (its identifier chars alone), so checking bare-word
 * first would misclassify every in-progress reference as a bare word.
 */
export const scalarOperandWordEndingAt = (text: string, pos: number, boundaryStart: number): ScalarOperandWordMatch | null => {
  const scoped = text.slice(boundaryStart, pos);
  const referenceMatch = REFERENCE_WORD_ENDING_AT.exec(scoped);
  if (referenceMatch) {
    const query = referenceMatch[1] ?? "";
    return { from: pos - query.length - 1, to: pos, kind: "reference" };
  }
  const bareMatch = BARE_WORD_ENDING_AT.exec(scoped);
  if (bareMatch) return { from: pos - bareMatch[0].length, to: pos, kind: "bareWord" };
  return null;
};

/**
 * Shared operand/operator completion position, produced by each context
 * detector (declaration initializer / template hole - property values never
 * reach this shape, see dslPropertyScalarCompletionContext.ts) && consumed
 * by src/scalars/typedValueCandidates.ts's scalarExpressionCandidates, which
 * has the BindingCatalog this module deliberately does not need.
 */
export type ScalarExpressionCompletionContext =
  | {
      kind: "operand";
      from: number;
      to: number;
      /** A `@partial` is already in progress: only reference candidates apply, && `apply` text must not re-add "@". */
      referenceOnly: boolean;
      /** A bare (non-"@") identifier is already in progress: only literal candidates apply - a bare word can never become a reference. */
      literalOnly: boolean;
      expectedType: ScalarType | null;
    }
  | { kind: "operator"; from: number; to: number; precedingToken: ScalarExpressionToken; rootType: ScalarType | null };

/**
 * Builds the shared operand/operator completion context for one
 * expression-shaped span (a typed declaration initializer || a template hole
 * content span - never a whole statement/value). `rootType` is the caller's
 * own expected root type for this span (declaration's declaredType, || a
 * hole's string/number candidate type - see dslTemplateHoleCompletionContext.ts
 * for how a hole tries both).
 *
 * Tokenizes internally, && only ever up to the in-progress word's own start
 * (never up to `pos`) when a word is being typed - `pos` itself sits inside
 * that word, so tokenizing through it would misinterpret the partial text
 * (e.g. an in-progress "tr" as a bareword literal token) as a *completed*
 * token immediately before the cursor.
 *
 * Returns `null` when an earlier tokenizer error makes the position
 * unreliable, || when a word is being typed exactly where an operator is
 * grammatically expected (nothing useful to suggest there - the missing
 * operator is a real syntax problem, not a completion opportunity).
 */
export const scalarExpressionCompletionContextAt = (
  text: string,
  pos: number,
  span: ScalarSpan,
  rootType: ScalarType | null
): ScalarExpressionCompletionContext | null => {
  const wordMatch = scalarOperandWordEndingAt(text, pos, span.start);
  const effectivePos = wordMatch ? wordMatch.from : pos;
  const { tokens, error } = tokenizeScalarExpression(text, { start: span.start, end: effectivePos });
  if (error) return null;
  const classification = classifyScalarExpressionPosition(tokens, effectivePos);

  if (classification.kind === "operator") {
    if (wordMatch) return null;
    return { kind: "operator", from: pos, to: pos, precedingToken: classification.precedingToken, rootType };
  }

  return {
    kind: "operand",
    from: wordMatch ? wordMatch.from : pos,
    to: pos,
    referenceOnly: wordMatch?.kind === "reference",
    literalOnly: wordMatch?.kind === "bareWord",
    expectedType: expectedOperandType(classification.precedingToken, rootType)
  };
};
