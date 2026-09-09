import { describe, expect, it } from "vitest";
import { legacyCreationCommandRecipeMap } from "./legacyCreationRecipes";
import {
  sourceCreationTemplatePlanForLegacyCommand,
  sourceCreationTemplatePlans
} from "./sourceCreationTemplatePlan";

const holesFor = (commandId: string, formIndex = 0) => {
  const plan = sourceCreationTemplatePlanForLegacyCommand(commandId);
  expect(plan).not.toBeNull();
  return plan!.forms[formIndex]!.argumentHoles;
};

describe("Source creation template planning", () => {
  it("keeps the exact legacy Create Geometry catalog membership and order", () => {
    expect(sourceCreationTemplatePlans.map(({ commandId }) => commandId)).toEqual(
      Object.keys(legacyCreationCommandRecipeMap)
    );
    expect(sourceCreationTemplatePlanForLegacyCommand("pathReverse")).toBeNull();
    expect(sourceCreationTemplatePlanForLegacyCommand("addImage")).toBeNull();
  });

  it("plans a normal one-form segment from the line creation recipe", () => {
    const plan = sourceCreationTemplatePlanForLegacyCommand("addLine");

    expect(plan).toMatchObject({
      commandId: "addLine",
      elementType: "line",
      category: "line",
      construction: "segment",
      hasNameHole: true
    });
    expect(plan?.forms).toEqual([{
      argumentHoles: [
        { argName: "start", parameterKey: "startPoint" },
        { argName: "end", parameterKey: "endPoint" }
      ],
      exclusiveChoices: []
    }]);
  });

  it("overlays between distance and ratio forms at the recipe anchor", () => {
    const plan = sourceCreationTemplatePlanForLegacyCommand("addDivisionPoint");

    expect(plan?.forms).toEqual([
      {
        argumentHoles: [
          { argName: "start", parameterKey: "startPoint" },
          { argName: "end", parameterKey: "endPoint" },
          { argName: "distance", parameterKey: "distance" }
        ],
        exclusiveChoices: [{
          group: ["distance", "ratio"],
          selectedArgName: "distance",
          parameterKey: "distance"
        }]
      },
      {
        argumentHoles: [
          { argName: "start", parameterKey: "startPoint" },
          { argName: "end", parameterKey: "endPoint" },
          { argName: "ratio", parameterKey: "ratio" }
        ],
        exclusiveChoices: [{
          group: ["distance", "ratio"],
          selectedArgName: "ratio",
          parameterKey: "ratio"
        }]
      }
    ]);
  });

  it("overlays tangent angle and curve-side forms through canonical argument mapping", () => {
    const plan = sourceCreationTemplatePlanForLegacyCommand("addLineTangentOffsetPoint");

    expect(plan?.forms).toEqual([
      {
        argumentHoles: [
          { argName: "line", parameterKey: "baseLineId" },
          { argName: "base", parameterKey: "basePoint" },
          { argName: "angle", parameterKey: "tangentAngleDeg" },
          { argName: "distance", parameterKey: "distance" }
        ],
        exclusiveChoices: [{
          group: ["angle", "curveSide"],
          selectedArgName: "angle",
          parameterKey: "tangentAngleDeg"
        }]
      },
      {
        argumentHoles: [
          { argName: "line", parameterKey: "baseLineId" },
          { argName: "base", parameterKey: "basePoint" },
          { argName: "curveSide", parameterKey: "curveSide" },
          { argName: "distance", parameterKey: "distance" }
        ],
        exclusiveChoices: [{
          group: ["angle", "curveSide"],
          selectedArgName: "curveSide",
          parameterKey: "curveSide"
        }]
      }
    ]);
  });

  it("preserves recipe order and explicit exclusivity for the other between construction", () => {
    expect(holesFor("addLineDivisionPoint", 0).map(({ argName }) => argName)).toEqual([
      "from", "distance"
    ]);
    expect(holesFor("addLineDivisionPoint", 1).map(({ argName }) => argName)).toEqual([
      "from", "ratio"
    ]);
    for (const form of sourceCreationTemplatePlanForLegacyCommand("addLineDivisionPoint")!.forms) {
      expect(form.argumentHoles.filter(({ argName }) => ["distance", "ratio"].includes(argName))).toHaveLength(1);
    }
  });

  it("preserves creation recipes without a name step", () => {
    const plan = sourceCreationTemplatePlanForLegacyCommand("addMove");

    expect(plan?.hasNameHole).toBe(false);
    expect(plan?.forms).toHaveLength(1);
    expect(plan?.forms[0]?.argumentHoles.map(({ argName }) => argName)).toEqual([
      "targets", "from", "to", "scale", "angleDeg"
    ]);
  });

  it("has one explicit exclusive member in every generated form", () => {
    for (const plan of sourceCreationTemplatePlans) {
      for (const form of plan.forms) {
        for (const choice of form.exclusiveChoices) {
          expect(form.argumentHoles.filter(({ argName }) => choice.group.includes(argName))).toHaveLength(1);
        }
      }
    }
  });
});
