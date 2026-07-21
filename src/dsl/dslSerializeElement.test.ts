import { describe, expect, it } from "vitest";
import { createCadElement } from "../model/elementFactory";
import { referenceAnchor } from "../model/pointAnchors";
import type { CadElement, CadElementType } from "../types/geometry";
import { commonArgSpecs, constructionFor, constructionForElementType } from "./dslConstructions";
import { documentDslRefs, flatRefs } from "./dslSerializer";
import {
  serializeElementStatementBlock,
  serializeElementStatementLogical,
} from "./dslSerializeElement";

const referenceElements: CadElement[] = [
  { id: "p1", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
  { id: "p2", name: "B", type: "freePoint", visible: true, enabled: true, x: 10, y: 0 },
  { id: "p3", name: "C", type: "freePoint", visible: true, enabled: true, x: 20, y: 0 },
  { id: "l1", name: "AB", type: "line", visible: true, enabled: true, startPoint: referenceAnchor("p1"), endPoint: referenceAnchor("p2") },
  { id: "l2", name: "CD", type: "line", visible: true, enabled: true, startPoint: referenceAnchor("p2"), endPoint: referenceAnchor("p3") },
];

const minimal = (type: CadElementType) => createCadElement(type, [], {
  createId: (elementType) => `${elementType}-id`,
  referenceElements,
});

const calls: ReadonlyArray<readonly [CadElementType, string, string]> = [
  ["freePoint", "point", "coordinate"], ["offsetPoint", "point", "offset"],
  ["polarOffsetPoint", "point", "polar"], ["divisionPoint", "point", "between"],
  ["lineDivisionPoint", "point", "onLine"], ["intersectionPoint", "point", "intersection"],
  ["lineTangentOffsetPoint", "point", "tangentOffset"], ["line", "line", "segment"],
  ["angleLengthLine", "line", "polar"], ["offsetLine", "line", "offset"],
  ["splitLine", "line", "split"], ["extendTrim", "line", "extend"],
  ["copyLine", "line", "copy"], ["move", "line", "move"],
  ["symmetricCopyLine", "line", "mirrorCopy"], ["symmetricMove", "line", "mirrorMove"],
  ["edge", "line", "edge"], ["bezierCurve", "curve", "bezier"],
  ["arcLine", "arc", "arc"], ["threePointArcLine", "arc", "through"],
  ["cornerRadiusArcLine", "arc", "corner"], ["text", "text", "label"],
  ["image", "image", "image"], ["variable", "var", "expression"],
  ["group", "group", ""], ["conditionalGroup", "if", ""], ["forGroup", "for", ""],
];

describe("DSL v2 element serializer", () => {
  it("serializes all 27 element types from their registry construction", () => {
    for (const [type, category, construction] of calls) {
      const element = minimal(type);
      const block = serializeElementStatementBlock(element, documentDslRefs([...referenceElements, element]));
      const spec = constructionForElementType(type);

      expect(spec).toMatchObject({ category, construction });
      if (type === "variable") {
        expect(block).toEqual({ header: `var ${element.name} = 0`, args: [], close: null });
      } else if (type === "group") {
        expect(block).toEqual({ header: `group ${element.name}`, args: [], close: null });
      } else if (type === "conditionalGroup" || type === "forGroup") {
        expect(block.close).toBeNull();
        expect(block.args).toEqual([]);
        expect(block.header).toMatch(new RegExp(`^${category} ${element.name} \\(`));
      } else {
        expect(block).toMatchObject({
          header: `${category} ${element.name} = ${construction}(`,
          close: ")",
        });
        const constructionKeys = spec.args
          .filter((arg) => {
            const hasIntermediateRecords =
              arg.special !== "intermediates" ||
              element.type !== "bezierCurve" ||
              element.intermediatePoints.length > 0;
            const isActivePlacement =
              (arg.arg !== "distance" && arg.arg !== "ratio") ||
              !(element.type === "divisionPoint" || element.type === "lineDivisionPoint") ||
              element.placementMode === arg.arg;
            return hasIntermediateRecords && isActivePlacement;
          })
          .map((arg) => arg.arg);
        expect(block.args.slice(0, constructionKeys.length).map((arg) => arg.key)).toEqual(constructionKeys);
        expect(block.args.slice(constructionKeys.length).map((arg) => arg.key)).toEqual(
          Object.keys(element.numericParameterSteps ?? {}).length ? ["steps"] : [],
        );
      }
    }
  });

  it("keeps block and logical forms fixed for normal elements and record values", () => {
    const point = {
      ...minimal("freePoint"),
      name: "前 身",
      x: { kind: "expression" as const, expression: "-(bust / 4)" },
      y: -2,
      visible: false,
      enabled: false,
      colorId: "pattern-black",
      numericParameterSteps: { x: 0.1 },
      numericVariables: [{ id: "local-1", name: "幅", value: 12 }],
    };
    const refs = documentDslRefs([...referenceElements, point]);

    expect(serializeElementStatementBlock(point, refs)).toEqual({
      header: 'point "前 身" = coordinate(',
      args: [
        { key: "x", text: "x: -(bust / 4)" }, { key: "y", text: "y: -2" },
        { key: "enabled", text: "enabled: false" },
        { key: "color", text: "color: pattern-black" },
        { key: "steps", text: "steps: [x: 0.1]" }, { key: "vars", text: "vars: [幅: 12]" },
      ],
      close: ")",
    });
    expect(serializeElementStatementLogical(point, refs)).toBe(
      'point "前 身" = coordinate(x: -(bust / 4) y: -2 enabled: false color: pattern-black steps: [x: 0.1] vars: [幅: 12])',
    );

    const curve = {
      ...minimal("bezierCurve"),
      intermediatePoints: [{
        id: "mid-1", point: referenceAnchor("p3"), handleAngleDeg: 45,
        incomingHandleLength: 20, outgoingHandleLength: 25,
      }],
    };
    expect(serializeElementStatementLogical(curve, flatRefs())).toContain("intermediates: [p3:45:20:25:mid-1]");
    expect(serializeElementStatementLogical(curve, documentDslRefs([...referenceElements, curve])))
      .toContain("intermediates: [C:45:20:25]");
  });

  it("uses only the active exclusive placement argument and canonical common-argument order", () => {
    const division = {
      ...minimal("divisionPoint"), placementMode: "distance" as const, distance: 24,
      visible: false, enabled: false, colorId: "red",
      numericParameterSteps: { distance: 1 },
      numericVariables: [{ id: "local-1", name: "幅", value: 5 }],
      parentGroupId: "g1", conditionalBranch: "else" as const,
    };
    const args = serializeElementStatementBlock(division, flatRefs()).args;
    expect(args.map((arg) => arg.key)).toEqual([
      "start", "end", "distance",
      ...commonArgSpecs
        .filter((arg) => arg.arg !== "roles" && arg.arg !== "visible" && arg.arg !== "locked")
        .map((arg) => arg.arg),
    ]);
    expect(args.map((arg) => arg.text)).toContain("parent: g1");
    expect(args.map((arg) => arg.text)).toContain("branch: else");
  });

  // 04: divisionPointのdistance-modeは上のテストで確認済みだが、lineDivisionPointの
  // distance-modeは既存の登録駆動loop(ratio-mode既定fixture)では未確認だったため
  // 明示的に固定する。
  it("uses only the active exclusive placement argument for lineDivisionPoint distance mode", () => {
    const onLine = {
      ...minimal("lineDivisionPoint"), placementMode: "distance" as const, distance: 12, ratio: 0.75,
    };
    const args = serializeElementStatementBlock(onLine, flatRefs()).args;
    expect(args.map((arg) => arg.key)).toContain("distance");
    expect(args.map((arg) => arg.key)).not.toContain("ratio");
    expect(args.map((arg) => arg.text)).toContain("distance: 12");
  });

  it("keeps all four variable constructions and both expression forms fixed", () => {
    const base = minimal("variable");
    const refs = documentDslRefs([...referenceElements, base]);

    expect(serializeElementStatementBlock(base, refs)).toEqual({
      header: `var ${base.name} = 0`, args: [], close: null,
    });
    const expressionCall = { ...base, enabled: false };
    expect(serializeElementStatementBlock(expressionCall, refs)).toEqual({
      header: `var ${base.name} = expression(`,
      args: [
        { key: "value", text: "value: 0" }, { key: "scope", text: "scope: global" },
        { key: "enabled", text: "enabled: false" },
      ],
      close: ")",
    });

    for (const mode of ["expression", "pointDistance", "pointAngle", "pointLineDistance"] as const) {
      const element = { ...base, valueMode: mode } as CadElement;
      const construction = constructionFor("var", mode)!;
      const output = serializeElementStatementBlock(element, refs);
      expect(construction.construction).toBe(mode);
      if (mode !== "expression") {
        expect(output.header).toBe(`var ${base.name} = ${mode}(`);
        expect(output.args.map((arg) => arg.key)).toEqual(construction.args.map((arg) => arg.arg));
      }
    }
  });

  it("writes group, if, and for headers without block braces", () => {
    const group = { ...minimal("group"), printEnabled: true, visibilityRoleIds: ["seam"] };
    expect(serializeElementStatementBlock(group, documentDslRefs([...referenceElements, group]))).toEqual({
      header: `group ${group.name} (printEnabled: true roles: [seam])`, args: [], close: null,
    });
    const conditional = minimal("conditionalGroup");
    const loop = minimal("forGroup");
    expect(serializeElementStatementLogical(conditional, documentDslRefs([...referenceElements, conditional])))
      .toBe("if ifブロック1 (1)");
    expect(serializeElementStatementLogical(loop, documentDslRefs([...referenceElements, loop])))
      .toBe("for forブロック1 (i from: 0 count: 3 step: 1 showGenerated: false)");
  });
});
