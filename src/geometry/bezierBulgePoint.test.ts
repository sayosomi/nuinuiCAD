import { describe, expect, it } from "vitest";
import { evaluateElements } from "./evaluate";
import type {
  BezierBulgePointElement,
  BezierCurveElement,
  CadElement,
  LineDivisionPointElement,
  SplitLineElement
} from "../types/geometry";

const curve = (
  id: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
  startAngleDeg: number,
  startHandleLength: number,
  endAngleDeg: number,
  endHandleLength: number,
  intermediatePoints: BezierCurveElement["intermediatePoints"] = []
): BezierCurveElement => ({
  id,
  name: id,
  type: "bezierCurve",
  activity: "visible",
  startPoint: { mode: "coordinate", ...start },
  startHandleAngleDeg: startAngleDeg,
  startHandleLength,
  intermediatePoints,
  endPoint: { mode: "coordinate", ...end },
  endHandleAngleDeg: endAngleDeg,
  endHandleLength
});

const bulge = (
  id: string,
  baseLineId: string,
  segmentIndex: BezierBulgePointElement["segmentIndex"] = 0
): BezierBulgePointElement => ({
  id,
  name: id,
  type: "bezierBulgePoint",
  activity: "visible",
  baseLineId,
  segmentIndex
});

const pointOf = (elements: CadElement[], id = "bulge") => {
  const result = evaluateElements(elements);
  expect(result.errors).toEqual([]);
  const computed = result.computedGeometry.get(id);
  expect(computed?.kind).toBe("point");
  if (!computed || computed.kind !== "point") throw new Error("expected a computed point");
  return computed;
};

describe("bezierBulgePoint evaluation", () => {
  it("selects the normal interior maximum at the requested unsigned distance", () => {
    const computed = pointOf([
      curve("curve", { x: 0, y: 0 }, { x: 10, y: 0 }, 90, 10, -90, 10),
      bulge("bulge", "curve")
    ]);
    expect(computed.x).toBeCloseTo(5, 10);
    expect(computed.y).toBeCloseTo(7.5, 10);
  });

  it("compares equal positive and negative bulges as unsigned distances and picks smaller t", () => {
    const handleAngle = Math.atan2(10, 10 / 3) * 180 / Math.PI;
    const handleLength = Math.hypot(10 / 3, 10);
    const computed = pointOf([
      curve("curve", { x: 0, y: 0 }, { x: 10, y: 0 }, handleAngle, handleLength, handleAngle, handleLength),
      bulge("bulge", "curve")
    ]);
    expect(computed.x).toBeCloseTo(2.11324865405187, 10);
    expect(computed.y).toBeCloseTo(2.88675134594813, 10);
  });

  it("uses parameter t=0.5 for a flat straight curve", () => {
    const computed = pointOf([
      curve("curve", { x: 0, y: 0 }, { x: 10, y: 0 }, 0, 0, 0, 10),
      bulge("bulge", "curve")
    ]);
    expect(computed.x).toBeCloseTo(1.25, 10);
    expect(computed.y).toBeCloseTo(0, 10);
  });

  it("selects segment 1 from a multi-segment source", () => {
    const computed = pointOf([
      curve("curve", { x: 0, y: 0 }, { x: 20, y: 0 }, 0, 0, -90, 10, [{
        id: "mid",
        point: { mode: "coordinate", x: 10, y: 0 },
        handleAngleDeg: 90,
        incomingHandleLength: 10,
        outgoingHandleLength: 10
      }]),
      bulge("bulge", "curve", 1)
    ]);
    expect(computed.x).toBeCloseTo(15, 10);
    expect(computed.y).toBeCloseTo(7.5, 10);
  });

  it("accepts an expression segment index", () => {
    const computed = pointOf([
      curve("curve", { x: 0, y: 0 }, { x: 10, y: 0 }, 90, 10, -90, 10),
      bulge("bulge", "curve", { kind: "expression", expression: "curve.length - curve.length" })
    ]);
    expect(computed.x).toBeCloseTo(5, 10);
    expect(computed.y).toBeCloseTo(7.5, 10);
  });

  it("validates negative, non-integer, and out-of-range segment indexes", () => {
    const source = curve("curve", { x: 0, y: 0 }, { x: 10, y: 0 }, 90, 10, -90, 10);
    for (const [value, message] of [
      [-1, "bulge の区間番号は0以上の整数で指定してください。"],
      [0.5, "bulge の区間番号は0以上の整数で指定してください。"],
      [1, "bulge の区間番号 1 に対応する区間がありません。区間数は 1 個です。"]
    ] as const) {
      const result = evaluateElements([source, bulge("bulge", "curve", value)]);
      expect(result.computedGeometry.has("bulge")).toBe(false);
      expect(result.errors[0]?.message).toBe(message);
    }
  });

  it("accepts a split-generated computed Bezier source", () => {
    const midpoint: LineDivisionPointElement = {
      id: "midpoint",
      name: "midpoint",
      type: "lineDivisionPoint",
      activity: "visible",
      endpoint: { lineId: "curve", endpointKey: "start" },
      placement: { kind: "ratio", value: 0.5 }
    };
    const split: SplitLineElement = {
      id: "split",
      name: "split",
      type: "splitLine",
      activity: "visible",
      baseLineId: "curve",
      splitPoint: { mode: "reference", pointId: "midpoint" }
    };
    const result = evaluateElements([
      curve("curve", { x: 0, y: 0 }, { x: 10, y: 0 }, 90, 10, -90, 10),
      midpoint,
      split,
      bulge("bulge", "split")
    ] as CadElement[]);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get("split")).toMatchObject({ kind: "bezierCurve" });
    expect(result.computedGeometry.get("bulge")).toMatchObject({ kind: "point" });
  });

  it("reports degenerate chords as geometry errors", () => {
    const result = evaluateElements([
      curve("curve", { x: 0, y: 0 }, { x: 0, y: 0 }, 90, 10, -90, 10),
      bulge("bulge", "curve")
    ]);
    expect(result.computedGeometry.has("bulge")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "bulge",
      message: "bulge の選択区間は始点と終点が一致しているため、膨らみの基準線を定義できません。"
    });
  });

  it("reports missing, disabled, and non-Bezier sources through the existing paths", () => {
    const missing = evaluateElements([bulge("bulge", "missing")]);
    expect(missing.errors[0]).toMatchObject({ elementId: "bulge", missingDependencyId: "missing" });

    const disabledCurve = curve("curve", { x: 0, y: 0 }, { x: 10, y: 0 }, 90, 10, -90, 10);
    disabledCurve.activity = "disabled";
    const disabled = evaluateElements([disabledCurve, bulge("bulge", "curve")]);
    expect(disabled.errors[0]).toMatchObject({ elementId: "bulge", missingDependencyId: "curve" });

    const ordinaryLine: CadElement = {
      id: "line",
      name: "line",
      type: "line",
      activity: "visible",
      startPoint: { mode: "coordinate", x: 0, y: 0 },
      endPoint: { mode: "coordinate", x: 10, y: 0 }
    };
    const lineResult = evaluateElements([ordinaryLine, bulge("bulge", "line")]);
    expect(lineResult.errors[0]?.message).toBe(
      "bulge の参照先はベジェ曲線の計算結果ではありません。ベジェ曲線を指定してください。"
    );
  });
});
