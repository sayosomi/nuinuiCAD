// Task 20: bridges Task 19's ScalarProgram to a real document's already-
// computed legacy numeric context, so a typed const/let initializer may
// reference a legacy `var` binding (D05's shared namespace during
// migration) and get its actual runtime value - including geometry
// measurements (pointDistance/pointAngle/etc.) the legacy evaluator already
// computed, reused rather than reimplemented (D06).
//
// Task 23 changed the legacy-var lookup from a one-time snapshot (built after
// the whole document had already been evaluated) to a *live* read of the same
// mutable `computedVariables` map the per-element evaluation loop is still
// filling in as it walks the document. This is what lets a caller ask for a
// binding's value *during* that loop (e.g. to materialize a bound element
// property) rather than only after it finishes: since every legacy `var` a
// typed initializer may reference is guaranteed (by Task 12/13's forward-
// reference rejection) to sit earlier in the document than the reference
// itself, `computedVariables` already holds that var's value by the time
// anything asks for it mid-loop, exactly as it always would have by the time
// the loop finished. `computedVariables` only ever contains entries for
// `variable`-type elements (the only writer is `evaluateVariableElement`), so
// a direct `.get(elementId)` lookup is safe without first re-checking the
// element's own type.
//
// This module owns no evaluation logic of its own beyond that one lookup: it
// maps a legacy `var` element's already-computed value into a
// ScalarEvaluation and hands it to Task 20's lazy evaluator
// (declarationEvaluator.ts). forGroup iteration / elementLocal bindings are
// not resolvable here (loop mutation is out of scope - Tasks 33-35), so a
// reference to one simply poisons gracefully via the same "unavailable" path
// as a disabled legacy var, never a crash.

import type { ComputedVariable, ElementId } from "../types/geometry";
import type { BindingId } from "../scalars/bindingCatalog";
import type { BindingReadPosition, BindingVersionGraph } from "../scalars/bindingVersions";
import {
  createLazyScalarProgramEvaluator,
  finalizeScalarProgramEvaluation,
  type ScalarProgramEvaluation
} from "../scalars/declarationEvaluator";
import {
  createIncrementalLinearMutationEvaluator,
  type LinearMutationEvaluation
} from "../scalars/linearMutationEvaluator";
import { adaptNumericResult } from "../scalars/numericFunctionAdapter";
import type { ScalarProgram } from "../scalars/scalarProgram";
import type { ScalarEvaluation } from "../scalars/types";

// Mirrors bindingIdForStableStatementId's own format (`binding:${id}`, see
// bindingCatalog.ts) - duplicated as a literal the same way Rust's
// `bindings.rs` already duplicates it, rather than parsing the id back out
// through the formatter.
const LEGACY_BINDING_PREFIX = "binding:";

const externalBindingUnavailable = (bindingId: BindingId): ScalarEvaluation => ({
  status: "error",
  type: { kind: "number" },
  issueCode: "evaluation-external-binding-unavailable",
  bindingId
});

/**
 * A scalar-program binding resolver bound to one document's live
 * `computedVariables` map. `resolveBinding` may be called at any point while
 * the caller's own element-evaluation loop is still running (e.g. from
 * property materialization); `finalize` produces the same
 * `computedScalarBindings` shape/order Task 21 already contracts, reusing
 * whatever `resolveBinding` already resolved rather than re-evaluating it.
 */
export type ScalarBindingResolver = {
  resolveBinding: (bindingId: BindingId) => ScalarEvaluation;
  finalize: () => ScalarProgramEvaluation;
};

export type LinearScalarBindingResolver = {
  advanceTo: (position: BindingReadPosition) => void;
  resolveBinding: (bindingId: BindingId) => ScalarEvaluation;
  finalize: (position: BindingReadPosition) => LinearMutationEvaluation;
};

/**
 * Builds a resolver for `program` against a document's `computedVariables`
 * map. `computedVariables` is read live (by reference) on every call, not
 * snapshotted up front - see module comment.
 */
export const createDocumentScalarBindingResolver = (
  program: ScalarProgram,
  computedVariables: ReadonlyMap<ElementId, ComputedVariable>
): ScalarBindingResolver => {
  const resolveExternalBinding = (bindingId: BindingId): ScalarEvaluation => {
    if (!bindingId.startsWith(LEGACY_BINDING_PREFIX)) return externalBindingUnavailable(bindingId);
    const computed = computedVariables.get(bindingId.slice(LEGACY_BINDING_PREFIX.length));
    return computed ? adaptNumericResult({ value: computed.value }, bindingId) : externalBindingUnavailable(bindingId);
  };

  const evaluator = createLazyScalarProgramEvaluator(program, resolveExternalBinding);

  return {
    resolveBinding: evaluator.resolve,
    finalize: () => finalizeScalarProgramEvaluation(program, evaluator)
  };
};

/** Task 31's live document adapter for a Task 30 graph with linear sets. */
export const createDocumentLinearScalarBindingResolver = (
  graph: BindingVersionGraph,
  computedVariables: ReadonlyMap<ElementId, ComputedVariable>
): LinearScalarBindingResolver => {
  const resolveExternalBinding = (bindingId: BindingId): ScalarEvaluation => {
    if (!bindingId.startsWith(LEGACY_BINDING_PREFIX)) return externalBindingUnavailable(bindingId);
    const computed = computedVariables.get(bindingId.slice(LEGACY_BINDING_PREFIX.length));
    return computed ? adaptNumericResult({ value: computed.value }, bindingId) : externalBindingUnavailable(bindingId);
  };
  const evaluator = createIncrementalLinearMutationEvaluator(graph, resolveExternalBinding);
  return {
    advanceTo: evaluator.advanceTo,
    resolveBinding: evaluator.resolveCurrent,
    finalize: evaluator.finalize
  };
};

/**
 * Evaluates `program`'s declarations against a document already evaluated by
 * `evaluateElements` (or an equivalent legacy-numeric pass) - a convenience
 * wrapper for callers that only need the whole-document result with no
 * mid-run property lookups of their own.
 */
export const evaluateDocumentScalarProgram = (
  program: ScalarProgram,
  computedVariables: ReadonlyMap<ElementId, ComputedVariable>
): ScalarProgramEvaluation => createDocumentScalarBindingResolver(program, computedVariables).finalize();
