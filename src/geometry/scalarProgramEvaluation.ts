// Task 20: bridges Task 19's ScalarProgram to a real document's already-
// computed legacy numeric context, so a typed const/let initializer may
// reference a legacy `var` binding (D05's shared namespace during
// migration) and get its actual runtime value - including geometry
// measurements (pointDistance/pointAngle/etc.) the legacy evaluator already
// computed, reused rather than reimplemented (D06).
//
// This module owns no evaluation logic of its own beyond that one lookup:
// it maps a legacy `var` element's already-computed value into a
// ScalarEvaluation and hands it to the pure evaluateScalarProgram
// (declarationEvaluator.ts). forGroup iteration / elementLocal bindings are
// not resolvable here (loop mutation is out of scope - Tasks 33-35), so a
// reference to one simply poisons gracefully via the same "unavailable"
// path as a disabled legacy var, never a crash.

import type { CadElement, ComputedVariable, ElementId } from "../types/geometry";
import { bindingIdForStableStatementId, type BindingId } from "../scalars/bindingCatalog";
import { evaluateScalarProgram, type ScalarProgramEvaluation } from "../scalars/declarationEvaluator";
import { adaptNumericResult } from "../scalars/numericFunctionAdapter";
import type { ScalarProgram } from "../scalars/scalarProgram";
import type { ScalarEvaluation } from "../scalars/types";
import { isVariableElement } from "./variableScope";

const externalBindingUnavailable = (bindingId: BindingId): ScalarEvaluation => ({
  status: "error",
  type: { kind: "number" },
  issueCode: "evaluation-external-binding-unavailable",
  bindingId
});

/**
 * Evaluates `program`'s declarations against a document already evaluated by
 * `evaluateElements` (or an equivalent legacy-numeric pass): `elements` and
 * `computedVariables` supply the runtime value for any legacy `var`
 * reference. A legacy var missing from `computedVariables` (its element was
 * `disabled`, or evaluation failed/was skipped) resolves to a poisoned
 * binding rather than throwing - a `hidden` (but enabled) legacy var is
 * present in `computedVariables` normally and resolves fine.
 */
export const evaluateDocumentScalarProgram = (
  program: ScalarProgram,
  elements: readonly CadElement[],
  computedVariables: ReadonlyMap<ElementId, ComputedVariable>
): ScalarProgramEvaluation => {
  const legacyValueByBindingId = new Map<BindingId, ComputedVariable>();
  for (const element of elements) {
    if (!isVariableElement(element)) continue;
    const computed = computedVariables.get(element.id);
    if (computed) legacyValueByBindingId.set(bindingIdForStableStatementId(element.id), computed);
  }

  return evaluateScalarProgram(program, (bindingId) => {
    const computed = legacyValueByBindingId.get(bindingId);
    return computed ? adaptNumericResult({ value: computed.value }, bindingId) : externalBindingUnavailable(bindingId);
  });
};
