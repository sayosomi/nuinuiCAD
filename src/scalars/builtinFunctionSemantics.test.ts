import { describe, expect, it } from "vitest";
import { evaluateBuiltinFunction } from "./builtinFunctionSemantics";

const expectNumberResult = (result: ReturnType<typeof evaluateBuiltinFunction>, expected: number): void => {
  expect(result.status).toBe("ok");
  if (result.status !== "ok" || typeof result.value !== "number") throw new Error("expected a numeric builtin result");
  expect(result.value).toBeCloseTo(expected, 10);
};

describe("evaluateBuiltinFunction", () => {
  it("evaluates the basic numeric and boolean builtins", () => {
    expect(evaluateBuiltinFunction("abs", [-3])).toEqual({ status: "ok", value: 3 });
    expect(evaluateBuiltinFunction("min", [4, -2])).toEqual({ status: "ok", value: -2 });
    expect(evaluateBuiltinFunction("max", [4, -2])).toEqual({ status: "ok", value: 4 });
    expect(evaluateBuiltinFunction("sqrt", [9])).toEqual({ status: "ok", value: 3 });
    expect(evaluateBuiltinFunction("isClose", [1, 1.05, 0.051])).toEqual({ status: "ok", value: true });
    expect(evaluateBuiltinFunction("isClose", [1, 1.06, 0.05])).toEqual({ status: "ok", value: false });
  });

  it("evaluates trigonometric functions in degrees", () => {
    for (const [degrees, expected] of [[0, 0], [30, 0.5], [90, 1], [180, 0], [-30, -0.5], [390, 0.5]] as const) {
      expectNumberResult(evaluateBuiltinFunction("sin", [degrees]), expected);
    }
    for (const [degrees, expected] of [[0, 1], [60, 0.5], [90, 0], [180, -1], [-60, 0.5], [420, 0.5]] as const) {
      expectNumberResult(evaluateBuiltinFunction("cos", [degrees]), expected);
    }
    expectNumberResult(evaluateBuiltinFunction("tan", [0]), 0);
    expectNumberResult(evaluateBuiltinFunction("tan", [45]), 1);
    expectNumberResult(evaluateBuiltinFunction("tan", [135]), -1);
  });

  it("rejects tangent singularities by the exact degree contract", () => {
    for (const degrees of [90, 270, -90, -270, 450]) {
      expect(evaluateBuiltinFunction("tan", [degrees])).toEqual({ status: "error", reason: "invalid-argument" });
    }
    expect(evaluateBuiltinFunction("tan", [90 + 1e-10]).status).toBe("ok");
  });

  it("evaluates inverse trigonometric functions in degrees and validates domains", () => {
    for (const [name, value, expected] of [
      ["asin", -1, -90], ["asin", 0, 0], ["asin", 0.5, 30], ["asin", 1, 90],
      ["acos", -1, 180], ["acos", 0, 90], ["acos", 0.5, 60], ["acos", 1, 0],
      ["atan", -1, -45], ["atan", 0, 0], ["atan", 1, 45]
    ] as const) {
      expectNumberResult(evaluateBuiltinFunction(name, [value]), expected);
    }
    for (const name of ["asin", "acos"] as const) {
      for (const value of [-1.000001, 1.000001]) {
        expect(evaluateBuiltinFunction(name, [value])).toEqual({ status: "error", reason: "invalid-argument" });
      }
    }
  });

  it("normalizes atan2(y, x) to compass degrees", () => {
    for (const [y, x, expected] of [
      [0, 1, 0], [1, 0, 90], [0, -1, 180], [-1, 0, 270],
      [1, 1, 45], [1, -1, 135], [-1, -1, 225], [-1, 1, 315], [0, 0, 0]
    ] as const) {
      expectNumberResult(evaluateBuiltinFunction("atan2", [y, x]), expected);
    }
  });

  it("evaluates spreadAngle from chord length in degrees", () => {
    expectNumberResult(evaluateBuiltinFunction("spreadAngle", [100, 20]), 11.4783409545);
    expectNumberResult(evaluateBuiltinFunction("spreadAngle", [100, 0]), 0);
    expectNumberResult(evaluateBuiltinFunction("spreadAngle", [100, 200]), 180);
    expectNumberResult(evaluateBuiltinFunction("spreadAngle", [Number.MAX_VALUE, Number.MAX_VALUE]), 60);
  });

  it("rejects invalid spreadAngle arguments and arity", () => {
    for (const args of [
      [0, 0],
      [-100, 20],
      [100, -1],
      [100, 201],
      [Number.NaN, 20],
      [100, Number.NaN],
      [Number.POSITIVE_INFINITY, 20],
      [100, Number.POSITIVE_INFINITY],
      [Number.NEGATIVE_INFINITY, 20],
      [100, Number.NEGATIVE_INFINITY],
      [100],
      [100, 20, 0]
    ]) {
      expect(evaluateBuiltinFunction("spreadAngle", args)).toEqual({ status: "error", reason: "invalid-argument" });
    }
  });

  it("rejects non-finite trigonometric inputs", () => {
    for (const name of ["sin", "cos", "tan", "asin", "acos", "atan"] as const) {
      for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expect(evaluateBuiltinFunction(name, [value])).toEqual({ status: "error", reason: "invalid-argument" });
      }
    }
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(evaluateBuiltinFunction("atan2", [value, 1])).toEqual({ status: "error", reason: "invalid-argument" });
      expect(evaluateBuiltinFunction("atan2", [0, value])).toEqual({ status: "error", reason: "invalid-argument" });
    }
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
