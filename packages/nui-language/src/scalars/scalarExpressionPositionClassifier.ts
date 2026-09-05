// Pure, catalog-free position analysis for typed value completion:
// "is the cursor at an operand || an operator position" over an
// already-tokenized scalar expression (tokenizeScalarExpression),
// plus "is a partial word already being typed right at the cursor".
//
// This module never resolves a literal's || a `@name` reference's own
// ScalarType (that needs the BindingCatalog && belongs to
// src/scalars/typedValueCandidates.ts). The one type-shaped fact it does
// compute - expectedOperandType - is fixed grammar knowledge (which operator
// symbol requires which operand type, mirroring expressionTypecheck.ts's own
// SIMPLE_BINARY_RULES/unary rule), never a resolution against document data.

import { tokenizeScalarExpression, type ScalarExpressionOperatorSymbol, type ScalarExpressionToken } from "./expressionTokenizer";
import { getBuiltinFunctionDefinition, isScalarBuiltinParameterType } from "./builtinFunctions";
import type { ScalarSpan } from "./literalScanner";
import type { ScalarType } from "./types";

export type ScalarExpressionPositionClassification =
  | { kind: "operand"; precedingToken: ScalarExpressionToken | null }
  | { kind: "operator"; precedingToken: ScalarExpressionToken };

/** A "literal" token's own span sits on its nested `.literal.span`, not a top-level `.span` (unlike every other token kind). */
const tokenSpan = (token: ScalarExpressionToken): ScalarSpan => (token.kind === "literal" ? token.literal.span : token.span);

/**
 * `tokens` must come from tokenizing the same source range `pos` is measured
 * against `tokenizeScalarExpression`'s absolute-offset convention.
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
  if (precedingToken.kind === "comma") return rootType;
  if (precedingToken.kind !== "operator") return null;
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
    case "%":
    case "^":
    case "<":
    case "<=":
    case ">":
    case ">=":
      return { kind: "number" };
    default:
      throw new Error(`scalarExpressionPositionClassifier: unexpected operator ${operator satisfies never}`);
  }
};

type ScalarCallContext = {
  readonly openingIndex: number;
  readonly definition: NonNullable<ReturnType<typeof getBuiltinFunctionDefinition>>;
};

const callContextAt = (tokens: readonly ScalarExpressionToken[], anchorIndex: number): ScalarCallContext | null => {
  let nesting = 0;
  for (let index = anchorIndex; index >= 0; index -= 1) {
    const token = tokens[index];
    if (token.kind === "rightParen") {
      nesting += 1;
      continue;
    }
    if (token.kind !== "leftParen") continue;
    if (nesting > 0) {
      nesting -= 1;
      continue;
    }
    const functionToken = tokens[index - 1];
    if (!functionToken || functionToken.kind !== "literal" || functionToken.literal.kind !== "choice") return null;
    const definition = getBuiltinFunctionDefinition(functionToken.literal.raw);
    return definition ? { openingIndex: index, definition } : null;
  }
  return null;
};

const directNamedArgumentNames = (
  tokens: readonly ScalarExpressionToken[],
  openingIndex: number,
  endIndex: number
): ReadonlySet<string> => {
  const names = new Set<string>();
  let nesting = 0;
  for (let index = openingIndex + 1; index <= endIndex; index += 1) {
    const token = tokens[index];
    if (token.kind === "leftParen") {
      nesting += 1;
      continue;
    }
    if (token.kind === "rightParen") {
      nesting = Math.max(0, nesting - 1);
      continue;
    }
    if (nesting !== 0 || token.kind !== "literal" || token.literal.kind !== "choice") continue;
    if (tokens[index + 1]?.kind === "colon") names.add(token.literal.raw);
  }
  return names;
};

const namedArgumentNamesAt = (
  tokens: readonly ScalarExpressionToken[],
  anchorIndex: number
): readonly string[] | null => {
  const call = callContextAt(tokens, anchorIndex);
  if (!call) return null;
  const signature = call.definition.signatures.find((candidate) => candidate.callingStyle === "named");
  if (!signature) return null;
  const preceding = tokens[anchorIndex];
  if (!preceding || (preceding.kind !== "leftParen" && preceding.kind !== "comma")) return null;
  if (preceding.kind === "leftParen" && anchorIndex !== call.openingIndex) return null;
  const used = directNamedArgumentNames(tokens, call.openingIndex, anchorIndex - 1);
  return signature.parameters
    .map((parameter) => parameter.name)
    .filter((name) => !used.has(name));
};

/**
 * The root expected type is not enough inside a builtin call: `isClose(` is a
 * boolean expression, but all three of its arguments are numbers. Resolve
 * only this narrow editor fact from the token stream; full arity/type
 * validation remains owned by expressionTypecheck.ts. A builtin-wide
 * `anyChoice` constraint intentionally returns null because completion cannot
 * invent a concrete choice option set.
 */
