import { findNumericExpressionLiteralSpanAt } from "../geometry/numericExpressionLiteralSpan";
import type { ScalarType } from "../scalars/types";
import { choiceAfterStep, stepDslNumericLiteral, type DslValueStepDirection } from "./dslValueStep";
import type { DslSpan } from "./dslTypes";
import type { DslNumericTypeOptions } from "./dslNumericTypeOptions";
import type { CompiledDslDocument } from "./dslDocument";
import type { BindingId } from "../scalars/bindingCatalog";

export type TypedValueEdit = {
  from: number;
  to: number;
  insert: string;
  selection: DslSpan;
};

export type TypedValueStepOptions = {
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

export type TypedValueStepTarget = {
  declaredType: ScalarType;
  options: TypedValueStepOptions;
};

/** Compiler-owned binding identity -> declaration-owned step metadata. */
export const typedValueStepTargetForBinding = (
  compiled: CompiledDslDocument,
  bindingId: BindingId
): TypedValueStepTarget | null => {
  const binding = compiled.bindingAnalysis?.catalog.bindingsById.get(bindingId);
  if (!binding?.declaredType) return null;
  const declaration = compiled.statements[binding.statementIndex];
  if (!declaration || declaration.kind !== "typedDeclaration") return null;
  return {
    declaredType: binding.declaredType,
    options: binding.declaredType.kind === "number"
      ? typedNumericStepOptions(declaration.numericTypeOptions)
      : {}
  };
};

/** Exact source statement -> its unique compiler-owned typed binding. */
export const typedValueStepTargetForStatement = (
  compiled: CompiledDslDocument,
  statementIndex: number
): TypedValueStepTarget | null => {
  const bindings = compiled.bindingAnalysis?.catalog.bindings.filter(
    (binding) =>
      binding.kind === "typed" &&
      binding.statementIndex === statementIndex &&
      binding.resolutionMode !== "preResolvedOnly"
  ) ?? [];
  return bindings.length === 1
    ? typedValueStepTargetForBinding(compiled, bindings[0]!.id)
    : null;
};

/** Formats a finite JavaScript number as the exponent-free DSL numeric grammar requires. */
const finiteDslNumericLiteral = (value: number): string | null => {
  if (!Number.isFinite(value)) return null;
  const source = `${value}`;
  const exponentMarker = source.search(/e/i);
  if (exponentMarker < 0) return source;

  const sign = source.startsWith("-") ? "-" : "";
  const unsigned = sign ? source.slice(1) : source;
  const [coefficient, exponentText] = unsigned.split(/e/i);
  const exponent = Number(exponentText);
  if (!coefficient || !Number.isInteger(exponent)) return null;
  const [integer, fraction = ""] = coefficient.split(".");
  const digits = `${integer}${fraction}`.replace(/^0+/, "") || "0";
  const decimalIndex = integer.length + exponent;
  if (decimalIndex <= 0) return `${sign}0.${"0".repeat(-decimalIndex)}${digits}`;
  if (decimalIndex >= digits.length) return `${sign}${digits}${"0".repeat(decimalIndex - digits.length)}`;
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
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
  // This prevents a right step from decreasing || a left step from increasing.
  if (min !== undefined && current < min) return direction > 0 ? finiteDslNumericLiteral(min) : null;
  if (max !== undefined && current > max) return direction < 0 ? finiteDslNumericLiteral(max) : null;

  const stepped = stepDslNumericLiteral(literal, step, direction);
  if (stepped === null) return null;
  const next = Number(stepped);
  if (!Number.isFinite(next)) return null;
  if (min !== undefined && next < min) return finiteDslNumericLiteral(min);
  if (max !== undefined && next > max) return finiteDslNumericLiteral(max);
  return stepped;
};

/**
 * Resolves a typed value edit for a declaration initializer || `set` RHS
 * literal. Pure: the caller has already sliced
 * `value` from a tracked physical span && resolved `declaredType` from
 * BindingAnalysis - this never re-parses source || re-resolves a name.
 *
 * Mirrors resolveDslValueStep's numeric/boolean/choice behavior
 * (dslValueStep.ts), generalized from ParameterDefinition to ScalarType.
 * Typed-number step policy is supplied from the target declaration for both
 * declaration initializers and `set` RHS values. Strings remain out of scope.
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
    const insert = normalized;
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
