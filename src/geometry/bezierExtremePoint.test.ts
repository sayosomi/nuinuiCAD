import { describe, expect, it } from "vitest";
import { evaluateElements } from "./evaluate";
import type {
  BezierCurveElement,
  BezierExtremePointElement,
  CadElement,
  FreePointElement,
  LineDivisionPointElement,
  SplitLineElement
} from "../types/geometry";

const point = (id: string, x: number, y: number): FreePointElement => ({
  id,
  name: id,
  type: "freePoint",
  activity: "visible",
  x,
  y
});

const curve = (
  id: string,
  startAngleDeg: number,
  startHandleLength: number,
  endAngleDeg: number,
  endHandleLength: number
): BezierCurveElement => ({
  id,
  name: id,
  type: "bezierCurve",
  activity: "visible",
  startPoint: { mode: "reference", pointId: "start" },
  startHandleAngleDeg: startAngleDeg,
  startHandleLength,
  intermediatePoints: [],
  endPoint: { mode: "reference", pointId: "end" },
  endHandleAngleDeg: endAngleDeg,
  endHandleLength
});

const extreme = (id: string, baseLineId: string, directionDeg: number, segmentIndex = 0): BezierExtremePointElement => ({
  id,
  name: id,
  type: "bezierExtremePoint",
  activity: "visible",
  baseLineId,
  segmentIndex,
  directionDeg
});

const evaluate = (directionDeg: number) => {
  const result = evaluateElements([
    point("start", 0, 0),
    point("end", 10, 0),
    curve("curve", 90, 10, -90, 10),
    extreme("extreme", "curve", directionDeg)
  ]);
  expect(result.errors).toEqual([]);
  const computed = result.computedGeometry.get("extreme");
  expect(computed?.kind).toBe("point");
  if (!computed || computed.kind !== "point") throw new Error("expected a computed point");
  return computed;
};

describe("bezierExtremePoint evaluation", () => {
  it("selects interior and endpoint maxima for the cardinal directions", () => {
    expect(evaluate(90)).toMatchObject({ kind: "point" });
    expect(evaluate(90).x).toBeCloseTo(5, 10);
    expect(evaluate(90).y).toBeCloseTo(7.5, 10);
    expect(evaluate(0)).toMatchObject({ kind: "point", x: 10, y: 0 });
    expect(evaluate(180)).toMatchObject({ kind: "point", x: 0, y: 0 });
    expect(evaluate(270)).toMatchObject({ kind: "point", x: 0, y: 0 });
  });

  it("normalizes negative and over-360-degree directions", () => {
    expect(evaluate(-270).x).toBeCloseTo(5, 10);
    expect(evaluate(-270).y).toBeCloseTo(7.5, 10);
    expect(evaluate(450).x).toBeCloseTo(5, 10);
    expect(evaluate(450).y).toBeCloseTo(7.5, 10);
  });

  it("uses t=0.5 for a flat projection", () => {
    const result = evaluateElements([
      point("start", 0, 0),
      point("end", 10, 0),
      curve("curve", 0, 0, 0, 0),
      extreme("extreme", "curve", 90)
    ]);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get("extreme")).toMatchObject({ x: 5, y: 0 });
  });

  it("selects the requested segment from a multi-segment source", () => {
    const result = evaluateElements([
      {
        id: "curve",
        name: "curve",
        type: "bezierCurve",
        activity: "visible",
        startPoint: { mode: "coordinate", x: 0, y: 0 },
        startHandleAngleDeg: 0,
        startHandleLength: 0,
        intermediatePoints: [{
          id: "mid",
          point: { mode: "coordinate", x: 10, y: 10 },
          handleAngleDeg: 0,
          incomingHandleLength: 0,
          outgoingHandleLength: 0
        }],
        endPoint: { mode: "coordinate", x: 20, y: 0 },
        endHandleAngleDeg: 0,
        endHandleLength: 0
      },
      extreme("extreme", "curve", 90, 1)
    ]);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get("extreme")).toMatchObject({ x: 10, y: 10 });
  });

  it("distinguishes invalid and out-of-range segment indexes", () => {
    const elements = [point("start", 0, 0), point("end", 10, 0), curve("curve", 90, 10, -90, 10)];
    const negative = evaluateElements([...elements, extreme("extreme", "curve", 90, -1)]);
    expect(negative.computedGeometry.has("extreme")).toBe(false);
    expect(negative.errors[0]).toMatchObject({
      elementId: "extreme",
      missingDependencyId: "extreme",
      message: "extreme の区間番号は0以上の整数で指定してください。"
    });

    const nonInteger = evaluateElements([...elements, extreme("extreme", "curve", 90, 0.5)]);
    expect(nonInteger.errors[0]?.message).toBe("extreme の区間番号は0以上の整数で指定してください。");

    const outOfRange = evaluateElements([...elements, extreme("extreme", "curve", 90, 1)]);
    expect(outOfRange.errors[0]?.message).toBe(
      "extreme の区間番号 1 に対応する区間がありません。区間数は 1 個です。"
    );
  });

  it("reports a missing Bezier source as a dependency error", () => {
    const result = evaluateElements([
      extreme("extreme", "missing", 90)
    ]);
    expect(result.computedGeometry.has("extreme")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "extreme",
      missingDependencyId: "missing",
      missingDependencyName: undefined
    });
  });

  it("reports a disabled Bezier source as the missing dependency", () => {
    const disabledCurve = curve("curve", 90, 10, -90, 10);
    disabledCurve.activity = "disabled";
    const result = evaluateElements([
      point("start", 0, 0),
      point("end", 10, 0),
      disabledCurve,
      extreme("extreme", "curve", 90)
    ]);
    expect(result.computedGeometry.has("extreme")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "extreme",
      missingDependencyId: "curve",
      missingDependencyName: "curve"
    });
    expect(result.errors[0]?.message).toContain("curve");
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
      point("start", 0, 0),
      point("end", 10, 0),
      curve("curve", 90, 10, -90, 10),
      midpoint,
      split,
      extreme("extreme", "split", 90)
    ] as CadElement[]);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get("split")).toMatchObject({ kind: "bezierCurve" });
    expect(result.computedGeometry.get("extreme")).toMatchObject({ kind: "point" });
  });

  it("rejects an existing non-Bezier computed geometry", () => {
    const result = evaluateElements([
      point("start", 0, 0),
      point("end", 10, 0),
      {
        id: "line",
        name: "line",
        type: "line",
        activity: "visible",
        startPoint: { mode: "reference", pointId: "start" },
        endPoint: { mode: "reference", pointId: "end" }
      },
      extreme("extreme", "line", 90)
    ]);
    expect(result.computedGeometry.has("extreme")).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({
      elementId: "extreme",
      message: "extreme の参照先はベジェ曲線の計算結果ではありません。ベジェ曲線を指定してください。"
    }));
  });
});
