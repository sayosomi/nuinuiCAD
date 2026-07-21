import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import { getParameterDefinitions, type ParameterDefinition } from "./parameterDefinitions";

describe("parameterDefinitions propertyCapability", () => {
  it("is optional and unused by existing consumers", () => {
    const point: CadElement = {
      id: "point-a",
      name: "点A",
      type: "freePoint",
      visible: true,
      enabled: true,
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
