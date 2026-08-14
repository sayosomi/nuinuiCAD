import { describe, expect, it } from "vitest";
import { evaluateBuiltinFunction } from "./builtinFunctionSemantics";

describe("evaluateBuiltinFunction", () => {
  it("evaluates the basic numeric and boolean builtins", () => {
    expect(evaluateBuiltinFunction("abs", [-3])).toEqual({ status: "ok", value: 3 });
    expect(evaluateBuiltinFunction("min", [4, -2])).toEqual({ status: "ok", value: -2 });
    expect(evaluateBuiltinFunction("max", [4, -2])).toEqual({ status: "ok", value: 4 });
    expect(evaluateBuiltinFunction("sqrt", [9])).toEqual({ status: "ok", value: 3 });
    expect(evaluateBuiltinFunction("isClose", [1, 1.05, 0.051])).toEqual({ status: "ok", value: true });
    expect(evaluateBuiltinFunction("isClose", [1, 1.06, 0.05])).toEqual({ status: "ok", value: false });
  });

  it("rounds midpoint values away from zero", () => {
    expect(evaluateBuiltinFunction("round", [1.5])).toEqual({ status: "ok", value: 2 });
    expect(evaluateBuiltinFunction("round", [-1.5])).toEqual({ status: "ok", value: -2 });
    expect(evaluateBuiltinFunction("round", [1.25, 1])).toEqual({ status: "ok", value: 1.3 });
    expect(evaluateBuiltinFunction("round", [-1.25, 1])).toEqual({ status: "ok", value: -1.3 });
    expect(evaluateBuiltinFunction("round", [149, -1])).toEqual({ status: "ok", value: 150 });
    expect(evaluateBuiltinFunction("round", [-150, -2])).toEqual({ status: "ok", value: -200 });
  });

  it("supports decimal digits for floor and ceil", () => {
    expect(evaluateBuiltinFunction("floor", [1.29, 1])).toEqual({ status: "ok", value: 1.2 });
    expect(evaluateBuiltinFunction("floor", [-1.21, 1])).toEqual({ status: "ok", value: -1.3 });
    expect(evaluateBuiltinFunction("ceil", [1.21, 1])).toEqual({ status: "ok", value: 1.3 });
    expect(evaluateBuiltinFunction("ceil", [-1.29, 1])).toEqual({ status: "ok", value: -1.2 });
  });

  it("uses directional integer rounding when decimal scaling underflows", () => {
    const extremeDigits = -1e308;
    expect(evaluateBuiltinFunction("round", [1, extremeDigits])).toEqual({ status: "ok", value: 0 });
    expect(evaluateBuiltinFunction("floor", [1, extremeDigits])).toEqual({ status: "ok", value: 0 });
    expect(evaluateBuiltinFunction("ceil", [-1, extremeDigits])).toEqual({ status: "ok", value: 0 });
    expect(evaluateBuiltinFunction("floor", [-1, extremeDigits])).toEqual({ status: "error", reason: "non-finite-result" });
    expect(evaluateBuiltinFunction("ceil", [1, extremeDigits])).toEqual({ status: "error", reason: "non-finite-result" });
  });

  it("keeps the original finite value when finer scaling overflows", () => {
    const value = 123.456;
    expect(evaluateBuiltinFunction("round", [value, 1e308])).toEqual({ status: "ok", value });
    expect(evaluateBuiltinFunction("floor", [value, 1e308])).toEqual({ status: "ok", value });
    expect(evaluateBuiltinFunction("ceil", [value, 1e308])).toEqual({ status: "ok", value });
  });

  it("rounds to a positive step using the same midpoint rule", () => {
    expect(evaluateBuiltinFunction("roundTo", [7, 5])).toEqual({ status: "ok", value: 5 });
    expect(evaluateBuiltinFunction("roundTo", [7.5, 5])).toEqual({ status: "ok", value: 10 });
    expect(evaluateBuiltinFunction("roundTo", [-7.5, 5])).toEqual({ status: "ok", value: -10 });
  });

  it("rejects invalid arity, non-finite values, and invalid constraints", () => {
    expect(evaluateBuiltinFunction("abs", [])).toEqual({ status: "error", reason: "invalid-argument" });
    expect(evaluateBuiltinFunction("min", [1])).toEqual({ status: "error", reason: "invalid-argument" });
    expect(evaluateBuiltinFunction("sqrt", [-1])).toEqual({ status: "error", reason: "invalid-argument" });
    expect(evaluateBuiltinFunction("round", [1, 1.5])).toEqual({ status: "error", reason: "invalid-argument" });
    expect(evaluateBuiltinFunction("floor", [1, Number.POSITIVE_INFINITY])).toEqual({ status: "error", reason: "invalid-argument" });
    expect(evaluateBuiltinFunction("roundTo", [1, 0])).toEqual({ status: "error", reason: "invalid-argument" });
    expect(evaluateBuiltinFunction("isClose", [1, 2, -1])).toEqual({ status: "error", reason: "invalid-argument" });
    expect(evaluateBuiltinFunction("abs", [Number.NaN])).toEqual({ status: "error", reason: "invalid-argument" });
  });

  it("reports non-finite roundTo intermediates instead of returning them", () => {
    expect(evaluateBuiltinFunction("roundTo", [Number.MAX_VALUE, Number.MIN_VALUE])).toEqual({
      status: "error",
      reason: "non-finite-result"
    });
  });
});
