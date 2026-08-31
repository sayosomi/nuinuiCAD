import { describe, expect, it } from "vitest";
import { createCadElement } from "../model/elementFactory";
import { findParameterDefinition } from "../parameters/parameterDefinitions";
import {
  elementTypeLabels,
  runtimeOnlyElementTypes,
  type CadElement,
  type CadElementType
} from "../types/geometry";
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
  ["point", "bezierExtremePoint", "bezierExtremePoint"],
  ["point", "bezierBulgePoint", "bezierBulgePoint"],
  ["line", "segment", "line"],
  ["line", "polar", "angleLengthLine"],
  ["line", "commonTangent", "commonTangentLine"],
  ["line", "offset", "offsetLine"],
  ["line", "polyline", "polyline"],
  ["line", "split", "splitLine"],
  ["line", "transformCopy", "copyLine"],
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

describe("DSL nui 1 construction registry", () => {
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

    expect(coveredTypes).toEqual(new Set(
      Object.keys(elementTypeLabels).filter((type) => !runtimeOnlyElementTypes.has(type as CadElementType))
    ));
  });

  it("keeps same-named constructions independent within their categories", () => {
    expect(constructionFor("point", "offset")?.elementType).toBe("offsetPoint");
    expect(constructionFor("line", "offset")?.elementType).toBe("offsetLine");
    expect(constructionFor("point", "polar")?.elementType).toBe("polarOffsetPoint");
    expect(constructionFor("line", "polar")?.elementType).toBe("angleLengthLine");
    expect(constructionFor("point", "missing")).toBeNull();
    expect(constructionFor("missing", "offset")).toBeNull();
  });

  it("renames the copy construction without changing its element or arguments", () => {
    expect(constructionFor("line", "transformCopy")).toMatchObject({
      category: "line",
      construction: "transformCopy",
      elementType: "copyLine",
      args: [
        { arg: "startPoint", required: true },
        { arg: "endPoint", required: true },
        { arg: "scale" },
        { arg: "angleDeg" },
        { arg: "mirrorX" },
        { arg: "baseLines", required: true, parameterKey: "baseLineIds" },
      ],
    });
    expect(constructionFor("line", "copy")).toBeNull();
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

    expect(argNameForParameter("freePoint", "colorId")).toBeNull();
    expect(argNameForParameter("freePoint", "unknown")).toBeNull();
  });
});

describe("DSL nui 1 settings registry", () => {
  it("defines the specified settings arguments and positional slots", () => {
    expect(settingsSpecFor("color")).toBeNull();
    expect(settingsSpecFor("role")?.args.map((arg) => arg.arg)).toEqual(["name"]);
    expect(settingsSpecFor("view")).toMatchObject({ allowsDynamicArgs: true });
    expect(settingsSpecFor("layout")?.args.map((arg) => arg.arg)).toEqual(["scale"]);
    expect(settingsSpecFor("print")?.args.map((arg) => arg.arg)).toEqual([
      "layout", "profile", "paper", "orientation", "overlap",
    ]);
    expect(settingsSpecFor("svg")?.args.map((arg) => arg.arg)).toEqual(["layout", "profile", "margin"]);
    expect(settingsSpecFor("place")).toMatchObject({
      args: [
        { arg: "group", positional: true },
        { arg: "origin" },
        { arg: "at" },
        { arg: "scale" },
        { arg: "angle" },
        { arg: "mirror" },
      ],
    });
    expect(settingsSpecFor("missing")).toBeNull();
  });
});
