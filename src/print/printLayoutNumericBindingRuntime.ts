// Task 53: materializes compiled printLayout/place typed `@name` occurrences
// into plain literals before the legacy numeric-expression evaluator runs -
// the same splice algorithm src/geometry/numericBindingRuntime.ts uses for
// element parameters, but reading from the document's already-evaluated
// `computedScalarBindings` (a finished, terminal snapshot) rather than a
// live/interleaved resolver.
//
// This is safe specifically because printLayout is the document's true
// final sink (see AGENTS.md / Task 53 plan): no `set`, typed declaration,
// element, or group may appear after the first printLayout block, so the
// terminal value of any binding IS its value at every printLayout/place
// occurrence - there is no "value at this point in the document" to get
// wrong. Do not reuse this module's pattern for any future consumer that
// isn't guaranteed to run after the whole document, the way
// groupPrintEnabledRuntime.ts's `isGroupPrintEnabled` also relies on that
// same guarantee for `printEnabled`.
import type { EvaluationResult } from "../types/geometry";
import type { CompiledDslDocument, StatementMap } from "../dsl/dslDocument";
import type { CompiledNumericBinding } from "../scalars/numericBindingCompiler";
import { propertyBindingOccurrenceKey } from "../scalars/propertyBindingCompiler";
import { numericLiteralForExpression } from "../scalars/numericLiteral";

export type PrintLayoutNumericBindingLookup = {
  numericBindings: CompiledDslDocument["numericBindings"];
  byKey: StatementMap["byKey"];
};

export const printLayoutStatementKey = (layoutId: string) => `printLayout:${layoutId}`;
export const printLayoutPlacementStatementKey = (layoutId: string, placementIndex: number) =>
  `place:${layoutId}:${placementIndex}`;

/** Resolves the compiled occurrence for one printLayout/place attribute, or
 * undefined when the statement wasn't found, has no compiled binding for
 * this key, or is a plain literal/measurement-only expression. */
export const printLayoutCompiledNumericBinding = (
  lookup: PrintLayoutNumericBindingLookup | undefined,
  statementKey: string,
  parameterKey: string
): CompiledNumericBinding | undefined => {
  if (!lookup) return undefined;
  const statementIndex = lookup.byKey.get(statementKey)?.statementIndex;
  if (statementIndex === undefined) return undefined;
  return lookup.numericBindings?.get(propertyBindingOccurrenceKey(statementIndex, parameterKey));
};

/** Splices each resolved typed reference's terminal value into `binding`'s
 * expression text, reusing the exact reverse-offset substitution algorithm
 * `materializeNumericBindingElement` (numericBindingRuntime.ts) uses for
 * element parameters. Returns null (fail closed) if any reference doesn't
 * resolve to a finite number - callers fall back to their existing default,
 * never a stale/partial value. */
export const materializePrintLayoutNumericBinding = (
  binding: CompiledNumericBinding,
  computedScalarBindings: EvaluationResult["computedScalarBindings"]
): string | null => {
  let expression = binding.expression;
  for (const reference of [...binding.references].reverse()) {
    const evaluation = computedScalarBindings?.get(reference.bindingId);
    if (
      evaluation?.status !== "ok" ||
      evaluation.type.kind !== "number" ||
      typeof evaluation.value.value !== "number" ||
      !Number.isFinite(evaluation.value.value)
    ) {
      return null;
    }
    if (expression.slice(reference.expressionStart, reference.expressionEnd) !== `@${reference.name}`) return null;
    const literal = numericLiteralForExpression(evaluation.value.value);
    if (literal === null) return null;
    expression = `${expression.slice(0, reference.expressionStart)}${literal}${expression.slice(reference.expressionEnd)}`;
  }
  return expression;
};
