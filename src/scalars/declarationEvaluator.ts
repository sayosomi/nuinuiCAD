// Task 20: evaluates a Task 19 ScalarProgram's const/let declarations to
// their version-0 value using Task 16's pure expression evaluator. This
// module never parses source, never re-resolves a binding name, && never
// re-derives Task 13's forward/self/cycle/eligibility diagnostics.
//
// Task 23 changed the evaluation strategy from a single eager left-to-right
// sweep to an on-demand, memoized resolver (`createLazyScalarProgramEvaluator`):
// a binding's initializer is evaluated the first time something asks for it
// (recursing into other referenced bindings on demand) rather than always in
// array order up front. This lets a caller (the per-element evaluation loop)
// ask for a specific binding's value mid-run, without re-evaluating the whole
// program && without ever evaluating any single binding more than once. A
// compiled ScalarProgram is already guaranteed acyclic && forward-reference
// free (Task 13's `binding-cycle`/`forward-binding-reference`/
// `self-initialization` diagnostics make the whole document fail to compile
// otherwise - see `compileDslDocument`'s early-return-on-error &&
// `buildBindingProgramEligibility`'s own defensive throw in
// bindingProgramEligibility.ts), so on-demand recursion always strictly
// resolves "earlier" statements first && terminates. `evaluateScalarProgram`
// still exists with its original signature && byte-identical output (same
// map, same insertion order) - it walks `program.statements` in array order,
// pulling each value from the (memoized, so free after the first ask)
// resolver, so callers that only need the whole-document result never see a
// difference from the prior array-order construction.
//
// `set`, control-flow mutation, && Rust evaluation are all out of scope -
// see docs/typed-variables/tasks/20-ts-const-evaluation.md &&
// docs/typed-variables/tasks/23-standard-property-runtime.md.

import type { BindingId } from "./bindingCatalog";
import { evaluateTypedExpression, type ScalarEvaluationEnvironment } from "./expressionEvaluator";
import type { ScalarProgram, ScalarProgramStatement } from "./scalarProgram";
import type { ScalarEvaluation } from "./types";
import type { TypedScalarGeometryPropertyReferenceNode } from "./typedExpressionAst";

export type ScalarProgramEvaluation = {
  /** One entry per evaluated `declare` statement, keyed by its bindingId. */
  resultsByBindingId: ReadonlyMap<BindingId, ScalarEvaluation>;
};

export type LazyScalarProgramEvaluator = {
  /**
   * Resolves a single binding's value, evaluating its initializer on first
   * ask && caching the result for every subsequent ask (including asks made
   * recursively while resolving a different binding's initializer).
   */
  resolve: (bindingId: BindingId) => ScalarEvaluation;
};

const isWithinEvaluationLimit = (
  program: ScalarProgram,
  statement: ScalarProgramStatement,
  postStopBindingIds: ReadonlySet<BindingId>
): boolean =>
  program.evaluationLimitSourceOrder === undefined ||
  statement.sourceOrder < program.evaluationLimitSourceOrder ||
  postStopBindingIds.has(statement.bindingId);

/**
 * Builds an on-demand resolver over `program`. Nothing is evaluated until
 * `resolve` is actually called for a given bindingId; a statement at or after
 * `program.evaluationLimitSourceOrder` (the `stop` cutoff) is treated as
 * absent unless its resolved bindingId is explicitly listed in
 * `postStopBindingIds` for a printLayout-local binding.
 */
export const createLazyScalarProgramEvaluator = (
  program: ScalarProgram,
  resolveGeometryProperty?: (reference: TypedScalarGeometryPropertyReferenceNode, sourceOrder: number) => ScalarEvaluation
): LazyScalarProgramEvaluator => {
  const postStopBindingIds = new Set(program.postStopBindingIds ?? []);
  const statementByBindingId = new Map<BindingId, ScalarProgramStatement>();
  for (const statement of program.statements) {
    if (isWithinEvaluationLimit(program, statement, postStopBindingIds)) statementByBindingId.set(statement.bindingId, statement);
  }

  const cache = new Map<BindingId, ScalarEvaluation>();
  // Defense-in-depth only (see module comment): a compiled program is already
  // proven acyclic before it reaches this module. Guards against this new
  // on-demand recursion ever silently looping forever if that upstream
  // invariant were somehow violated, rather than letting it hang.
  const inProgressBindingIds = new Set<BindingId>();

  const resolve = (bindingId: BindingId): ScalarEvaluation => {
    const cached = cache.get(bindingId);
    if (cached) return cached;

    const statement = statementByBindingId.get(bindingId);
    if (!statement) {
      return { status: "error", type: { kind: "number" }, issueCode: "evaluation-binding-unavailable", bindingId };
    }

    if (inProgressBindingIds.has(bindingId)) {
      throw new Error(
        `createLazyScalarProgramEvaluator: cyclic reference detected while resolving ${bindingId} - ` +
          "a compiled ScalarProgram is expected to be acyclic (Task 13's binding-cycle diagnostic should " +
          "have rejected this document at compile time)"
      );
    }

    inProgressBindingIds.add(bindingId);
    try {
      const environment: ScalarEvaluationEnvironment = {
        lookupBinding: resolve,
        ...(resolveGeometryProperty ? { lookupGeometryProperty: (reference) => resolveGeometryProperty(reference, statement.sourceOrder) } : {})
      };
      const evaluation = evaluateTypedExpression(statement.declaration.initializer, environment);
      cache.set(bindingId, evaluation);
      return evaluation;
    } finally {
      inProgressBindingIds.delete(bindingId);
    }
  };

  return { resolve };
};

/**
 * Walks `program.statements` in array order (already source order) && pulls
 * each statement's value from `evaluator` - a memoized resolver, so anything
 * already resolved (e.g. by a property-materialization lookup made mid-run,
 * per Task 23) is a free cache hit here, never re-evaluated. This is what
 * guarantees the returned map's shape/insertion order is always the same
 * regardless of what order (if any) callers resolved bindings in beforehand,
 * so `computedScalarBindings`'s output stays byte-identical to the original
 * eager-sweep implementation.
 */
export const finalizeScalarProgramEvaluation = (
  program: ScalarProgram,
  evaluator: LazyScalarProgramEvaluator
): ScalarProgramEvaluation => {
  const postStopBindingIds = new Set(program.postStopBindingIds ?? []);
  const resultsByBindingId = new Map<BindingId, ScalarEvaluation>();
  for (const statement of program.statements) {
    if (!isWithinEvaluationLimit(program, statement, postStopBindingIds)) continue;
    resultsByBindingId.set(statement.bindingId, evaluator.resolve(statement.bindingId));
  }
  return { resultsByBindingId };
};

/**
 * Evaluates every declaration in `program.statements` && returns them keyed
 * by bindingId, in array order. A thin convenience wrapper for callers that
 * only need the whole-document result with no mid-run lookups of their own -
 * see `finalizeScalarProgramEvaluation` for callers (Task 23) that need to
 * resolve individual bindings before the whole program is walked.
 */
export const evaluateScalarProgram = (
  program: ScalarProgram
): ScalarProgramEvaluation =>
  finalizeScalarProgramEvaluation(program, createLazyScalarProgramEvaluator(program));
