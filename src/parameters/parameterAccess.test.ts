import { describe, expect, it } from "vitest";
import { referenceAnchor } from "../model/pointAnchors";
import type { CadElement } from "../types/geometry";
import {
  getParameterValue,
  getPointAnchor,
  setNumericParameterOrLocalVariable,
  setParameterValue,
  supportsNumericVariables
} from "./parameterAccess";

describe("parameterAccess", () => {
  it("reads and writes free point numeric parameters", () => {
    const point: CadElement = {
      id: "point-a",
      name: "点A",
      type: "freePoint",
      visible: true,
      enabled: true,
      x: 10,
      y: 20
    };

    expect(getParameterValue(point, "x")).toBe(10);
    expect(setParameterValue(point, "x", 15)).toMatchObject({ x: 15, y: 20 });
  });

  it("updates offset point anchors while keeping legacy fromPointId in sync", () => {
    const point: CadElement = {
      id: "point-b",
      name: "点B",
      type: "offsetPoint",
      visible: true,
      enabled: true,
      fromPointId: "point-a",
      dx: 10,
      dy: 0
    };

    expect(getPointAnchor(point, "fromPoint")).toEqual(referenceAnchor("point-a"));
    expect(setParameterValue(point, "fromPoint", referenceAnchor("point-c"))).toMatchObject({
      fromPoint: referenceAnchor("point-c"),
      fromPointId: "point-c"
    });
  });

  it("updates coordinate anchor child parameters", () => {
    const line: CadElement = {
      id: "line",
      name: "線",
      type: "line",
      visible: true,
      enabled: true,
      startPoint: { mode: "coordinate", x: 0, y: 5 },
      endPoint: referenceAnchor("point-a")
    };

    const updated = setParameterValue(line, "startPoint:x", 12);

    expect(updated).toMatchObject({
      startPoint: { mode: "coordinate", x: 12, y: 5 }
    });
    expect(getParameterValue(updated, "startPoint:x")).toBe(12);
  });

  it("updates arc center anchors", () => {
    const arc: CadElement = {
      id: "arc",
      name: "円弧",
      type: "arcLine",
      visible: true,
      enabled: true,
      centerPoint: referenceAnchor("point-a"),
      radius: 30,
      startAngleDeg: 0,
      endAngleDeg: 90
    };

    expect(setParameterValue(arc, "centerPoint", referenceAnchor("point-b"))).toMatchObject({
      centerPoint: referenceAnchor("point-b")
    });
  });

  it("updates three-point arc anchors", () => {
    const arc: CadElement = {
      id: "arc",
      name: "三点円弧",
      type: "threePointArcLine",
      visible: true,
      enabled: true,
      point1: referenceAnchor("point-a"),
      point2: referenceAnchor("point-b"),
      point3: referenceAnchor("point-c"),
      startAngleDeg: 0,
      endAngleDeg: 90
    };

    expect(getPointAnchor(arc, "point2")).toEqual(referenceAnchor("point-b"));
    expect(setParameterValue(arc, "point2", referenceAnchor("point-d"))).toMatchObject({
      point2: referenceAnchor("point-d")
    });
  });

  it("updates division point anchors", () => {
    const point: CadElement = {
      id: "division",
      name: "分点",
      type: "divisionPoint",
      visible: true,
      enabled: true,
      startPoint: referenceAnchor("point-a"),
      endPoint: referenceAnchor("point-b"),
      placement: { kind: "ratio", value: 0.5 }
    };

    expect(getPointAnchor(point, "startPoint")).toEqual(referenceAnchor("point-a"));
    expect(setParameterValue(point, "endPoint", referenceAnchor("point-c"))).toMatchObject({
      endPoint: referenceAnchor("point-c")
    });
    expect(supportsNumericVariables(point)).toBe(true);
  });

  // 05: DivisionPlacement union. getParameterValue never leaks the active value
  // onto the inactive distance/ratio key -- it returns the same "missing" shape
  // (undefined) that the generic fallback already returns for any key not present
  // on an element. An explicit setParameterValue call may switch which kind is
  // active.
  it("does not leak the active placement value onto the inactive distance/ratio key", () => {
    const point: CadElement = {
      id: "division",
      name: "分点",
      type: "divisionPoint",
      visible: true,
      enabled: true,
      startPoint: referenceAnchor("point-a"),
      endPoint: referenceAnchor("point-b"),
      placement: { kind: "ratio", value: 0.5 }
    };

    expect(getParameterValue(point, "placementMode")).toBe("ratio");
    expect(getParameterValue(point, "ratio")).toBe(0.5);
    expect(getParameterValue(point, "distance")).toBeUndefined();

    const switched = setParameterValue(point, "distance", 12);
    expect(switched).toMatchObject({ placement: { kind: "distance", value: 12 } });
    expect(getParameterValue(switched, "distance")).toBe(12);
    expect(getParameterValue(switched, "ratio")).toBeUndefined();
  });

  it("updates line division point endpoint references", () => {
    const point: CadElement = {
      id: "line-division",
      name: "線上分点",
      type: "lineDivisionPoint",
      visible: true,
      enabled: true,
      endpoint: { lineId: "line-a", endpointKey: "start" },
      placement: { kind: "ratio", value: 0.5 }
    };

    expect(getParameterValue(point, "endpoint")).toEqual({
      lineId: "line-a",
      endpointKey: "start"
    });
    expect(
      setParameterValue(point, "endpoint", { lineId: "line-b", endpointKey: "end" })
    ).toMatchObject({
      endpoint: { lineId: "line-b", endpointKey: "end" }
    });
    expect(supportsNumericVariables(point)).toBe(true);
  });

  it("updates intersection point line references and supports numeric variables", () => {
    const point: CadElement = {
      id: "intersection",
      name: "交点",
      type: "intersectionPoint",
      visible: true,
      enabled: true,
      line1Id: "line-a",
      line2Id: "line-b",
      intersectionIndex: 0,
      useExtensions: false
    };

    expect(getParameterValue(point, "line1Id")).toBe("line-a");
    expect(setParameterValue(point, "line2Id", "line-c")).toMatchObject({
      line2Id: "line-c"
    });
    expect(supportsNumericVariables(point)).toBe(true);
  });

  it("updates line tangent offset point references and supports numeric variables", () => {
    const point: CadElement = {
      id: "line-tangent-offset",
      name: "線上オフセット点",
      type: "lineTangentOffsetPoint",
      visible: true,
      enabled: true,
      baseLineId: "line-a",
      basePoint: referenceAnchor("point-a"),
      tangentAngleDeg: 0,
      distance: 30
    };

    expect(getParameterValue(point, "baseLineId")).toBe("line-a");
    expect(getPointAnchor(point, "basePoint")).toEqual(referenceAnchor("point-a"));
    expect(setParameterValue(point, "baseLineId", "line-b")).toMatchObject({
      baseLineId: "line-b"
    });
    expect(setParameterValue(point, "basePoint", referenceAnchor("point-b"))).toMatchObject({
      basePoint: referenceAnchor("point-b")
    });
    expect(supportsNumericVariables(point)).toBe(true);
  });

  it("updates split line references and supports numeric variables", () => {
    const line: CadElement = {
      id: "split",
      name: "分割線",
      type: "splitLine",
      visible: true,
      enabled: true,
      baseLineId: "line-a",
      splitPoint: referenceAnchor("point-a")
    };

    expect(getParameterValue(line, "baseLineId")).toBe("line-a");
    expect(getPointAnchor(line, "splitPoint")).toEqual(referenceAnchor("point-a"));
    expect(setParameterValue(line, "baseLineId", "line-b")).toMatchObject({
      baseLineId: "line-b"
    });
    expect(setParameterValue(line, "splitPoint", referenceAnchor("point-b"))).toMatchObject({
      splitPoint: referenceAnchor("point-b")
    });
    expect(supportsNumericVariables(line)).toBe(true);
  });

  it("updates Bezier intermediate anchors and handle parameters", () => {
    const curve: CadElement = {
      id: "curve",
      name: "曲線",
      type: "bezierCurve",
      visible: true,
      enabled: true,
      startPoint: referenceAnchor("point-a"),
      startHandleAngleDeg: 0,
      startHandleLength: 20,
      intermediatePoints: [
        {
          id: "mid-1",
          point: referenceAnchor("point-b"),
          handleAngleDeg: 10,
          incomingHandleLength: 15,
          outgoingHandleLength: 25
        }
      ],
      endPoint: referenceAnchor("point-c"),
      endHandleAngleDeg: 180,
      endHandleLength: 20
    };

    const movedPoint = setParameterValue(
      curve,
      "intermediate:mid-1:point",
      referenceAnchor("point-d")
    );
    const changedHandle = setParameterValue(
      movedPoint,
      "intermediate:mid-1:incomingHandleLength",
      40
    );

    expect(changedHandle).toMatchObject({
      intermediatePoints: [
        {
          id: "mid-1",
          point: referenceAnchor("point-d"),
          incomingHandleLength: 40,
          outgoingHandleLength: 25
        }
      ]
    });
  });

  it("updates numeric variables and local variable references", () => {
    const point: CadElement = {
      id: "point-a",
      name: "点A",
      type: "freePoint",
      visible: true,
      enabled: true,
      numericVariables: [{ id: "var-1", name: "幅", value: 30 }],
      x: { kind: "expression", expression: "@var-1" },
      y: 20
    };

    expect(supportsNumericVariables(point)).toBe(true);
    expect(getParameterValue(point, "variable:var-1:value")).toBe(30);
    expect(setParameterValue(point, "variable:var-1:value", 35)).toMatchObject({
      numericVariables: [{ id: "var-1", name: "幅", value: 35 }]
    });
    expect(setNumericParameterOrLocalVariable(point, "x", 42)).toMatchObject({
      numericVariables: [{ id: "var-1", name: "幅", value: 42 }],
      x: { kind: "expression", expression: "@var-1" }
    });
  });

  it("supports numeric variables on variable elements", () => {
    const variable: CadElement = {
      id: "variable",
      name: "変数",
      type: "variable",
      visible: true,
      enabled: true,
      numericVariables: [{ id: "var-1", name: "幅", value: 30 }],
      scope: "global",
      valueMode: "expression",
      expression: { kind: "expression", expression: "@var-1 * 2" },
      point1: { mode: "reference", pointId: "point-a" },
      point2: { mode: "reference", pointId: "point-b" },
      point: { mode: "reference", pointId: "point-a" },
      lineId: "line-ab"
    };

    expect(supportsNumericVariables(variable)).toBe(true);
    expect(getParameterValue(variable, "variable:var-1:value")).toBe(30);
    expect(setParameterValue(variable, "variable:var-1:value", 40)).toMatchObject({
      numericVariables: [{ id: "var-1", name: "幅", value: 40 }]
    });
  });
});
