// Pure, catalog-free completion context for an opt-in scalar element property
// value (Task 39). Never offers expression operators - Task 22's
// `compilePropertyBindings` only ever accepts a property value that is a
// single bare literal or a single whole `@name` reference (never an
// expression), so this context mirrors that exact shape rather than reusing
// the declaration/hole expression machinery. See
// docs/typed-variables/tasks/39-typed-value-completion.md and
// docs/typed-variables/tasks/22-property-reference-typecheck.md.
//
// Eligibility is derived purely from `ParameterDefinition.propertyCapability`
// (src/parameters/parameterDefinitions.ts) - the same single metadata source
// Task 22 itself reads - never a hardcoded property count/list here. A
// property with no `propertyCapability` (including `conditionalGroup.condition`,
// which Task 25 compiles through a wholly separate arbitrary-boolean-expression
// path and which the D10 opt-in table never lists) is automatically excluded
// without this module needing to know it exists.

import type { ParameterDefinition } from "../parameters/parameterDefinitions";
import type { PropertyBindingCapability } from "../scalars/scalarAssignability";
import type { DslSpan } from "./dslTypes";

export type PropertyScalarValueCompletionContext =
  | { readonly kind: "reference"; readonly from: number; readonly to: number; readonly capability: PropertyBindingCapability }
  | { readonly kind: "booleanLiteral"; readonly from: number; readonly to: number };

/**
 * `lineText`/`span`/`pos` follow the same local-text convention as every
 * other dslCompletionContext.ts detector (statement logical text or a single
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
  const typedSoFar = lineText.slice(span.start, pos);
  if (typedSoFar.startsWith("@")) {
    // A non-opted-in property's stray "@..." value already gets Task 22's own
    // property-binding-not-supported diagnostic; completion adds nothing there.
    return definition.propertyCapability ? { kind: "reference", from: span.start, to: pos, capability: definition.propertyCapability } : null;
  }
  // Only a scalar-eligible boolean field gets a new literal candidate here -
  // choice fields keep their existing enum-literal completion branch
  // (cmAutocomplete.ts, unchanged), and a bare (non-"@") text field value can
  // never be a completable identifier run in the first place.
  if (definition.kind === "boolean" && definition.propertyCapability) {
    return { kind: "booleanLiteral", from: span.start, to: pos };
  }
  return null;
};
