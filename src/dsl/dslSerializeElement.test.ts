import { describe, expect, it } from "vitest";
import { createCadElement } from "../model/elementFactory";
import { referenceAnchor } from "../model/pointAnchors";
import type { CadElement, CadElementType } from "../types/geometry";
import { commonArgSpecs, constructionForElementType } from "./dslConstructions";
import { documentDslRefs, flatRefs } from "./dslSerializer";
import {
  serializeElementStatementBlock,
  serializeElementStatementLogical,
} from "./dslSerializeElement";

const referenceElements: CadElement[] = [
  { id: "p1", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
  { id: "p2", name: "B", type: "freePoint", activity: "visible", x: 10, y: 0 },
  { id: "p3", name: "C", type: "freePoint", activity: "visible", x: 20, y: 0 },
  { id: "l1", name: "AB", type: "line", activity: "visible", startPoint: referenceAnchor("p1"), endPoint: referenceAnchor("p2") },
  { id: "l2", name: "CD", type: "line", activity: "visible", startPoint: referenceAnchor("p2"), endPoint: referenceAnchor("p3") },
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
  ["bezierExtremePoint", "point", "bezierExtremePoint"],
  ["bezierBulgePoint", "point", "bezierBulgePoint"],
  ["angleLengthLine", "line", "polar"], ["offsetLine", "line", "offset"],
  ["splitLine", "line", "split"],
  ["copyLine", "line", "transformCopy"],
  ["symmetricCopyLine", "line", "mirrorCopy"],
  ["extendTrim", "mutation", "extend"], ["move", "mutation", "move"],
  ["symmetricMove", "mutation", "mirrorMove"], ["edge", "mutation", "edge"],
  ["pathReverse", "mutation", "reverse"],
  ["bezierCurve", "curve", "bezier"],
  ["arcLine", "arc", "arc"], ["threePointArcLine", "arc", "through"],
  ["cornerRadiusArcLine", "arc", "corner"], ["text", "text", "label"],
  ["image", "image", "image"],
  ["group", "group", ""], ["conditionalGroup", "if", ""], ["forGroup", "for", ""],
];

const bareMutationTypes: ReadonlySet<CadElementType> =
  new Set(["edge", "extendTrim", "move", "symmetricMove", "pathReverse"]);

describe("DSL nui 4 element serializer", () => {
  it("serializes all element types from their registry construction", () => {
    for (const [type, category, construction] of calls) {
      const element = minimal(type);
      const block = serializeElementStatementBlock(element, documentDslRefs([...referenceElements, element]));
      const spec = constructionForElementType(type);

      expect(spec).toMatchObject({ category, construction });
      if (type === "group") {
        expect(block).toEqual({ header: `group ${element.name}`, args: [], close: null, argumentSeparator: "comma" });
      } else if (type === "conditionalGroup" || type === "forGroup") {
        expect(block.close).toBeNull();
        expect(block.args).toEqual([]);
        expect(block.header).toMatch(category === "if" ? /^if \(/ : /^for i in range\(/);
      } else {
        expect(block).toMatchObject({
          header: bareMutationTypes.has(type) ? `${construction}(` : `${category} ${element.name} = ${construction}(`,
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
              element.placement.kind === arg.arg;
            const isActiveTangentOffsetMode =
              element.type !== "lineTangentOffsetPoint" ||
              (arg.arg !== "angle" && arg.arg !== "curveSide") ||
              (arg.arg === "curveSide" ? element.curveSide !== undefined : element.curveSide === undefined);
            return hasIntermediateRecords && isActivePlacement && isActiveTangentOffsetMode;
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
      activity: "disabled" as const,
      numericParameterSteps: { x: 0.1 },
    };
    const refs = documentDslRefs([...referenceElements, point]);

    expect(serializeElementStatementBlock(point, refs)).toEqual({
      header: 'point "前 身" = coordinate(',
      args: [
        { key: "x", text: "x: -(bust / 4)" }, { key: "y", text: "y: -2" },
        { key: "state", text: "state: disabled" },
        { key: "steps", text: "steps: [x: 0.1]" },
      ],
      close: ")",
      argumentSeparator: "comma",
    });
    expect(serializeElementStatementLogical(point, refs)).toBe(
      'point "前 身" = coordinate(x: -(bust / 4), y: -2, state: disabled, steps: [x: 0.1])',
    );

    const curve = {
      ...minimal("bezierCurve"),
      intermediatePoints: [{
        id: "mid-1", point: referenceAnchor("p3"), handleAngleDeg: 45,
        incomingHandleLength: 20, outgoingHandleLength: 25,
      }],
    };
    expect(serializeElementStatementLogical(curve, flatRefs())).toContain("intermediates: [@p3:45:20:25:mid-1]");
    expect(serializeElementStatementLogical(curve, documentDslRefs([...referenceElements, curve])))
      .toContain("intermediates: [@C:45:20:25]");
  });

  it("uses only the active exclusive placement argument and canonical common-argument order", () => {
    const division = {
      ...minimal("divisionPoint"), placement: { kind: "distance" as const, value: 24 },
      activity: "disabled" as const, colorId: "red",
      numericParameterSteps: { distance: 1 },
      parentGroupId: "g1", conditionalBranch: "else" as const,
    };
    const args = serializeElementStatementBlock(division, flatRefs()).args;
    expect(args.map((arg) => arg.key)).toEqual([
      "start", "end", "distance",
      ...commonArgSpecs
        .filter((arg) => arg.arg !== "roles")
        .map((arg) => arg.arg),
    ]);
    expect(args.map((arg) => arg.text)).toContain("parent: @g1");
    expect(args.map((arg) => arg.text)).toContain("branch: else");
  });

  // 04: divisionPointのdistance-modeは上のテストで確認済みだが、lineDivisionPointの
  // distance-modeは既存の登録駆動loop(ratio-mode既定fixture)では未確認だったため
  // 明示的に固定する。
  it("uses only the active exclusive placement argument for lineDivisionPoint distance mode", () => {
    const onLine = {
      ...minimal("lineDivisionPoint"), placement: { kind: "distance" as const, value: 12 },
    };
    const args = serializeElementStatementBlock(onLine, flatRefs()).args;
    expect(args.map((arg) => arg.key)).toContain("distance");
    expect(args.map((arg) => arg.key)).not.toContain("ratio");
    expect(args.map((arg) => arg.text)).toContain("distance: 12");
  });

  it("serializes only the active tangentOffset direction mode", () => {
    const base = minimal("lineTangentOffsetPoint");
    const convex = { ...base, curveSide: "convex" as const, tangentAngleDeg: 37 };
    const refs = documentDslRefs([...referenceElements, convex]);
    const block = serializeElementStatementBlock(convex, refs);
    expect(block.args.map((arg) => arg.key)).toContain("curveSide");
    expect(block.args.map((arg) => arg.key)).not.toContain("angle");
    expect(serializeElementStatementLogical(convex, refs)).toContain("curveSide: convex");
    expect(serializeElementStatementLogical(convex, refs)).not.toContain("angle:");

    const angle = { ...base, tangentAngleDeg: 37 };
    const angleBlock = serializeElementStatementBlock(angle, documentDslRefs([...referenceElements, angle]));
    expect(angleBlock.args.map((arg) => arg.key)).toContain("angle");
    expect(angleBlock.args.map((arg) => arg.key)).not.toContain("curveSide");
  });

  it("writes group, if, and for headers without block braces", () => {
    const group = { ...minimal("group"), visibilityRoleIds: ["seam"] };
    expect(serializeElementStatementBlock(group, documentDslRefs([...referenceElements, group]))).toEqual({
      header: `group ${group.name} (roles: [seam])`, args: [], close: null, argumentSeparator: "comma",
    });
    const conditional = minimal("conditionalGroup");
    const loop = minimal("forGroup");
    expect(serializeElementStatementLogical(conditional, documentDslRefs([...referenceElements, conditional])))
      .toBe("if (true)");
    expect(serializeElementStatementLogical(loop, documentDslRefs([...referenceElements, loop])))
      .toBe("for i in range(from: 0, count: 3, step: 1)");
  });
});

describe("nui 4 activity serialization", () => {
  const argTexts = (element: CadElement) =>
    serializeElementStatementBlock(element, flatRefs()).args.map((arg) => arg.text);

  it("omits state for visible and never emits legacy visible/enabled flags", () => {
    const visible = minimal("freePoint");
    expect(argTexts(visible).some((text) => text.startsWith("state:"))).toBe(false);
    expect(argTexts(visible).some((text) => text.startsWith("visible:") || text.startsWith("enabled:"))).toBe(false);
  });

  it("emits state: hidden / state: disabled and never legacy flags", () => {
    const hidden = { ...minimal("freePoint"), activity: "hidden" as const };
    expect(argTexts(hidden)).toContain("state: hidden");
    expect(argTexts(hidden).some((text) => text.startsWith("visible:") || text.startsWith("enabled:"))).toBe(false);

    const disabled = { ...minimal("freePoint"), activity: "disabled" as const };
    expect(argTexts(disabled)).toContain("state: disabled");
    expect(argTexts(disabled).some((text) => text.startsWith("visible:") || text.startsWith("enabled:"))).toBe(false);
  });
});
