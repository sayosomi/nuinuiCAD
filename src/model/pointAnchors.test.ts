import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import { evaluateElements } from "../geometry/evaluate";
import {
  derivedAnchor,
  derivedPointLabel,
  isPointElement,
  pointAnchorLabel,
  selectablePointsForGeometry
} from "./pointAnchors";

const curve: CadElement = {
  id: "curve",
  name: "曲線",
  type: "bezierCurve",
  activity: "visible",
  startPoint: { mode: "coordinate", x: 0, y: 0 },
  startHandleAngleDeg: 0,
  startHandleLength: 20,
  intermediatePoints: [
    {
      id: "mid-a",
      point: { mode: "coordinate", x: 20, y: 10 },
      handleAngleDeg: 45,
      incomingHandleLength: 10,
      outgoingHandleLength: 10
    },
    {
      id: "mid-b",
      point: { mode: "coordinate", x: 40, y: 10 },
      handleAngleDeg: 45,
      incomingHandleLength: 10,
      outgoingHandleLength: 10
    }
  ],
  endPoint: { mode: "coordinate", x: 60, y: 0 },
  endHandleAngleDeg: 180,
  endHandleLength: 20
};

describe("pointAnchors", () => {
  it("treats Bezier extreme points as ordinary point elements", () => {
    expect(isPointElement({
      id: "extreme",
      name: "方向極値点",
      type: "bezierExtremePoint",
      activity: "visible",
      baseLineId: "curve",
      segmentIndex: 0,
      directionDeg: 90
    })).toBe(true);
  });

  it("treats Bezier bulge points as ordinary point elements", () => {
    expect(isPointElement({
      id: "bulge",
      name: "最大膨らみ点",
      type: "bezierBulgePoint",
      activity: "visible",
      baseLineId: "curve",
      segmentIndex: 0
    })).toBe(true);
  });

  it("labels Bezier intermediate derived points with stable indexes", () => {
    expect(pointAnchorLabel(derivedAnchor("curve", "intermediate:mid-b"), [curve])).toBe(
      "曲線.中間点2"
    );
    expect(derivedPointLabel("curve", "intermediate:missing", [curve])).toBe(
      "曲線.中間点missing"
    );
  });

  it("labels common derived point keys consistently", () => {
    expect(derivedPointLabel("curve", "start", [curve])).toBe("曲線.始点");
    expect(derivedPointLabel("curve", "end", [curve])).toBe("曲線.終点");
    expect(derivedPointLabel("arc", "center", [])).toBe("arc.中心点");
  });

  it("projects authored Bezier labels through the reversed current slot mapping", () => {
    const result = evaluateElements([
      curve,
      {
        id: "reverse",
        name: "",
        type: "pathReverse",
        activity: "visible",
        targetLineId: "curve"
      }
    ]);
    expect(result.errors).toEqual([]);
    const geometry = result.computedGeometry.get("curve");
    expect(geometry?.kind).toBe("bezierCurve");
    if (geometry?.kind !== "bezierCurve") throw new Error("Expected a Bezier curve");

    const selectable = selectablePointsForGeometry(
      geometry,
      new Map([[curve.id, curve]])
    );
    expect(selectable).toEqual(expect.arrayContaining([
      expect.objectContaining({
        anchor: derivedAnchor("curve", "intermediate:mid-a"),
        label: "曲線.中間点1",
        point: expect.objectContaining({ x: 20, y: 10 })
      }),
      expect.objectContaining({
        anchor: derivedAnchor("curve", "intermediate:mid-b"),
        label: "曲線.中間点2",
        point: expect.objectContaining({ x: 40, y: 10 })
      })
    ]));
  });
});
