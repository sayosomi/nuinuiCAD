// Pure, catalog-free completion context for a schema-typed scalar element
// property value. The compiler accepts the same shared scalar expression
// frontend used by declarations && conditions; this context identifies the
// reference/expression completion lane && leaves expression parsing to the
// normal source diagnostics.
//
// Eligibility is derived from the parameter's scalar schema kind; the legacy
// Property scalar eligibility comes from the parameter schema alone.

import { scalarTypeForParameterDefinition, type ParameterDefinition } from "../parameters/parameterDefinitions";
import type { ScalarType } from "../scalars/types";
import type { DslSpan } from "./dslTypes";
import { expressionReferenceTokenEndingAt } from "./expressionReferenceToken";
import { scalarExpressionCompletionContextAt, type ScalarExpressionCompletionContext } from "../scalars/scalarExpressionPositionClassifier";

export type PropertyScalarValueCompletionContext =
  | { readonly kind: "reference"; readonly from: number; readonly to: number; readonly expectedType: ScalarType }
  | { readonly kind: "booleanLiteral"; readonly from: number; readonly to: number }
  | { readonly kind: "expression"; readonly from: number; readonly to: number; readonly positionContext: ScalarExpressionCompletionContext };

/**
 * `lineText`/`span`/`pos` follow the same local-text convention as every
 * other dslCompletionContext.ts detector (statement logical text || a single
 * physical line, absolute-to-that-text offsets). `span` is the labeled
 * value's full span as already resolved by the existing element-statement
 * value-span scan; this function only interprets it, it does not re-scan
 * for the span itself.
 */
export const propertyScalarValueCompletionContext = (
  lineText: string,
  span: DslSpan,
  pos: number,
  definition: ParameterDefinition
): PropertyScalarValueCompletionContext | null => {
  if (pos < span.start || pos > span.end) return null;
  // A quoted text value owns its interpolation holes; the @ inside
  // "\${@name}" is not the whole property value && must reach the template
  // hole completion lane below dslCompletionContext.ts.
  if (definition.kind === "text" && /^["']/.test(lineText.slice(span.start).trimStart())) return null;
  const reference = expressionReferenceTokenEndingAt(lineText, pos, { boundaryStart: span.start });
  if (reference?.kind === "binding") {
    const expectedType = scalarTypeForParameterDefinition(definition);
    return expectedType ? { kind: "reference", from: reference.from, to: reference.to, expectedType } : null;
  }
  // Boolean properties use the same expression-position analysis
  // as declarations and set RHS values. This is what makes a builtin such as
  // `isClose(` available in a boolean property while preserving the existing
  // direct `@name` lane above.
  const expectedType = scalarTypeForParameterDefinition(definition);
  if (definition.kind === "boolean" && expectedType?.kind === "boolean" && lineText.slice(span.start, pos).trim().length === 0) {
    return { kind: "booleanLiteral", from: span.start, to: pos };
  }
  if (expectedType && definition.kind === "boolean") {
    const positionContext = scalarExpressionCompletionContextAt(lineText, pos, span, expectedType);
    if (positionContext) return { kind: "expression", from: positionContext.from, to: positionContext.to, positionContext };
  }
  return null;
};
