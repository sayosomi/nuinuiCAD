// Pure shape adapter bridging the existing legacy numeric-expression
// evaluator's result convention (src/geometry/numericExpressions.ts,
// `{ value?, error? }`, discriminant = presence of `.error`) into this
// subsystem's ScalarEvaluation convention (discriminant = `.status`).
//
// This module performs no geometry evaluation of its own and does not
// replace `evaluateNumericValue` - it exists solely so `evaluateTypedExpression`
// (expressionEvaluator.ts) has a documented, tested seam for a future
// document-context environment (Tasks 20/27/31) to expose legacy numeric
// values through, without this task reimplementing distance/angle/line-
// distance math or wiring anything into production. The typed-expression
// grammar (Task 14) has no call-node syntax to invoke geometry functions
// directly, so nothing here is reachable from expressionEvaluator.ts's own
// evaluation switch today; see numericFunctionAdapter.test.ts for the
// result-consistency check against the real legacy evaluator.

import type { NumericExpressionError } from "../geometry/numericExpressionTypes";
import type { BindingId } from "./bindingCatalog";
import type { ScalarEvaluation } from "./types";

export type LegacyNumericEvaluationResult = { value?: number; error?: NumericExpressionError };

/**
 * Wraps an already-computed legacy numeric-expression result. Performs no
 * evaluation of its own - the caller has already run the legacy evaluator.
 * The raw number is passed through unrounded (no display formatting); text
 * interpolation's 3-decimal display format is a separate, later concern.
 */
export const adaptNumericResult = (
  result: LegacyNumericEvaluationResult,
  bindingId?: BindingId
): ScalarEvaluation => {
  if (result.error === undefined) {
    return { status: "ok", type: { kind: "number" }, value: { kind: "number", value: result.value ?? 0 } };
  }
  return bindingId !== undefined
    ? { status: "error", type: { kind: "number" }, issueCode: "evaluation-numeric-adapter-failure", bindingId }
    : { status: "error", type: { kind: "number" }, issueCode: "evaluation-numeric-adapter-failure" };
};

/** Environment hook shape reserved for later document-context wiring. */
export interface NumericGeometryLookup {
  adaptNumericResult: typeof adaptNumericResult;
}
