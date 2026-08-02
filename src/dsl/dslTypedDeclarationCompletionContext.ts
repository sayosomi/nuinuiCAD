// Pure, catalog-free typed declaration initializer completion context
// (Task 39). Re-parses only the single statement the cursor is in - never
// the document - and never resolves `@name` types itself; see
// docs/typed-variables/tasks/39-typed-value-completion.md and
// src/scalars/scalarExpressionPositionClassifier.ts for the shared
// operand/operator position analysis this delegates to.

import { parseDslTypedDeclarationStatement } from "./dslDeclarationParser";
import type { DslSpan } from "./dslTypes";
import { scalarExpressionCompletionContextAt, type ScalarExpressionCompletionContext } from "../scalars/scalarExpressionPositionClassifier";
import type { ScalarType } from "../scalars/types";
import {
  typedGeometryPropertyCompletionContextAt,
  type TypedGeometryPropertyCompletionContext
} from "./dslTypedGeometryPropertyCompletionContext";

export type TypedDeclarationInitializerCompletionContext = {
  declaredType: ScalarType;
  positionContext: ScalarExpressionCompletionContext;
  geometryProperty?: TypedGeometryPropertyCompletionContext;
};

/**
 * `parseDslTypedDeclarationStatement`'s own `payloadSpans.initializer`, when
 * present, is trimmed of trailing whitespace (mirrors every other payload
 * span's convention), and is entirely absent when the trimmed text is empty -
 * exactly the common "cursor right after `=`, nothing typed yet" completion
 * moment. Rather than changing that established parser contract (other
 * consumers, e.g. Source Editor value-span navigation, rely on the trimmed
 * span/its absence), this always widens the end boundary to the end of
 * `logicalText` (nothing follows an initializer in this statement grammar,
 * so trailing whitespace - or a not-yet-typed operator - is always fair
 * completion territory) and, when the span is entirely absent, falls back to
 * the text after the first `=` for its start - safe here specifically
 * because that branch only ever runs when nothing meaningful has been typed
 * after it yet (no quoted content exists yet to contain a confounding `=`).
 */
const initializerSpanIncludingEmpty = (logicalText: string, existing: DslSpan | undefined): DslSpan | null => {
  if (existing) return { start: existing.start, end: logicalText.length };
  const equalsIndex = logicalText.indexOf("=");
  if (equalsIndex < 0) return null;
  return { start: equalsIndex + 1, end: logicalText.length };
};

/**
 * `logicalText` is the statement's own logical projection (or a single
 * physical line - this function has no opinion on which, matching
 * dslCompletionContext.ts's own convention), `pos` a local offset into it.
 * Returns `null` whenever the statement isn't a typed declaration, its type
 * annotation didn't parse, or the cursor sits outside the initializer.
 */
export const typedDeclarationInitializerCompletionContext = (
  logicalText: string,
  pos: number
): TypedDeclarationInitializerCompletionContext | null => {
  const { statement } = parseDslTypedDeclarationStatement(logicalText);
  if (!statement || statement.declaredType === null) return null;
  const span = initializerSpanIncludingEmpty(logicalText, statement.payloadSpans.initializer);
  if (!span || pos < span.start || pos > span.end) return null;
  const geometryProperty = typedGeometryPropertyCompletionContextAt(logicalText, pos, span, statement.declaredType);
  if (geometryProperty) {
    return {
      declaredType: statement.declaredType,
      geometryProperty,
      positionContext: {
        kind: "operand",
        from: geometryProperty.from,
        to: geometryProperty.to,
        referenceOnly: false,
        literalOnly: false,
        expectedType: statement.declaredType
      }
    };
  }
  const positionContext = scalarExpressionCompletionContextAt(logicalText, pos, span, statement.declaredType);
  if (!positionContext) return null;
  return { declaredType: statement.declaredType, positionContext };
};
