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
    });
    expect(createCadElement("conditionalGroup", sampleElements, { createId: createTestId })).toMatchObject({
      id: "conditionalGroup-test-id",
      type: "conditionalGroup",
    });
    expect(createCadElement("forGroup", sampleElements, { createId: createTestId })).toMatchObject({
      id: "forGroup-test-id",
      type: "forGroup",
    });
  });

  it("creates a free point at the origin by default", () => {
    expect(createCadElement("freePoint", sampleElements, { createId: createTestId })).toMatchObject({
      id: "freePoint-test-id",
      name: "点D",
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
      name: "点Aオフセット",
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
      name: "点A極座標",
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
      name: "分点AB",
      type: "divisionPoint",
      visible: true,
      enabled: true,
      numericVariables: [],
      numericParameterSteps: { ratio: 0.01 },
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" },
      placement: { kind: "ratio", value: 0.5 }
    });
  });

  it("creates line division points using the first line endpoint as the default endpoint", () => {
    expect(createCadElement("lineDivisionPoint", sampleElements, { createId: createTestId })).toMatchObject({
      id: "lineDivisionPoint-test-id",
      name: "AB分点",
      type: "lineDivisionPoint",
      visible: true,
      enabled: true,
      numericVariables: [],
      numericParameterSteps: { ratio: 0.01 },
      endpoint: { lineId: "line-ab", endpointKey: "start" },
      placement: { kind: "ratio", value: 0.5 }
    });
  });

  // 05: DivisionPlacement union. The desktop IPC payload (evaluationEngine.ts
  // passes `elements` straight through to Tauri's `invoke`, which JSON-serializes
  // it) must never carry the legacy flat placementMode/distance/ratio fields, and
  // the union shape must not be larger on the wire than the shape it replaced --
  // matching Task 05's own performance condition (payload size must not increase).
  it("keeps the desktop IPC payload free of legacy fields and no larger than the legacy shape", () => {
    const division = createCadElement("divisionPoint", sampleElements, { createId: createTestId });
    const lineDivision = createCadElement("lineDivisionPoint", sampleElements, { createId: createTestId });

    for (const element of [division, lineDivision]) {
      const parsed = JSON.parse(JSON.stringify(element));
      expect(parsed).toHaveProperty("placement");
      expect(parsed).not.toHaveProperty("placementMode");
      expect(parsed).not.toHaveProperty("distance");
      expect(parsed).not.toHaveProperty("ratio");
    }

    const legacyShapeOf = (element: unknown) => {
      const { placement, ...rest } = element as { placement: { kind: string; value: unknown } };
      return { ...rest, placementMode: placement.kind, distance: 0, ratio: placement.value };
    };

    for (const element of [division, lineDivision]) {
      const newSize = JSON.stringify(element).length;
      const legacySize = JSON.stringify(legacyShapeOf(element)).length;
      expect(newSize).toBeLessThanOrEqual(legacySize);
    }
  });

  it("creates intersection points using the first two lines as defaults", () => {
    expect(createCadElement("intersectionPoint", sampleElements, { createId: createTestId })).toMatchObject({
      id: "intersectionPoint-test-id",
      name: "交点AB_BC",
      type: "intersectionPoint",
      visible: true,
      enabled: true,
      numericVariables: [],
      line1Id: "line-ab",
      line2Id: "line-bc",
      intersectionIndex: 0,
      useExtensions: true
    });
  });

  it("creates line tangent offset points using the first line start as the default base", () => {
    expect(createCadElement("lineTangentOffsetPoint", sampleElements, { createId: createTestId })).toMatchObject({
      id: "lineTangentOffsetPoint-test-id",
      name: "AB上オフセット点",
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
      name: "直線AB 2",
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
      name: "A方向線",
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
      name: "A円弧",
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
      name: "円弧AC",
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
      name: "AB_BC角R",
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
      name: "AB_BCエッジ",
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
      name: "AB延長短縮",
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
      name: "曲線AB",
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
      name: "AB分割",
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
      name: "ABコピー",
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
      name: "AB移動",
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
      name: "AB対称コピー",
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
      name: "AB対称移動",
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
        name: "直線AB 2",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "point-a" },
        endPoint: { mode: "reference", pointId: "point-b" }
      }
    ] satisfies Parameters<typeof createCadElement>[1];

    expect(createCadElement("line", existing, { createId: createTestId }).name).not.toBe("直線AB");
  });

  it("keeps the existing empty-reference fallback when no points exist", () => {
    expect(createCadElement("line", [], { createId: createTestId })).toMatchObject({
      startPoint: { mode: "reference", pointId: "" },
      endPoint: { mode: "reference", pointId: "" }
    });
  });
});
