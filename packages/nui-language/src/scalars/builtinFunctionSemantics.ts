import type { BuiltinFunctionName } from "./builtinFunctions";
import {
  atan2Degrees360,
  degreesToRadians,
  isOddMultipleOf90Degrees,
  radiansToDegrees
} from "./angleMath";

export type BuiltinFunctionEvaluation =
  | {
      status: "ok";
      value: number | boolean;
    }
  | {
      status: "error";
      reason:
        | "invalid-argument"
        | "sqrt-negative-input"
        | "round-to-non-positive-step"
        | "is-close-negative-tolerance"
        | "tan-odd-multiple-of-90"
        | "asin-out-of-range"
        | "acos-out-of-range"
        | "non-finite-result";
    };

type DecimalShiftResult =
  | { status: "finite"; value: number }
  | { status: "overflow" }
  | { status: "underflow" };

type DecimalRoundingOperation = "round" | "floor" | "ceil";

const MAX_FINITE_DECIMAL_EXPONENT = Number(Number.MAX_VALUE.toExponential().split("e")[1]);
const MIN_SUBNORMAL_DECIMAL_EXPONENT = Number(Number.MIN_VALUE.toExponential().split("e")[1]);

const invalidArgument = (): BuiltinFunctionEvaluation => ({ status: "error", reason: "invalid-argument" });

const semanticError = (
  reason: Exclude<Extract<BuiltinFunctionEvaluation, { status: "error" }>["reason"], "invalid-argument" | "non-finite-result">
): BuiltinFunctionEvaluation => ({ status: "error", reason });

const nonFiniteResult = (): BuiltinFunctionEvaluation => ({ status: "error", reason: "non-finite-result" });

const finiteNumberResult = (value: number): BuiltinFunctionEvaluation =>
  Number.isFinite(value) ? { status: "ok", value } : nonFiniteResult();

const hasFiniteArguments = (args: readonly number[], expectedLength: number): boolean =>
  args.length === expectedLength && args.every((arg) => Number.isFinite(arg));

const roundAwayFromZero = (value: number): number => (value < 0 ? -Math.round(-value) : Math.round(value));

/**
 * Moves a finite number by a decimal exponent without constructing a scale
 * factor such as `10 ** digits`. Exponents outside JavaScript's representable
 * range are handled as overflow/underflow cases without imposing a
 * contract-level digits limit.
 */
const shiftDecimalExponent = (value: number, digits: number): DecimalShiftResult => {
  if (value === 0) return { status: "finite", value: 0 };

  const [coefficient, exponentText] = value.toExponential().split("e");
  const shiftedExponent = Number(exponentText) + digits;

  if (shiftedExponent > MAX_FINITE_DECIMAL_EXPONENT || !Number.isFinite(shiftedExponent)) return { status: "overflow" };
  if (shiftedExponent < MIN_SUBNORMAL_DECIMAL_EXPONENT) return { status: "underflow" };

  const shifted = Number(`${coefficient}e${shiftedExponent}`);
  if (shifted === 0) return { status: "underflow" };
  if (!Number.isFinite(shifted)) return { status: "overflow" };
  return { status: "finite", value: shifted };
};

const roundScaledValue = (operation: DecimalRoundingOperation, value: number): number => {
  switch (operation) {
    case "round":
      return roundAwayFromZero(value);
    case "floor":
      return Math.floor(value);
    case "ceil":
      return Math.ceil(value);
  }
};

const underflowRoundedValue = (operation: DecimalRoundingOperation, value: number): number => {
  switch (operation) {
    case "round":
      return 0;
    case "floor":
      return value < 0 ? -1 : 0;
    case "ceil":
      return value > 0 ? 1 : 0;
  }
};

const evaluateDecimalRounding = (
  operation: DecimalRoundingOperation,
  value: number,
  digits: number
): BuiltinFunctionEvaluation => {
  const scaled = shiftDecimalExponent(value, digits);

  // At a precision finer than the representable range, the original finite
  // value is already the most precise value JavaScript can preserve.
  if (scaled.status === "overflow") return finiteNumberResult(value);

  const rounded = scaled.status === "underflow"
    ? underflowRoundedValue(operation, value)
    : roundScaledValue(operation, scaled.value);

  const unscaled = shiftDecimalExponent(rounded, -digits);
  if (unscaled.status === "overflow") return nonFiniteResult();
  if (unscaled.status === "underflow") return { status: "ok", value: 0 };
  return finiteNumberResult(unscaled.value);
};

const evaluateUnaryDecimalRounding = (
  operation: DecimalRoundingOperation,
  value: number
): BuiltinFunctionEvaluation => finiteNumberResult(roundScaledValue(operation, value));

