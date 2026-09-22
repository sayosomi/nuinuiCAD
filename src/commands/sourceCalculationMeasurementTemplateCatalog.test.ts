import { describe, expect, it } from "vitest";
import { getBuiltinFunctionDefinition } from "@nuinuicad/nui-language";
import {
  SOURCE_CALCULATION_MEASUREMENT_TEMPLATE_DEFINITIONS,
  sourceCalculationMeasurementTemplatePlans
} from "./sourceCalculationMeasurementTemplateCatalog";

describe("Calculation / Measurement template catalog", () => {
  it("exposes the explicit five-entry presentation allowlist in order", () => {
    const plans = sourceCalculationMeasurementTemplatePlans();

    expect(SOURCE_CALCULATION_MEASUREMENT_TEMPLATE_DEFINITIONS.map(({ label }) => label)).toEqual([
      "Distance between points",
      "Angle between points",
      "Point-to-line distance",
      "Angle between lines",
      "Spread angle"
    ]);
    expect(plans.map(({ builtinName, label }) => [builtinName, label])).toEqual([
      ["distance", "Distance between points"],
      ["angle", "Angle between points"],
      ["lineDistance", "Point-to-line distance"],
      ["lineAngle", "Angle between lines"],
      ["spreadAngle", "Spread angle"]
    ]);
  });

  it("projects each selected definition and signature from Language Core", () => {
    for (const plan of sourceCalculationMeasurementTemplatePlans()) {
      const definition = getBuiltinFunctionDefinition(plan.builtinName);
      expect(plan.definition).toBe(definition);
      expect(plan.signature).toBe(definition?.signatures[0]);
      expect(plan.signature.returnType).toEqual({ kind: "number" });
    }
  });

  it("does not scan scalar, trigonometric, string, or other builtin registry entries", () => {
    const names = new Set(sourceCalculationMeasurementTemplatePlans().map(({ builtinName }) => builtinName));
    for (const excluded of [
      "abs", "min", "max", "sqrt", "round", "floor", "ceil", "roundTo",
      "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "isClose", "string"
    ]) {
      expect(names.has(excluded as never)).toBe(false);
    }
  });
});
