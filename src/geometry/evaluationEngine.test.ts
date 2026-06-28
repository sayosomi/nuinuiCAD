import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import { canUseRustEvaluationForElements } from "./evaluationEngine";

const pointA: CadElement = {
  id: "a",
  name: "A",
  type: "freePoint",
  visible: true,
  enabled: true,
  x: 0,
  y: 0
};

const pointB: CadElement = {
  id: "b",
  name: "B",
  type: "freePoint",
  visible: true,
  enabled: true,
  x: 100,
  y: 0
};

const line: CadElement = {
  id: "line",
  name: "線",
  type: "line",
  visible: true,
  enabled: true,
  startPoint: { mode: "reference", pointId: "a" },
  endPoint: { mode: "reference", pointId: "b" }
};

const arcLine: CadElement = {
  id: "arc",
  name: "円弧",
  type: "arcLine",
  visible: true,
  enabled: true,
  centerPoint: { mode: "reference", pointId: "a" },
  radius: 10,
  startAngleDeg: 0,
  endAngleDeg: 90
};

const threePointArcLine: CadElement = {
  id: "three-point-arc",
  name: "三点円弧",
  type: "threePointArcLine",
  visible: true,
  enabled: true,
  point1: { mode: "reference", pointId: "a" },
  point2: { mode: "coordinate", x: 0, y: -10 },
  point3: { mode: "coordinate", x: -10, y: 0 },
  startAngleDeg: 0,
  endAngleDeg: 90
};

const bezierCurve: CadElement = {
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
};

const offsetLine: CadElement = {
  id: "offset",
  name: "オフセット",
  type: "offsetLine",
  visible: true,
  enabled: true,
  baseLineIds: ["line"],
  offset: 10,
  side: "right",
  closed: false
};

const lineDivisionPoint = (lineId: string): CadElement => ({
  id: `division-${lineId}`,
  name: "線上分点",
  type: "lineDivisionPoint",
  visible: true,
  enabled: true,
  endpoint: { lineId, endpointKey: "start" },
  placementMode: "ratio",
  distance: 0,
  ratio: 0.5
});

const lineTangentOffsetPoint = (lineId: string): CadElement => ({
  id: `tangent-offset-${lineId}`,
  name: "線上オフセット点",
  type: "lineTangentOffsetPoint",
  visible: true,
  enabled: true,
  baseLineId: lineId,
  basePoint: { mode: "reference", pointId: "a" },
  tangentAngleDeg: 90,
  distance: 10
});

const intersectionPoint = (line1Id: string, line2Id: string): CadElement => ({
  id: `intersection-${line1Id}-${line2Id}`,
  name: "交点",
  type: "intersectionPoint",
  visible: true,
  enabled: true,
  line1Id,
  line2Id,
  intersectionIndex: 0,
  useExtensions: false
});

describe("canUseRustEvaluationForElements", () => {
  it("allows lineDivisionPoint when it references a supported line type", () => {
    expect(canUseRustEvaluationForElements([pointA, pointB, line, lineDivisionPoint("line")])).toBe(
      true
    );
    expect(canUseRustEvaluationForElements([pointA, arcLine, lineDivisionPoint("arc")])).toBe(
      true
    );
  });

  it("keeps lineDivisionPoint on the TypeScript path for unsupported or missing line references", () => {
    expect(
      canUseRustEvaluationForElements([pointA, lineDivisionPoint("offset"), pointB, offsetLine], {
        evaluationLimitIndex: 2
      })
    ).toBe(false);
    expect(canUseRustEvaluationForElements([pointA, lineDivisionPoint("missing")])).toBe(false);
  });

  it("allows lineTangentOffsetPoint when it references a supported line type", () => {
    expect(
      canUseRustEvaluationForElements([pointA, pointB, line, lineTangentOffsetPoint("line")])
    ).toBe(true);
    expect(canUseRustEvaluationForElements([pointA, arcLine, lineTangentOffsetPoint("arc")])).toBe(
      true
    );
  });

  it("keeps lineTangentOffsetPoint on the TypeScript path for unsupported or missing line references", () => {
    expect(
      canUseRustEvaluationForElements(
        [pointA, lineTangentOffsetPoint("offset"), pointB, offsetLine],
        { evaluationLimitIndex: 2 }
      )
    ).toBe(false);
    expect(canUseRustEvaluationForElements([pointA, lineTangentOffsetPoint("missing")])).toBe(
      false
    );
  });

  it("allows intersectionPoint when both references are supported line types", () => {
    expect(
      canUseRustEvaluationForElements([pointA, pointB, line, arcLine, intersectionPoint("line", "arc")])
    ).toBe(true);
  });

  it("keeps intersectionPoint on the TypeScript path for unsupported or missing line references", () => {
    expect(
      canUseRustEvaluationForElements(
        [pointA, pointB, line, offsetLine, intersectionPoint("line", "offset")],
        { evaluationLimitIndex: 5 }
      )
    ).toBe(false);
    expect(canUseRustEvaluationForElements([pointA, line, intersectionPoint("line", "missing")])).toBe(
      false
    );
  });

  it("allows threePointArcLine and supported point elements that reference it", () => {
    expect(canUseRustEvaluationForElements([pointA, threePointArcLine])).toBe(true);
    expect(
      canUseRustEvaluationForElements([
        pointA,
        pointB,
        line,
        threePointArcLine,
        lineDivisionPoint("three-point-arc"),
        lineTangentOffsetPoint("three-point-arc"),
        intersectionPoint("line", "three-point-arc")
      ])
    ).toBe(true);
  });

  it("allows bezierCurve and supported point elements that reference it", () => {
    expect(canUseRustEvaluationForElements([pointA, pointB, bezierCurve])).toBe(true);
    expect(
      canUseRustEvaluationForElements([
        pointA,
        pointB,
        line,
        bezierCurve,
        lineDivisionPoint("curve"),
        lineTangentOffsetPoint("curve"),
        intersectionPoint("line", "curve")
      ])
    ).toBe(true);
  });
});
