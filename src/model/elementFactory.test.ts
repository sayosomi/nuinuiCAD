import { describe, expect, it } from "vitest";
import { sampleElements } from "../sampleData";
import type { CadElementType } from "../types/geometry";
import { createCadElement } from "./elementFactory";

const createTestId = (type: CadElementType) => `${type}-test-id`;

describe("createCadElement", () => {
  it("creates a free point with the existing default position pattern", () => {
    expect(createCadElement("freePoint", sampleElements, { createId: createTestId })).toMatchObject({
      id: "freePoint-test-id",
      name: "点4",
      type: "freePoint",
      visible: true,
      enabled: true,
      x: 140,
      y: 140
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
      dx: 30,
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
      distance: 30
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
      distance: 30,
      ratio: 0.5
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
