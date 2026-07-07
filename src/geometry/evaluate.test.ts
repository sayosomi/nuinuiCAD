import { describe, expect, it } from "vitest";
import { evaluateElements } from "./evaluate";
import { makeNumericExpression, normalizeNumericExpressionInput } from "./numericExpressions";
import type { CadElement } from "../types/geometry";

const validElements: CadElement[] = [
  {
    id: "a",
    name: "点A",
    type: "freePoint",
    visible: true,
    enabled: true,
    x: 10,
    y: 20
  },
  {
    id: "b",
    name: "点B",
    type: "offsetPoint",
    visible: true,
    enabled: true,
    fromPointId: "a",
    dx: 30,
    dy: 5
  },
  {
    id: "ab",
    name: "直線AB",
    type: "line",
    visible: true,
    enabled: true,
    startPoint: { mode: "reference", pointId: "a" },
    endPoint: { mode: "reference", pointId: "b" }
  }
];

describe("evaluateElements", () => {
  it("evaluates points and lines in valid top-to-bottom order", () => {
    const result = evaluateElements(validElements);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("a")).toMatchObject({ kind: "point", x: 10, y: 20 });
    expect(result.computedGeometry.get("b")).toMatchObject({ kind: "point", x: 40, y: 25 });
    expect(result.computedGeometry.get("ab")).toMatchObject({ kind: "line" });
  });

  it("evaluates image placement from source dpi and scale", () => {
    const result = evaluateElements([
      validElements[0],
      {
        id: "image",
        name: "下絵",
        type: "image",
        visible: true,
        enabled: true,
        sourcePath: "underlay.png",
        originPoint: { mode: "reference", pointId: "a" },
        naturalWidthPx: 300,
        naturalHeightPx: 150,
        sourceDpi: 300,
        targetPixelsPerMm: 10,
        scale: 2,
        angleDeg: 15,
        mirrorX: true
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("image")).toMatchObject({
      kind: "image",
      origin: { x: 10, y: 20 },
      widthMm: 50.8,
      heightMm: 25.4,
      scale: 2,
      angleDeg: 15,
      mirrorX: true
    });
  });

  it("evaluates text with point anchors and live numeric references", () => {
    const result = evaluateElements([
      ...validElements,
      {
        id: "ease",
        name: "ゆとり",
        type: "variable",
        visible: true,
        enabled: true,
        scope: "global",
        valueMode: "expression",
        expression: 12,
        point1: { mode: "reference", pointId: "a" },
        point2: { mode: "reference", pointId: "b" },
        point: { mode: "reference", pointId: "a" },
        lineId: "ab"
      },
      {
        id: "text",
        name: "注記",
        type: "text",
        visible: true,
        enabled: true,
        text: "前中心 @ゆとり / 直線AB.length",
        anchor: { mode: "reference", pointId: "a" },
        fontSize: 4
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("text")).toMatchObject({
      kind: "text",
      text: "前中心 12 / 30.414",
      anchor: { x: 10, y: 20 },
      fontSize: 4
    });
  });

  it("evaluates text without an anchor as a list comment", () => {
    const result = evaluateElements([
      {
        id: "text",
        name: "メモ",
        type: "text",
        visible: true,
        enabled: true,
        text: "ここから前身頃",
        anchor: null,
        fontSize: 3
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("text")).toMatchObject({
      kind: "text",
      text: "ここから前身頃",
      anchor: null
    });
  });

  it("reports image geometry errors for invalid dpi or scale", () => {
    const result = evaluateElements([
      {
        id: "image",
        name: "壊れた画像",
        type: "image",
        visible: true,
        enabled: true,
        sourcePath: "broken.png",
        originPoint: { mode: "coordinate", x: 0, y: 0 },
        naturalWidthPx: 300,
        naturalHeightPx: 150,
        sourceDpi: 0,
        targetPixelsPerMm: 10,
        scale: 1,
        angleDeg: 0,
        mirrorX: false
      }
    ]);

    expect(result.computedGeometry.has("image")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "image",
      missingDependencyId: "image"
    });
  });

  it("evaluates only elements before the evaluation limit", () => {
    const result = evaluateElements(validElements, { evaluationLimitIndex: 2 });

    expect(result.errors).toHaveLength(0);
    expect(result.evaluationLimitIndex).toBe(2);
    expect(result.evaluatedElementIds).toEqual(new Set(["a", "b"]));
    expect(result.computedGeometry.has("a")).toBe(true);
    expect(result.computedGeometry.has("b")).toBe(true);
    expect(result.computedGeometry.has("ab")).toBe(false);
  });

  it("reports a dependency error when an evaluated element references an element after the limit", () => {
    const result = evaluateElements([validElements[0], validElements[2], validElements[1]], {
      evaluationLimitIndex: 2
    });

    expect(result.computedGeometry.has("ab")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "ab",
      missingDependencyId: "b",
      missingDependencyName: "点B"
    });
  });

  it("keeps child visibility settings while applying parent visibility as a drawing mask", () => {
    const result = evaluateElements([
      {
        id: "group",
        name: "前身頃",
        type: "group",
        visible: false,
        enabled: true,
        expanded: true
      },
      { ...validElements[0], parentGroupId: "group", visible: true }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.has("a")).toBe(true);
    expect(result.effectiveVisibleElementIds?.has("a")).toBe(false);
  });

  it("reports references to geometry disabled by a parent group", () => {
    const result = evaluateElements([
      {
        id: "group",
        name: "前身頃",
        type: "group",
        visible: true,
        enabled: false,
        expanded: true
      },
      { ...validElements[0], parentGroupId: "group", enabled: true },
      {
        id: "line",
        name: "参照線",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "coordinate", x: 10, y: 10 }
      }
    ]);

    expect(result.computedGeometry.has("a")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "line",
      missingDependencyId: "a",
      missingDependencyName: "点A"
    });
    expect(result.errors[0].message).toContain("前身頃");
    expect(result.errors[0].message).toContain("評価OFF");
  });

  it("evaluates only the then branch of a conditional group when condition is non-zero", () => {
    const result = evaluateElements([
      {
        id: "if",
        name: "寸法分岐",
        type: "conditionalGroup",
        visible: true,
        enabled: true,
        condition: 1,
        expanded: true,
        elseExpanded: true
      },
      { ...validElements[0], id: "then-point", name: "then点", parentGroupId: "if", conditionalBranch: "then" },
      { ...validElements[0], id: "else-point", name: "else点", parentGroupId: "if", conditionalBranch: "else" }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.has("then-point")).toBe(true);
    expect(result.computedGeometry.has("else-point")).toBe(false);
    expect(result.conditionInactiveElementIds).toEqual(new Set(["else-point"]));
    expect(result.effectiveEnabledElementIds?.has("then-point")).toBe(true);
    expect(result.effectiveEnabledElementIds?.has("else-point")).toBe(false);
  });

  it("evaluates only the else branch of a conditional group when condition is zero", () => {
    const result = evaluateElements([
      {
        id: "if",
        name: "寸法分岐",
        type: "conditionalGroup",
        visible: true,
        enabled: true,
        condition: 0,
        expanded: true,
        elseExpanded: true
      },
      { ...validElements[0], id: "then-point", name: "then点", parentGroupId: "if", conditionalBranch: "then" },
      { ...validElements[0], id: "else-point", name: "else点", parentGroupId: "if", conditionalBranch: "else" }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.has("then-point")).toBe(false);
    expect(result.computedGeometry.has("else-point")).toBe(true);
    expect(result.conditionInactiveElementIds).toEqual(new Set(["then-point"]));
  });

  it("evaluates conditional group comparison expressions", () => {
    const result = evaluateElements([
      ...validElements,
      {
        id: "c",
        name: "点C",
        type: "offsetPoint",
        visible: true,
        enabled: true,
        fromPointId: "a",
        dx: 100,
        dy: 0
      },
      {
        id: "ac",
        name: "直線AC",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "c" }
      },
      {
        id: "if",
        name: "寸法分岐",
        type: "conditionalGroup",
        visible: true,
        enabled: true,
        condition: makeNumericExpression("ab.length >= 100 || ac.length >= 100"),
        expanded: true,
        elseExpanded: true
      },
      { ...validElements[0], id: "then-point", name: "then点", parentGroupId: "if", conditionalBranch: "then" },
      { ...validElements[0], id: "else-point", name: "else点", parentGroupId: "if", conditionalBranch: "else" }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.has("then-point")).toBe(true);
    expect(result.computedGeometry.has("else-point")).toBe(false);
    expect(result.conditionInactiveElementIds).toEqual(new Set(["else-point"]));
  });

  it("evaluates false conditional comparison expressions", () => {
    const result = evaluateElements([
      ...validElements,
      {
        id: "if",
        name: "寸法分岐",
        type: "conditionalGroup",
        visible: true,
        enabled: true,
        condition: makeNumericExpression("ab.length > 0 && ab.length + 10 <= 10"),
        expanded: true,
        elseExpanded: true
      },
      { ...validElements[0], id: "then-point", name: "then点", parentGroupId: "if", conditionalBranch: "then" },
      { ...validElements[0], id: "else-point", name: "else点", parentGroupId: "if", conditionalBranch: "else" }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.has("then-point")).toBe(false);
    expect(result.computedGeometry.has("else-point")).toBe(true);
    expect(result.conditionInactiveElementIds).toEqual(new Set(["then-point"]));
  });

  it("does not treat single equals as equality in conditional expressions", () => {
    const result = evaluateElements([
      ...validElements,
      {
        id: "if",
        name: "寸法分岐",
        type: "conditionalGroup",
        visible: true,
        enabled: true,
        condition: makeNumericExpression("ab.length = 0"),
        expanded: true,
        elseExpanded: true
      },
      { ...validElements[0], id: "then-point", name: "then点", parentGroupId: "if", conditionalBranch: "then" }
    ]);

    expect(result.errors[0]).toMatchObject({
      elementId: "if",
      missingDependencyId: "ab.length = 0"
    });
    expect(result.computedGeometry.has("then-point")).toBe(false);
  });

  it("evaluates for group template elements once per iteration with a local variable", () => {
    const result = evaluateElements([
      {
        id: "loop",
        name: "プリーツ繰り返し",
        type: "forGroup",
        visible: true,
        enabled: true,
        variableName: "i",
        start: 0,
        count: 3,
        step: 2,
        expanded: true,
        showGenerated: true
      },
      {
        id: "p",
        name: "プリーツ点",
        type: "freePoint",
        visible: true,
        enabled: true,
        parentGroupId: "loop",
        x: makeNumericExpression("@i * 10"),
        y: 5
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.has("p")).toBe(false);
    expect(result.computedGeometry.get("p@loop:0")).toMatchObject({ kind: "point", x: 0, y: 5 });
    expect(result.computedGeometry.get("p@loop:1")).toMatchObject({ kind: "point", x: 20, y: 5 });
    expect(result.computedGeometry.get("p@loop:2")).toMatchObject({ kind: "point", x: 40, y: 5 });
    expect(result.forGroupGeneratedRows).toEqual([
      expect.objectContaining({ forGroupId: "loop", templateElementId: "p", generatedElementId: "p@loop:0" }),
      expect.objectContaining({ forGroupId: "loop", templateElementId: "p", generatedElementId: "p@loop:1" }),
      expect.objectContaining({ forGroupId: "loop", templateElementId: "p", generatedElementId: "p@loop:2" })
    ]);
  });

  it("remaps references between generated for group template elements", () => {
    const result = evaluateElements([
      {
        id: "origin",
        name: "原点",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "loop",
        name: "ボタン繰り返し",
        type: "forGroup",
        visible: true,
        enabled: true,
        variableName: "i",
        start: 1,
        count: 2,
        step: 1,
        expanded: true,
        showGenerated: false
      },
      {
        id: "button",
        name: "ボタン位置",
        type: "offsetPoint",
        visible: true,
        enabled: true,
        parentGroupId: "loop",
        fromPoint: { mode: "reference", pointId: "origin" },
        fromPointId: "origin",
        dx: makeNumericExpression("@i * 15"),
        dy: 0
      },
      {
        id: "button-line",
        name: "ボタン線",
        type: "line",
        visible: true,
        enabled: true,
        parentGroupId: "loop",
        startPoint: { mode: "reference", pointId: "origin" },
        endPoint: { mode: "reference", pointId: "button" }
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("button@loop:0")).toMatchObject({ kind: "point", x: 15 });
    expect(result.computedGeometry.get("button-line@loop:0")).toMatchObject({
      kind: "line",
      endPointId: "button@loop:0"
    });
    expect(result.computedGeometry.get("button@loop:1")).toMatchObject({ kind: "point", x: 30 });
    expect(result.computedGeometry.get("button-line@loop:1")).toMatchObject({
      kind: "line",
      endPointId: "button@loop:1"
    });
  });

  it("applies generated for group extend trims to matching generated lines", () => {
    const result = evaluateElements([
      { id: "a", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", visible: true, enabled: true, x: 110, y: 0 },
      { id: "c", name: "C", type: "freePoint", visible: true, enabled: true, x: 0, y: 30 },
      { id: "d", name: "D", type: "freePoint", visible: true, enabled: true, x: 110, y: 30 },
      {
        id: "ab",
        name: "AB",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "cd",
        name: "CD",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "c" },
        endPoint: { mode: "reference", pointId: "d" }
      },
      {
        id: "loop",
        name: "繰り返し",
        type: "forGroup",
        visible: true,
        enabled: true,
        variableName: "i",
        start: 1,
        count: 2,
        step: 1,
        expanded: true,
        showGenerated: true
      },
      {
        id: "division",
        name: "線上分点",
        type: "lineDivisionPoint",
        visible: true,
        enabled: true,
        parentGroupId: "loop",
        endpoint: { lineId: "ab", endpointKey: "start" },
        placementMode: "ratio",
        distance: 30,
        ratio: makeNumericExpression("@i / 11")
      },
      {
        id: "offset",
        name: "線上オフセット点",
        type: "lineTangentOffsetPoint",
        visible: true,
        enabled: true,
        parentGroupId: "loop",
        baseLineId: "ab",
        basePoint: { mode: "reference", pointId: "division" },
        tangentAngleDeg: 90,
        distance: 20
      },
      {
        id: "guide",
        name: "補助線",
        type: "line",
        visible: true,
        enabled: true,
        parentGroupId: "loop",
        startPoint: { mode: "reference", pointId: "division" },
        endPoint: { mode: "reference", pointId: "offset" }
      },
      {
        id: "intersection",
        name: "交点",
        type: "intersectionPoint",
        visible: true,
        enabled: true,
        parentGroupId: "loop",
        line1Id: "guide",
        line2Id: "cd",
        intersectionIndex: 0,
        useExtensions: true
      },
      {
        id: "trim",
        name: "延長短縮",
        type: "extendTrim",
        visible: true,
        enabled: true,
        parentGroupId: "loop",
        endpoint: { lineId: "guide", endpointKey: "end" },
        point: { mode: "reference", pointId: "intersection" }
      }
    ]);

    expect(result.errors).toHaveLength(0);
    const firstGuide = result.computedGeometry.get("guide@loop:0");
    const secondGuide = result.computedGeometry.get("guide@loop:1");
    expect(firstGuide).toMatchObject({ kind: "line", length: 30 });
    expect(secondGuide).toMatchObject({ kind: "line", length: 30 });
    if (firstGuide?.kind !== "line" || secondGuide?.kind !== "line") {
      throw new Error("Expected generated guide lines");
    }
    expect(firstGuide.start.x).toBeCloseTo(10);
    expect(firstGuide.start.y).toBeCloseTo(0);
    expect(firstGuide.end.x).toBeCloseTo(10);
    expect(firstGuide.end.y).toBeCloseTo(30);
    expect(secondGuide.start.x).toBeCloseTo(20);
    expect(secondGuide.start.y).toBeCloseTo(0);
    expect(secondGuide.end.x).toBeCloseTo(20);
    expect(secondGuide.end.y).toBeCloseTo(30);
  });

  it("reports invalid for group counts", () => {
    const result = evaluateElements([
      {
        id: "loop",
        name: "不正な繰り返し",
        type: "forGroup",
        visible: true,
        enabled: true,
        variableName: "i",
        start: 0,
        count: 1.5,
        step: 1,
        expanded: true,
        showGenerated: false
      }
    ]);

    expect(result.errors[0]).toMatchObject({
      elementId: "loop",
      message: "不正な繰り返し の回数は0以上の整数にしてください。"
    });
  });

  it("reports references to geometry in an inactive conditional branch", () => {
    const result = evaluateElements([
      {
        id: "if",
        name: "寸法分岐",
        type: "conditionalGroup",
        visible: true,
        enabled: true,
        condition: 0,
        expanded: true,
        elseExpanded: true
      },
      { ...validElements[0], id: "then-point", name: "then点", parentGroupId: "if", conditionalBranch: "then" },
      {
        id: "line",
        name: "参照線",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "then-point" },
        endPoint: { mode: "coordinate", x: 10, y: 10 }
      }
    ]);

    expect(result.computedGeometry.has("then-point")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "line",
      missingDependencyId: "then-point",
      missingDependencyName: "then点"
    });
    expect(result.errors[0].message).toContain("寸法分岐");
    expect(result.errors[0].message).toContain("評価OFF");
  });

  it("marks a conditional group invalid when its condition cannot be evaluated", () => {
    const result = evaluateElements([
      {
        id: "if",
        name: "寸法分岐",
        type: "conditionalGroup",
        visible: true,
        enabled: true,
        condition: makeNumericExpression("missing.length"),
        expanded: true,
        elseExpanded: true
      },
      { ...validElements[0], id: "then-point", name: "then点", parentGroupId: "if", conditionalBranch: "then" }
    ]);

    expect(result.computedGeometry.has("then-point")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "if",
      missingDependencyId: "missing"
    });
    expect(result.conditionInactiveElementIds).toEqual(new Set(["then-point"]));
  });

  it("evaluates line anchors from direct coordinate expressions", () => {
    const result = evaluateElements([
      validElements[0],
      {
        id: "direct-line",
        name: "直接線",
        type: "line",
        visible: true,
        enabled: true,
        numericVariables: [{ id: "base", name: "基準", value: 10 }],
        startPoint: {
          mode: "coordinate",
          x: { kind: "expression", expression: "@base" },
          y: 20
        },
        endPoint: {
          mode: "coordinate",
          x: { kind: "expression", expression: "@base + 30" },
          y: { kind: "expression", expression: "@base + 30" }
        }
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("direct-line")).toMatchObject({
      kind: "line",
      startPointId: null,
      endPointId: null,
      start: { x: 10, y: 20 },
      end: { x: 40, y: 40 }
    });
  });

  it("evaluates global variable elements and resolves them from later numeric expressions", () => {
    const result = evaluateElements([
      {
        id: "ease",
        name: "ゆとり",
        type: "variable",
        visible: true,
        enabled: true,
        scope: "global",
        valueMode: "expression",
        expression: 12,
        point1: { mode: "reference", pointId: "a" },
        point2: { mode: "reference", pointId: "a" },
        point: { mode: "reference", pointId: "a" },
        lineId: ""
      },
      {
        id: "a",
        name: "点A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: { kind: "expression", expression: "@ゆとり + 8" },
        y: 0
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedVariables.get("ease")).toMatchObject({ value: 12 });
    expect(result.computedGeometry.get("a")).toMatchObject({ kind: "point", x: 20 });
  });

  it("evaluates variable element expressions from local numeric variables", () => {
    const result = evaluateElements([
      {
        id: "size",
        name: "寸法",
        type: "variable",
        visible: true,
        enabled: true,
        numericVariables: [
          { id: "base", name: "基準", value: 30 },
          { id: "ease", name: "ゆとり", value: { kind: "expression", expression: "@base + 5" } }
        ],
        scope: "global",
        valueMode: "expression",
        expression: { kind: "expression", expression: "@ゆとり * 2" },
        point1: { mode: "reference", pointId: "a" },
        point2: { mode: "reference", pointId: "a" },
        point: { mode: "reference", pointId: "a" },
        lineId: ""
      },
      {
        id: "a",
        name: "点A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: { kind: "expression", expression: "@寸法" },
        y: 0
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedVariables.get("size")).toMatchObject({ value: 70 });
    expect(result.computedGeometry.get("a")).toMatchObject({ kind: "point", x: 70 });
  });

  it("evaluates sqrt and pi numeric expressions", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "点A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: { kind: "expression", expression: "sqrt(2) * pi" },
        y: { kind: "expression", expression: "sqrt(pi * 4)" }
      }
    ]);

    expect(result.errors).toHaveLength(0);
    const point = result.computedGeometry.get("a");
    expect(point).toMatchObject({ kind: "point" });
    if (point?.kind !== "point") throw new Error("expected point geometry");
    expect(point.x).toBeCloseTo(Math.sqrt(2) * Math.PI);
    expect(point.y).toBeCloseTo(Math.sqrt(Math.PI * 4));
  });

  it("reports negative sqrt numeric expressions", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "点A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: { kind: "expression", expression: "sqrt(-1)" },
        y: 0
      }
    ]);

    expect(result.computedGeometry.has("a")).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("sqrt");
  });

  it("uses the nearest previous variable with the same name", () => {
    const variable = (id: string, expression: number): CadElement => ({
      id,
      name: "寸法",
      type: "variable",
      visible: true,
      enabled: true,
      scope: "global",
      valueMode: "expression",
      expression,
      point1: { mode: "reference", pointId: "a" },
      point2: { mode: "reference", pointId: "a" },
      point: { mode: "reference", pointId: "a" },
      lineId: ""
    });
    const result = evaluateElements([
      variable("size-1", 10),
      variable("size-2", 30),
      {
        id: "a",
        name: "点A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: { kind: "expression", expression: "@寸法" },
        y: 0
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("a")).toMatchObject({ kind: "point", x: 30 });
  });

  it("keeps root local variables out of child groups", () => {
    const result = evaluateElements([
      {
        id: "local",
        name: "局所",
        type: "variable",
        visible: true,
        enabled: true,
        scope: "group",
        valueMode: "expression",
        expression: 10,
        point1: { mode: "reference", pointId: "a" },
        point2: { mode: "reference", pointId: "a" },
        point: { mode: "reference", pointId: "a" },
        lineId: ""
      },
      {
        id: "group",
        name: "身頃",
        type: "group",
        visible: true,
        enabled: true,
        expanded: true
      },
      {
        id: "a",
        name: "点A",
        type: "freePoint",
        parentGroupId: "group",
        visible: true,
        enabled: true,
        x: { kind: "expression", expression: "@局所" },
        y: 0
      }
    ]);

    expect(result.computedGeometry.has("a")).toBe(false);
    expect(result.errors[0].message).toContain("参照可能な変数");
  });

  it("makes group local variables visible to descendant groups", () => {
    const result = evaluateElements([
      {
        id: "group",
        name: "身頃",
        type: "group",
        visible: true,
        enabled: true,
        expanded: true
      },
      {
        id: "local",
        name: "局所",
        type: "variable",
        parentGroupId: "group",
        visible: true,
        enabled: true,
        scope: "group",
        valueMode: "expression",
        expression: 10,
        point1: { mode: "reference", pointId: "a" },
        point2: { mode: "reference", pointId: "a" },
        point: { mode: "reference", pointId: "a" },
        lineId: ""
      },
      {
        id: "child",
        name: "袖ぐり",
        type: "group",
        parentGroupId: "group",
        visible: true,
        enabled: true,
        expanded: true
      },
      {
        id: "a",
        name: "点A",
        type: "freePoint",
        parentGroupId: "child",
        visible: true,
        enabled: true,
        x: { kind: "expression", expression: "@局所 + 2" },
        y: 0
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("a")).toMatchObject({ kind: "point", x: 12 });
  });

  it("evaluates point distance, point angle, and point-line distance variables", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "点A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "点B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: -10
      },
      {
        id: "line",
        name: "直線",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "coordinate", x: 0, y: 0 },
        endPoint: { mode: "coordinate", x: 10, y: 0 }
      },
      {
        id: "distance",
        name: "距離",
        type: "variable",
        visible: true,
        enabled: true,
        scope: "global",
        valueMode: "pointDistance",
        expression: 0,
        point1: { mode: "reference", pointId: "a" },
        point2: { mode: "reference", pointId: "b" },
        point: { mode: "reference", pointId: "a" },
        lineId: "line"
      },
      {
        id: "angle",
        name: "角度",
        type: "variable",
        visible: true,
        enabled: true,
        scope: "global",
        valueMode: "pointAngle",
        expression: 0,
        point1: { mode: "reference", pointId: "a" },
        point2: { mode: "reference", pointId: "b" },
        point: { mode: "reference", pointId: "a" },
        lineId: "line"
      },
      {
        id: "line-distance",
        name: "点線距離",
        type: "variable",
        visible: true,
        enabled: true,
        scope: "global",
        valueMode: "pointLineDistance",
        expression: 0,
        point1: { mode: "reference", pointId: "a" },
        point2: { mode: "reference", pointId: "b" },
        point: { mode: "reference", pointId: "b" },
        lineId: "line"
      },
      {
        id: "reverse-angle",
        name: "逆角度",
        type: "variable",
        visible: true,
        enabled: true,
        scope: "global",
        valueMode: "pointAngle",
        expression: 0,
        point1: { mode: "reference", pointId: "b" },
        point2: { mode: "reference", pointId: "a" },
        point: { mode: "reference", pointId: "a" },
        lineId: "line"
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedVariables.get("distance")?.value).toBeCloseTo(10);
    expect(result.computedVariables.get("angle")?.value).toBeCloseTo(270);
    expect(result.computedVariables.get("reverse-angle")?.value).toBeCloseTo(90);
    expect(result.computedVariables.get("line-distance")?.value).toBeCloseTo(10);
  });

  it("evaluates point distance, point angle, and point-line distance inside expressions", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "点A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "点B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: -10
      },
      {
        id: "line",
        name: "直線",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "coordinate", x: 0, y: 0 },
        endPoint: { mode: "coordinate", x: 10, y: 0 }
      },
      {
        id: "measurement",
        name: "測定",
        type: "variable",
        visible: true,
        enabled: true,
        scope: "global",
        valueMode: "expression",
        expression: {
          kind: "expression",
          expression: "distance(a, b) + angle(a, b) + lineDistance(b, line)"
        },
        point1: { mode: "reference", pointId: "a" },
        point2: { mode: "reference", pointId: "b" },
        point: { mode: "reference", pointId: "a" },
        lineId: "line"
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedVariables.get("measurement")?.value).toBeCloseTo(290);
  });

  it("evaluates point distance expressions with line endpoint arguments", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "点A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "点B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 10,
        y: 0
      },
      {
        id: "line",
        name: "線AB",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "measurement",
        name: "測定",
        type: "variable",
        visible: true,
        enabled: true,
        scope: "global",
        valueMode: "expression",
        expression: { kind: "expression", expression: "distance(line:start, line:end)" },
        point1: { mode: "reference", pointId: "a" },
        point2: { mode: "reference", pointId: "b" },
        point: { mode: "reference", pointId: "a" },
        lineId: "line"
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedVariables.get("measurement")?.value).toBeCloseTo(10);
  });

  it("reports dependency errors for measurement function references that appear too late", () => {
    const result = evaluateElements([
      {
        id: "measurement",
        name: "測定",
        type: "variable",
        visible: true,
        enabled: true,
        scope: "global",
        valueMode: "expression",
        expression: { kind: "expression", expression: "distance(a, b)" },
        point1: { mode: "reference", pointId: "a" },
        point2: { mode: "reference", pointId: "b" },
        point: { mode: "reference", pointId: "a" },
        lineId: ""
      },
      {
        id: "a",
        name: "点A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "点B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 10,
        y: 0
      }
    ]);

    expect(result.computedVariables.has("measurement")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "measurement",
      missingDependencyId: "a",
      missingDependencyName: "点A"
    });
  });

  it("reports a direct coordinate expression dependency that appears too late", () => {
    const result = evaluateElements([
      validElements[0],
      {
        id: "direct-line",
        name: "直接線",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "coordinate", x: 0, y: 0 },
        endPoint: { mode: "coordinate", x: { kind: "expression", expression: "ab.length" }, y: 0 }
      },
      validElements[1],
      validElements[2]
    ]);

    expect(result.computedGeometry.has("direct-line")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "direct-line",
      missingDependencyId: "ab",
      missingDependencyName: "直線AB"
    });
  });

  it("evaluates numeric reference paths for computed geometry, parameters, and variables", () => {
    const result = evaluateElements([
      validElements[0],
      validElements[1],
      validElements[2],
      {
        id: "ratio-variable",
        name: "割合変数",
        type: "variable",
        visible: true,
        enabled: true,
        scope: "global",
        valueMode: "expression",
        expression: 0.25,
        point1: { mode: "reference", pointId: "a" },
        point2: { mode: "reference", pointId: "b" },
        point: { mode: "reference", pointId: "a" },
        lineId: ""
      },
      {
        id: "division",
        name: "分点",
        type: "divisionPoint",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" },
        placementMode: "ratio",
        distance: 0,
        ratio: { kind: "expression", expression: "ratio-variable.value" }
      },
      {
        id: "derived",
        name: "参照確認",
        type: "offsetPoint",
        visible: true,
        enabled: true,
        fromPoint: { mode: "reference", pointId: "division" },
        dx: {
          kind: "expression",
          expression: "division.params.ratio * ab.length + ab.startPoint.x"
        },
        dy: {
          kind: "expression",
          expression: "division.params.startPoint.y + ab.endPoint.y"
        }
      }
    ]);

    expect(result.errors).toHaveLength(0);
    const division = result.computedGeometry.get("division");
    const derived = result.computedGeometry.get("derived");
    expect(division).toMatchObject({ kind: "point", x: 17.5, y: 21.25 });
    expect(derived).toMatchObject({ kind: "point", y: 66.25 });
    expect(derived?.kind === "point" ? derived.x : 0).toBeCloseTo(35.103453162872775);
  });

  it("evaluates polar offset points using mathematical angles", () => {
    const result = evaluateElements([
      validElements[0],
      {
        id: "right",
        name: "右",
        type: "polarOffsetPoint",
        visible: true,
        enabled: true,
        fromPointId: "a",
        angleDeg: 0,
        distance: 10
      },
      {
        id: "up",
        name: "上",
        type: "polarOffsetPoint",
        visible: true,
        enabled: true,
        fromPointId: "a",
        angleDeg: 90,
        distance: 10
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("right")).toMatchObject({ kind: "point", x: 20, y: 20 });
    expect(result.computedGeometry.get("up")).toMatchObject({ kind: "point", x: 10, y: 30 });
  });

  it("evaluates angle length lines using mathematical angles", () => {
    const result = evaluateElements([
      validElements[0],
      {
        id: "right-line",
        name: "右線",
        type: "angleLengthLine",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        angleDeg: 0,
        length: 10
      },
      {
        id: "up-line",
        name: "上線",
        type: "angleLengthLine",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        angleDeg: 90,
        length: 10
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("right-line")).toMatchObject({
      kind: "line",
      start: { x: 10, y: 20 },
      end: { x: 20, y: 20 },
      length: 10,
      startAngleDeg: 0,
      endAngleDeg: 180
    });
    expect(result.computedGeometry.get("up-line")).toMatchObject({
      kind: "line",
      start: { x: 10, y: 20 },
      end: { x: 10, y: 30 },
      length: 10,
      startAngleDeg: 90,
      endAngleDeg: 270
    });
  });

  it("evaluates division points by distance from the start point toward the end point", () => {
    const result = evaluateElements([
      validElements[0],
      validElements[1],
      {
        id: "division",
        name: "分点",
        type: "divisionPoint",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" },
        placementMode: "distance",
        distance: 15,
        ratio: 0.5
      }
    ]);

    const point = result.computedGeometry.get("division");
    expect(result.errors).toHaveLength(0);
    expect(point).toMatchObject({ kind: "point" });
    if (point?.kind !== "point") throw new Error("Expected a point");
    expect(point.x).toBeCloseTo(10 + (30 / Math.hypot(30, 5)) * 15);
    expect(point.y).toBeCloseTo(20 + (5 / Math.hypot(30, 5)) * 15);
  });

  it("evaluates division points by ratio and allows the midpoint", () => {
    const result = evaluateElements([
      validElements[0],
      validElements[1],
      {
        id: "division",
        name: "中点",
        type: "divisionPoint",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" },
        placementMode: "ratio",
        distance: 30,
        ratio: 0.5
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("division")).toMatchObject({
      kind: "point",
      x: 25,
      y: 22.5
    });
  });

  it("reports a division point dependency that appears too late", () => {
    const result = evaluateElements([
      validElements[0],
      {
        id: "division",
        name: "分点",
        type: "divisionPoint",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" },
        placementMode: "ratio",
        distance: 30,
        ratio: 0.5
      },
      validElements[1]
    ]);

    expect(result.computedGeometry.has("division")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "division",
      missingDependencyId: "b",
      missingDependencyName: "点B"
    });
  });

  it("splits a line at an existing point on the finite segment", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "点A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "点B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 100,
        y: 0
      },
      {
        id: "line",
        name: "基準線",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "p",
        name: "分割点",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 40,
        y: 0
      },
      {
        id: "split",
        name: "先の線",
        type: "splitLine",
        visible: true,
        enabled: true,
        baseLineId: "line",
        splitPoint: { mode: "reference", pointId: "p" }
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("line")).toMatchObject({
      kind: "line",
      name: "基準線",
      start: { x: 0, y: 0 },
      end: { x: 40, y: 0 },
      length: 40
    });
    expect(result.computedGeometry.get("split")).toMatchObject({
      kind: "line",
      name: "先の線",
      start: { x: 40, y: 0 },
      end: { x: 100, y: 0 },
      length: 60
    });
  });

  it("rejects a split point on the extension outside the line segment", () => {
    const result = evaluateElements([
      validElements[0],
      validElements[1],
      validElements[2],
      {
        id: "outside",
        name: "外側点",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 160,
        y: 45
      },
      {
        id: "split",
        name: "分割線",
        type: "splitLine",
        visible: true,
        enabled: true,
        baseLineId: "ab",
        splitPoint: { mode: "reference", pointId: "outside" }
      }
    ]);

    expect(result.computedGeometry.has("split")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "split",
      missingDependencyId: "split"
    });
    expect(result.errors[0].message).toContain("基準線上");
  });

  it("rejects a split point at a line endpoint", () => {
    const result = evaluateElements([
      validElements[0],
      validElements[1],
      validElements[2],
      {
        id: "split",
        name: "分割線",
        type: "splitLine",
        visible: true,
        enabled: true,
        baseLineId: "ab",
        splitPoint: { mode: "reference", pointId: "a" }
      }
    ]);

    expect(result.computedGeometry.has("split")).toBe(false);
    expect(result.errors[0].message).toContain("端点");
  });

  it("splits an arc line and keeps the original name on the near side", () => {
    const result = evaluateElements([
      {
        id: "center",
        name: "中心",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "arc",
        name: "円弧",
        type: "arcLine",
        visible: true,
        enabled: true,
        centerPoint: { mode: "reference", pointId: "center" },
        radius: 10,
        startAngleDeg: 0,
        endAngleDeg: 90
      },
      {
        id: "mid",
        name: "中点",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: Math.SQRT1_2 * 10,
        y: Math.SQRT1_2 * 10
      },
      {
        id: "split",
        name: "先円弧",
        type: "splitLine",
        visible: true,
        enabled: true,
        baseLineId: "arc",
        splitPoint: { mode: "reference", pointId: "mid" }
      }
    ]);

    const near = result.computedGeometry.get("arc");
    const far = result.computedGeometry.get("split");
    expect(result.errors).toHaveLength(0);
    expect(near).toMatchObject({ kind: "arcLine", name: "円弧", startAngleDeg: 0, sweepAngleDeg: 45 });
    expect(far).toMatchObject({ kind: "arcLine", name: "先円弧", startAngleDeg: 45, sweepAngleDeg: 45 });
  });

  it("splits a bezier curve into two computed curves", () => {
    const result = evaluateElements([
      {
        id: "start",
        name: "始点",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "end",
        name: "終点",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 100,
        y: 0
      },
      {
        id: "curve",
        name: "曲線",
        type: "bezierCurve",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "start" },
        startHandleAngleDeg: 0,
        startHandleLength: 30,
        intermediatePoints: [],
        endPoint: { mode: "reference", pointId: "end" },
        endHandleAngleDeg: 180,
        endHandleLength: 30
      },
      {
        id: "mid",
        name: "中点",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 50,
        y: 0
      },
      {
        id: "split",
        name: "先曲線",
        type: "splitLine",
        visible: true,
        enabled: true,
        baseLineId: "curve",
        splitPoint: { mode: "reference", pointId: "mid" }
      }
    ]);

    const near = result.computedGeometry.get("curve");
    const far = result.computedGeometry.get("split");
    expect(result.errors).toHaveLength(0);
    expect(near).toMatchObject({ kind: "bezierCurve", name: "曲線" });
    expect(far).toMatchObject({ kind: "bezierCurve", name: "先曲線" });
    if (near?.kind !== "bezierCurve" || far?.kind !== "bezierCurve") {
      throw new Error("Expected split bezier curves");
    }
    expect(near.segments.at(-1)?.end.x).toBeCloseTo(50, 2);
    expect(near.segments.at(-1)?.end.y).toBeCloseTo(0, 2);
    expect(far.segments[0].start.x).toBeCloseTo(50, 2);
    expect(far.segments[0].start.y).toBeCloseTo(0, 2);
  });

  it("extends and trims two line endpoints to an edge intersection", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 100,
        y: 0
      },
      {
        id: "c",
        name: "C",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 150,
        y: 80
      },
      {
        id: "d",
        name: "D",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 150,
        y: 160
      },
      {
        id: "ab",
        name: "AB",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "cd",
        name: "CD",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "c" },
        endPoint: { mode: "reference", pointId: "d" }
      },
      {
        id: "edge",
        name: "エッジ",
        type: "edge",
        visible: true,
        enabled: true,
        endpoint1: { lineId: "ab", endpointKey: "end" },
        endpoint2: { lineId: "cd", endpointKey: "start" },
        intersectionIndex: 0
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("ab")).toMatchObject({
      kind: "line",
      start: { x: 0, y: 0 },
      end: { x: 150, y: 0 }
    });
    expect(result.computedGeometry.get("cd")).toMatchObject({
      kind: "line",
      start: { x: 150, y: 0 },
      end: { x: 150, y: 160 }
    });
    expect(result.computedGeometry.has("edge")).toBe(false);
  });

  it("reports an edge error for parallel lines", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 100,
        y: 0
      },
      {
        id: "c",
        name: "C",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 20
      },
      {
        id: "d",
        name: "D",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 100,
        y: 20
      },
      {
        id: "ab",
        name: "AB",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "cd",
        name: "CD",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "c" },
        endPoint: { mode: "reference", pointId: "d" }
      },
      {
        id: "edge",
        name: "エッジ",
        type: "edge",
        visible: true,
        enabled: true,
        endpoint1: { lineId: "ab", endpointKey: "end" },
        endpoint2: { lineId: "cd", endpointKey: "start" },
        intersectionIndex: 0
      }
    ]);

    expect(result.errors[0]).toMatchObject({
      elementId: "edge",
      missingDependencyId: "edge"
    });
    expect(result.errors[0].message).toContain("交点");
  });

  it("extends or trims a line endpoint to a point on the line extension", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 100,
        y: 0
      },
      {
        id: "target",
        name: "目標",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 140,
        y: 0
      },
      {
        id: "line",
        name: "線",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "extend",
        name: "延長短縮",
        type: "extendTrim",
        visible: true,
        enabled: true,
        endpoint: { lineId: "line", endpointKey: "end" },
        point: { mode: "reference", pointId: "target" }
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("line")).toMatchObject({
      kind: "line",
      end: { x: 140, y: 0 },
      length: 140
    });
    expect(result.computedGeometry.has("extend")).toBe(false);
  });

  it("rejects extend trim when the point is not on the line or extension", () => {
    const result = evaluateElements([
      validElements[0],
      validElements[1],
      validElements[2],
      {
        id: "target",
        name: "外点",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 140,
        y: 20
      },
      {
        id: "extend",
        name: "延長短縮",
        type: "extendTrim",
        visible: true,
        enabled: true,
        endpoint: { lineId: "ab", endpointKey: "end" },
        point: { mode: "reference", pointId: "target" }
      }
    ]);

    expect(result.errors[0]).toMatchObject({
      elementId: "extend",
      missingDependencyId: "extend"
    });
    expect(result.errors[0].message).toContain("直線上または延長線上");
  });

  it("moves an arc endpoint to a point on the same circle", () => {
    const result = evaluateElements([
      {
        id: "center",
        name: "中心",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "target",
        name: "目標",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: -10,
        y: 0
      },
      {
        id: "arc",
        name: "円弧",
        type: "arcLine",
        visible: true,
        enabled: true,
        centerPoint: { mode: "reference", pointId: "center" },
        radius: 10,
        startAngleDeg: 0,
        endAngleDeg: 90
      },
      {
        id: "extend",
        name: "延長短縮",
        type: "extendTrim",
        visible: true,
        enabled: true,
        endpoint: { lineId: "arc", endpointKey: "end" },
        point: { mode: "reference", pointId: "target" }
      }
    ]);

    expect(result.errors).toHaveLength(0);
    const arc = result.computedGeometry.get("arc");
    expect(arc).toMatchObject({
      kind: "arcLine",
      endAngleDeg: 180,
      sweepAngleDeg: 180
    });
    if (arc?.kind !== "arcLine") throw new Error("Expected an arc line");
    expect(arc.end.x).toBeCloseTo(-10);
    expect(arc.end.y).toBeCloseTo(0);
  });

  it("moves a Bezier endpoint only along the endpoint tangent line", () => {
    const result = evaluateElements([
      {
        id: "start",
        name: "始点",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "end",
        name: "終点",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 100,
        y: 0
      },
      {
        id: "target",
        name: "目標",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: -20,
        y: 0
      },
      {
        id: "curve",
        name: "曲線",
        type: "bezierCurve",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "start" },
        startHandleAngleDeg: 0,
        startHandleLength: 30,
        intermediatePoints: [],
        endPoint: { mode: "reference", pointId: "end" },
        endHandleAngleDeg: 180,
        endHandleLength: 30
      },
      {
        id: "extend",
        name: "延長短縮",
        type: "extendTrim",
        visible: true,
        enabled: true,
        endpoint: { lineId: "curve", endpointKey: "start" },
        point: { mode: "reference", pointId: "target" }
      }
    ]);

    const curve = result.computedGeometry.get("curve");
    expect(result.errors).toHaveLength(0);
    expect(curve).toMatchObject({ kind: "bezierCurve" });
    if (curve?.kind !== "bezierCurve") throw new Error("Expected a Bezier curve");
    expect(curve.segments[0].start).toMatchObject({ x: -20, y: 0 });
    expect(curve.segments[0].control1).toMatchObject({ x: 10, y: 0 });
  });

  it("moves an open offset line endpoint along the endpoint tangent", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 100,
        y: 0
      },
      {
        id: "target",
        name: "目標",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 140,
        y: -10
      },
      {
        id: "line",
        name: "線",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "offset",
        name: "オフセット",
        type: "offsetLine",
        visible: true,
        enabled: true,
        baseLineIds: ["line"],
        offset: 10,
        side: "right",
        closed: false
      },
      {
        id: "extend",
        name: "延長短縮",
        type: "extendTrim",
        visible: true,
        enabled: true,
        endpoint: { lineId: "offset", endpointKey: "end" },
        point: { mode: "reference", pointId: "target" }
      }
    ]);

    const offset = result.computedGeometry.get("offset");
    expect(result.errors).toHaveLength(0);
    expect(offset).toMatchObject({ kind: "offsetLine" });
    if (offset?.kind !== "offsetLine") throw new Error("Expected an offset line");
    expect(offset.segments.at(-1)?.end).toMatchObject({ x: 140, y: -10 });
  });

  it("reports a division point distance error when the endpoints overlap", () => {
    const result = evaluateElements([
      validElements[0],
      {
        id: "same",
        name: "同一点",
        type: "divisionPoint",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "a" },
        placementMode: "distance",
        distance: 10,
        ratio: 0.5
      }
    ]);

    expect(result.computedGeometry.has("same")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "same",
      missingDependencyId: "same",
      message: expect.stringContaining("距離方向を決められません")
    });
  });

  it("evaluates line division points along a line from the selected endpoint", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 100,
        y: 0
      },
      {
        id: "line",
        name: "線",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "division",
        name: "線上分点",
        type: "lineDivisionPoint",
        visible: true,
        enabled: true,
        endpoint: { lineId: "line", endpointKey: "start" },
        placementMode: "distance",
        distance: 25,
        ratio: 0.5
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("division")).toMatchObject({
      kind: "point",
      x: 25,
      y: 0
    });
  });

  it("extends line division points past the opposite endpoint along the endpoint tangent", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 100,
        y: 0
      },
      {
        id: "line",
        name: "線",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "division",
        name: "線上分点",
        type: "lineDivisionPoint",
        visible: true,
        enabled: true,
        endpoint: { lineId: "line", endpointKey: "end" },
        placementMode: "ratio",
        distance: 25,
        ratio: 1.2
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("division")).toMatchObject({
      kind: "point",
      x: -20,
      y: 0
    });
  });

  it("evaluates line division points along arc, Bezier, and offset lines", () => {
    const result = evaluateElements([
      {
        id: "center",
        name: "中心",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "a",
        name: "A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 100,
        y: 0
      },
      {
        id: "arc",
        name: "円弧",
        type: "arcLine",
        visible: true,
        enabled: true,
        centerPoint: { mode: "reference", pointId: "center" },
        radius: 10,
        startAngleDeg: 0,
        endAngleDeg: 90
      },
      {
        id: "curve",
        name: "曲線",
        type: "bezierCurve",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        startHandleAngleDeg: 0,
        startHandleLength: 0,
        intermediatePoints: [],
        endPoint: { mode: "reference", pointId: "b" },
        endHandleAngleDeg: 180,
        endHandleLength: 0
      },
      {
        id: "line",
        name: "線",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "offset",
        name: "オフセット",
        type: "offsetLine",
        visible: true,
        enabled: true,
        baseLineIds: ["line"],
        offset: 10,
        side: "right",
        closed: false
      },
      {
        id: "arc-division",
        name: "円弧分点",
        type: "lineDivisionPoint",
        visible: true,
        enabled: true,
        endpoint: { lineId: "arc", endpointKey: "start" },
        placementMode: "ratio",
        distance: 0,
        ratio: 0.5
      },
      {
        id: "curve-division",
        name: "曲線分点",
        type: "lineDivisionPoint",
        visible: true,
        enabled: true,
        endpoint: { lineId: "curve", endpointKey: "start" },
        placementMode: "ratio",
        distance: 0,
        ratio: 0.5
      },
      {
        id: "offset-division",
        name: "オフセット分点",
        type: "lineDivisionPoint",
        visible: true,
        enabled: true,
        endpoint: { lineId: "offset", endpointKey: "start" },
        placementMode: "ratio",
        distance: 0,
        ratio: 0.5
      }
    ]);

    const arcPoint = result.computedGeometry.get("arc-division");
    expect(result.errors).toHaveLength(0);
    expect(arcPoint).toMatchObject({ kind: "point" });
    if (arcPoint?.kind !== "point") throw new Error("Expected a point");
    expect(arcPoint.x).toBeCloseTo(10 / Math.sqrt(2), 1);
    expect(arcPoint.y).toBeCloseTo(10 / Math.sqrt(2), 1);
    expect(result.computedGeometry.get("curve-division")).toMatchObject({
      kind: "point",
      x: 50,
      y: 0
    });
    expect(result.computedGeometry.get("offset-division")).toMatchObject({
      kind: "point",
      x: 50,
      y: -10
    });
  });

  it("reports a line division point dependency that appears too late", () => {
    const result = evaluateElements([
      {
        id: "division",
        name: "線上分点",
        type: "lineDivisionPoint",
        visible: true,
        enabled: true,
        endpoint: { lineId: "ab", endpointKey: "start" },
        placementMode: "ratio",
        distance: 0,
        ratio: 0.5
      },
      ...validElements
    ]);

    expect(result.computedGeometry.has("division")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "division",
      missingDependencyId: "ab",
      missingDependencyName: "直線AB"
    });
  });

  it("copies connected lines by translating from start to end", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 80,
        y: 0
      },
      {
        id: "c",
        name: "C",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 80,
        y: 30
      },
      {
        id: "d",
        name: "D",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 40,
        y: 100
      },
      {
        id: "ab",
        name: "AB",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "bc",
        name: "BC",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "b" },
        endPoint: { mode: "reference", pointId: "c" }
      },
      {
        id: "copy",
        name: "コピー線",
        type: "copyLine",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "d" },
        scale: 1,
        angleDeg: 0,
        mirrorX: false,
        baseLineIds: ["ab", "bc"]
      }
    ]);

    const copy = result.computedGeometry.get("copy");
    expect(result.errors).toHaveLength(0);
    expect(copy).toMatchObject({ kind: "offsetLine", length: 110 });
    if (copy?.kind !== "offsetLine") throw new Error("Expected a copy line");
    expect(copy.segments[0]).toMatchObject({
      kind: "line",
      start: { x: 40, y: 100 },
      end: { x: 120, y: 100 }
    });
    expect(copy.segments[1]).toMatchObject({
      kind: "line",
      start: { x: 120, y: 100 },
      end: { x: 120, y: 130 }
    });
  });

  it("scales copied lines around the end point", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 20,
        y: 0
      },
      {
        id: "target",
        name: "移動先",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 10,
        y: 10
      },
      {
        id: "ab",
        name: "AB",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "copy",
        name: "コピー線",
        type: "copyLine",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "target" },
        scale: 0.5,
        angleDeg: 0,
        mirrorX: false,
        baseLineIds: ["ab"]
      }
    ]);

    const copy = result.computedGeometry.get("copy");
    expect(result.errors).toHaveLength(0);
    expect(copy).toMatchObject({ kind: "offsetLine", length: 10 });
    if (copy?.kind !== "offsetLine") throw new Error("Expected a copy line");
    expect(copy.segments[0]).toMatchObject({
      kind: "line",
      start: { x: 10, y: 10 },
      end: { x: 20, y: 10 }
    });
  });

  it("mirrors copied lines across the vertical axis through the end point", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 80,
        y: 0
      },
      {
        id: "c",
        name: "C",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 80,
        y: 30
      },
      {
        id: "d",
        name: "D",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 40,
        y: 100
      },
      {
        id: "ab",
        name: "AB",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "bc",
        name: "BC",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "b" },
        endPoint: { mode: "reference", pointId: "c" }
      },
      {
        id: "copy",
        name: "コピー線",
        type: "copyLine",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "d" },
        scale: 1,
        angleDeg: 0,
        mirrorX: true,
        baseLineIds: ["ab", "bc"]
      }
    ]);

    const copy = result.computedGeometry.get("copy");
    expect(result.errors).toHaveLength(0);
    expect(copy).toMatchObject({ kind: "offsetLine", length: 110 });
    if (copy?.kind !== "offsetLine") throw new Error("Expected a copy line");
    expect(copy.segments[0]).toMatchObject({
      kind: "line",
      start: { x: 40, y: 100 },
      end: { x: -40, y: 100 }
    });
    expect(copy.segments[1]).toMatchObject({
      kind: "line",
      start: { x: -40, y: 100 },
      end: { x: -40, y: 130 }
    });
  });

  it("rotates mirrored copy lines around the end point", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 80,
        y: 0
      },
      {
        id: "c",
        name: "C",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 80,
        y: 30
      },
      {
        id: "d",
        name: "D",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 40,
        y: 100
      },
      {
        id: "ab",
        name: "AB",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "bc",
        name: "BC",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "b" },
        endPoint: { mode: "reference", pointId: "c" }
      },
      {
        id: "copy",
        name: "コピー線",
        type: "copyLine",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "d" },
        scale: 1,
        angleDeg: 90,
        mirrorX: true,
        baseLineIds: ["ab", "bc"]
      }
    ]);

    const copy = result.computedGeometry.get("copy");
    expect(result.errors).toHaveLength(0);
    expect(copy).toMatchObject({ kind: "offsetLine", length: 110 });
    if (copy?.kind !== "offsetLine") throw new Error("Expected a copy line");
    expect(copy.segments[0].start.x).toBeCloseTo(40);
    expect(copy.segments[0].start.y).toBeCloseTo(100);
    expect(copy.segments[0].end.x).toBeCloseTo(40);
    expect(copy.segments[0].end.y).toBeCloseTo(20);
    expect(copy.segments[1].end.x).toBeCloseTo(10);
    expect(copy.segments[1].end.y).toBeCloseTo(20);
  });

  it("mirrors copied lines across an axis defined by two points", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 80,
        y: 0
      },
      {
        id: "c",
        name: "C",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 80,
        y: 30
      },
      {
        id: "axis-a",
        name: "軸A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 40,
        y: -50
      },
      {
        id: "axis-b",
        name: "軸B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 40,
        y: 50
      },
      {
        id: "ab",
        name: "AB",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "bc",
        name: "BC",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "b" },
        endPoint: { mode: "reference", pointId: "c" }
      },
      {
        id: "symmetric",
        name: "対称コピー線",
        type: "symmetricCopyLine",
        visible: true,
        enabled: true,
        axisPoint1: { mode: "reference", pointId: "axis-a" },
        axisPoint2: { mode: "reference", pointId: "axis-b" },
        baseLineIds: ["ab", "bc"]
      }
    ]);

    const line = result.computedGeometry.get("symmetric");
    expect(result.errors).toHaveLength(0);
    expect(line).toMatchObject({ kind: "offsetLine", length: 110 });
    if (line?.kind !== "offsetLine") throw new Error("Expected a symmetric copy line");
    expect(line.segments[0]).toMatchObject({
      kind: "line",
      start: { x: 80, y: 0 },
      end: { x: 0, y: 0 }
    });
    expect(line.segments[1]).toMatchObject({
      kind: "line",
      start: { x: 0, y: 0 },
      end: { x: 0, y: 30 }
    });
  });

  it("mirrors copied lines across a diagonal axis", () => {
    const result = evaluateElements([
      {
        id: "axis-a",
        name: "軸A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "axis-b",
        name: "軸B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 100,
        y: 100
      },
      {
        id: "p1",
        name: "P1",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 20
      },
      {
        id: "p2",
        name: "P2",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 30,
        y: 20
      },
      {
        id: "line",
        name: "線",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "p1" },
        endPoint: { mode: "reference", pointId: "p2" }
      },
      {
        id: "symmetric",
        name: "対称コピー線",
        type: "symmetricCopyLine",
        visible: true,
        enabled: true,
        axisPoint1: { mode: "reference", pointId: "axis-a" },
        axisPoint2: { mode: "reference", pointId: "axis-b" },
        baseLineIds: ["line"]
      }
    ]);

    const line = result.computedGeometry.get("symmetric");
    expect(result.errors).toHaveLength(0);
    if (line?.kind !== "offsetLine") throw new Error("Expected a symmetric copy line");
    expect(line.segments[0].start.x).toBeCloseTo(20);
    expect(line.segments[0].start.y).toBeCloseTo(0);
    expect(line.segments[0].end.x).toBeCloseTo(20);
    expect(line.segments[0].end.y).toBeCloseTo(30);
  });

  it("reports symmetric copy line dependencies that appear too late", () => {
    const result = evaluateElements([
      {
        id: "axis-a",
        name: "軸A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "axis-b",
        name: "軸B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 100
      },
      {
        id: "symmetric",
        name: "対称コピー線",
        type: "symmetricCopyLine",
        visible: true,
        enabled: true,
        axisPoint1: { mode: "reference", pointId: "axis-a" },
        axisPoint2: { mode: "reference", pointId: "axis-b" },
        baseLineIds: ["line"]
      },
      {
        id: "line",
        name: "線",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "axis-a" },
        endPoint: { mode: "reference", pointId: "axis-b" }
      }
    ]);

    expect(result.computedGeometry.has("symmetric")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "symmetric",
      missingDependencyId: "line",
      missingDependencyName: "線"
    });
  });

  it("reports a geometry error when symmetric copy axis points are the same", () => {
    const result = evaluateElements([
      validElements[0],
      validElements[1],
      validElements[2],
      {
        id: "symmetric",
        name: "対称コピー線",
        type: "symmetricCopyLine",
        visible: true,
        enabled: true,
        axisPoint1: { mode: "reference", pointId: "a" },
        axisPoint2: { mode: "reference", pointId: "a" },
        baseLineIds: ["ab"]
      }
    ]);

    expect(result.computedGeometry.has("symmetric")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "symmetric",
      missingDependencyId: "symmetric"
    });
    expect(result.errors[0].message).toContain("同じ点");
  });

  it("moves target lines without creating geometry for the move element", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 80,
        y: 0
      },
      {
        id: "d",
        name: "D",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 40,
        y: 100
      },
      {
        id: "ab",
        name: "AB",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "move",
        name: "移動",
        type: "move",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "d" },
        scale: 1,
        angleDeg: 0,
        mirrorX: false,
        baseLineIds: ["ab"]
      }
    ]);

    const line = result.computedGeometry.get("ab");
    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.has("move")).toBe(false);
    expect(line).toMatchObject({
      kind: "line",
      start: { x: 40, y: 100 },
      end: { x: 120, y: 100 },
      length: 80
    });
  });

  it("scales moved target lines around the end point", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 20,
        y: 0
      },
      {
        id: "target",
        name: "移動先",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 10,
        y: 10
      },
      {
        id: "ab",
        name: "AB",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "move",
        name: "移動",
        type: "move",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "target" },
        scale: 0.5,
        angleDeg: 0,
        mirrorX: false,
        baseLineIds: ["ab"]
      }
    ]);

    const line = result.computedGeometry.get("ab");
    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.has("move")).toBe(false);
    expect(line).toMatchObject({
      kind: "line",
      start: { x: 10, y: 10 },
      end: { x: 20, y: 10 },
      length: 10
    });
  });

  it("restores target lines when a move modification is disabled", () => {
    const result = evaluateElements([
      validElements[0],
      validElements[1],
      validElements[2],
      {
        id: "move",
        name: "移動",
        type: "move",
        visible: true,
        enabled: false,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "c" },
        scale: 1,
        angleDeg: 0,
        mirrorX: false,
        baseLineIds: ["ab"]
      }
    ]);

    const line = result.computedGeometry.get("ab");
    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.has("move")).toBe(false);
    expect(line).toMatchObject({
      kind: "line",
      start: { x: 10, y: 20 },
      end: { x: 40, y: 25 }
    });
  });

  it("symmetrically moves target lines across an axis", () => {
    const result = evaluateElements([
      {
        id: "axis-a",
        name: "軸A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 40,
        y: -50
      },
      {
        id: "axis-b",
        name: "軸B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 40,
        y: 50
      },
      {
        id: "p1",
        name: "P1",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "p2",
        name: "P2",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 80,
        y: 0
      },
      {
        id: "line",
        name: "線",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "p1" },
        endPoint: { mode: "reference", pointId: "p2" }
      },
      {
        id: "symmetric-move",
        name: "対称移動",
        type: "symmetricMove",
        visible: true,
        enabled: true,
        axisPoint1: { mode: "reference", pointId: "axis-a" },
        axisPoint2: { mode: "reference", pointId: "axis-b" },
        baseLineIds: ["line"]
      }
    ]);

    const line = result.computedGeometry.get("line");
    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.has("symmetric-move")).toBe(false);
    expect(line).toMatchObject({
      kind: "line",
      start: { x: 80, y: 0 },
      end: { x: 0, y: 0 }
    });
  });

  it("reports move dependencies that appear too late", () => {
    const result = evaluateElements([
      validElements[0],
      validElements[1],
      {
        id: "move",
        name: "移動",
        type: "move",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" },
        scale: 1,
        angleDeg: 0,
        mirrorX: false,
        baseLineIds: ["ab"]
      },
      validElements[2]
    ]);

    expect(result.computedGeometry.has("move")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "move",
      missingDependencyId: "ab",
      missingDependencyName: "直線AB"
    });
  });

  it("evaluates line tangent offset points relative to the tangent at the base point", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 100,
        y: 0
      },
      {
        id: "line",
        name: "線",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "offset",
        name: "線上オフセット点",
        type: "lineTangentOffsetPoint",
        visible: true,
        enabled: true,
        baseLineId: "line",
        basePoint: { mode: "reference", pointId: "a" },
        tangentAngleDeg: 90,
        distance: 10
      }
    ]);

    expect(result.errors).toHaveLength(0);
    const point = result.computedGeometry.get("offset");
    expect(point).toMatchObject({ kind: "point" });
    if (point?.kind !== "point") throw new Error("Expected a point");
    expect(point.x).toBeCloseTo(0);
    expect(point.y).toBeCloseTo(10);
  });

  it("evaluates line tangent offset points on diagonal lines using Y-up angles", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 10,
        y: 10
      },
      {
        id: "line",
        name: "線",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "offset",
        name: "線上オフセット点",
        type: "lineTangentOffsetPoint",
        visible: true,
        enabled: true,
        baseLineId: "line",
        basePoint: { mode: "reference", pointId: "a" },
        tangentAngleDeg: 0,
        distance: 10
      }
    ]);

    expect(result.errors).toHaveLength(0);
    const point = result.computedGeometry.get("offset");
    expect(point).toMatchObject({ kind: "point" });
    if (point?.kind !== "point") throw new Error("Expected a point");
    expect(point.x).toBeCloseTo(5 * Math.SQRT2);
    expect(point.y).toBeCloseTo(5 * Math.SQRT2);
  });

  it("evaluates line tangent offset points on a Bezier line-like geometry", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 100,
        y: 0
      },
      {
        id: "curve",
        name: "曲線",
        type: "bezierCurve",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        startHandleAngleDeg: 0,
        startHandleLength: 0,
        intermediatePoints: [],
        endPoint: { mode: "reference", pointId: "b" },
        endHandleAngleDeg: 180,
        endHandleLength: 0
      },
      {
        id: "offset",
        name: "線上オフセット点",
        type: "lineTangentOffsetPoint",
        visible: true,
        enabled: true,
        baseLineId: "curve",
        basePoint: { mode: "reference", pointId: "a" },
        tangentAngleDeg: 0,
        distance: 10
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("offset")).toMatchObject({
      kind: "point",
      x: 10,
      y: 0
    });
  });

  it("evaluates line tangent offset points from exact Bezier endpoint tangents", () => {
    const result = evaluateElements([
      {
        id: "start",
        name: "始点",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 62.1,
        y: 59.52
      },
      {
        id: "middle",
        name: "中間点",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 68.05,
        y: 27.18
      },
      {
        id: "end",
        name: "終点",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 89.92,
        y: 39.33
      },
      {
        id: "curve",
        name: "曲線",
        type: "bezierCurve",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "start" },
        startHandleAngleDeg: 254.72,
        startHandleLength: 18.52,
        intermediatePoints: [
          {
            id: "middle-handle",
            point: { mode: "reference", pointId: "middle" },
            handleAngleDeg: 336.35,
            incomingHandleLength: 8.2,
            outgoingHandleLength: 7.22
          }
        ],
        endPoint: { mode: "reference", pointId: "end" },
        endHandleAngleDeg: 75.86,
        endHandleLength: 13.85
      },
      {
        id: "offset",
        name: "線上オフセット点",
        type: "lineTangentOffsetPoint",
        visible: true,
        enabled: true,
        baseLineId: "curve",
        basePoint: { mode: "reference", pointId: "middle" },
        tangentAngleDeg: 270,
        distance: 10
      }
    ]);

    expect(result.errors).toHaveLength(0);
    const point = result.computedGeometry.get("offset");
    expect(point).toMatchObject({ kind: "point" });
    if (point?.kind !== "point") throw new Error("Expected a point");
    expect(point.x).toBeCloseTo(64.03851442647533);
    expect(point.y).toBeCloseTo(18.019869897572224);
  });

  it("reports a line tangent offset point dependency that appears too late", () => {
    const result = evaluateElements([
      {
        id: "offset",
        name: "線上オフセット点",
        type: "lineTangentOffsetPoint",
        visible: true,
        enabled: true,
        baseLineId: "ab",
        basePoint: { mode: "reference", pointId: "a" },
        tangentAngleDeg: 0,
        distance: 10
      },
      ...validElements
    ]);

    expect(result.computedGeometry.has("offset")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "offset",
      missingDependencyId: "ab",
      missingDependencyName: "直線AB"
    });
  });

  it("reports a line tangent offset point when the base point is not on the base line", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 100,
        y: 0
      },
      {
        id: "c",
        name: "C",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 50,
        y: 5
      },
      {
        id: "line",
        name: "線",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "offset",
        name: "線上オフセット点",
        type: "lineTangentOffsetPoint",
        visible: true,
        enabled: true,
        baseLineId: "line",
        basePoint: { mode: "reference", pointId: "c" },
        tangentAngleDeg: 0,
        distance: 10
      }
    ]);

    expect(result.computedGeometry.has("offset")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "offset",
      missingDependencyId: "offset",
      message: expect.stringContaining("基準点は基準線上にありません")
    });
  });

  it("evaluates an intersection point between two line segments", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 100,
        y: 100
      },
      {
        id: "c",
        name: "C",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 100
      },
      {
        id: "d",
        name: "D",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 100,
        y: 0
      },
      {
        id: "ab",
        name: "AB",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "cd",
        name: "CD",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "c" },
        endPoint: { mode: "reference", pointId: "d" }
      },
      {
        id: "intersection",
        name: "交点",
        type: "intersectionPoint",
        visible: true,
        enabled: true,
        line1Id: "ab",
        line2Id: "cd",
        intersectionIndex: 0,
        useExtensions: false
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("intersection")).toMatchObject({
      kind: "point",
      x: 50,
      y: 50
    });
  });

  it("evaluates a corner radius arc line and trims the source line endpoints", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "点A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "点B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 100,
        y: 0
      },
      {
        id: "c",
        name: "点C",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 100
      },
      {
        id: "ab",
        name: "直線AB",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "ac",
        name: "直線AC",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "c" }
      },
      {
        id: "corner",
        name: "角R",
        type: "cornerRadiusArcLine",
        visible: true,
        enabled: true,
        endpoint1: { lineId: "ab", endpointKey: "start" },
        endpoint2: { lineId: "ac", endpointKey: "start" },
        radius: 10,
        intersectionIndex: 0
      }
    ]);

    const line1 = result.computedGeometry.get("ab");
    const line2 = result.computedGeometry.get("ac");
    const corner = result.computedGeometry.get("corner");

    expect(result.errors).toHaveLength(0);
    expect(line1).toMatchObject({ kind: "line" });
    expect(line2).toMatchObject({ kind: "line" });
    if (line1?.kind !== "line" || line2?.kind !== "line") throw new Error("Expected trimmed lines");
    expect(line1.start.x).toBeCloseTo(10);
    expect(line1.start.y).toBeCloseTo(0);
    expect(line1.length).toBeCloseTo(90);
    expect(line2.start.x).toBeCloseTo(0);
    expect(line2.start.y).toBeCloseTo(10);
    expect(line2.length).toBeCloseTo(90);
    expect(corner).toMatchObject({
      kind: "arcLine",
      radius: 10
    });
    if (corner?.kind !== "arcLine") throw new Error("Expected a corner arc");
    expect(corner.center.x).toBeCloseTo(10);
    expect(corner.center.y).toBeCloseTo(10);
    expect(corner.start.x).toBeCloseTo(10);
    expect(corner.start.y).toBeCloseTo(0);
    expect(corner.end.x).toBeCloseTo(0);
    expect(corner.end.y).toBeCloseTo(10);
    expect(corner.length).toBeCloseTo(Math.PI * 5);
  });

  it("lets later elements reference the trimmed line result", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "点A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "点B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 100,
        y: 0
      },
      {
        id: "c",
        name: "点C",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 100
      },
      {
        id: "ab",
        name: "直線AB",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "ac",
        name: "直線AC",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "c" }
      },
      {
        id: "corner",
        name: "角R",
        type: "cornerRadiusArcLine",
        visible: true,
        enabled: true,
        endpoint1: { lineId: "ab", endpointKey: "start" },
        endpoint2: { lineId: "ac", endpointKey: "start" },
        radius: 10,
        intersectionIndex: 0
      },
      {
        id: "division",
        name: "トリム後始点",
        type: "lineDivisionPoint",
        visible: true,
        enabled: true,
        endpoint: { lineId: "ab", endpointKey: "start" },
        placementMode: "distance",
        distance: 0,
        ratio: 0
      },
      {
        id: "length-line",
        name: "長さ参照線",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "coordinate", x: 0, y: 0 },
        endPoint: { mode: "coordinate", x: { kind: "expression", expression: "ab.length" }, y: 0 }
      }
    ]);

    expect(result.errors).toHaveLength(0);
    const division = result.computedGeometry.get("division");
    expect(division).toMatchObject({ kind: "point" });
    if (division?.kind !== "point") throw new Error("Expected a point");
    expect(division.x).toBeCloseTo(10);
    expect(division.y).toBeCloseTo(0);
    expect(result.computedGeometry.get("length-line")).toMatchObject({
      kind: "line",
      end: { x: 90, y: 0 }
    });
  });

  it("evaluates a corner radius arc line between approximated line-like geometries", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "点A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "点B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 100,
        y: 0
      },
      {
        id: "base",
        name: "基準",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "curve",
        name: "曲線",
        type: "bezierCurve",
        visible: true,
        enabled: true,
        startPoint: { mode: "coordinate", x: 0, y: 0 },
        startHandleAngleDeg: 90,
        startHandleLength: 40,
        intermediatePoints: [],
        endPoint: { mode: "coordinate", x: 0, y: 100 },
        endHandleAngleDeg: 90,
        endHandleLength: 40
      },
      {
        id: "corner",
        name: "角R",
        type: "cornerRadiusArcLine",
        visible: true,
        enabled: true,
        endpoint1: { lineId: "base", endpointKey: "start" },
        endpoint2: { lineId: "curve", endpointKey: "start" },
        radius: 10,
        intersectionIndex: 0
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("corner")).toMatchObject({ kind: "arcLine", radius: 10 });
    expect(result.computedGeometry.get("curve")).toMatchObject({ kind: "offsetLine" });
  });

  it("reports corner radius arc line dependency and geometry errors", () => {
    const missing = evaluateElements([
      {
        id: "corner",
        name: "角R",
        type: "cornerRadiusArcLine",
        visible: true,
        enabled: true,
        endpoint1: { lineId: "ab", endpointKey: "start" },
        endpoint2: { lineId: "ac", endpointKey: "start" },
        radius: 10,
        intersectionIndex: 0
      }
    ]);
    expect(missing.errors[0]).toMatchObject({
      elementId: "corner",
      missingDependencyId: "ab"
    });

    const invalidRadius = evaluateElements([
      ...validElements,
      {
        id: "corner",
        name: "角R",
        type: "cornerRadiusArcLine",
        visible: true,
        enabled: true,
        endpoint1: { lineId: "ab", endpointKey: "start" },
        endpoint2: { lineId: "ab", endpointKey: "end" },
        radius: 0,
        intersectionIndex: 0
      }
    ]);
    expect(invalidRadius.computedGeometry.has("corner")).toBe(false);
    expect(invalidRadius.errors[0].message).toContain("同じ線");

    const invalidIndex = evaluateElements([
      ...validElements,
      {
        id: "ac",
        name: "直線AC",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "coordinate", x: 10, y: 100 }
      },
      {
        id: "corner",
        name: "角R",
        type: "cornerRadiusArcLine",
        visible: true,
        enabled: true,
        endpoint1: { lineId: "ab", endpointKey: "start" },
        endpoint2: { lineId: "ac", endpointKey: "start" },
        radius: 10,
        intersectionIndex: 0.5
      }
    ]);
    expect(invalidIndex.errors[0].message).toContain("0以上の整数");
  });

  it("uses line endpoint tangent extensions when requested", () => {
    const elements: CadElement[] = [
      { id: "a", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", visible: true, enabled: true, x: 10, y: 0 },
      { id: "c", name: "C", type: "freePoint", visible: true, enabled: true, x: 20, y: -10 },
      { id: "d", name: "D", type: "freePoint", visible: true, enabled: true, x: 20, y: 10 },
      {
        id: "ab",
        name: "AB",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "cd",
        name: "CD",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "c" },
        endPoint: { mode: "reference", pointId: "d" }
      }
    ];
    const withoutExtension = evaluateElements([
      ...elements,
      {
        id: "intersection",
        name: "交点",
        type: "intersectionPoint",
        visible: true,
        enabled: true,
        line1Id: "ab",
        line2Id: "cd",
        intersectionIndex: 0,
        useExtensions: false
      }
    ]);
    const withExtension = evaluateElements([
      ...elements,
      {
        id: "intersection",
        name: "交点",
        type: "intersectionPoint",
        visible: true,
        enabled: true,
        line1Id: "ab",
        line2Id: "cd",
        intersectionIndex: 0,
        useExtensions: true
      }
    ]);

    expect(withoutExtension.computedGeometry.has("intersection")).toBe(false);
    expect(withExtension.errors).toHaveLength(0);
    expect(withExtension.computedGeometry.get("intersection")).toMatchObject({
      kind: "point",
      x: 20,
      y: 0
    });
  });

  it("evaluates intersections with arc, Bezier, and offset lines", () => {
    const result = evaluateElements([
      { id: "center", name: "中心", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
      { id: "a", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", visible: true, enabled: true, x: 100, y: 0 },
      { id: "p1", name: "P1", type: "freePoint", visible: true, enabled: true, x: -20, y: 7 },
      { id: "p2", name: "P2", type: "freePoint", visible: true, enabled: true, x: 20, y: 7 },
      { id: "v1", name: "V1", type: "freePoint", visible: true, enabled: true, x: 50, y: -20 },
      { id: "v2", name: "V2", type: "freePoint", visible: true, enabled: true, x: 50, y: 20 },
      {
        id: "arc",
        name: "円弧",
        type: "arcLine",
        visible: true,
        enabled: true,
        centerPoint: { mode: "reference", pointId: "center" },
        radius: 10,
        startAngleDeg: 0,
        endAngleDeg: 180
      },
      {
        id: "horizontal",
        name: "水平線",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "p1" },
        endPoint: { mode: "reference", pointId: "p2" }
      },
      {
        id: "curve",
        name: "曲線",
        type: "bezierCurve",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        startHandleAngleDeg: 0,
        startHandleLength: 0,
        intermediatePoints: [],
        endPoint: { mode: "reference", pointId: "b" },
        endHandleAngleDeg: 180,
        endHandleLength: 0
      },
      {
        id: "vertical",
        name: "垂直線",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "v1" },
        endPoint: { mode: "reference", pointId: "v2" }
      },
      {
        id: "offset",
        name: "オフセット",
        type: "offsetLine",
        visible: true,
        enabled: true,
        baseLineIds: ["curve"],
        offset: 10,
        side: "right",
        closed: false
      },
      {
        id: "arc-intersection",
        name: "円弧交点",
        type: "intersectionPoint",
        visible: true,
        enabled: true,
        line1Id: "arc",
        line2Id: "horizontal",
        intersectionIndex: 0,
        useExtensions: false
      },
      {
        id: "curve-intersection",
        name: "曲線交点",
        type: "intersectionPoint",
        visible: true,
        enabled: true,
        line1Id: "curve",
        line2Id: "vertical",
        intersectionIndex: 0,
        useExtensions: false
      },
      {
        id: "offset-intersection",
        name: "オフセット交点",
        type: "intersectionPoint",
        visible: true,
        enabled: true,
        line1Id: "offset",
        line2Id: "vertical",
        intersectionIndex: 0,
        useExtensions: false
      }
    ]);

    const arc = result.computedGeometry.get("arc-intersection");
    const curve = result.computedGeometry.get("curve-intersection");
    const offset = result.computedGeometry.get("offset-intersection");
    expect(result.errors).toHaveLength(0);
    if (arc?.kind !== "point" || curve?.kind !== "point" || offset?.kind !== "point") {
      throw new Error("Expected points");
    }
    expect(arc.x).toBeCloseTo(Math.sqrt(51), 0);
    expect(arc.y).toBeCloseTo(7, 1);
    expect(curve.x).toBeCloseTo(50);
    expect(curve.y).toBeCloseTo(0);
    expect(offset.x).toBeCloseTo(50);
    expect(offset.y).toBeCloseTo(10);
  });

  it("selects an intersection by index when multiple intersections exist", () => {
    const result = evaluateElements([
      { id: "center", name: "中心", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
      { id: "p1", name: "P1", type: "freePoint", visible: true, enabled: true, x: -20, y: 7 },
      { id: "p2", name: "P2", type: "freePoint", visible: true, enabled: true, x: 20, y: 7 },
      {
        id: "arc",
        name: "円弧",
        type: "arcLine",
        visible: true,
        enabled: true,
        centerPoint: { mode: "reference", pointId: "center" },
        radius: 10,
        startAngleDeg: 0,
        endAngleDeg: 180
      },
      {
        id: "line",
        name: "水平線",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "p1" },
        endPoint: { mode: "reference", pointId: "p2" }
      },
      {
        id: "intersection",
        name: "交点",
        type: "intersectionPoint",
        visible: true,
        enabled: true,
        line1Id: "arc",
        line2Id: "line",
        intersectionIndex: 1,
        useExtensions: false
      }
    ]);

    const point = result.computedGeometry.get("intersection");
    expect(result.errors).toHaveLength(0);
    if (point?.kind !== "point") throw new Error("Expected a point");
    expect(point.x).toBeCloseTo(-Math.sqrt(51), 0);
    expect(point.y).toBeCloseTo(7, 1);
  });

  it("reports intersection point dependency and geometry errors", () => {
    const missing = evaluateElements([
      {
        id: "intersection",
        name: "交点",
        type: "intersectionPoint",
        visible: true,
        enabled: true,
        line1Id: "ab",
        line2Id: "missing",
        intersectionIndex: 0,
        useExtensions: false
      },
      ...validElements
    ]);
    const sameLine = evaluateElements([
      ...validElements,
      {
        id: "intersection",
        name: "交点",
        type: "intersectionPoint",
        visible: true,
        enabled: true,
        line1Id: "ab",
        line2Id: "ab",
        intersectionIndex: 0,
        useExtensions: false
      }
    ]);
    const invalidIndex = evaluateElements([
      ...validElements,
      { id: "c", name: "C", type: "freePoint", visible: true, enabled: true, x: 10, y: 25 },
      { id: "d", name: "D", type: "freePoint", visible: true, enabled: true, x: 40, y: 20 },
      {
        id: "cd",
        name: "CD",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "c" },
        endPoint: { mode: "reference", pointId: "d" }
      },
      {
        id: "intersection",
        name: "交点",
        type: "intersectionPoint",
        visible: true,
        enabled: true,
        line1Id: "ab",
        line2Id: "cd",
        intersectionIndex: 0.5,
        useExtensions: false
      }
    ]);

    expect(missing.errors[0]).toMatchObject({
      elementId: "intersection",
      missingDependencyId: "ab",
      missingDependencyName: "直線AB"
    });
    expect(sameLine.errors[0].message).toContain("同じ線");
    expect(invalidIndex.errors[0].message).toContain("0以上の整数");
  });

  it("evaluates numeric expressions that reference earlier line measurements", () => {
    const result = evaluateElements([
      ...validElements,
      {
        id: "c",
        name: "点C",
        type: "offsetPoint",
        visible: true,
        enabled: true,
        fromPointId: "a",
        dx: { kind: "expression", expression: "ab.length + 10" },
        dy: { kind: "expression", expression: "ab.startAngleDeg / 9" }
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("ab")).toMatchObject({
      kind: "line",
      length: Math.hypot(30, 5)
    });
    expect(result.computedGeometry.get("c")).toMatchObject({
      kind: "point",
      x: 10 + Math.hypot(30, 5) + 10
    });
  });

  it("evaluates a cubic Bezier curve and its approximate length", () => {
    const result = evaluateElements([
      ...validElements,
      {
        id: "curve",
        name: "曲線AB",
        type: "bezierCurve",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        startHandleAngleDeg: 0,
        startHandleLength: 20,
        intermediatePoints: [],
        endPoint: { mode: "reference", pointId: "b" },
        endHandleAngleDeg: 0,
        endHandleLength: 20
      }
    ]);

    const curve = result.computedGeometry.get("curve");
    expect(result.errors).toHaveLength(0);
    expect(curve).toMatchObject({
      kind: "bezierCurve",
      startPointId: "a",
      endPointId: "b"
    });
    if (curve?.kind !== "bezierCurve") throw new Error("Expected a Bezier curve");
    expect(curve.segments).toHaveLength(1);
    expect(curve.length).toBeGreaterThan(0);
  });

  it("evaluates a multi-point cubic Bezier curve as multiple segments", () => {
    const result = evaluateElements([
      ...validElements,
      {
        id: "c",
        name: "点C",
        type: "offsetPoint",
        visible: true,
        enabled: true,
        fromPointId: "b",
        dx: 0,
        dy: 40
      },
      {
        id: "curve",
        name: "曲線ABC",
        type: "bezierCurve",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        startHandleAngleDeg: 0,
        startHandleLength: 20,
        intermediatePoints: [
          {
            id: "mid-1",
            point: { mode: "reference", pointId: "b" },
            handleAngleDeg: 90,
            incomingHandleLength: 10,
            outgoingHandleLength: 15
          }
        ],
        endPoint: { mode: "reference", pointId: "c" },
        endHandleAngleDeg: 90,
        endHandleLength: 20
      }
    ]);

    const curve = result.computedGeometry.get("curve");
    expect(result.errors).toHaveLength(0);
    expect(curve).toMatchObject({ kind: "bezierCurve" });
    if (curve?.kind !== "bezierCurve") throw new Error("Expected a Bezier curve");
    expect(curve.segments).toHaveLength(2);
    expect(curve.intermediatePointIds).toEqual(["b"]);
  });

  it("evaluates Bezier curve anchors from direct coordinates", () => {
    const result = evaluateElements([
      {
        id: "curve",
        name: "直接曲線",
        type: "bezierCurve",
        visible: true,
        enabled: true,
        startPoint: { mode: "coordinate", x: 0, y: 0 },
        startHandleAngleDeg: 0,
        startHandleLength: 10,
        intermediatePoints: [
          {
            id: "mid-1",
            point: { mode: "coordinate", x: 10, y: 10 },
            handleAngleDeg: 90,
            incomingHandleLength: 5,
            outgoingHandleLength: 5
          }
        ],
        endPoint: { mode: "coordinate", x: 20, y: 0 },
        endHandleAngleDeg: 0,
        endHandleLength: 10
      }
    ]);

    const curve = result.computedGeometry.get("curve");
    expect(result.errors).toHaveLength(0);
    expect(curve).toMatchObject({
      kind: "bezierCurve",
      startPointId: null,
      endPointId: null,
      intermediatePointIds: []
    });
    if (curve?.kind !== "bezierCurve") throw new Error("Expected a Bezier curve");
    expect(curve.segments).toHaveLength(2);
  });

  it("evaluates numeric expressions that reference earlier curve length", () => {
    const result = evaluateElements([
      ...validElements,
      {
        id: "curve",
        name: "曲線AB",
        type: "bezierCurve",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        startHandleAngleDeg: 0,
        startHandleLength: 20,
        intermediatePoints: [],
        endPoint: { mode: "reference", pointId: "b" },
        endHandleAngleDeg: 0,
        endHandleLength: 20
      },
      {
        id: "c",
        name: "点C",
        type: "offsetPoint",
        visible: true,
        enabled: true,
        fromPointId: "a",
        dx: { kind: "expression", expression: "curve.length" },
        dy: 0
      }
    ]);

    const curve = result.computedGeometry.get("curve");
    const point = result.computedGeometry.get("c");
    expect(result.errors).toHaveLength(0);
    if (curve?.kind !== "bezierCurve") throw new Error("Expected a Bezier curve");
    expect(point).toMatchObject({ kind: "point", x: 10 + curve.length });
  });

  it("evaluates an arc line with counterclockwise sweep and length", () => {
    const result = evaluateElements([
      validElements[0],
      {
        id: "arc",
        name: "円弧",
        type: "arcLine",
        visible: true,
        enabled: true,
        centerPoint: { mode: "reference", pointId: "a" },
        radius: 10,
        startAngleDeg: 0,
        endAngleDeg: 90
      }
    ]);

    const arc = result.computedGeometry.get("arc");
    expect(result.errors).toHaveLength(0);
    expect(arc).toMatchObject({
      kind: "arcLine",
      centerPointId: "a",
      start: { x: 20, y: 20 },
      end: { x: 10, y: 30 },
      sweepAngleDeg: 90
    });
    if (arc?.kind !== "arcLine") throw new Error("Expected an arc line");
    expect(arc.length).toBeCloseTo((Math.PI * 10) / 2);
  });

  it("evaluates an arc line that wraps past 360 degrees", () => {
    const result = evaluateElements([
      validElements[0],
      {
        id: "arc",
        name: "またぎ円弧",
        type: "arcLine",
        visible: true,
        enabled: true,
        centerPoint: { mode: "reference", pointId: "a" },
        radius: 20,
        startAngleDeg: 300,
        endAngleDeg: 30
      }
    ]);

    const arc = result.computedGeometry.get("arc");
    expect(result.errors).toHaveLength(0);
    expect(arc).toMatchObject({ kind: "arcLine", sweepAngleDeg: 90 });
    if (arc?.kind !== "arcLine") throw new Error("Expected an arc line");
    expect(arc.length).toBeCloseTo((Math.PI * 20) / 2);
  });

  it("evaluates an arc line with a full 360 degree sweep", () => {
    const result = evaluateElements([
      validElements[0],
      {
        id: "arc",
        name: "完全円",
        type: "arcLine",
        visible: true,
        enabled: true,
        centerPoint: { mode: "reference", pointId: "a" },
        radius: 10,
        startAngleDeg: 0,
        endAngleDeg: 360
      }
    ]);

    const arc = result.computedGeometry.get("arc");
    expect(result.errors).toHaveLength(0);
    expect(arc).toMatchObject({
      kind: "arcLine",
      start: { x: 20, y: 20 },
      sweepAngleDeg: 360
    });
    if (arc?.kind !== "arcLine") throw new Error("Expected an arc line");
    expect(arc.end.x).toBeCloseTo(20);
    expect(arc.end.y).toBeCloseTo(20);
    expect(arc.length).toBeCloseTo(Math.PI * 20);
  });

  it("evaluates numeric expressions that reference earlier arc measurements", () => {
    const result = evaluateElements([
      validElements[0],
      {
        id: "arc",
        name: "円弧",
        type: "arcLine",
        visible: true,
        enabled: true,
        centerPoint: { mode: "reference", pointId: "a" },
        radius: 10,
        startAngleDeg: 0,
        endAngleDeg: 180
      },
      {
        id: "c",
        name: "点C",
        type: "offsetPoint",
        visible: true,
        enabled: true,
        fromPointId: "a",
        dx: { kind: "expression", expression: "arc.length" },
        dy: { kind: "expression", expression: "arc.endAngleDeg / 9" }
      }
    ]);

    const point = result.computedGeometry.get("c");
    expect(result.errors).toHaveLength(0);
    expect(point).toMatchObject({ kind: "point", x: 10 + Math.PI * 10, y: 40 });
  });

  it("evaluates a three-point arc line by fitting a circle and trimming by angles", () => {
    const result = evaluateElements([
      {
        id: "p1",
        name: "点1",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 10,
        y: 0
      },
      {
        id: "p2",
        name: "点2",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: -10
      },
      {
        id: "p3",
        name: "点3",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: -10,
        y: 0
      },
      {
        id: "arc",
        name: "三点円弧",
        type: "threePointArcLine",
        visible: true,
        enabled: true,
        point1: { mode: "reference", pointId: "p1" },
        point2: { mode: "reference", pointId: "p2" },
        point3: { mode: "reference", pointId: "p3" },
        startAngleDeg: 0,
        endAngleDeg: 90
      }
    ]);

    const arc = result.computedGeometry.get("arc");
    expect(result.errors).toHaveLength(0);
    expect(arc).toMatchObject({
      kind: "arcLine",
      centerPointId: null,
      radius: 10,
      startAngleDeg: 0,
      endAngleDeg: 90,
      sweepAngleDeg: 90
    });
    if (arc?.kind !== "arcLine") throw new Error("Expected an arc line");
    expect(arc.center.x).toBeCloseTo(0);
    expect(arc.center.y).toBeCloseTo(0);
    expect(arc.start.x).toBeCloseTo(10);
    expect(arc.start.y).toBeCloseTo(0);
    expect(arc.end.x).toBeCloseTo(0);
    expect(arc.end.y).toBeCloseTo(10);
    expect(arc.length).toBeCloseTo((Math.PI * 10) / 2);
  });

  it("evaluates three-point arc wraps and numeric measurement references", () => {
    const result = evaluateElements([
      {
        id: "p1",
        name: "点1",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 20,
        y: 0
      },
      {
        id: "p2",
        name: "点2",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: -20
      },
      {
        id: "p3",
        name: "点3",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: -20,
        y: 0
      },
      {
        id: "arc",
        name: "三点円弧",
        type: "threePointArcLine",
        visible: true,
        enabled: true,
        point1: { mode: "reference", pointId: "p1" },
        point2: { mode: "reference", pointId: "p2" },
        point3: { mode: "reference", pointId: "p3" },
        startAngleDeg: 300,
        endAngleDeg: 30
      },
      {
        id: "measure",
        name: "計測点",
        type: "offsetPoint",
        visible: true,
        enabled: true,
        fromPointId: "p1",
        dx: { kind: "expression", expression: "arc.length" },
        dy: { kind: "expression", expression: "arc.endAngleDeg" }
      }
    ]);

    const arc = result.computedGeometry.get("arc");
    const point = result.computedGeometry.get("measure");
    expect(result.errors).toHaveLength(0);
    expect(arc).toMatchObject({ kind: "arcLine", sweepAngleDeg: 90 });
    if (arc?.kind !== "arcLine") throw new Error("Expected an arc line");
    expect(point).toMatchObject({ kind: "point", x: 20 + Math.PI * 10, y: 30 });
  });

  it("reports a three-point arc dependency that appears too late", () => {
    const result = evaluateElements([
      validElements[0],
      {
        id: "arc",
        name: "三点円弧",
        type: "threePointArcLine",
        visible: true,
        enabled: true,
        point1: { mode: "reference", pointId: "a" },
        point2: { mode: "reference", pointId: "b" },
        point3: { mode: "reference", pointId: "missing" },
        startAngleDeg: 0,
        endAngleDeg: 90
      },
      validElements[1]
    ]);

    expect(result.computedGeometry.has("arc")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "arc",
      missingDependencyId: "b",
      missingDependencyName: "点B"
    });
  });

  it("reports a three-point arc geometry error for collinear points", () => {
    const result = evaluateElements([
      {
        id: "p1",
        name: "点1",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "p2",
        name: "点2",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 10,
        y: 0
      },
      {
        id: "p3",
        name: "点3",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 20,
        y: 0
      },
      {
        id: "arc",
        name: "三点円弧",
        type: "threePointArcLine",
        visible: true,
        enabled: true,
        point1: { mode: "reference", pointId: "p1" },
        point2: { mode: "reference", pointId: "p2" },
        point3: { mode: "reference", pointId: "p3" },
        startAngleDeg: 0,
        endAngleDeg: 90
      }
    ]);

    expect(result.computedGeometry.has("arc")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "arc",
      missingDependencyId: "arc",
      message: expect.stringContaining("円を作れません")
    });
  });

  it("evaluates curve handles from local numeric variables", () => {
    const result = evaluateElements([
      ...validElements,
      {
        id: "curve",
        name: "曲線AB",
        type: "bezierCurve",
        visible: true,
        enabled: true,
        numericVariables: [{ id: "shared", name: "共通長", value: 40 }],
        startPoint: { mode: "reference", pointId: "a" },
        startHandleAngleDeg: 0,
        startHandleLength: { kind: "expression", expression: "@shared" },
        intermediatePoints: [],
        endPoint: { mode: "reference", pointId: "b" },
        endHandleAngleDeg: 0,
        endHandleLength: { kind: "expression", expression: "@shared" }
      }
    ]);

    const curve = result.computedGeometry.get("curve");
    expect(result.errors).toHaveLength(0);
    expect(curve).toMatchObject({
      kind: "bezierCurve",
      startHandleLength: 40,
      endHandleLength: 40
    });
  });

  it("evaluates free point coordinates from local numeric variables", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "点A",
        type: "freePoint",
        visible: true,
        enabled: true,
        numericVariables: [
          { id: "base", name: "基準", value: 20 },
          { id: "half", name: "半分", value: { kind: "expression", expression: "@base / 2" } }
        ],
        x: { kind: "expression", expression: "@base" },
        y: { kind: "expression", expression: "@half" }
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("a")).toMatchObject({ kind: "point", x: 20, y: 10 });
  });

  it("evaluates offset point deltas from local numeric variables", () => {
    const result = evaluateElements([
      validElements[0],
      {
        id: "b",
        name: "点B",
        type: "offsetPoint",
        visible: true,
        enabled: true,
        numericVariables: [{ id: "move", name: "移動量", value: 15 }],
        fromPointId: "a",
        dx: { kind: "expression", expression: "@move * 2" },
        dy: { kind: "expression", expression: "@move" }
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("b")).toMatchObject({ kind: "point", x: 40, y: 35 });
  });

  it("evaluates polar offset parameters from local numeric variables", () => {
    const result = evaluateElements([
      validElements[0],
      {
        id: "b",
        name: "点B",
        type: "polarOffsetPoint",
        visible: true,
        enabled: true,
        numericVariables: [
          { id: "angle", name: "角度", value: 90 },
          { id: "distance", name: "距離", value: 10 }
        ],
        fromPointId: "a",
        angleDeg: { kind: "expression", expression: "@angle" },
        distance: { kind: "expression", expression: "@distance" }
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("b")).toMatchObject({ kind: "point", x: 10, y: 30 });
  });

  it("reports missing local numeric variables on non-curve elements", () => {
    const result = evaluateElements([
      {
        id: "a",
        name: "点A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: { kind: "expression", expression: "@missing" },
        y: 0
      }
    ]);

    expect(result.computedGeometry.has("a")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "a",
      elementName: "点A",
      missingDependencyId: "missing",
      message: expect.stringContaining("この要素内に存在しません")
    });
  });

  it("evaluates numeric expressions that reference earlier curve handle measurements", () => {
    const result = evaluateElements([
      ...validElements,
      {
        id: "curve",
        name: "曲線AB",
        type: "bezierCurve",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        startHandleAngleDeg: 15,
        startHandleLength: 20,
        intermediatePoints: [],
        endPoint: { mode: "reference", pointId: "b" },
        endHandleAngleDeg: 25,
        endHandleLength: 30
      },
      {
        id: "c",
        name: "点C",
        type: "offsetPoint",
        visible: true,
        enabled: true,
        fromPointId: "a",
        dx: { kind: "expression", expression: "curve.startHandleLength + curve.endHandleLength" },
        dy: { kind: "expression", expression: "curve.startHandleAngleDeg + curve.endHandleAngleDeg" }
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("c")).toMatchObject({
      kind: "point",
      x: 60,
      y: 60
    });
  });

  it("normalizes displayed Japanese line measurement references before evaluation", () => {
    const expression = normalizeNumericExpressionInput("直線AB.長さ + 10", validElements);
    const result = evaluateElements([
      ...validElements,
      {
        id: "c",
        name: "点C",
        type: "offsetPoint",
        visible: true,
        enabled: true,
        fromPointId: "a",
        dx: makeNumericExpression(expression),
        dy: 0
      }
    ]);

    expect(expression).toBe("ab.length + 10");
    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("c")).toMatchObject({
      kind: "point",
      x: 10 + Math.hypot(30, 5) + 10
    });
  });

  it("reports a numeric expression dependency that appears too late", () => {
    const result = evaluateElements([
      validElements[0],
      {
        id: "c",
        name: "点C",
        type: "offsetPoint",
        visible: true,
        enabled: true,
        fromPointId: "a",
        dx: { kind: "expression", expression: "ab.length" },
        dy: 0
      },
      validElements[1],
      validElements[2]
    ]);

    expect(result.computedGeometry.has("c")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "c",
      missingDependencyId: "ab",
      missingDependencyName: "直線AB"
    });
  });

  it("reports a missing dependency", () => {
    const result = evaluateElements([
      {
        id: "b",
        name: "点B",
        type: "offsetPoint",
        visible: true,
        enabled: true,
        fromPointId: "missing",
        dx: 30,
        dy: 5
      }
    ]);

    expect(result.computedGeometry.has("b")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "b",
      missingDependencyId: "missing"
    });
  });

  it("reports a missing polar offset point dependency", () => {
    const result = evaluateElements([
      {
        id: "polar",
        name: "角度距離点",
        type: "polarOffsetPoint",
        visible: true,
        enabled: true,
        fromPointId: "missing",
        angleDeg: 0,
        distance: 30
      }
    ]);

    expect(result.computedGeometry.has("polar")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "polar",
      missingDependencyId: "missing"
    });
  });

  it("reports a missing angle length line start point dependency", () => {
    const result = evaluateElements([
      {
        id: "angle-line",
        name: "角度距離線",
        type: "angleLengthLine",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "missing" },
        angleDeg: 0,
        length: 30
      }
    ]);

    expect(result.computedGeometry.has("angle-line")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "angle-line",
      missingDependencyId: "missing"
    });
  });

  it("reports a dependency that appears too late", () => {
    const result = evaluateElements([validElements[0], validElements[2], validElements[1]]);

    expect(result.computedGeometry.has("ab")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "ab",
      elementName: "直線AB",
      missingDependencyId: "b",
      missingDependencyName: "点B"
    });
  });

  it("reports a Bezier curve dependency that appears too late", () => {
    const result = evaluateElements([
      validElements[0],
      {
        id: "curve",
        name: "曲線AB",
        type: "bezierCurve",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        startHandleAngleDeg: 0,
        startHandleLength: 20,
        intermediatePoints: [],
        endPoint: { mode: "reference", pointId: "b" },
        endHandleAngleDeg: 0,
        endHandleLength: 20
      },
      validElements[1]
    ]);

    expect(result.computedGeometry.has("curve")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "curve",
      missingDependencyId: "b",
      missingDependencyName: "点B"
    });
  });

  it("evaluates derived line start and end point anchors", () => {
    const result = evaluateElements([
      ...validElements,
      {
        id: "derived-line",
        name: "派生線",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "derived", elementId: "ab", pointKey: "start" },
        endPoint: { mode: "derived", elementId: "ab", pointKey: "end" }
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("derived-line")).toMatchObject({
      kind: "line",
      start: { x: 10, y: 20 },
      end: { x: 40, y: 25 }
    });
  });

  it("evaluates derived Bezier intermediate point anchors", () => {
    const result = evaluateElements([
      ...validElements,
      {
        id: "c",
        name: "点C",
        type: "offsetPoint",
        visible: true,
        enabled: true,
        fromPointId: "b",
        dx: 0,
        dy: 40
      },
      {
        id: "curve",
        name: "曲線ABC",
        type: "bezierCurve",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        startHandleAngleDeg: 0,
        startHandleLength: 20,
        intermediatePoints: [
          {
            id: "mid-1",
            point: { mode: "reference", pointId: "b" },
            handleAngleDeg: 90,
            incomingHandleLength: 10,
            outgoingHandleLength: 15
          }
        ],
        endPoint: { mode: "reference", pointId: "c" },
        endHandleAngleDeg: 90,
        endHandleLength: 20
      },
      {
        id: "from-mid",
        name: "中間点からの点",
        type: "offsetPoint",
        visible: true,
        enabled: true,
        fromPoint: { mode: "derived", elementId: "curve", pointKey: "intermediate:mid-1" },
        dx: 5,
        dy: 6
      }
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("from-mid")).toMatchObject({
      kind: "point",
      x: 45,
      y: 31
    });
  });

  it("reports a derived point dependency that appears too late", () => {
    const result = evaluateElements([
      validElements[0],
      {
        id: "before-line",
        name: "前の線",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "derived", elementId: "ab", pointKey: "end" }
      },
      validElements[1],
      validElements[2]
    ]);

    expect(result.computedGeometry.has("before-line")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "before-line",
      missingDependencyId: "ab",
      missingDependencyName: "直線AB"
    });
  });

  it("allows hidden elements to be evaluated and referenced", () => {
    const hiddenSource: CadElement[] = [
      { ...validElements[0], visible: false },
      validElements[1]
    ];

    const result = evaluateElements(hiddenSource);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("b")).toMatchObject({ kind: "point", x: 40, y: 25 });
  });

  it("does not evaluate disabled elements", () => {
    const disabledSource: CadElement[] = [
      { ...validElements[0], enabled: false },
      validElements[1]
    ];

    const result = evaluateElements(disabledSource);

    expect(result.computedGeometry.has("a")).toBe(false);
    expect(result.computedGeometry.has("b")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "b",
      missingDependencyId: "a"
    });
  });

  it("evaluates offset lines from multiple base lines with mitered joins", () => {
    const elements: CadElement[] = [
      {
        id: "a",
        name: "A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 100,
        y: 0
      },
      {
        id: "c",
        name: "C",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 100,
        y: 100
      },
      {
        id: "ab",
        name: "AB",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "bc",
        name: "BC",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "b" },
        endPoint: { mode: "reference", pointId: "c" }
      },
      {
        id: "offset",
        name: "オフセット",
        type: "offsetLine",
        visible: true,
        enabled: true,
        baseLineIds: ["ab", "bc"],
        offset: 10,
        side: "right",
        closed: false
      }
    ];

    const result = evaluateElements(elements);
    const offset = result.computedGeometry.get("offset");

    expect(result.errors).toHaveLength(0);
    expect(offset).toMatchObject({ kind: "offsetLine", length: 220 });
    if (offset?.kind !== "offsetLine") throw new Error("Expected an offset line");
    expect(offset.segments).toHaveLength(2);
    expect(offset.segments[0].start).toMatchObject({ x: 0, y: -10 });
    expect(offset.segments[0].end).toMatchObject({ x: 110, y: -10 });
    expect(offset.segments[1].start).toMatchObject({ x: 110, y: -10 });
    expect(offset.segments[1].end).toMatchObject({ x: 110, y: 100 });
  });

  it("ignores base line direction and connects the nearest endpoints", () => {
    const elements: CadElement[] = [
      {
        id: "a",
        name: "A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 100,
        y: 0
      },
      {
        id: "c",
        name: "C",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 100,
        y: 100
      },
      {
        id: "ab",
        name: "AB",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "cb",
        name: "CB",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "c" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "offset",
        name: "オフセット",
        type: "offsetLine",
        visible: true,
        enabled: true,
        baseLineIds: ["ab", "cb"],
        offset: 10,
        side: "right",
        closed: false
      }
    ];

    const result = evaluateElements(elements);
    const offset = result.computedGeometry.get("offset");

    expect(result.errors).toHaveLength(0);
    expect(offset).toMatchObject({ kind: "offsetLine", length: 220 });
    if (offset?.kind !== "offsetLine") throw new Error("Expected an offset line");
    expect(offset.segments).toHaveLength(2);
    expect(offset.segments[0].start).toMatchObject({ x: 0, y: -10 });
    expect(offset.segments[0].end).toMatchObject({ x: 110, y: -10 });
    expect(offset.segments[1].start).toMatchObject({ x: 110, y: -10 });
    expect(offset.segments[1].end).toMatchObject({ x: 110, y: 100 });
  });

  it("keeps the first base line direction stable for multi-line offsets", () => {
    const elements: CadElement[] = [
      {
        id: "a",
        name: "A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "b",
        name: "B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 100,
        y: 0
      },
      {
        id: "c",
        name: "C",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 100
      },
      {
        id: "ab",
        name: "AB",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "ac",
        name: "AC",
        type: "bezierCurve",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        startHandleAngleDeg: 270,
        startHandleLength: 30,
        intermediatePoints: [],
        endPoint: { mode: "reference", pointId: "c" },
        endHandleAngleDeg: 270,
        endHandleLength: 30
      },
      {
        id: "offset",
        name: "オフセット",
        type: "offsetLine",
        visible: true,
        enabled: true,
        baseLineIds: ["ab", "ac"],
        offset: 10,
        side: "right",
        closed: false
      }
    ];

    const result = evaluateElements(elements);
    const offset = result.computedGeometry.get("offset");

    expect(result.errors).toHaveLength(0);
    if (offset?.kind !== "offsetLine") throw new Error("Expected an offset line");
    expect(offset.segments[0].start.x).toBeCloseTo(0);
    expect(offset.segments[0].start.y).toBeCloseTo(-10);
    expect(offset.segments[0].end.x).toBeCloseTo(100);
    expect(offset.segments[0].end.y).toBeCloseTo(-10);
  });

  it("trims a folded line-to-curve offset at the actual segment intersection", () => {
    const elements: CadElement[] = [
      {
        id: "a",
        name: "A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 50,
        y: 50
      },
      {
        id: "b",
        name: "B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 150,
        y: 50
      },
      {
        id: "c",
        name: "C",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 150,
        y: 130
      },
      {
        id: "ab",
        name: "AB",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "ac",
        name: "AC",
        type: "bezierCurve",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        startHandleAngleDeg: 0,
        startHandleLength: 45,
        intermediatePoints: [],
        endPoint: { mode: "reference", pointId: "c" },
        endHandleAngleDeg: 90,
        endHandleLength: 35
      },
      {
        id: "offset",
        name: "オフセット",
        type: "offsetLine",
        visible: true,
        enabled: true,
        baseLineIds: ["ab", "ac"],
        offset: 10,
        side: "right",
        closed: false
      }
    ];

    const result = evaluateElements(elements);
    const offset = result.computedGeometry.get("offset");

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(offset).toMatchObject({ kind: "offsetLine" });
    if (offset?.kind !== "offsetLine") throw new Error("Expected an offset line");
    const lineSegments = offset.segments.filter((segment) => segment.kind === "line");
    const bezierSegments = offset.segments.filter((segment) => segment.kind === "bezier");
    expect(lineSegments.length).toBeGreaterThan(0);
    expect(bezierSegments.length).toBeGreaterThan(0);
    for (let index = 0; index < offset.segments.length - 1; index += 1) {
      expect(offset.segments[index].end.x).toBeCloseTo(offset.segments[index + 1].start.x);
      expect(offset.segments[index].end.y).toBeCloseTo(offset.segments[index + 1].start.y);
    }
  });

  it("keeps Bezier-derived offset lines as smooth curve segments", () => {
    const elements: CadElement[] = [
      {
        id: "curve",
        name: "曲線",
        type: "bezierCurve",
        visible: true,
        enabled: true,
        startPoint: { mode: "coordinate", x: 0, y: 0 },
        startHandleAngleDeg: 45,
        startHandleLength: 80,
        intermediatePoints: [],
        endPoint: { mode: "coordinate", x: 120, y: 0 },
        endHandleAngleDeg: 135,
        endHandleLength: 80
      },
      {
        id: "offset",
        name: "オフセット",
        type: "offsetLine",
        visible: true,
        enabled: true,
        baseLineIds: ["curve"],
        offset: 10,
        side: "right",
        closed: false
      }
    ];

    const result = evaluateElements(elements);
    const offset = result.computedGeometry.get("offset");

    expect(result.errors).toHaveLength(0);
    expect(offset).toMatchObject({ kind: "offsetLine" });
    if (offset?.kind !== "offsetLine") throw new Error("Expected an offset line");
    expect(offset.segments.some((segment) => segment.kind === "bezier")).toBe(true);
    expect(offset.segments.every((segment) => segment.kind !== "line")).toBe(true);
  });

  it("keeps repeated Bezier-derived offset lines as smooth curve segments", () => {
    const elements: CadElement[] = [
      {
        id: "curve",
        name: "曲線",
        type: "bezierCurve",
        visible: true,
        enabled: true,
        startPoint: { mode: "coordinate", x: 0, y: 0 },
        startHandleAngleDeg: 45,
        startHandleLength: 80,
        intermediatePoints: [],
        endPoint: { mode: "coordinate", x: 120, y: 0 },
        endHandleAngleDeg: 135,
        endHandleLength: 80
      },
      {
        id: "offset-1",
        name: "オフセット1",
        type: "offsetLine",
        visible: true,
        enabled: true,
        baseLineIds: ["curve"],
        offset: 10,
        side: "right",
        closed: false
      },
      {
        id: "offset-2",
        name: "オフセット2",
        type: "offsetLine",
        visible: true,
        enabled: true,
        baseLineIds: ["offset-1"],
        offset: 10,
        side: "right",
        closed: false
      }
    ];

    const result = evaluateElements(elements);
    const offset = result.computedGeometry.get("offset-2");

    expect(result.errors).toHaveLength(0);
    expect(offset).toMatchObject({ kind: "offsetLine" });
    if (offset?.kind !== "offsetLine") throw new Error("Expected an offset line");
    expect(offset.segments.some((segment) => segment.kind === "bezier")).toBe(true);
  });

  it("keeps large Bezier-derived offsets continuous without internal connector lines", () => {
    const elements: CadElement[] = [
      {
        id: "curve",
        name: "曲線",
        type: "bezierCurve",
        visible: true,
        enabled: true,
        startPoint: { mode: "coordinate", x: 0, y: 0 },
        startHandleAngleDeg: 45,
        startHandleLength: 90,
        intermediatePoints: [],
        endPoint: { mode: "coordinate", x: 140, y: 0 },
        endHandleAngleDeg: 135,
        endHandleLength: 90
      },
      {
        id: "offset",
        name: "大きいオフセット",
        type: "offsetLine",
        visible: true,
        enabled: true,
        baseLineIds: ["curve"],
        offset: 20,
        side: "left",
        closed: false
      }
    ];

    const result = evaluateElements(elements);
    const offset = result.computedGeometry.get("offset");

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(offset).toMatchObject({ kind: "offsetLine" });
    if (offset?.kind !== "offsetLine") throw new Error("Expected an offset line");
    expect(offset.segments.length).toBeGreaterThan(1);
    expect(offset.segments.every((segment) => segment.kind === "bezier")).toBe(true);
    for (let index = 0; index < offset.segments.length - 1; index += 1) {
      expect(offset.segments[index].end.x).toBeCloseTo(offset.segments[index + 1].start.x);
      expect(offset.segments[index].end.y).toBeCloseTo(offset.segments[index + 1].start.y);
    }
  });

  it("uses more Bezier offset segments when larger offsets need more approximation detail", () => {
    const curve: CadElement = {
      id: "curve",
      name: "曲線",
      type: "bezierCurve",
      visible: true,
      enabled: true,
      startPoint: { mode: "coordinate", x: 0, y: 0 },
      startHandleAngleDeg: 45,
      startHandleLength: 90,
      intermediatePoints: [],
      endPoint: { mode: "coordinate", x: 140, y: 0 },
      endHandleAngleDeg: 135,
      endHandleLength: 90
    };
    const smallResult = evaluateElements([
      curve,
      {
        id: "offset",
        name: "小さいオフセット",
        type: "offsetLine",
        visible: true,
        enabled: true,
        baseLineIds: ["curve"],
        offset: 5,
        side: "right",
        closed: false
      }
    ]);
    const largeResult = evaluateElements([
      curve,
      {
        id: "offset",
        name: "大きいオフセット",
        type: "offsetLine",
        visible: true,
        enabled: true,
        baseLineIds: ["curve"],
        offset: 60,
        side: "right",
        closed: false
      }
    ]);
    const smallOffset = smallResult.computedGeometry.get("offset");
    const largeOffset = largeResult.computedGeometry.get("offset");

    expect(smallResult.errors).toHaveLength(0);
    expect(largeResult.errors).toHaveLength(0);
    expect(smallOffset).toMatchObject({ kind: "offsetLine" });
    expect(largeOffset).toMatchObject({ kind: "offsetLine" });
    if (smallOffset?.kind !== "offsetLine" || largeOffset?.kind !== "offsetLine") {
      throw new Error("Expected offset lines");
    }
    expect(largeOffset.segments.length).toBeGreaterThanOrEqual(smallOffset.segments.length);
  });

  it("trims Bezier offset sections where the offset exceeds the curve radius", () => {
    const elements: CadElement[] = [
      {
        id: "curve",
        name: "曲線AC",
        type: "bezierCurve",
        visible: true,
        enabled: true,
        startPoint: { mode: "coordinate", x: 50, y: 50 },
        startHandleAngleDeg: 0,
        startHandleLength: 45,
        intermediatePoints: [],
        endPoint: { mode: "coordinate", x: 150, y: 130 },
        endHandleAngleDeg: 90,
        endHandleLength: 35
      },
      {
        id: "offset",
        name: "オフセット線",
        type: "offsetLine",
        visible: true,
        enabled: true,
        baseLineIds: ["curve"],
        offset: 35,
        side: "right",
        closed: false
      }
    ];

    const result = evaluateElements(elements);
    const offset = result.computedGeometry.get("offset");

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      elementId: "offset",
      elementName: "オフセット線"
    });
    expect(result.warnings[0].message).toContain("トリム");
    expect(offset).toMatchObject({ kind: "offsetLine" });
    if (offset?.kind !== "offsetLine") throw new Error("Expected an offset line");
    expect(offset.segments.length).toBeGreaterThan(0);
    expect(offset.segments.every((segment) => segment.kind === "bezier")).toBe(true);
  });

  it("can suppress expected Bezier offset trim warnings", () => {
    const elements: CadElement[] = [
      {
        id: "curve",
        name: "曲線AC",
        type: "bezierCurve",
        visible: true,
        enabled: true,
        startPoint: { mode: "coordinate", x: 50, y: 50 },
        startHandleAngleDeg: 0,
        startHandleLength: 45,
        intermediatePoints: [],
        endPoint: { mode: "coordinate", x: 150, y: 130 },
        endHandleAngleDeg: 90,
        endHandleLength: 35
      },
      {
        id: "offset",
        name: "オフセット線",
        type: "offsetLine",
        visible: true,
        enabled: true,
        baseLineIds: ["curve"],
        offset: 35,
        side: "right",
        closed: false,
        suppressTrimWarnings: true
      }
    ];

    const result = evaluateElements(elements);
    const offset = result.computedGeometry.get("offset");

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(offset).toMatchObject({ kind: "offsetLine" });
    if (offset?.kind !== "offsetLine") throw new Error("Expected an offset line");
    expect(offset.segments.length).toBeGreaterThan(0);
  });

  it("reports offset line dependencies that appear too late", () => {
    const result = evaluateElements([
      validElements[0],
      {
        id: "offset",
        name: "先のオフセット",
        type: "offsetLine",
        visible: true,
        enabled: true,
        baseLineIds: ["ab"],
        offset: 10,
        side: "right",
        closed: false
      },
      validElements[1],
      validElements[2]
    ]);

    expect(result.computedGeometry.has("offset")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "offset",
      missingDependencyId: "ab",
      missingDependencyName: "直線AB"
    });
  });
});
