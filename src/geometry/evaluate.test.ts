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
    expect(result.computedGeometry.get("up")).toMatchObject({ kind: "point", x: 10, y: 10 });
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
    expect(result.computedGeometry.get("b")).toMatchObject({ kind: "point", x: 10, y: 10 });
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
});
