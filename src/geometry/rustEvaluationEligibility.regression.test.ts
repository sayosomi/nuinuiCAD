import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import { canUseRustEvaluationForElements } from "./rustEvaluationEligibility";

const pointA: CadElement = {
  id: "a",
  name: "A",
  type: "freePoint",
  activity: "visible",
  x: 0,
  y: 0
};

const pointB: CadElement = {
  id: "b",
  name: "B",
  type: "freePoint",
  activity: "visible",
  x: 100,
  y: 0
};

const line: CadElement = {
  id: "line",
  name: "線",
  type: "line",
  activity: "visible",
  startPoint: { mode: "reference", pointId: "a" },
  endPoint: { mode: "reference", pointId: "b" }
};

const angleLengthLine: CadElement = {
  id: "angle-line",
  name: "角度距離線",
  type: "angleLengthLine",
  activity: "visible",
  startPoint: { mode: "reference", pointId: "a" },
  angleDeg: 0,
  length: 100
};

const arcLine: CadElement = {
  id: "arc",
  name: "円弧",
  type: "arcLine",
  activity: "visible",
  centerPoint: { mode: "reference", pointId: "a" },
  radius: 10,
  startAngleDeg: 0,
  endAngleDeg: 90
};

const threePointArcLine: CadElement = {
  id: "three-point-arc",
  name: "三点円弧",
  type: "threePointArcLine",
  activity: "visible",
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
  activity: "visible",
  startPoint: { mode: "reference", pointId: "a" },
  startHandleAngleDeg: 0,
  startHandleLength: 0,
  intermediatePoints: [],
  endPoint: { mode: "reference", pointId: "b" },
  endHandleAngleDeg: 180,
  endHandleLength: 0
};

const bezierExtremePoint: CadElement = {
  id: "extreme",
  name: "方向極値点",
  type: "bezierExtremePoint",
  activity: "visible",
  baseLineId: "curve",
  segmentIndex: 0,
  directionDeg: 90
};

const bezierBulgePoint: CadElement = {
  id: "bulge",
  name: "最大膨らみ点",
  type: "bezierBulgePoint",
  activity: "visible",
  baseLineId: "curve",
  segmentIndex: 0
};

const offsetLine: CadElement = {
  id: "offset",
  name: "オフセット",
  type: "offsetLine",
  activity: "visible",
  baseLineIds: ["line"],
  offset: 10,
  side: "right",
  closed: false
};

const splitLine: CadElement = {
  id: "split",
  name: "分割線",
  type: "splitLine",
  activity: "visible",
  baseLineId: "line",
  splitPoint: { mode: "reference", pointId: "a" }
};

const lineDivisionPoint = (lineId: string): CadElement => ({
  id: `division-${lineId}`,
  name: "線上分点",
  type: "lineDivisionPoint",
  activity: "visible",
  endpoint: { lineId, endpointKey: "start" },
  placement: { kind: "ratio", value: 0.5 }
});

const lineTangentOffsetPoint = (lineId: string): CadElement => ({
  id: `tangent-offset-${lineId}`,
  name: "線上オフセット点",
  type: "lineTangentOffsetPoint",
  activity: "visible",
  baseLineId: lineId,
  basePoint: { mode: "reference", pointId: "a" },
  tangentAngleDeg: 90,
  distance: 10
});

const intersectionPoint = (line1Id: string, line2Id: string): CadElement => ({
  id: `intersection-${line1Id}-${line2Id}`,
  name: "交点",
  type: "intersectionPoint",
  activity: "visible",
  line1Id,
  line2Id,
  intersectionIndex: 0,
  useExtensions: false
});

const edge = (line1Id: string, line2Id: string): CadElement => ({
  id: `edge-${line1Id}-${line2Id}`,
  name: "エッジ",
  type: "edge",
  activity: "visible",
  endpoint1: { lineId: line1Id, endpointKey: "end" },
  endpoint2: { lineId: line2Id, endpointKey: "start" },
  intersectionIndex: 0
});

const extendTrim = (lineId: string): CadElement => ({
  id: `extend-${lineId}`,
  name: "延長短縮",
  type: "extendTrim",
  activity: "visible",
  endpoint: { lineId, endpointKey: "end" },
  point: { mode: "reference", pointId: "a" }
});

const cornerRadiusArcLine = (line1Id: string, line2Id: string): CadElement => ({
  id: `corner-${line1Id}-${line2Id}`,
  name: "角R",
  type: "cornerRadiusArcLine",
  activity: "visible",
  endpoint1: { lineId: line1Id, endpointKey: "end" },
  endpoint2: { lineId: line2Id, endpointKey: "start" },
  radius: 10,
  intersectionIndex: 0
});

const copyLine = (baseLineIds: string[]): CadElement => ({
  id: `copy-${baseLineIds.join("-")}`,
  name: "コピー",
  type: "copyLine",
  activity: "visible",
  startPoint: { mode: "reference", pointId: "a" },
  endPoint: { mode: "reference", pointId: "b" },
  scale: 1,
  angleDeg: 0,
  mirrorX: false,
  baseLineIds
});

const symmetricCopyLine = (baseLineIds: string[]): CadElement => ({
  id: `symmetric-copy-${baseLineIds.join("-")}`,
  name: "対称コピー",
  type: "symmetricCopyLine",
  activity: "visible",
  axisPoint1: { mode: "reference", pointId: "a" },
  axisPoint2: { mode: "reference", pointId: "b" },
  baseLineIds
});

