import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import type { ScalarType } from "../scalars/types";
import { getParameterDefinitions, type ParameterDefinition } from "./parameterDefinitions";

describe("parameterDefinitions propertyCapability", () => {
  it("is optional and unused by existing consumers", () => {
    const point: CadElement = {
      id: "point-a",
      name: "点A",
      type: "freePoint",
      activity: "visible",
      x: 10,
      y: 20
    };

    const definitions = getParameterDefinitions(point);
    expect(definitions.length).toBeGreaterThan(0);
    for (const definition of definitions) {
      expect(definition.propertyCapability).toBeUndefined();
    }
  });

  it("allows a definition to declare a scalar property capability without affecting other fields", () => {
    const withCapability: ParameterDefinition = {
      key: "side",
      label: "側",
      kind: "choice",
      choiceOptions: ["right", "left"],
      propertyCapability: { propertyType: { kind: "choice", options: ["right", "left"] } }
    };

    expect(withCapability.propertyCapability?.propertyType).toEqual({ kind: "choice", options: ["right", "left"] });
  });
});

describe("parameterDefinitions Task 22 opt-in property capability registry", () => {
  const text: CadElement = {
    id: "text-1", name: "テキスト1", type: "text", activity: "visible",
    numericVariables: [], text: "テキスト", anchor: null, fontSize: 3
  };
  const offsetLine: CadElement = {
    id: "offset-1", name: "オフセット1", type: "offsetLine", activity: "visible",
    numericVariables: [], baseLineIds: [], offset: 10, side: "right", closed: false, suppressTrimWarnings: false
  };
  const intersectionPoint: CadElement = {
    id: "intersection-1", name: "交点1", type: "intersectionPoint", activity: "visible",
    numericVariables: [], line1Id: "", line2Id: "", intersectionIndex: 0, useExtensions: true
  };
  const copyLine: CadElement = {
    id: "copy-1", name: "コピー1", type: "copyLine", activity: "visible",
    numericVariables: [],
    startPoint: { mode: "reference", pointId: "" },
    endPoint: { mode: "reference", pointId: "" },
    scale: 1, angleDeg: 0, mirrorX: false, baseLineIds: []
  };
  const move: CadElement = { ...copyLine, id: "move-1", name: "移動1", type: "move" };
  const image: CadElement = {
    id: "image-1", name: "画像1", type: "image", activity: "visible",
    numericVariables: [], sourcePath: "", originPoint: { mode: "coordinate", x: 0, y: 0 },
    naturalWidthPx: 1, naturalHeightPx: 1, sourceDpi: 300, targetPixelsPerMm: 300 / 25.4,
    scale: 1, angleDeg: 0, mirrorX: false
  };
  const group: CadElement = {
    id: "group-1", name: "グループ1", type: "group", activity: "visible",
    printEnabled: false, printAnchor: { mode: "coordinate", x: 0, y: 0 }
  };
  const forGroup: CadElement = {
    id: "for-1", name: "for1", type: "forGroup", activity: "visible",
    variableName: "i", start: 0, count: 3, step: 1, showGenerated: false
  };

  it.each<[CadElement, string, ScalarType]>([
    [text, "text", { kind: "string" }],
    [offsetLine, "side", { kind: "choice", options: ["right", "left"] }],
    [offsetLine, "closed", { kind: "boolean" }],
    [offsetLine, "suppressTrimWarnings", { kind: "boolean" }],
    [intersectionPoint, "useExtensions", { kind: "boolean" }],
    [copyLine, "mirrorX", { kind: "boolean" }],
    [move, "mirrorX", { kind: "boolean" }],
    [image, "mirrorX", { kind: "boolean" }],
    [group, "printEnabled", { kind: "boolean" }],
    [forGroup, "showGenerated", { kind: "boolean" }]
  ])("opts in %s.%s with the expected capability type", (element, key, propertyType) => {
    const definition = getParameterDefinitions(element).find((item) => item.key === key);
    expect(definition?.propertyCapability?.propertyType).toEqual(propertyType);
  });

  it.each<[CadElement, string]>([
    [offsetLine, "offset"],
    [text, "fontSize"]
  ])("leaves %s.%s without a property capability", (element, key) => {
    const definition = getParameterDefinitions(element).find((item) => item.key === key);
    expect(definition?.propertyCapability).toBeUndefined();
  });

  it.each<["visible" | "hidden" | "disabled"]>([["visible"], ["hidden"], ["disabled"]])(
    "never exposes visible/enabled parameter keys for a %s element",
    (activity) => {
      const element: CadElement = { ...text, activity };
      const keys = getParameterDefinitions(element).map((definition) => definition.key);
      expect(keys).not.toContain("visible");
      expect(keys).not.toContain("enabled");
    }
  );
});