const builtinArgumentTypeAt = (
  tokens: readonly ScalarExpressionToken[],
  precedingToken: ScalarExpressionToken,
  rootType: ScalarType | null
): ScalarType | null => {
  const precedingIndex = tokens.lastIndexOf(precedingToken);
  if (precedingToken.kind === "colon") {
    const nameToken = precedingIndex > 0 ? tokens[precedingIndex - 1] : null;
    const call = callContextAt(tokens, precedingIndex - 2);
    const signature = call?.definition.signatures.find((candidate) => candidate.callingStyle === "named");
    if (nameToken?.kind === "literal" && nameToken.literal.kind === "choice" && signature) {
      const parameter = signature.parameters.find((candidate) => candidate.name === nameToken.literal.raw);
      return parameter && isScalarBuiltinParameterType(parameter.type) && parameter.type.kind !== "anyChoice"
        ? parameter.type
        : null;
    }
    return expectedOperandType(precedingToken, rootType);
  }
  if (precedingToken.kind !== "leftParen" && precedingToken.kind !== "comma") return expectedOperandType(precedingToken, rootType);
  if (precedingIndex < 0) return expectedOperandType(precedingToken, rootType);
  const call = callContextAt(tokens, precedingIndex);
  if (!call) {
    return expectedOperandType(precedingToken, rootType);
  }
  const namedSignature = call.definition.signatures.find((signature) => signature.callingStyle === "named");
  if (namedSignature) return expectedOperandType(precedingToken, rootType);
  let nestedDepth = 0;
  let argumentIndex = 0;
  for (let index = call.openingIndex + 1; index <= precedingIndex; index += 1) {
    const token = tokens[index];
    if (token.kind === "leftParen") {
      nestedDepth += 1;
    } else if (token.kind === "rightParen") {
      nestedDepth = Math.max(0, nestedDepth - 1);
    } else if (token.kind === "comma" && nestedDepth === 0) {
      argumentIndex += 1;
    }
  }
  const parameterType = call.definition.signatures
    .filter((signature) => signature.callingStyle === "positional")
    .find((signature) => signature.parameters.length > argumentIndex)?.parameters[argumentIndex]?.type;
  return parameterType && isScalarBuiltinParameterType(parameterType) && parameterType.kind !== "anyChoice"
    ? parameterType
    : parameterType && isScalarBuiltinParameterType(parameterType) && parameterType.kind === "anyChoice"
      ? null
      : expectedOperandType(precedingToken, rootType);
};

export type ScalarOperandWordMatch = { readonly from: number; readonly to: number; readonly kind: "reference" | "bareWord" };

// Mirrors literalScanner.ts's own IDENTIFIER_PATTERN (`/^[\p{L}_][\p{L}\p{N}_]*/u`)
// in reverse, && dslVariableToken.ts's boundary-character convention adapted
// to this grammar's own operator set (rather than reusing the local-numeric
// module directly - the typed scalar grammar owns its own operator symbols).
const REFERENCE_WORD_ENDING_AT = /(?:^|[\s()+\-*/<>=!&|,:])@([\p{L}_][\p{L}\p{N}_]*)?$/u;
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
 * detector (declaration initializer / template hole / scalar property) && consumed
 * by src/scalars/typedValueCandidates.ts's scalarExpressionCandidates, which
 * has the BindingCatalog this module deliberately does not need.
 */
export type ScalarExpressionCompletionContext =
  | { kind: "argumentName"; from: number; to: number; names: readonly string[] }
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

  if (classification.kind === "operand") {
    const names = namedArgumentNamesAt(tokens, tokens.length - 1);
    if (names && (!wordMatch || wordMatch.kind === "bareWord")) {
      return { kind: "argumentName", from: wordMatch ? wordMatch.from : pos, to: pos, names };
    }
  }

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
    expectedType: classification.precedingToken
      ? builtinArgumentTypeAt(tokens, classification.precedingToken, rootType)
      : rootType
  };
};
