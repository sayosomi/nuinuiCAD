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
import type { BindingId } from "../scalars/bindingCatalog";
import type { CompiledNumericBinding } from "../scalars/numericBindingCompiler";
import { propertyBindingOccurrenceKey } from "../scalars/propertyBindingCompiler";
import { numericLiteralForExpression } from "../scalars/numericLiteral";
import { evaluateTypedExpression } from "../scalars/expressionEvaluator";
import type { ScalarEvaluation } from "../scalars/types";
import { resolveDocumentGeometryProperty } from "../geometry/scalarProgramEvaluation";

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

const resolvePrintLayoutBinding = (
  bindingId: BindingId,
  evaluation: EvaluationResult,
  sourceOrder: number | undefined,
  lookup: PrintLayoutNumericBindingLookup
): ScalarEvaluation => {
  const version = lookup.bindingVersions && sourceOrder !== undefined
    ? readBindingVersionAtPosition(lookup.bindingVersions, bindingId, beforeStatement(sourceOrder))
    : undefined;
  const result = evaluation.computedScalarBindingVersions
    ? version
      ? evaluation.computedScalarBindingVersions.get(version.id)?.evaluation
      : undefined
    : evaluation.computedScalarBindings?.get(bindingId);
  return result ?? {
    status: "error",
    type: { kind: "number" },
    issueCode: lookup.bindingVersions && sourceOrder !== undefined
      ? "evaluation-binding-version-unavailable"
      : "evaluation-binding-unavailable",
    bindingId
  };
};

export const evaluatePrintLayoutTypedNumericBinding = (
  binding: CompiledNumericBinding,
  evaluation: EvaluationResult,
  lookup: PrintLayoutNumericBindingLookup,
  sourceOrder: number | undefined
): ScalarEvaluation | undefined => {
  if (!binding.typedExpression) return undefined;
  return evaluateTypedExpression(binding.typedExpression, {
    lookupBinding: (bindingId) => resolvePrintLayoutBinding(bindingId, evaluation, sourceOrder, lookup),
    lookupGeometryProperty: (reference) => sourceOrder === undefined
      ? { status: "error", type: { kind: "number" }, issueCode: "evaluation-geometry-property-unavailable" }
      : resolveDocumentGeometryProperty(evaluation.computedGeometry, reference, sourceOrder)
  });
};

/** Splices each resolved typed reference's visible value into `binding`'s
 * expression text, reusing the exact reverse-offset substitution algorithm
 * `materializeNumericBindingElement` (numericBindingRuntime.ts) uses for
 * element parameters. Returns null (fail closed) if any reference doesn't
 * resolve to a finite number - callers fall back to their existing default,
 * never a stale/partial value. */
export const materializePrintLayoutNumericBinding = (
  binding: CompiledNumericBinding,
  evaluation: EvaluationResult,
  lookup: PrintLayoutNumericBindingLookup,
  sourceOrder?: number
): string | null => {
  let expression = binding.expression;
  for (const reference of [...binding.references].reverse()) {
    const bindingEvaluation = resolvePrintLayoutBinding(reference.bindingId, evaluation, sourceOrder, lookup);
    if (
      bindingEvaluation.status !== "ok" ||
      bindingEvaluation.type.kind !== "number" ||
      typeof bindingEvaluation.value.value !== "number" ||
      !Number.isFinite(bindingEvaluation.value.value)
    ) {
      return null;
    }
    if (expression.slice(reference.expressionStart, reference.expressionEnd) !== `@${reference.name}`) return null;
    const literal = numericLiteralForExpression(bindingEvaluation.value.value);
    if (literal === null) return null;
    expression = `${expression.slice(0, reference.expressionStart)}${literal}${expression.slice(reference.expressionEnd)}`;
  }
  return expression;
};
