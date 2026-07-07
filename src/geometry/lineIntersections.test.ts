import { describe, expect, it } from "vitest";
import type { ComputedOffsetLine, ComputedPoint } from "../types/geometry";
import { findLineIntersections } from "./lineIntersections";

const point = (x: number, y: number): ComputedPoint => ({
  kind: "point",
  elementId: "",
  name: "",
  x,
  y
});

const offsetBezier = (
  id: string,
  start: ComputedPoint,
  control1: { x: number; y: number },
  control2: { x: number; y: number },
  end: ComputedPoint
): ComputedOffsetLine => ({
  kind: "offsetLine",
  elementId: id,
  name: id,
  baseLineIds: [],
  start,
  end,
  segments: [
    {
      kind: "bezier",
      start,
      control1,
      control2,
      end,
      length: Math.hypot(end.x - start.x, end.y - start.y)
    }
  ],
  closed: false,
  length: Math.hypot(end.x - start.x, end.y - start.y),
  startTangentAngleDeg: null,
  endTangentAngleDeg: null
});

describe("findLineIntersections", () => {
  it("uses offset Bezier endpoint tangents for extension intersections", () => {
    const horizontal = offsetBezier(
      "horizontal",
      point(-100, 0),
      { x: -70, y: 0 },
      { x: -30, y: 0 },
      point(0, 0)
    );
    const vertical = offsetBezier(
      "vertical",
      point(10, 10),
      { x: 10, y: 13 },
      { x: 10, y: 17 },
      point(10, 20)
    );

    expect(findLineIntersections(horizontal, vertical, { useExtensions: false }).intersections).toHaveLength(0);

    const result = findLineIntersections(horizontal, vertical, { useExtensions: true });

    expect(result.error).toBeUndefined();
    expect(result.intersections[0]).toMatchObject({
      x: 10,
      y: 0
    });
  });
});
