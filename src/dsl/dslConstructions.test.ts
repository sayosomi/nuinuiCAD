import { describe, expect, it } from "vitest";
import { createCadElement } from "../model/elementFactory";
import { findParameterDefinition } from "../parameters/parameterDefinitions";
import { elementTypeLabels, type CadElement, type CadElementType } from "../types/geometry";
import {
  argNameForParameter,
  commonArgSpecs,
  constructionFor,
} from "./dslConstructions";
import { settingsSpecFor } from "./dslConstructionsSettings";

const calls = [
  ["point", "coordinate", "freePoint"],
  ["point", "offset", "offsetPoint"],
  ["point", "polar", "polarOffsetPoint"],
  ["point", "between", "divisionPoint"],
  ["point", "onLine", "lineDivisionPoint"],
  ["point", "intersection", "intersectionPoint"],
  ["point", "tangentOffset", "lineTangentOffsetPoint"],
  ["line", "segment", "line"],
  ["line", "polar", "angleLengthLine"],
  ["line", "offset", "offsetLine"],
  ["line", "split", "splitLine"],
  ["line", "copy", "copyLine"],
  ["line", "mirrorCopy", "symmetricCopyLine"],
  ["mutation", "edge", "edge"],
  ["mutation", "extend", "extendTrim"],
  ["mutation", "move", "move"],
  ["mutation", "mirrorMove", "symmetricMove"],
  ["mutation", "reverse", "pathReverse"],
  ["curve", "bezier", "bezierCurve"],
  ["arc", "arc", "arcLine"],
  ["arc", "through", "threePointArcLine"],
  ["arc", "corner", "cornerRadiusArcLine"],
  ["text", "label", "text"],
  ["image", "image", "image"],
  ["group", "", "group"],
  ["if", "", "conditionalGroup"],
  ["for", "", "forGroup"],
] as const satisfies ReadonlyArray<readonly [string, string, CadElementType]>;

const sampleFor = (type: CadElementType) =>
  createCadElement(type, [], { createId: (elementType) => `${elementType}-sample` });

const sampleForSpec = (category: string, construction: string) => {
  const spec = constructionFor(category, construction)!;
  return { ...sampleFor(spec.elementType), ...spec.preset } as CadElement;
};

describe("DSL nui 3 construction registry", () => {
  it("maps every CadElementType to a construction and resolves every call by category", () => {
    const coveredTypes = new Set<CadElementType>();

    for (const [category, construction, type] of calls) {
      expect(constructionFor(category, construction)).toMatchObject({
        category,
        construction,
        elementType: type,
      });
      coveredTypes.add(type);
    }

    expect(coveredTypes).toEqual(new Set(Object.keys(elementTypeLabels)));
  });

  it("keeps same-named constructions independent within their categories", () => {
    expect(constructionFor("point", "offset")?.elementType).toBe("offsetPoint");
    expect(constructionFor("line", "offset")?.elementType).toBe("offsetLine");
    expect(constructionFor("point", "polar")?.elementType).toBe("polarOffsetPoint");
    expect(constructionFor("line", "polar")?.elementType).toBe("angleLengthLine");
    expect(constructionFor("point", "missing")).toBeNull();
    expect(constructionFor("missing", "offset")).toBeNull();
  });

  it("maps each ordinary registry argument to an existing parameter definition", () => {
    for (const [category, construction] of calls) {
      const spec = constructionFor(category, construction)!;
      const sample = sampleForSpec(category, construction);

      for (const definition of spec.args) {
        if (definition.special) continue;
        expect(findParameterDefinition(sample, definition.parameterKey ?? definition.arg)).toBeDefined();
      }
    }

    const commonSample = sampleFor("freePoint");
    for (const definition of commonArgSpecs) {
      if (definition.special) continue;
      // `state` (ElementActivity sugar) is derived, not a CadElement field, so
      // it deliberately has no ParameterDefinition of its own.
      if (definition.arg === "state") continue;
      expect(findParameterDefinition(commonSample, definition.parameterKey ?? definition.arg)).toBeDefined();
    }
  });

  it("round-trips construction parameter keys to their DSL argument names", () => {
    for (const [category, construction] of calls) {
      const spec = constructionFor(category, construction)!;
      for (const definition of spec.args) {
        if (definition.special) continue;
        expect(argNameForParameter(spec.elementType, definition.parameterKey ?? definition.arg)).toBe(definition.arg);
      }
    }

    expect(argNameForParameter("freePoint", "colorId")).toBe("color");
    expect(argNameForParameter("freePoint", "unknown")).toBeNull();
  });
});

describe("DSL nui 3 settings registry", () => {
  it("defines the specified settings arguments and positional slots", () => {
    expect(settingsSpecFor("color")).toMatchObject({
      args: [
        { arg: "hex", positional: true },
        { arg: "name" },
        { arg: "default" },
      ],
    });
    expect(settingsSpecFor("role")?.args.map((arg) => arg.arg)).toEqual(["name"]);
    expect(settingsSpecFor("view")).toMatchObject({ allowsDynamicArgs: true });
    expect(settingsSpecFor("printLayout")?.args.map((arg) => arg.arg)).toEqual([
      "output", "view", "paper", "orientation", "columns", "rows", "overlap", "scale", "canvas",
    ]);
    expect(settingsSpecFor("place")).toMatchObject({
      args: [
        { arg: "group", positional: true },
        { arg: "at" },
        { arg: "angle" },
        { arg: "mirrorX" },
      ],
    });
    expect(settingsSpecFor("missing")).toBeNull();
  });
});
