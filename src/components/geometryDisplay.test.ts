import { describe, expect, it } from "vitest";
import type {
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedLine,
  ComputedOffsetLine,
  ComputedPoint
} from "../types/geometry";
import {
  arcLineInfoRows,
  bezierCurveInfoRows,
  formatAngleDeg,
  formatCoordinate,
  formatMillimeters,
  formatNumber,
  lineInfoRows,
  numericReferenceExpression,
  numericReferenceLabel,
  numericReferenceProperties,
  numericReferenceValue,
  offsetLineInfoRows,
  pointCoordinateRows
} from "./geometryDisplay";

const point = (id: string, x: number, y: number): ComputedPoint => ({
  kind: "point",
  elementId: id,
  name: id,
  x,
  y
});

const line: ComputedLine = {
  kind: "line",
  elementId: "line-ab",
  name: "直線AB",
  startPointId: "point-a",
  endPointId: "point-b",
  start: point("point-a", 0, 0),
  end: point("point-b", 30, 40),
  length: 50,
  startAngleDeg: 53.13010235415598,
  endAngleDeg: 233.13010235415598,
  startTangentAngleDeg: 53.13010235415598,
  endTangentAngleDeg: 233.13010235415598
};

const arc: ComputedArcLine = {
  kind: "arcLine",
  elementId: "arc",
  name: "円弧",
  centerPointId: "point-a",
  center: point("point-a", 0, 0),
  start: point("arc:start", 30, 0),
  end: point("arc:end", 0, -30),
  radius: 30,
  startAngleDeg: 0,
  endAngleDeg: 90,
  startTangentAngleDeg: 90,
  endTangentAngleDeg: 0,
  sweepAngleDeg: 90,
  length: Math.PI * 15
};

const curve: ComputedBezierCurve = {
  kind: "bezierCurve",
  elementId: "curve",
  name: "曲線",
  startPointId: "point-a",
  endPointId: "point-b",
  intermediatePointIds: [],
  segments: [
    {
      startPointId: "point-a",
      endPointId: "point-b",
      start: point("point-a", 0, 0),
      control1: { x: 10, y: 0 },
      control2: { x: 20, y: 40 },
      end: point("point-b", 30, 40)
    }
  ],
  length: 52.345,
  startTangentAngleDeg: 0,
  endTangentAngleDeg: 0,
  startHandleAngleDeg: 0,
  startHandleLength: 10,
  endHandleAngleDeg: 180,
  endHandleLength: 10
};

const offsetLine: ComputedOffsetLine = {
  kind: "offsetLine",
  elementId: "offset",
  name: "オフセット線",
  baseLineIds: ["line-ab"],
  start: point("offset:start", 0, 10),
  end: point("offset:end", 30, 50),
  segments: [
    {
      kind: "line",
      start: point("offset:start", 0, 10),
      end: point("offset:end", 30, 50),
      length: 50
    }
  ],
  closed: false,
  length: 50,
  startTangentAngleDeg: 53.13010235415598,
  endTangentAngleDeg: 233.13010235415598
};

