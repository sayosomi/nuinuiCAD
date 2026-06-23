import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import { getParameterDefinitions } from "./parameterDefinitions";

describe("parameterDefinitions", () => {
  it("defines editable parameters for intersection points", () => {
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

    expect(getParameterDefinitions(point)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "line1Id", directKey: "1", label: "線1", kind: "lineReference" }),
        expect.objectContaining({ key: "line2Id", directKey: "2", label: "線2", kind: "lineReference" }),
        expect.objectContaining({ key: "intersectionIndex", directKey: "i", label: "番号", kind: "number" }),
        expect.objectContaining({ key: "useExtensions", directKey: "x", label: "延長", kind: "boolean" })
      ])
    );
  });

  it("defines editable parameters for line tangent offset points", () => {
    const point: CadElement = {
      id: "line-tangent-offset",
      name: "線上オフセット点",
      type: "lineTangentOffsetPoint",
      visible: true,
      enabled: true,
      baseLineId: "line-a",
      basePoint: { mode: "reference", pointId: "point-a" },
      tangentAngleDeg: 0,
      distance: 30
    };

    expect(getParameterDefinitions(point)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "baseLineId", directKey: "b", label: "基準線", kind: "lineReference" }),
        expect.objectContaining({ key: "basePoint", directKey: "p", label: "基準点", kind: "reference" }),
        expect.objectContaining({ key: "tangentAngleDeg", directKey: "r", label: "接線角度", kind: "number" }),
        expect.objectContaining({ key: "distance", directKey: "d", label: "距離", kind: "number" })
      ])
    );
  });

  it("defines editable parameters for corner radius arc lines", () => {
    const arc: CadElement = {
      id: "corner",
      name: "角R",
      type: "cornerRadiusArcLine",
      visible: true,
      enabled: true,
      endpoint1: { lineId: "line-a", endpointKey: "start" },
      endpoint2: { lineId: "line-b", endpointKey: "end" },
      radius: 10,
      intersectionIndex: 0
    };

    expect(getParameterDefinitions(arc)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "endpoint1", directKey: "1", label: "端点1", kind: "lineEndpointReference" }),
        expect.objectContaining({ key: "endpoint2", directKey: "2", label: "端点2", kind: "lineEndpointReference" }),
        expect.objectContaining({ key: "radius", directKey: "r", label: "半径", kind: "number" }),
        expect.objectContaining({ key: "intersectionIndex", directKey: "i", label: "番号", kind: "number" })
      ])
    );
  });

  it("defines editable parameters for split lines", () => {
    const line: CadElement = {
      id: "split",
      name: "分割線",
      type: "splitLine",
      visible: true,
      enabled: true,
      baseLineId: "line-a",
      splitPoint: { mode: "reference", pointId: "point-a" }
    };

    expect(getParameterDefinitions(line)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "baseLineId", directKey: "b", label: "基準線", kind: "lineReference" }),
        expect.objectContaining({ key: "splitPoint", directKey: "p", label: "点", kind: "reference", allowCoordinate: false })
      ])
    );
  });

  it("marks which point reference parameters can use coordinate mode", () => {
    const line: CadElement = {
      id: "line",
      name: "線",
      type: "line",
      visible: true,
      enabled: true,
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" }
    };
    const offsetPoint: CadElement = {
      id: "offset",
      name: "オフセット点",
      type: "offsetPoint",
      visible: true,
      enabled: true,
      fromPointId: "point-a",
      dx: 10,
      dy: 20
    };

    expect(getParameterDefinitions(line)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "startPoint", kind: "reference", allowCoordinate: true }),
        expect.objectContaining({ key: "endPoint", kind: "reference", allowCoordinate: true })
      ])
    );
    expect(getParameterDefinitions(offsetPoint)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "fromPoint", kind: "reference", allowCoordinate: false })
      ])
    );
  });
});
