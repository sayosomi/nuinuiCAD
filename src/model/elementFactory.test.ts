import { describe, expect, it } from "vitest";
import { sampleElements } from "../sampleData";
import type { CadElementType } from "../types/geometry";
import { createCadElement } from "./elementFactory";

const createTestId = (type: CadElementType) => `${type}-test-id`;

describe("createCadElement", () => {
  it("creates group-like elements collapsed by default", () => {
    expect(createCadElement("group", sampleElements, { createId: createTestId })).toMatchObject({
      id: "group-test-id",
      type: "group",
      expanded: false
    });
    expect(createCadElement("conditionalGroup", sampleElements, { createId: createTestId })).toMatchObject({
      id: "conditionalGroup-test-id",
      type: "conditionalGroup",
      expanded: false,
      elseExpanded: true
    });
    expect(createCadElement("forGroup", sampleElements, { createId: createTestId })).toMatchObject({
      id: "forGroup-test-id",
      type: "forGroup",
      expanded: false
    });
  });

  it("creates a free point at the origin by default", () => {
    expect(createCadElement("freePoint", sampleElements, { createId: createTestId })).toMatchObject({
      id: "freePoint-test-id",
      name: "点4",
      type: "freePoint",
      visible: true,
      enabled: true,
      x: 0,
      y: 0
    });
  });

  it("creates offset points using the first point as the default base", () => {
    expect(createCadElement("offsetPoint", sampleElements, { createId: createTestId })).toMatchObject({
      id: "offsetPoint-test-id",
      name: "オフセット点4",
      type: "offsetPoint",
      visible: true,
      enabled: true,
      fromPoint: { mode: "reference", pointId: "point-a" },
      fromPointId: "point-a",
      dx: 0,
      dy: 0
    });
  });

  it("creates polar offset points using the first point as the default base", () => {
    expect(createCadElement("polarOffsetPoint", sampleElements, { createId: createTestId })).toMatchObject({
      id: "polarOffsetPoint-test-id",
      name: "角度距離点4",
      type: "polarOffsetPoint",
      visible: true,
      enabled: true,
      fromPoint: { mode: "reference", pointId: "point-a" },
      fromPointId: "point-a",
      angleDeg: 0,
      distance: 0
    });
  });

  it("creates variables with numeric variable support enabled", () => {
    expect(createCadElement("variable", sampleElements, { createId: createTestId })).toMatchObject({
      id: "variable-test-id",
      name: "変数1",
      type: "variable",
      visible: true,
      enabled: true,
      numericVariables: [],
      scope: "global",
      valueMode: "expression",
      expression: 0
    });
  });

  it("creates text elements without a default anchor", () => {
    expect(createCadElement("text", sampleElements, { createId: createTestId })).toMatchObject({
      id: "text-test-id",
      name: "テキスト1",
      type: "text",
      visible: true,
      enabled: true,
      numericVariables: [],
      text: "テキスト",
      anchor: null,
      fontSize: 3
    });
  });

  it("creates division points using the first two points as default endpoints", () => {
    expect(createCadElement("divisionPoint", sampleElements, { createId: createTestId })).toMatchObject({
      id: "divisionPoint-test-id",
      name: "分点4",
      type: "divisionPoint",
      visible: true,
      enabled: true,
      numericVariables: [],
      numericParameterSteps: { ratio: 0.01 },
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" },
      placementMode: "ratio",
      distance: 0,
      ratio: 0.5
    });
  });

  it("creates line division points using the first line endpoint as the default endpoint", () => {
    expect(createCadElement("lineDivisionPoint", sampleElements, { createId: createTestId })).toMatchObject({
      id: "lineDivisionPoint-test-id",
      name: "線上分点4",
      type: "lineDivisionPoint",
      visible: true,
      enabled: true,
      numericVariables: [],
      numericParameterSteps: { ratio: 0.01 },
      endpoint: { lineId: "line-ab", endpointKey: "start" },
      placementMode: "ratio",
      distance: 0,
      ratio: 0.5
    });
  });

  it("creates intersection points using the first two lines as defaults", () => {
    expect(createCadElement("intersectionPoint", sampleElements, { createId: createTestId })).toMatchObject({
      id: "intersectionPoint-test-id",
      name: "交点1",
      type: "intersectionPoint",
      visible: true,
      enabled: true,
      numericVariables: [],
      line1Id: "line-ab",
      line2Id: "line-bc",
      intersectionIndex: 0,
      useExtensions: false
    });
  });

  it("creates line tangent offset points using the first line start as the default base", () => {
    expect(createCadElement("lineTangentOffsetPoint", sampleElements, { createId: createTestId })).toMatchObject({
      id: "lineTangentOffsetPoint-test-id",
      name: "線上オフセット点1",
      type: "lineTangentOffsetPoint",
      visible: true,
      enabled: true,
      numericVariables: [],
      baseLineId: "line-ab",
      basePoint: { mode: "derived", elementId: "line-ab", pointKey: "start" },
      tangentAngleDeg: 0,
      distance: 0
    });
  });

  it("creates lines using the first two points as default endpoints", () => {
    expect(createCadElement("line", sampleElements, { createId: createTestId })).toMatchObject({
      id: "line-test-id",
      name: "直線3",
      type: "line",
      visible: true,
      enabled: true,
      numericVariables: [],
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" }
    });
  });

  it("creates angle length lines using the first point as the default start", () => {
    expect(createCadElement("angleLengthLine", sampleElements, { createId: createTestId })).toMatchObject({
      id: "angleLengthLine-test-id",
      name: "角度距離線1",
      type: "angleLengthLine",
      visible: true,
      enabled: true,
      numericVariables: [],
      startPoint: { mode: "reference", pointId: "point-a" },
      angleDeg: 0,
      length: 100
    });
  });

  it("creates arc lines with the existing radius and angle defaults", () => {
    expect(createCadElement("arcLine", sampleElements, { createId: createTestId })).toMatchObject({
      id: "arcLine-test-id",
      name: "円弧線1",
      type: "arcLine",
      visible: true,
      enabled: true,
      numericVariables: [],
      centerPoint: { mode: "reference", pointId: "point-a" },
      radius: 30,
      startAngleDeg: 0,
      endAngleDeg: 90
    });
  });

  it("creates three-point arc lines using the first three points as default circle points", () => {
    expect(createCadElement("threePointArcLine", sampleElements, { createId: createTestId })).toMatchObject({
      id: "threePointArcLine-test-id",
      name: "三点円弧線1",
      type: "threePointArcLine",
      visible: true,
      enabled: true,
      numericVariables: [],
      point1: { mode: "reference", pointId: "point-a" },
      point2: { mode: "reference", pointId: "point-b" },
      point3: { mode: "reference", pointId: "point-c" },
      startAngleDeg: 0,
      endAngleDeg: 90
    });
  });

  it("creates corner radius arc lines using the first two line endpoints as defaults", () => {
    expect(createCadElement("cornerRadiusArcLine", sampleElements, { createId: createTestId })).toMatchObject({
      id: "cornerRadiusArcLine-test-id",
      name: "角R円弧線1",
      type: "cornerRadiusArcLine",
      visible: true,
      enabled: true,
      numericVariables: [],
      endpoint1: { lineId: "line-ab", endpointKey: "start" },
      endpoint2: { lineId: "line-bc", endpointKey: "start" },
      radius: 10,
      intersectionIndex: 0
    });
  });

  it("creates edge modifications using the first two line endpoints as defaults", () => {
    expect(createCadElement("edge", sampleElements, { createId: createTestId })).toMatchObject({
      id: "edge-test-id",
      name: "エッジ1",
      type: "edge",
      visible: true,
      enabled: true,
      numericVariables: [],
      endpoint1: { lineId: "line-ab", endpointKey: "start" },
      endpoint2: { lineId: "line-bc", endpointKey: "start" },
      intersectionIndex: 0
    });
  });

  it("creates extend trim modifications using the first line endpoint and first point as defaults", () => {
    expect(createCadElement("extendTrim", sampleElements, { createId: createTestId })).toMatchObject({
      id: "extendTrim-test-id",
      name: "延長短縮1",
      type: "extendTrim",
      visible: true,
      enabled: true,
      numericVariables: [],
      endpoint: { lineId: "line-ab", endpointKey: "start" },
      point: { mode: "reference", pointId: "point-a" }
    });
  });

  it("creates Bezier curves using the first two points as default endpoints", () => {
    expect(createCadElement("bezierCurve", sampleElements, { createId: createTestId })).toMatchObject({
      id: "bezierCurve-test-id",
      name: "曲線2",
      type: "bezierCurve",
      visible: true,
      enabled: true,
      numericVariables: [],
      startPoint: { mode: "reference", pointId: "point-a" },
      startHandleAngleDeg: 0,
      startHandleLength: 30,
      intermediatePoints: [],
      endPoint: { mode: "reference", pointId: "point-b" },
      endHandleAngleDeg: 0,
      endHandleLength: 30
    });
  });

  it("creates split lines using the first line and first point as defaults", () => {
    expect(createCadElement("splitLine", sampleElements, { createId: createTestId })).toMatchObject({
      id: "splitLine-test-id",
      name: "分割線1",
      type: "splitLine",
      visible: true,
      enabled: true,
      numericVariables: [],
      baseLineId: "line-ab",
      splitPoint: { mode: "reference", pointId: "point-a" }
    });
  });

  it("creates copy lines using the first two points and first line as defaults", () => {
    expect(createCadElement("copyLine", sampleElements, { createId: createTestId })).toMatchObject({
      id: "copyLine-test-id",
      name: "コピー線1",
      type: "copyLine",
      visible: true,
      enabled: true,
      numericVariables: [],
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" },
      scale: 1,
      angleDeg: 0,
      mirrorX: false,
      baseLineIds: ["line-ab"]
    });
  });

  it("creates move modifications using the first two points and first line as defaults", () => {
    expect(createCadElement("move", sampleElements, { createId: createTestId })).toMatchObject({
      id: "move-test-id",
      name: "移動1",
      type: "move",
      visible: true,
      enabled: true,
      numericVariables: [],
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" },
      scale: 1,
      angleDeg: 0,
      mirrorX: false,
      baseLineIds: ["line-ab"]
    });
  });

  it("creates symmetric copy lines using the first two points and first line as defaults", () => {
    expect(createCadElement("symmetricCopyLine", sampleElements, { createId: createTestId })).toMatchObject({
      id: "symmetricCopyLine-test-id",
      name: "対称コピー線1",
      type: "symmetricCopyLine",
      visible: true,
      enabled: true,
      numericVariables: [],
      axisPoint1: { mode: "reference", pointId: "point-a" },
      axisPoint2: { mode: "reference", pointId: "point-b" },
      baseLineIds: ["line-ab"]
    });
  });

  it("creates symmetric move modifications using the first two points and first line as defaults", () => {
    expect(createCadElement("symmetricMove", sampleElements, { createId: createTestId })).toMatchObject({
      id: "symmetricMove-test-id",
      name: "対称移動1",
      type: "symmetricMove",
      visible: true,
      enabled: true,
      numericVariables: [],
      axisPoint1: { mode: "reference", pointId: "point-a" },
      axisPoint2: { mode: "reference", pointId: "point-b" },
      baseLineIds: ["line-ab"]
    });
  });

  it("keeps names unique when the requested default name already exists", () => {
    const existing = [
      ...sampleElements,
      {
        id: "existing",
        name: "直線3",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "point-a" },
        endPoint: { mode: "reference", pointId: "point-b" }
      }
    ] satisfies Parameters<typeof createCadElement>[1];

    expect(createCadElement("line", existing, { createId: createTestId }).name).not.toBe("直線3");
  });

  it("keeps the existing empty-reference fallback when no points exist", () => {
    expect(createCadElement("line", [], { createId: createTestId })).toMatchObject({
      startPoint: { mode: "reference", pointId: "" },
      endPoint: { mode: "reference", pointId: "" }
    });
  });
});