describe("geometryDisplay", () => {
  it("formats numbers, millimeters, coordinates, and angles", () => {
    expect(formatNumber(12)).toBe("12");
    expect(formatNumber(12.345)).toBe("12.35");
    expect(formatNumber(12.3)).toBe("12.3");
    expect(formatMillimeters(12.345)).toBe("12.35 mm");
    expect(formatCoordinate(point("p", 12.345, 67.8))).toBe("(12.35, 67.8)");
    expect(formatAngleDeg(null)).toBe("未定義");
    expect(formatAngleDeg(-15)).toBe("345°");
    expect(formatAngleDeg(370.25)).toBe("10.25°");
  });

  it("returns numeric reference properties and expressions", () => {
    expect(numericReferenceProperties(line)).toEqual([
      "length",
      "startTangentAngleDeg",
      "endTangentAngleDeg"
    ]);
    expect(numericReferenceProperties(arc)).toEqual([
      "length",
      "startAngleDeg",
      "endAngleDeg",
      "startTangentAngleDeg",
      "endTangentAngleDeg"
    ]);
    expect(numericReferenceProperties(curve)).toEqual([
      "length",
      "startTangentAngleDeg",
      "endTangentAngleDeg"
    ]);
    expect(numericReferenceExpression(line, "length")).toBe("line-ab.length");
  });

  it("formats numeric reference values", () => {
    expect(numericReferenceValue(line, "length")).toBe("50 mm");
    expect(numericReferenceValue(line, "startAngleDeg")).toBe("53.13°");
    expect(numericReferenceValue(line, "endAngleDeg")).toBe("233.13°");
    expect(numericReferenceValue(line, "startTangentAngleDeg")).toBe("53.13°");
    expect(numericReferenceValue(arc, "startTangentAngleDeg")).toBe("90°");
    expect(numericReferenceValue(curve, "length")).toBe("52.34 mm");
    expect(numericReferenceValue(curve, "startTangentAngleDeg")).toBe("0°");
    expect(numericReferenceValue(curve, "startHandleAngleDeg")).toBe("0°");
    expect(numericReferenceValue(curve, "startHandleLength")).toBe("10 mm");
    expect(numericReferenceValue(curve, "endHandleAngleDeg")).toBe("180°");
    expect(numericReferenceValue(curve, "endHandleLength")).toBe("10 mm");
  });

  it("labels Bezier handle numeric references", () => {
    expect(numericReferenceLabel(curve, "startHandleAngleDeg")).toBe("始点角度");
    expect(numericReferenceLabel(curve, "startHandleLength")).toBe("始点ハンドル長");
    expect(numericReferenceLabel(curve, "endHandleAngleDeg")).toBe("終点角度");
    expect(numericReferenceLabel(curve, "endHandleLength")).toBe("終点ハンドル長");
  });

  it("builds geometry info rows", () => {
    expect(pointCoordinateRows(point("p", 1, 2))).toEqual([{ label: "座標", value: "(1, 2)" }]);
    expect(lineInfoRows(line)).toEqual([
      { label: "始点", value: "(0, 0)" },
      { label: "終点", value: "(30, 40)" },
      { label: "始接線角度", value: "53.13°" },
      { label: "終接線角度", value: "233.13°" },
      { label: "長さ", value: "50 mm" }
    ]);
    expect(arcLineInfoRows(arc)).toEqual([
      { label: "中心点", value: "(0, 0)" },
      { label: "始点", value: "(30, 0)" },
      { label: "終点", value: "(0, -30)" },
      { label: "半径", value: "30 mm" },
      { label: "始トリム角度", value: "0°" },
      { label: "終トリム角度", value: "90°" },
      { label: "始接線角度", value: "90°" },
      { label: "終接線角度", value: "0°" },
      { label: "長さ", value: "47.12 mm" }
    ]);
    expect(bezierCurveInfoRows(curve)).toEqual([
      { label: "始点", value: "(0, 0)" },
      { label: "終点", value: "(30, 40)" },
      { label: "始接線角度", value: "0°" },
      { label: "終接線角度", value: "0°" },
      { label: "長さ", value: "52.34 mm" }
    ]);
    expect(offsetLineInfoRows(offsetLine)).toEqual([
      { label: "始点", value: "(0, 10)" },
      { label: "終点", value: "(30, 50)" },
      { label: "始接線角度", value: "53.13°" },
      { label: "終接線角度", value: "233.13°" },
      { label: "長さ", value: "50 mm" }
    ]);
    expect(offsetLineInfoRows({ ...offsetLine, closed: true })).toEqual([
      { label: "始点", value: "(0, 10)" },
      { label: "終点", value: "(30, 50)" },
      { label: "始接線角度", value: "53.13°" },
      { label: "終接線角度", value: "233.13°" },
      { label: "長さ", value: "50 mm" },
      { label: "閉じる", value: "はい" }
    ]);
  });
});
