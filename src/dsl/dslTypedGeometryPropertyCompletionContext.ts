// Completion-only recognition for an unfinished `@Element.property` inside a
// typed scalar expression. The regular scalar tokenizer rightly reports an
// unfinished property as syntax-invalid, so this narrow pre-check runs before
// callers ask it for the normal literal/reference position.
import { expressionReferenceTokenEndingAt } from "./expressionReferenceToken";
import type { DslSpan } from "./dslTypes";
import { scalarExpressionCompletionContextAt } from "../scalars/scalarExpressionPositionClassifier";
import type { ScalarType } from "../scalars/types";

export type TypedGeometryPropertyCompletionContext = {
  from: number;
  to: number;
  tokenStart: number;
  elementToken: string;
};

export const typedGeometryPropertyCompletionContextAt = (
  text: string,
  pos: number,
  expressionSpan: DslSpan,
  expectedType: ScalarType | null
): TypedGeometryPropertyCompletionContext | null => {
  if (expectedType?.kind !== "number") return null;
  const reference = expressionReferenceTokenEndingAt(text, pos, { boundaryStart: expressionSpan.start });
  if (!reference || reference.kind !== "elementProperty" || !reference.sigil) return null;

  // The prefix before this `@Element.` must be an operand position. This
  // prevents completion from masking a missing operator such as `1 @AB.`.
  const prefix = scalarExpressionCompletionContextAt(text, reference.tokenStart, expressionSpan, expectedType);
  if (!prefix || prefix.kind !== "operand") return null;

  return {
    from: reference.from,
    to: reference.to,
    tokenStart: reference.tokenStart,
    elementToken: reference.elementToken
  };
};