const move = (baseLineIds: string[]): CadElement => ({
  id: `move-${baseLineIds.join("-")}`,
  name: "移動",
  type: "move",
  activity: "visible",
  startPoint: { mode: "reference", pointId: "a" },
  endPoint: { mode: "reference", pointId: "b" },
  scale: 1,
  angleDeg: 0,
  mirrorX: false,
  baseLineIds
});

const symmetricMove = (baseLineIds: string[]): CadElement => ({
  id: `symmetric-move-${baseLineIds.join("-")}`,
  name: "対称移動",
  type: "symmetricMove",
  activity: "visible",
  axisPoint1: { mode: "reference", pointId: "a" },
  axisPoint2: { mode: "reference", pointId: "b" },
  baseLineIds
});

describe("Rust evaluation eligibility regression coverage", () => {
  it("supports angle-length lines and downstream line references", () => {
    expect(canUseRustEvaluationForElements([pointA, angleLengthLine])).toBe(true);
    expect(
      canUseRustEvaluationForElements([pointA, angleLengthLine, lineDivisionPoint("angle-line")])
    ).toBe(true);
  });

  it("supports tangent-offset points only when their line source exists", () => {
    expect(
      canUseRustEvaluationForElements([pointA, pointB, line, lineTangentOffsetPoint("line")])
    ).toBe(true);
    expect(canUseRustEvaluationForElements([pointA, arcLine, lineTangentOffsetPoint("arc")])).toBe(true);
    expect(canUseRustEvaluationForElements([pointA, lineTangentOffsetPoint("missing")])).toBe(false);
  });

  it("supports intersections only when both line sources exist", () => {
    expect(
      canUseRustEvaluationForElements([pointA, pointB, line, arcLine, intersectionPoint("line", "arc")])
    ).toBe(true);
    expect(
      canUseRustEvaluationForElements([pointA, pointB, line, intersectionPoint("line", "missing")])
    ).toBe(false);
  });

  it("supports three-point arcs as downstream line sources", () => {
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

  it("supports Bezier extreme and bulge points when their source exists", () => {
    expect(canUseRustEvaluationForElements([pointA, pointB, bezierCurve, bezierExtremePoint])).toBe(true);
    expect(canUseRustEvaluationForElements([pointA, pointB, bezierCurve, bezierBulgePoint])).toBe(true);
    expect(canUseRustEvaluationForElements([{ ...bezierExtremePoint, baseLineId: "missing" }])).toBe(false);
    expect(canUseRustEvaluationForElements([{ ...bezierBulgePoint, baseLineId: "missing" }])).toBe(false);
  });

  it("allows a Bezier bulge point to feed a downstream point reference", () => {
    const downstream: CadElement = {
      ...line,
      id: "downstream",
      startPoint: { mode: "reference", pointId: "bulge" }
    };
    expect(
      canUseRustEvaluationForElements([pointA, pointB, bezierCurve, bezierBulgePoint, downstream])
    ).toBe(true);
  });

  it("supports offset lines as downstream line sources", () => {
    expect(
      canUseRustEvaluationForElements([
        pointA,
        pointB,
        line,
        offsetLine,
        lineDivisionPoint("offset"),
        lineTangentOffsetPoint("offset"),
        intersectionPoint("line", "offset")
      ])
    ).toBe(true);
  });

  it("supports split lines as downstream line sources", () => {
    expect(
      canUseRustEvaluationForElements([
        pointA,
        pointB,
        line,
        splitLine,
        lineDivisionPoint("split"),
        lineTangentOffsetPoint("split"),
        intersectionPoint("line", "split"),
        { ...offsetLine, baseLineIds: ["split"] }
      ])
    ).toBe(true);
  });

  it("supports edge and extend-trim only with valid line references", () => {
    expect(
      canUseRustEvaluationForElements([pointA, pointB, line, arcLine, edge("line", "arc")])
    ).toBe(true);
    expect(canUseRustEvaluationForElements([pointA, pointB, line, extendTrim("line")])).toBe(true);
    expect(
      canUseRustEvaluationForElements([pointA, pointB, line, edge("line", "missing")])
    ).toBe(false);
    expect(canUseRustEvaluationForElements([pointA, extendTrim("missing")])).toBe(false);
  });

  it("supports corner-radius arcs and downstream references only with valid sources", () => {
    expect(
      canUseRustEvaluationForElements([
        pointA,
        pointB,
        line,
        arcLine,
        cornerRadiusArcLine("line", "arc"),
        lineDivisionPoint("corner-line-arc"),
        intersectionPoint("line", "corner-line-arc")
      ])
    ).toBe(true);
    expect(
      canUseRustEvaluationForElements([pointA, pointB, line, cornerRadiusArcLine("line", "missing")])
    ).toBe(false);
  });

  it("supports copy and move families only when every base line exists", () => {
    expect(
      canUseRustEvaluationForElements([
        pointA,
        pointB,
        line,
        arcLine,
        bezierCurve,
        offsetLine,
        splitLine,
        copyLine(["line", "arc", "curve", "offset", "split"]),
        symmetricCopyLine(["line", "curve"]),
        move(["line", "offset"]),
        symmetricMove(["arc", "split"])
      ])
    ).toBe(true);
    expect(canUseRustEvaluationForElements([pointA, pointB, copyLine(["missing"])])).toBe(false);
    expect(canUseRustEvaluationForElements([pointA, pointB, symmetricCopyLine(["missing"])])).toBe(false);
    expect(canUseRustEvaluationForElements([pointA, pointB, move(["missing"])])).toBe(false);
    expect(canUseRustEvaluationForElements([pointA, pointB, symmetricMove(["missing"])])).toBe(false);
  });
});
