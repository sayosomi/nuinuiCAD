import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import { getParameterDefinitions, scalarTypeForParameterDefinition } from "./parameterDefinitions";

describe("parameterDefinitions", () => {
  it("does not expose generic inspector parameters for a runtime-only moduleInstance", () => {
    const moduleInstance: CadElement = {
      id: "module",
      name: "module",
      type: "moduleInstance",
      activity: "visible"
    };

    expect(getParameterDefinitions(moduleInstance)).toEqual([]);
  });

  it("derives scalar property types from the parameter schema", () => {
    const point: CadElement = {
      id: "point-a",
      name: "点A",
      type: "freePoint",
      activity: "visible",
      x: 10,
      y: 20
    };
    const definitions = getParameterDefinitions(point);
    expect(scalarTypeForParameterDefinition(definitions.find((definition) => definition.key === "x"))).toEqual({ kind: "number" });
    expect(scalarTypeForParameterDefinition({ key: "side", label: "側", kind: "choice", choiceOptions: ["right", "left"] })).toEqual({
      kind: "choice",
      options: ["right", "left"]
    });
  });

  it.each<[string, ReturnType<typeof scalarTypeForParameterDefinition>]>([
    ["name", { kind: "string" }],
    ["colorId", null]
  ])("maps %s according to its schema kind", (key, expected) => {
    const group: CadElement = {
      id: "group",
      name: "group",
      type: "group",
      activity: "visible",
    };
    expect(scalarTypeForParameterDefinition(getParameterDefinitions(group).find((definition) => definition.key === key))).toEqual(expected);
  });

  it("defines tangentOffset curveSide as the shared convex/concave choice", () => {
    const element: CadElement = {
      id: "offset",
      name: "接線オフセット",
      type: "lineTangentOffsetPoint",
      activity: "visible",
      baseLineId: "curve",
      basePoint: { mode: "coordinate", x: 0, y: 0 },
      tangentAngleDeg: 0,
      distance: 3
    };
    expect(getParameterDefinitions(element).find((definition) => definition.key === "curveSide")).toMatchObject({
      kind: "choice",
      choiceOptions: ["convex", "concave"]
    });
  });
});
