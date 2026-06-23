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
    expect(arcPoint.y).toBeCloseTo(-10 / Math.sqrt(2), 1);
    expect(result.computedGeometry.get("curve-division")).toMatchObject({
      kind: "point",
      x: 50,
      y: 0
    });
    expect(result.computedGeometry.get("offset-division")).toMatchObject({
      kind: "point",
      x: 50,
      y: 10
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
    expect(point.y).toBeCloseTo(-10);
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
        startHandleAngleDeg: 270,
        startHandleLength: 40,
        intermediatePoints: [],
        endPoint: { mode: "coordinate", x: 0, y: 100 },
        endHandleAngleDeg: 270,
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
      { id: "p1", name: "P1", type: "freePoint", visible: true, enabled: true, x: -20, y: -7 },
      { id: "p2", name: "P2", type: "freePoint", visible: true, enabled: true, x: 20, y: -7 },
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
    expect(arc.y).toBeCloseTo(-7, 1);
    expect(curve.x).toBeCloseTo(50);
    expect(curve.y).toBeCloseTo(0);
    expect(offset.x).toBeCloseTo(50);
    expect(offset.y).toBeCloseTo(10);
  });

  it("selects an intersection by index when multiple intersections exist", () => {
    const result = evaluateElements([
      { id: "center", name: "中心", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
      { id: "p1", name: "P1", type: "freePoint", visible: true, enabled: true, x: -20, y: -7 },
      { id: "p2", name: "P2", type: "freePoint", visible: true, enabled: true, x: 20, y: -7 },
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
    expect(point.y).toBeCloseTo(-7, 1);
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
      end: { x: 10, y: 10 },
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
    expect(arc.end.y).toBeCloseTo(-10);
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
    expect(offset).toMatchObject({ kind: "offsetLine", length: 180 });
    if (offset?.kind !== "offsetLine") throw new Error("Expected an offset line");
    expect(offset.segments).toHaveLength(2);
    expect(offset.segments[0].start).toMatchObject({ x: 0, y: 10 });
    expect(offset.segments[0].end).toMatchObject({ x: 90, y: 10 });
    expect(offset.segments[1].start).toMatchObject({ x: 90, y: 10 });
    expect(offset.segments[1].end).toMatchObject({ x: 90, y: 100 });
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
    expect(offset).toMatchObject({ kind: "offsetLine", length: 180 });
    if (offset?.kind !== "offsetLine") throw new Error("Expected an offset line");
    expect(offset.segments).toHaveLength(2);
    expect(offset.segments[0].start).toMatchObject({ x: 0, y: 10 });
    expect(offset.segments[0].end).toMatchObject({ x: 90, y: 10 });
    expect(offset.segments[1].start).toMatchObject({ x: 90, y: 10 });
    expect(offset.segments[1].end).toMatchObject({ x: 90, y: 100 });
  });

  it("can reverse the first base line to connect AB then curve AC as B to A to C", () => {
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
    expect(offset.segments[0].start.x).toBeCloseTo(100);
    expect(offset.segments[0].start.y).toBeCloseTo(-10);
    expect(offset.segments[0].end.x).toBeCloseTo(-10);
    expect(offset.segments[0].end.y).toBeCloseTo(-10);
    expect(offset.segments[1].start.x).toBeCloseTo(-10);
    expect(offset.segments.at(-1)!.end.x).toBeCloseTo(-10);
    expect(offset.segments.at(-1)!.end.y).toBeCloseTo(100);
  });

  it("adds a finite pointed join for a folded line-to-curve offset at a shared point", () => {
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
    expect(lineSegments.length).toBeGreaterThanOrEqual(3);
    expect(Math.min(...lineSegments.flatMap((segment) => [segment.start.x, segment.end.x]))).toBeLessThan(50);
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
