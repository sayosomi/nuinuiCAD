import { describe, expect, it } from "vitest";
import type {
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedLine,
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
  numericReferenceProperties,
  numericReferenceValue,
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
  endAngleDeg: 233.13010235415598
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
  startHandleAngleDeg: 0,
  startHandleLength: 10,
  endHandleAngleDeg: 180,
  endHandleLength: 10
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
    expect(numericReferenceProperties(line)).toEqual(["length", "startAngleDeg", "endAngleDeg"]);
    expect(numericReferenceProperties(arc)).toEqual(["length", "startAngleDeg", "endAngleDeg"]);
    expect(numericReferenceProperties(curve)).toEqual(["length"]);
    expect(numericReferenceExpression(line, "length")).toBe("line-ab.length");
  });

  it("formats numeric reference values", () => {
    expect(numericReferenceValue(line, "length")).toBe("50 mm");
    expect(numericReferenceValue(line, "startAngleDeg")).toBe("53.13°");
    expect(numericReferenceValue(line, "endAngleDeg")).toBe("233.13°");
    expect(numericReferenceValue(curve, "length")).toBe("52.34 mm");
    expect(numericReferenceValue(curve, "startAngleDeg")).toBe("");
  });

  it("builds geometry info rows", () => {
    expect(pointCoordinateRows(point("p", 1, 2))).toEqual([{ label: "座標", value: "(1, 2)" }]);
    expect(lineInfoRows(line)).toEqual([
      { label: "始点", value: "(0, 0)" },
      { label: "終点", value: "(30, 40)" },
      { label: "始角度", value: "53.13°" },
      { label: "終角度", value: "233.13°" },
      { label: "長さ", value: "50 mm" }
    ]);
    expect(arcLineInfoRows(arc)).toEqual([
      { label: "中心点", value: "(0, 0)" },
      { label: "始点", value: "(30, 0)" },
      { label: "終点", value: "(0, -30)" },
      { label: "半径", value: "30 mm" },
      { label: "始角度", value: "0°" },
      { label: "終角度", value: "90°" },
      { label: "長さ", value: "47.12 mm" }
    ]);
    expect(bezierCurveInfoRows(curve)).toEqual([
      { label: "区間数", value: "1" },
      { label: "長さ", value: "52.34 mm" }
    ]);
  });
});
