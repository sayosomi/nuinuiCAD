// Task 53: materializes compiled printLayout/place typed `@name` occurrences
// into plain literals before the legacy numeric-expression evaluator runs -
// the same splice algorithm src/geometry/numericBindingRuntime.ts uses for
// element parameters. A linear-set document carries the existing
// binding-version history for live/source-ordered reads; documents without
// mutation history use the already-evaluated `computedScalarBindings`
// terminal snapshot.
//
// When that history && the compiled source position are available, the
// materializer reads the version visible at the printLayout/place site;
// documents without mutation history retain the existing terminal snapshot
// fallback.
import type { EvaluationResult } from "../types/geometry";
import type { CompiledDslDocument, StatementMap } from "../dsl/dslDocument";
import { beforeStatement, readBindingVersionAtPosition, type BindingVersionGraph } from "../scalars/bindingVersions";
import type { CompiledNumericBinding } from "../scalars/numericBindingCompiler";
import { propertyBindingOccurrenceKey } from "../scalars/propertyBindingCompiler";
import { numericLiteralForExpression } from "../scalars/numericLiteral";

export type PrintLayoutNumericBindingLookup = {
  numericBindings: CompiledDslDocument["numericBindings"];
  byKey: StatementMap["byKey"];
  bindingVersions?: BindingVersionGraph;
};

export const printLayoutStatementKey = (layoutId: string) => `printLayout:${layoutId}`;
export const printLayoutPlacementStatementKey = (layoutId: string, placementIndex: number) =>
  `place:${layoutId}:${placementIndex}`;

/** Resolves the compiled occurrence for one printLayout/place attribute, ||
 * undefined when the statement wasn't found, has no compiled binding for
 * this key, || is a plain literal/measurement-only expression. */
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

/** Splices each resolved typed reference's visible value into `binding`'s
 * expression text, reusing the exact reverse-offset substitution algorithm
 * `materializeNumericBindingElement` (numericBindingRuntime.ts) uses for
 * element parameters. Returns null (fail closed) if any reference doesn't
 * resolve to a finite number - callers fall back to their existing default,
 * never a stale/partial value. */
export const materializePrintLayoutNumericBinding = (
  binding: CompiledNumericBinding,
  computedScalarBindings: EvaluationResult["computedScalarBindings"],
  computedScalarBindingVersions?: EvaluationResult["computedScalarBindingVersions"],
  bindingVersions?: BindingVersionGraph,
  sourceOrder?: number
): string | null => {
  let expression = binding.expression;
  for (const reference of [...binding.references].reverse()) {
    const version = bindingVersions && sourceOrder !== undefined
      ? readBindingVersionAtPosition(bindingVersions, reference.bindingId, beforeStatement(sourceOrder))
      : undefined;
    const evaluation = computedScalarBindingVersions
      ? version
        ? computedScalarBindingVersions.get(version.id)?.evaluation
        : undefined
      : computedScalarBindings?.get(reference.bindingId);
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
