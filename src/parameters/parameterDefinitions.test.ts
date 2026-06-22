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
});
