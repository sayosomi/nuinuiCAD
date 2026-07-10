import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import { getParameterDefinitions } from "./parameterDefinitions";

describe("parameterDefinitions", () => {
  it("defines lock as a common editable boolean parameter", () => {
    expect(getParameterDefinitions({
      id: "point",
      name: "点",
      type: "freePoint",
      visible: true,
      enabled: true,
      x: 0,
      y: 0
    })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "locked", directKey: "l", label: "ロック", kind: "boolean" })
      ])
    );
  });

  it("defines empty Enter defaults for ratio-like and identity numeric parameters", () => {
    const conditionalGroup: CadElement = {
      id: "condition",
      name: "ifブロック",
      type: "conditionalGroup",
      visible: true,
      enabled: true,
      condition: 1,
    };
    const divisionPoint: CadElement = {
      id: "division",
      name: "分点",
      type: "divisionPoint",
      visible: true,
      enabled: true,
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" },
      placementMode: "ratio",
      distance: 10,
      ratio: 0.5
    };

    expect(getParameterDefinitions(conditionalGroup)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "condition",
          kind: "number",
          emptyInputDefaultValue: 1
        })
      ])
    );
    expect(getParameterDefinitions(divisionPoint)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "ratio",
          kind: "number",
          emptyInputDefaultValue: 1
        })
      ])
    );
  });

  it("defines editable parameters for for groups", () => {
    const group: CadElement = {
      id: "loop",
      name: "forブロック",
      type: "forGroup",
      visible: true,
      enabled: true,
      variableName: "i",
      start: 0,
      count: 3,
      step: 1,
      showGenerated: false
    };

    expect(getParameterDefinitions(group)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "variableName", directKey: "i", label: "変数名", kind: "text" }),
        expect.objectContaining({ key: "start", directKey: "s", label: "開始", kind: "number" }),
        expect.objectContaining({ key: "count", directKey: "c", label: "回数", kind: "number" }),
        expect.objectContaining({
          key: "step",
          directKey: "p",
          label: "ステップ",
          kind: "number",
          emptyInputDefaultValue: 1
        }),
        expect.objectContaining({ key: "showGenerated", directKey: "g", label: "生成結果を表示", kind: "boolean" })
      ])
    );
    expect(getParameterDefinitions(group).some((definition) => definition.key === "expanded")).toBe(false);
  });

  it("defines local numeric variable parameters for variable elements", () => {
    const variable: CadElement = {
      id: "variable",
      name: "変数",
      type: "variable",
      visible: true,
      enabled: true,
      numericVariables: [{ id: "local-width", name: "幅", value: 30 }],
      scope: "global",
      valueMode: "expression",
      expression: { kind: "expression", expression: "@local-width * 2" },
      point1: { mode: "reference", pointId: "point-a" },
      point2: { mode: "reference", pointId: "point-b" },
      point: { mode: "reference", pointId: "point-a" },
      lineId: "line-ab"
    };

    expect(getParameterDefinitions(variable)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "variable:local-width:value",
          directKey: "q",
          label: "変数 幅",
          kind: "number"
        }),
        expect.objectContaining({ key: "expression", directKey: "v", label: "式", kind: "number" })
      ])
    );
  });

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

  it("defines editable parameters for angle length lines", () => {
    const line: CadElement = {
      id: "angle-length-line",
      name: "角度距離線",
      type: "angleLengthLine",
      visible: true,
      enabled: true,
      startPoint: { mode: "reference", pointId: "point-a" },
      angleDeg: 0,
      length: 100
    };

    expect(getParameterDefinitions(line)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "startPoint", directKey: "s", label: "始点", kind: "reference" }),
        expect.objectContaining({ key: "angleDeg", directKey: "r", label: "角度", kind: "number" }),
        expect.objectContaining({ key: "length", directKey: "l", label: "長さ", kind: "number" })
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

  it("defines editable parameters for images", () => {
    const image: CadElement = {
      id: "image",
      name: "画像",
      type: "image",
      visible: true,
      enabled: true,
      sourcePath: "underlay.png",
      originPoint: { mode: "coordinate", x: 0, y: 0 },
      naturalWidthPx: 100,
      naturalHeightPx: 50,
      sourceDpi: 300,
      targetPixelsPerMm: 10,
      scale: 1,
      angleDeg: 0,
      mirrorX: false
    };

    expect(getParameterDefinitions(image)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "originPoint", directKey: "b", label: "基準点", kind: "reference", allowCoordinate: true }),
        expect.objectContaining({ key: "originPoint:x", directKey: "x", label: "基準点 x", kind: "number" }),
        expect.objectContaining({ key: "originPoint:y", directKey: "y", label: "基準点 y", kind: "number" }),
        expect.objectContaining({
          key: "scale",
          directKey: "s",
          label: "倍率",
          kind: "number",
          emptyInputDefaultValue: 1
        }),
        expect.objectContaining({ key: "angleDeg", directKey: "r", label: "角度", kind: "number" }),
        expect.objectContaining({ key: "mirrorX", directKey: "m", label: "左右反転", kind: "boolean" })
      ])
    );
  });

  it("defines editable parameters for edge modifications", () => {
    const edge: CadElement = {
      id: "edge",
      name: "エッジ",
      type: "edge",
      visible: true,
      enabled: true,
      endpoint1: { lineId: "line-a", endpointKey: "start" },
      endpoint2: { lineId: "line-b", endpointKey: "end" },
      intersectionIndex: 0
    };

    expect(getParameterDefinitions(edge)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "endpoint1", directKey: "1", label: "端点1", kind: "lineEndpointReference" }),
        expect.objectContaining({ key: "endpoint2", directKey: "2", label: "端点2", kind: "lineEndpointReference" }),
        expect.objectContaining({ key: "intersectionIndex", directKey: "i", label: "番号", kind: "number" })
      ])
    );
    expect(getParameterDefinitions(edge).some((definition) => definition.key === "colorId")).toBe(
      false
    );
  });

  it("defines editable parameters for extend trim modifications", () => {
    const extendTrim: CadElement = {
      id: "extend",
      name: "延長短縮",
      type: "extendTrim",
      visible: true,
      enabled: true,
      endpoint: { lineId: "line-a", endpointKey: "end" },
      point: { mode: "reference", pointId: "point-a" }
    };

    expect(getParameterDefinitions(extendTrim)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "endpoint", directKey: "e", label: "端点", kind: "lineEndpointReference" }),
        expect.objectContaining({ key: "point", directKey: "p", label: "点", kind: "reference", allowCoordinate: false })
      ])
    );
    expect(
      getParameterDefinitions(extendTrim).some((definition) => definition.key === "colorId")
    ).toBe(false);
  });

  it("defines editable parameters for copy lines", () => {
    const line: CadElement = {
      id: "copy",
      name: "コピー線",
      type: "copyLine",
      visible: true,
      enabled: true,
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" },
      scale: 1,
      angleDeg: 0,
      mirrorX: false,
      baseLineIds: ["line-a"]
    };

    expect(getParameterDefinitions(line)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "colorId", directKey: "k", label: "表示色", kind: "color" }),
        expect.objectContaining({ key: "startPoint", directKey: "s", label: "始点", kind: "reference", allowCoordinate: false }),
        expect.objectContaining({ key: "endPoint", directKey: "t", label: "終点", kind: "reference", allowCoordinate: false }),
        expect.objectContaining({ key: "scale", directKey: "s", label: "倍率", kind: "number" }),
        expect.objectContaining({ key: "angleDeg", directKey: "r", label: "角度", kind: "number" }),
        expect.objectContaining({ key: "mirrorX", directKey: "m", label: "左右反転", kind: "boolean" }),
        expect.objectContaining({ key: "baseLineIds", directKey: "b", label: "基準線", kind: "lineReferenceList" })
      ])
    );
  });

  it("defines editable parameters for move modifications", () => {
    const move: CadElement = {
      id: "move",
      name: "移動",
      type: "move",
      visible: true,
      enabled: true,
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" },
      scale: 1,
      angleDeg: 0,
      mirrorX: false,
      baseLineIds: ["line-a"]
    };

    expect(getParameterDefinitions(move)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "startPoint", directKey: "s", label: "始点", kind: "reference", allowCoordinate: false }),
        expect.objectContaining({ key: "endPoint", directKey: "t", label: "終点", kind: "reference", allowCoordinate: false }),
        expect.objectContaining({ key: "scale", directKey: "s", label: "倍率", kind: "number" }),
        expect.objectContaining({ key: "angleDeg", directKey: "r", label: "角度", kind: "number" }),
        expect.objectContaining({ key: "mirrorX", directKey: "m", label: "左右反転", kind: "boolean" }),
        expect.objectContaining({ key: "baseLineIds", directKey: "b", label: "対象線", kind: "lineReferenceList" })
      ])
    );
    expect(getParameterDefinitions(move).some((definition) => definition.key === "colorId")).toBe(
      false
    );
  });

  it("defines editable parameters for symmetric copy lines", () => {
    const line: CadElement = {
      id: "symmetric",
      name: "対称コピー線",
      type: "symmetricCopyLine",
      visible: true,
      enabled: true,
      axisPoint1: { mode: "reference", pointId: "point-a" },
      axisPoint2: { mode: "reference", pointId: "point-b" },
      baseLineIds: ["line-a"]
    };

    expect(getParameterDefinitions(line)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "colorId", directKey: "k", label: "表示色", kind: "color" }),
        expect.objectContaining({ key: "axisPoint1", directKey: "1", label: "対称点1", kind: "reference", allowCoordinate: false }),
        expect.objectContaining({ key: "axisPoint2", directKey: "2", label: "対称点2", kind: "reference", allowCoordinate: false }),
        expect.objectContaining({ key: "baseLineIds", directKey: "b", label: "基準線", kind: "lineReferenceList" })
      ])
    );
  });

  it("defines editable parameters for symmetric move modifications", () => {
    const move: CadElement = {
      id: "symmetric-move",
      name: "対称移動",
      type: "symmetricMove",
      visible: true,
      enabled: true,
      axisPoint1: { mode: "reference", pointId: "point-a" },
      axisPoint2: { mode: "reference", pointId: "point-b" },
      baseLineIds: ["line-a"]
    };

    expect(getParameterDefinitions(move)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "axisPoint1", directKey: "1", label: "対称点1", kind: "reference", allowCoordinate: false }),
        expect.objectContaining({ key: "axisPoint2", directKey: "2", label: "対称点2", kind: "reference", allowCoordinate: false }),
        expect.objectContaining({ key: "baseLineIds", directKey: "b", label: "対象線", kind: "lineReferenceList" })
      ])
    );
    expect(getParameterDefinitions(move).some((definition) => definition.key === "colorId")).toBe(
      false
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