export const evaluateBuiltinFunction = (
  name: BuiltinFunctionName,
  args: readonly number[]
): BuiltinFunctionEvaluation => {
  switch (name) {
    case "abs":
      if (!hasFiniteArguments(args, 1)) return invalidArgument();
      return finiteNumberResult(Math.abs(args[0]));
    case "min":
      if (!hasFiniteArguments(args, 2)) return invalidArgument();
      return finiteNumberResult(Math.min(args[0], args[1]));
    case "max":
      if (!hasFiniteArguments(args, 2)) return invalidArgument();
      return finiteNumberResult(Math.max(args[0], args[1]));
    case "sqrt":
      if (!hasFiniteArguments(args, 1)) return invalidArgument();
      if (args[0] < 0) return semanticError("sqrt-negative-input");
      return finiteNumberResult(Math.sqrt(args[0]));
    case "round":
      if (!hasFiniteArguments(args, 1) && !hasFiniteArguments(args, 2)) return invalidArgument();
      if (args.length === 1) return evaluateUnaryDecimalRounding("round", args[0]);
      if (!Number.isInteger(args[1])) return invalidArgument();
      return evaluateDecimalRounding("round", args[0], args[1]);
    case "floor":
      if (!hasFiniteArguments(args, 1) && !hasFiniteArguments(args, 2)) return invalidArgument();
      if (args.length === 1) return evaluateUnaryDecimalRounding("floor", args[0]);
      if (!Number.isInteger(args[1])) return invalidArgument();
      return evaluateDecimalRounding("floor", args[0], args[1]);
    case "ceil":
      if (!hasFiniteArguments(args, 1) && !hasFiniteArguments(args, 2)) return invalidArgument();
      if (args.length === 1) return evaluateUnaryDecimalRounding("ceil", args[0]);
      if (!Number.isInteger(args[1])) return invalidArgument();
      return evaluateDecimalRounding("ceil", args[0], args[1]);
    case "roundTo": {
      if (!hasFiniteArguments(args, 2)) return invalidArgument();
      if (args[1] <= 0) return semanticError("round-to-non-positive-step");
      const quotient = args[0] / args[1];
      if (!Number.isFinite(quotient)) return nonFiniteResult();
      return finiteNumberResult(roundAwayFromZero(quotient) * args[1]);
    }
    case "isClose": {
      if (!hasFiniteArguments(args, 3)) return invalidArgument();
      if (args[2] < 0) return semanticError("is-close-negative-tolerance");
      return { status: "ok", value: Math.abs(args[0] - args[1]) <= args[2] };
    }
    case "sin":
      if (!hasFiniteArguments(args, 1)) return invalidArgument();
      return finiteNumberResult(Math.sin(degreesToRadians(args[0])));
    case "cos":
      if (!hasFiniteArguments(args, 1)) return invalidArgument();
      return finiteNumberResult(Math.cos(degreesToRadians(args[0])));
    case "tan":
      if (!hasFiniteArguments(args, 1)) return invalidArgument();
      if (isOddMultipleOf90Degrees(args[0])) return semanticError("tan-odd-multiple-of-90");
      return finiteNumberResult(Math.tan(degreesToRadians(args[0])));
    case "asin":
      if (!hasFiniteArguments(args, 1)) return invalidArgument();
      if (args[0] < -1 || args[0] > 1) return semanticError("asin-out-of-range");
      return finiteNumberResult(radiansToDegrees(Math.asin(args[0])));
    case "acos":
      if (!hasFiniteArguments(args, 1)) return invalidArgument();
      if (args[0] < -1 || args[0] > 1) return semanticError("acos-out-of-range");
      return finiteNumberResult(radiansToDegrees(Math.acos(args[0])));
    case "atan":
      if (!hasFiniteArguments(args, 1)) return invalidArgument();
      return finiteNumberResult(radiansToDegrees(Math.atan(args[0])));
    case "atan2":
      if (!hasFiniteArguments(args, 2)) return invalidArgument();
      return finiteNumberResult(atan2Degrees360(args[0], args[1]));
    case "spreadAngle": {
      if (!hasFiniteArguments(args, 2) || args[0] <= 0 || args[1] < 0) return invalidArgument();
      const ratio = args[1] / args[0];
      if (!Number.isFinite(ratio) || ratio > 2) return invalidArgument();
      return finiteNumberResult(2 * radiansToDegrees(Math.asin(ratio / 2)));
    }
    default:
      // Geometry builtins are catalog-only until a later task adds geometry
      // argument resolution and lowering; they must not enter scalar runtime.
      return invalidArgument();
  }
};
