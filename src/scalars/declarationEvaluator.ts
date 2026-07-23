// Task 20: evaluates a Task 19 ScalarProgram's const/let declarations to
// their version-0 value using Task 16's pure expression evaluator. This
// module never parses source, never re-resolves a binding name, and never
// re-derives Task 13's forward/self/cycle/eligibility diagnostics - a
// ScalarProgram's statements are already guaranteed valid and ordered so
// that every reference points to an earlier statement (see
// buildBindingProgramEligibility's invariant check in
// bindingProgramEligibility.ts), so a single left-to-right pass suffices.
//
// `set`, control-flow mutation, property wiring, and Rust evaluation are all
// out of scope - see docs/typed-variables/tasks/20-ts-const-evaluation.md.

import type { BindingId } from "./bindingCatalog";
import { evaluateTypedExpression, type ScalarEvaluationEnvironment } from "./expressionEvaluator";
import type { ScalarProgram } from "./scalarProgram";
import type { ScalarEvaluation } from "./types";

/**
 * Resolves a binding that is not itself a statement in this program - a
 * legacy `var`, forGroup iteration binding, or anything else the shared
 * namespace (D05) allows a typed initializer to reference. Called at most
 * once per such reference actually reached during evaluation. The caller
 * owns CAD/document context entirely; this module has none.
 */
export type ResolveExternalScalarBinding = (bindingId: BindingId) => ScalarEvaluation;

export type ScalarProgramEvaluation = {
  /** One entry per evaluated `declare` statement, keyed by its bindingId. */
  resultsByBindingId: ReadonlyMap<BindingId, ScalarEvaluation>;
};

/**
 * Evaluates every declaration in `program.statements`, in array order
 * (already source order; see module comment for why that is dependency-safe).
 * Statements at or after `program.evaluationLimitSourceOrder` (the `@stop`
 * cutoff Task 19 recorded) are skipped entirely, mirroring how post-`@stop`
 * elements are absent from computed geometry rather than marked as errors -
 * any statement kept under the cutoff can only reference other kept
 * statements, so this needs no extra graph work.
 */
export const evaluateScalarProgram = (
  program: ScalarProgram,
  resolveExternalBinding: ResolveExternalScalarBinding
): ScalarProgramEvaluation => {
  const resultsByBindingId = new Map<BindingId, ScalarEvaluation>();
  const limit = program.evaluationLimitSourceOrder;
  const environment: ScalarEvaluationEnvironment = {
    lookupBinding: (bindingId) => resultsByBindingId.get(bindingId) ?? resolveExternalBinding(bindingId)
  };

  for (const statement of program.statements) {
    if (limit !== undefined && statement.sourceOrder >= limit) continue;
    resultsByBindingId.set(
      statement.bindingId,
      evaluateTypedExpression(statement.declaration.initializer, environment)
    );
  }

  return { resultsByBindingId };
};
