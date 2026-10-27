import { describe, expect, it } from "vitest";
import type { ComputedArcLine } from "../types/geometry";
import { computedPoint } from "./offsetPathMath";
import { buildOffsetLineGeometry } from "./offsetPaths";

const sourceArc = (clockwise: boolean): ComputedArcLine => {
  const start = clockwise ? 90 : 0;
  const end = clockwise ? 0 : 90;
  const pointAt = (angle: number) => computedPoint("", "", {
    x: 2 + 5 * Math.cos(angle * Math.PI / 180),
    y: -3 + 5 * Math.sin(angle * Math.PI / 180)
  });
  return { kind: "arcLine", elementId: "A", name: "A", centerPointId: null,
    center: computedPoint("", "", { x: 2, y: -3 }), start: pointAt(start), end: pointAt(end),
    radius: 5, startAngleDeg: start, endAngleDeg: end, sweepAngleDeg: clockwise ? -90 : 90,
    startTangentAngleDeg: clockwise ? 0 : 90, endTangentAngleDeg: clockwise ? 270 : 180,
    length: 5 * Math.PI / 2 };
};

// Signed helper offset is positive to the path's right. Expectations are frozen
// tangent-normal predictions, independent of the radius implementation.
const cases = [
  [false, 1, 6], [false, -1, 4], [true, 1, 4], [true, -1, 6],
  [false, -4.999, 0.001], [true, 4.999, 0.001],
  [false, -5, null], [true, 5, null], [false, -6, null], [true, 6, null],
  [false, 0, 5], [true, 0, 5]
] as const;

describe("Issue 1462 directed arc offset radius", () => {
  for (const [clockwise, offset, radius] of cases) it(`cw=${clockwise}, signed offset=${offset}`, () => {
    const result = buildOffsetLineGeometry({ elementId: "O", name: "O", baseLineIds: ["A"],
      baseGeometries: [sourceArc(clockwise)], offset, closed: false });
    if (radius === null) {
      expect(result.geometry).toBeUndefined();
      expect(result.error).toContain("円弧半径が0以下");
      return;
    }
    expect(result.error).toBeUndefined();
    const segment = result.geometry!.segments[0];
    expect(segment.kind).toBe("arc");
    if (segment.kind !== "arc") throw new Error("expected arc");
    expect(segment.radius).toBeCloseTo(radius, 10);
    expect(segment.center).toMatchObject({ x: 2, y: -3 });
    expect(segment.sweepAngleDeg).toBe(clockwise ? -90 : 90);
    expect(segment.start.x).toBeCloseTo(clockwise ? 2 : 2 + radius, 10);
    expect(segment.start.y).toBeCloseTo(clockwise ? -3 + radius : -3, 10);
    expect(segment.end.x).toBeCloseTo(clockwise ? 2 + radius : 2, 10);
    expect(segment.end.y).toBeCloseTo(clockwise ? -3 : -3 + radius, 10);
  });
});
