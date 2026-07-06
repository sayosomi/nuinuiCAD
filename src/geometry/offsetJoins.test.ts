import { describe, expect, it } from "vitest";

import type { ComputedOffsetLineSegment } from "../types/geometry";
import { computedPoint } from "./offsetPathMath";
import { joinIntersection, withEnd } from "./offsetJoins";

const point = (x: number, y: number) => computedPoint("", "", { x, y });

describe("offset joins", () => {
  it("uses the finite Bezier intersection before falling back to tangent miters", () => {
    const curve: ComputedOffsetLineSegment = {
      kind: "bezier",
      start: point(0, 0),
      control1: { x: 4, y: 8 },
      control2: { x: 6, y: 8 },
      end: point(10, 0),
      length: 0
    };
    const line: ComputedOffsetLineSegment = {
      kind: "line",
      start: point(5, -1),
      end: point(5, 7),
      length: 8
    };

    const intersection = joinIntersection(curve, line);

    expect(intersection?.x).toBeCloseTo(5);
    expect(intersection?.y).toBeCloseTo(6, 1);
  });

  it("trims a Bezier segment to an on-curve join point instead of moving the handle by translation", () => {
    const curve: ComputedOffsetLineSegment = {
      kind: "bezier",
      start: point(0, 0),
      control1: { x: 4, y: 8 },
      control2: { x: 6, y: 8 },
      end: point(10, 0),
      length: 0
    };

    const trimmed = withEnd(curve, { x: 5, y: 6 }, "offset", "オフセット");

    expect(trimmed.kind).toBe("bezier");
    if (trimmed.kind !== "bezier") throw new Error("Expected Bezier segment");
    expect(trimmed.end.x).toBeCloseTo(5);
    expect(trimmed.end.y).toBeCloseTo(6);
    expect(trimmed.control2.y).toBeLessThan(7);
  });
});
