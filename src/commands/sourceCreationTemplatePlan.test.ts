import { describe, expect, it } from "vitest";
import { legacyCreationCommandRecipeMap } from "./legacyCreationRecipes";
import {
  sourceCreationTemplatePlanForLegacyCommand,
  sourceCreationTemplatePlans
} from "./sourceCreationTemplatePlan";

const planFor = (commandId: string) => {
  const plan = sourceCreationTemplatePlanForLegacyCommand(commandId);
  expect(plan, commandId).not.toBeNull();
  return plan!;
};

const holesFor = (commandId: string, formIndex = 0) => planFor(commandId).forms[formIndex]!.argumentHoles;

describe("Source creation template planning", () => {
  it("keeps the exact legacy Create Geometry catalog membership and order", () => {
    expect(sourceCreationTemplatePlans.map(({ commandId }) => commandId)).toEqual(
      Object.keys(legacyCreationCommandRecipeMap)
    );
    expect(sourceCreationTemplatePlanForLegacyCommand("pathReverse")).toBeNull();
    expect(sourceCreationTemplatePlanForLegacyCommand("addImage")).toBeNull();
  });

  it("plans addLine as one named segment form with parameter metadata", () => {
    const plan = planFor("addLine");

    expect(plan).toMatchObject({
      commandId: "addLine",
      elementType: "line",
      category: "line",
      construction: "segment",
      hasNameHole: true
    });
    expect(plan.forms).toEqual([{
      argumentHoles: [
        { argName: "start", parameterKey: "startPoint", kind: "reference", label: "始点" },
        { argName: "end", parameterKey: "endPoint", kind: "reference", label: "終点" }
      ],
      exclusiveChoices: []
    }]);
  });

  it("plans addJoinedPath through the shared catalog with an ordered paths hole", () => {
    const plan = planFor("addJoinedPath");

    expect(plan).toMatchObject({
      commandId: "addJoinedPath",
      elementType: "joinedPath",
      category: "line",
      construction: "join",
      hasNameHole: true
    });
    expect(plan.forms).toEqual([{
      argumentHoles: [
        { argName: "paths", parameterKey: "pathIds", kind: "lineReferenceList", label: "パス" }
      ],
      exclusiveChoices: []
    }]);
  });

  it("includes commonTangent's required choice arguments from the DSL spec", () => {
    const plan = planFor("addCommonTangentLine");

    expect(plan.forms).toEqual([{
      argumentHoles: [
        { argName: "first", parameterKey: "firstLineId", kind: "lineReference", label: "1つ目の円弧" },
        { argName: "second", parameterKey: "secondLineId", kind: "lineReference", label: "2つ目の円弧" },
        { argName: "kind", parameterKey: "kind", kind: "choice", label: "接線種別" },
        { argName: "side", parameterKey: "side", kind: "choice", label: "側" }
      ],
      exclusiveChoices: []
    }]);
  });

  it("overlays between distance and ratio forms in canonical DSL order", () => {
    const plan = planFor("addDivisionPoint");

    expect(plan.forms).toEqual([
      {
        argumentHoles: [
          { argName: "start", parameterKey: "startPoint", kind: "reference", label: "始点" },
          { argName: "end", parameterKey: "endPoint", kind: "reference", label: "終点" },
          { argName: "distance", parameterKey: "distance", kind: "number", label: "距離" }
        ],
        exclusiveChoices: [{
          group: ["distance", "ratio"],
          selectedArgName: "distance",
          parameterKey: "distance"
        }]
      },
      {
        argumentHoles: [
          { argName: "start", parameterKey: "startPoint", kind: "reference", label: "始点" },
          { argName: "end", parameterKey: "endPoint", kind: "reference", label: "終点" },
          { argName: "ratio", parameterKey: "ratio", kind: "number", label: "割合" }
        ],
        exclusiveChoices: [{
          group: ["distance", "ratio"],
          selectedArgName: "ratio",
          parameterKey: "ratio"
        }]
      }
    ]);
  });

  it("overlays onLine distance and ratio forms without mixing members", () => {
    const plan = planFor("addLineDivisionPoint");

    expect(plan.forms.map((form) => form.argumentHoles)).toEqual([
      [
        { argName: "from", parameterKey: "endpoint", kind: "lineEndpointReference", label: "端点" },
        { argName: "distance", parameterKey: "distance", kind: "number", label: "距離" }
      ],
      [
        { argName: "from", parameterKey: "endpoint", kind: "lineEndpointReference", label: "端点" },
        { argName: "ratio", parameterKey: "ratio", kind: "number", label: "割合" }
      ]
    ]);
  });

  it("overlays tangent angle and curve-side forms with their existing metadata", () => {
    const plan = planFor("addLineTangentOffsetPoint");

    expect(plan.forms.map((form) => form.argumentHoles)).toEqual([
      [
        { argName: "line", parameterKey: "baseLineId", kind: "lineReference", label: "基準線" },
        { argName: "base", parameterKey: "basePoint", kind: "reference", label: "基準点" },
        { argName: "angle", parameterKey: "tangentAngleDeg", kind: "number", label: "接線角度" },
        { argName: "distance", parameterKey: "distance", kind: "number", label: "距離" }
      ],
      [
        { argName: "line", parameterKey: "baseLineId", kind: "lineReference", label: "基準線" },
        { argName: "base", parameterKey: "basePoint", kind: "reference", label: "基準点" },
        { argName: "curveSide", parameterKey: "curveSide", kind: "choice", label: "曲率側" },
        { argName: "distance", parameterKey: "distance", kind: "number", label: "距離" }
      ]
    ]);
    expect(plan.forms.map((form) => form.exclusiveChoices.map(({ selectedArgName, parameterKey }) => [selectedArgName, parameterKey]))).toEqual([
      [["angle", "tangentAngleDeg"]],
      [["curveSide", "curveSide"]]
    ]);
  });

  it("uses canonical DSL order for addCopyLine while guarding optional expansion", () => {
    const holes = holesFor("addCopyLine");

    expect(holes).toEqual([
      { argName: "startPoint", parameterKey: "startPoint", kind: "reference", label: "始点" },
      { argName: "endPoint", parameterKey: "endPoint", kind: "reference", label: "終点" },
      { argName: "scale", parameterKey: "scale", kind: "number", label: "倍率" },
      { argName: "angleDeg", parameterKey: "angleDeg", kind: "number", label: "角度" },
      { argName: "baseLines", parameterKey: "baseLineIds", kind: "lineReferenceList", label: "基準線" }
    ]);
    expect(holes.map(({ argName }) => argName)).not.toContain("mirrorX");
  });

  it("retains only recipe-backed optional arguments for addOffsetLine", () => {
    const holes = holesFor("addOffsetLine");

    expect(holes.map(({ argName, parameterKey }) => [argName, parameterKey])).toEqual([
      ["sources", "baseLineIds"],
      ["distance", "offset"]
    ]);
    expect(holes.map(({ argName }) => argName)).not.toEqual(
      expect.arrayContaining(["side", "closed", "suppressTrimWarnings"])
    );
  });

  it("preserves creation recipes without a name step", () => {
    const plan = planFor("addMove");

    expect(plan.hasNameHole).toBe(false);
    expect(plan.forms).toHaveLength(1);
    expect(plan.forms[0]?.argumentHoles.map(({ argName }) => argName)).toEqual([
      "targets", "from", "to", "scale", "angleDeg"
    ]);
  });

  it("projects kind and label metadata for every generated hole", () => {
    for (const plan of sourceCreationTemplatePlans) {
      for (const form of plan.forms) {
        for (const hole of form.argumentHoles) {
          expect(hole.kind, `${plan.commandId}.${hole.argName} kind`).toBeTypeOf("string");
          expect(hole.label, `${plan.commandId}.${hole.argName} label`).not.toBe("");
        }
      }
    }
  });

  it("has exactly one member of every exclusive group in every generated form", () => {
    for (const plan of sourceCreationTemplatePlans) {
      for (const form of plan.forms) {
        for (const choice of form.exclusiveChoices) {
          expect(form.argumentHoles.filter(({ argName }) => choice.group.includes(argName))).toHaveLength(1);
        }
      }
    }
  });
});
