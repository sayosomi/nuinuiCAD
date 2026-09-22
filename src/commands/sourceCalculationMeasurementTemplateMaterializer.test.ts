import { describe, expect, it } from "vitest";
import { sourceCalculationMeasurementTemplatePlans } from "./sourceCalculationMeasurementTemplateCatalog";
import { materializeSourceCalculationMeasurementTemplate } from "./sourceCalculationMeasurementTemplateMaterializer";

const planFor = (builtinName: string) => {
  const plan = sourceCalculationMeasurementTemplatePlans().find(({ builtinName: candidate }) => candidate === builtinName);
  expect(plan).toBeDefined();
  return plan!;
};

const materializeFor = (builtinName: string) => {
  const materialization = materializeSourceCalculationMeasurementTemplate(planFor(builtinName));
  expect(materialization).not.toBeNull();
  return materialization!;
};

const holeNamesFor = (materialization: ReturnType<typeof materializeFor>): string[] =>
  materialization.parts.flatMap((part) => {
    if (part.kind !== "hole") return [];
    return part.hole.role === "name"
      ? ["name"]
      : [part.hole.parameterName ?? `argument${part.hole.index}`];
  });

const textFor = (materialization: ReturnType<typeof materializeFor>): string =>
  materialization.parts.map((part) => part.kind === "text" ? part.text : "<hole>").join("");

describe("Calculation / Measurement template materializer", () => {
  it.each(["distance", "angle", "lineDistance", "lineAngle"] as const)(
    "materializes %s with registry-owned positional arguments",
    (builtinName) => {
      const materialization = materializeFor(builtinName);

      expect(holeNamesFor(materialization)).toEqual(["name", "argument0", "argument1"]);
      expect(textFor(materialization)).toBe(`const <hole>: number = ${builtinName}(<hole>, <hole>)`);
    }
  );

  it("materializes spreadAngle with registry-owned named argument labels", () => {
    const materialization = materializeFor("spreadAngle");

    expect(holeNamesFor(materialization)).toEqual(["name", "length", "spread"]);
    expect(textFor(materialization)).toBe(
      "const <hole>: number = spreadAngle(length: <hole>, spread: <hole>)"
    );
  });

  it("keeps holes in declaration-name then left-to-right argument order", () => {
    const materialization = materializeFor("spreadAngle");
    const holes = materialization.parts.flatMap((part) => part.kind === "hole" ? [part.hole] : []);
    expect(holes).toEqual([
      { role: "name" },
      { role: "argument", index: 0, parameterName: "length" },
      { role: "argument", index: 1, parameterName: "spread" }
    ]);
  });
});
