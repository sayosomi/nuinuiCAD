import { describe, expect, it } from "vitest";
import { allConstructionSpecs } from "@nuinuicad/nui-language";
import {
  sourceGeometryValueConstructionPlanFor,
  sourceGeometryValueTemplateGroups
} from "./sourceGeometryValueTemplateCatalog";

const groups = sourceGeometryValueTemplateGroups();

const groupFor = (groupId: "point" | "line" | "path") => {
  const group = groups.find(({ id }) => id === groupId);
  expect(group).toBeDefined();
  return group!;
};

describe("Geometry Value template catalog", () => {
  it("projects Point, Line, and Path from pureValueInterface in registry order", () => {
    expect(groups.map(({ id, label }) => [id, label])).toEqual([
      ["point", "Point"],
      ["line", "Line"],
      ["path", "Path"]
    ]);

    for (const group of groups) {
      expect(group.plans.map(({ construction }) => construction)).toEqual(
        allConstructionSpecs()
          .filter(({ pureValueInterface }) => pureValueInterface === group.id)
          .map(({ construction }) => construction)
      );
    }

    expect(groupFor("point").plans.map(({ construction }) => construction)).toEqual([
      "coordinate", "offset", "polar", "between", "onLine", "intersection",
      "tangentOffset", "bezierExtremePoint", "bezierBulgePoint"
    ]);
    expect(groupFor("line").plans.map(({ construction }) => construction)).toEqual([
      "segment", "polar", "commonTangent"
    ]);
    expect(groupFor("path").plans.map(({ construction }) => construction)).toEqual([
      "offset", "join", "polyline", "transformCopy", "mirrorCopy", "bezier", "arc", "through"
    ]);
  });

  it("does not project drawable-only constructions", () => {
    const projected = groups.flatMap(({ plans }) => plans.map(({ spec }) => spec));
    expect(projected.some(({ construction }) => construction === "from")).toBe(false);
    expect(projected.some(({ construction }) => construction === "split")).toBe(false);
    expect(projected.some(({ construction }) => construction === "corner")).toBe(false);
    expect(projected.some(({ construction }) => construction === "label")).toBe(false);
    expect(projected.some(({ construction }) => construction === "image")).toBe(false);
    expect(projected.some(({ category }) => category === "transformation")).toBe(false);
    expect(projected.some(({ category }) => category === "mutation")).toBe(false);
  });

  it("keeps same-spelling Point polar and Line polar as distinct registry specs", () => {
    const pointPolar = groupFor("point").plans.find(({ construction }) => construction === "polar");
    const linePolar = groupFor("line").plans.find(({ construction }) => construction === "polar");

    expect(pointPolar).toBeDefined();
    expect(linePolar).toBeDefined();
    expect(pointPolar!.spec).not.toBe(linePolar!.spec);
    expect(pointPolar!.groupId).toBe("point");
    expect(linePolar!.groupId).toBe("line");
    expect(pointPolar!.forms[0]!.args.map(({ arg }) => arg)).toEqual(["from", "angle", "distance"]);
    expect(linePolar!.forms[0]!.args.map(({ arg }) => arg)).toEqual(["start", "angle", "length"]);
  });

  it("uses selected registry argument order and derives exclusive forms", () => {
    const between = groupFor("point").plans.find(({ construction }) => construction === "between")!;
    expect(between.forms.map(({ args, exclusiveChoices }) => [
      args.map(({ arg }) => arg),
      exclusiveChoices.map(({ selectedArgName }) => selectedArgName)
    ])).toEqual([
      [["start", "end", "distance"], ["distance"]],
      [["start", "end", "ratio"], ["ratio"]]
    ]);

    const onLine = groupFor("point").plans.find(({ construction }) => construction === "onLine")!;
    expect(onLine.forms.map(({ args }) => args.map(({ arg }) => arg))).toEqual([
      ["from", "distance"],
      ["from", "ratio"]
    ]);

    const tangentOffset = groupFor("point").plans.find(({ construction }) => construction === "tangentOffset")!;
    expect(tangentOffset.forms.map(({ args, exclusiveChoices }) => [
      args.map(({ arg }) => arg),
      exclusiveChoices.map(({ selectedArgName }) => selectedArgName)
    ])).toEqual([
      [["line", "base", "angle", "distance"], ["angle"]],
      [["line", "base", "curveSide", "distance"], ["curveSide"]]
    ]);
  });

  it("rejects malformed exclusive metadata instead of guessing", () => {
    const spec = allConstructionSpecs().find(({ construction }) => construction === "between")!;
    expect(sourceGeometryValueConstructionPlanFor({
      ...spec,
      exclusiveGroups: [["distance", "missing"]]
    })).toBeNull();
  });
});
