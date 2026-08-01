import { findNumericExpressionLiteralSpanAt } from "../geometry/numericExpressionLiteralSpan";
import type { ScalarType } from "../scalars/types";
import { choiceAfterStep, stepDslNumericLiteral, type DslValueStepDirection } from "./dslValueStep";
import type { DslSpan } from "./dslTypes";
import type { DslNumericTypeOptions } from "./dslNumericTypeOptions";

export type TypedValueEdit = {
  from: number;
  to: number;
  insert: string;
  selection: DslSpan;
};

export type TypedValueStepOptions = {
  /** Provided only by typed declaration initializers; set RHS numeric stepping remains out of scope. */
  numericStep?: number;
  numericMin?: number;
  numericMax?: number;
};

/** Converts parsed declaration metadata into the editor's numeric stepping contract. */
export const typedNumericStepOptions = (options?: DslNumericTypeOptions): TypedValueStepOptions => ({
  numericStep: options?.step ?? 1,
  numericMin: options?.min,
  numericMax: options?.max
});

/** Keeps a typed initializer's authored decimal precision without affecting property-step normalization. */
const withTypedLiteralDecimalScale = (literal: string, stepped: string) => {
  const fraction = literal.match(/\.(\d+)$/)?.[1];
  if (!fraction) return stepped;
  const decimal = stepped.indexOf(".");
  if (decimal < 0) return `${stepped}.${"0".repeat(fraction.length)}`;
  const currentScale = stepped.length - decimal - 1;
  return currentScale >= fraction.length ? stepped : `${stepped}${"0".repeat(fraction.length - currentScale)}`;
};

const steppedNumberWithinBounds = (
  literal: string,
  step: number,
  direction: DslValueStepDirection,
  min?: number,
  max?: number
): string | null => {
  const current = Number(literal);
  if (!Number.isFinite(current)) return null;

  // An initially out-of-range value may only move toward the allowed interval.
  // This prevents a right step from decreasing or a left step from increasing.
  if (min !== undefined && current < min) return direction > 0 ? `${min}` : null;
  if (max !== undefined && current > max) return direction < 0 ? `${max}` : null;

  const stepped = stepDslNumericLiteral(literal, step, direction);
  if (stepped === null) return null;
  const next = Number(stepped);
  if (!Number.isFinite(next)) return null;
  if (min !== undefined && next < min) return `${min}`;
  if (max !== undefined && next > max) return `${max}`;
  return stepped;
};

/**
 * Resolves a typed value edit for a declaration initializer or `set` RHS
 * literal. Pure: the caller has already sliced
 * `value` from a tracked physical span and resolved `declaredType` from
 * BindingAnalysis - this never re-parses source or re-resolves a name.
 *
 * Mirrors resolveDslValueStep's numeric/boolean/choice behavior
 * (dslValueStep.ts), generalized from ParameterDefinition to ScalarType.
 * Typed-number step policy is supplied by the declaration caller, so a future
 * declaration-level configuration has one local call site to replace. Strings
 * remain out of scope.
 */
export const resolveTypedValueStep = (
  value: string,
  declaredType: ScalarType | null,
  span: { from: number; to: number },
  selection: { start: number; end: number },
  direction: DslValueStepDirection,
  { numericStep, numericMin, numericMax }: TypedValueStepOptions = {}
): TypedValueEdit | null => {
  if (!declaredType) return null;
  if (declaredType.kind === "number") {
    if (numericStep === undefined) return null;
    const literal = findNumericExpressionLiteralSpanAt(value, {
      start: selection.start - span.from,
      end: selection.end - span.from
    });
    if (!literal) return null;
    const from = span.from + literal.start;
    const to = span.from + literal.end;
    const literalValue = value.slice(literal.start, literal.end);
    const normalized = steppedNumberWithinBounds(
      literalValue,
      numericStep,
      direction,
      numericMin,
      numericMax
    );
    const insert = normalized === null ? null : withTypedLiteralDecimalScale(literalValue, normalized);
    if (insert === null || insert === literalValue) return null;
    return {
      from,
      to,
      insert,
      selection: { start: from, end: from + insert.length }
    };
  }
  if (declaredType.kind !== "boolean" && declaredType.kind !== "choice") return null;
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
