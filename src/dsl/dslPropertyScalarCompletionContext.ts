// Pure, catalog-free completion context for a schema-typed scalar element
// property value. The compiler accepts the same shared scalar expression
// frontend used by declarations && conditions; this context only identifies
// the reference/literal completion lane && leaves expression parsing to the
// normal source diagnostics.
//
// Eligibility is derived from the parameter's scalar schema kind; the legacy
// Property scalar eligibility comes from the parameter schema alone.

import { scalarTypeForParameterDefinition, type ParameterDefinition } from "../parameters/parameterDefinitions";
import type { ScalarType } from "../scalars/types";
import type { DslSpan } from "./dslTypes";
import { expressionReferenceTokenEndingAt } from "./expressionReferenceToken";

export type PropertyScalarValueCompletionContext =
  | { readonly kind: "reference"; readonly from: number; readonly to: number; readonly expectedType: ScalarType }
  | { readonly kind: "booleanLiteral"; readonly from: number; readonly to: number };

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
  // Only a scalar-eligible boolean field gets a new literal candidate here -
  // choice fields keep their existing enum-literal completion branch
  // (cmAutocomplete.ts, unchanged), && a bare (non-"@") text field value can
  // never be a completable identifier run in the first place.
  if (definition.kind === "boolean" &&  scalarTypeForParameterDefinition(definition)?.kind === "boolean") {
    return { kind: "booleanLiteral", from: span.start, to: pos };
  }
  return null;
};
