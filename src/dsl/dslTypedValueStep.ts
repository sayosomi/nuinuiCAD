import type { ScalarType } from "../scalars/types";
import { choiceAfterStep, type DslValueStepDirection } from "./dslValueStep";
import type { DslSpan } from "./dslTypes";

export type TypedValueEdit = {
  from: number;
  to: number;
  insert: string;
  selection: DslSpan;
};

/**
 * Resolves a boolean-toggle or choice-cycle edit for a typed declaration
 * initializer or `set` RHS literal. Pure: the caller has already sliced
 * `value` from a tracked physical span and resolved `declaredType` from
 * BindingAnalysis - this never re-parses source or re-resolves a name.
 *
 * Mirrors resolveDslValueStep's own boolean/choice tail (dslValueStep.ts)
 * generalized from ParameterDefinition to ScalarType, and reuses the same
 * choiceAfterStep wrap-around formula rather than re-deriving it. Numeric
 * and string typed values are out of scope (see plan.md/Task 44 fixed spec)
 * and always return null here.
 */
export const resolveTypedValueStep = (
  value: string,
  declaredType: ScalarType | null,
  span: { from: number; to: number },
  selection: { start: number; end: number },
  direction: DslValueStepDirection
): TypedValueEdit | null => {
  if (!declaredType || (declaredType.kind !== "boolean" && declaredType.kind !== "choice")) return null;
  if (selection.start !== selection.end && (selection.start !== span.from || selection.end !== span.to)) return null;

  const insert = declaredType.kind === "boolean"
    ? (value === "true" ? "false" : value === "false" ? "true" : null)
    : choiceAfterStep(value, declaredType.options, direction);
  if (insert === null || insert === value) return null;

  return {
    from: span.from,
    to: span.to,
    insert,
    selection: { start: span.from, end: span.from + insert.length }
  };
};
