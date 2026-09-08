import { describe, expect, it } from "vitest";
import { throughArcGeometryKernel, type StructuralPoint } from "./geometryValueKernels";

const point = (x: number, y: number): StructuralPoint => ({ x, y });

describe("throughArcGeometryKernel", () => {
  it("solves an identity-free circle and creates the requested counterclockwise arc", () => {
    const arc = throughArcGeometryKernel(
      point(10, 0),
      point(0, 10),
      point(-10, 0),
      30,
      120
    );

    expect(arc).not.toBeNull();
    expect(arc).toEqual(expect.objectContaining({
      kind: "arcLine",
      center: { x: 0, y: 0 },
      radius: 10,
      startAngleDeg: 30,
      endAngleDeg: 120,
      sweepAngleDeg: 90,
      length: 10 * Math.PI / 2
    }));
    expect(arc?.start.x).toBeCloseTo(10 * Math.cos(Math.PI / 6), 12);
    expect(arc?.start.y).toBeCloseTo(10 * Math.sin(Math.PI / 6), 12);
    expect(arc?.end.x).toBeCloseTo(10 * Math.cos(2 * Math.PI / 3), 12);
    expect(arc?.end.y).toBeCloseTo(10 * Math.sin(2 * Math.PI / 3), 12);
    expect(arc).not.toHaveProperty("elementId");
    expect(arc).not.toHaveProperty("name");
  });

  it.each([
    [point(0, 0), point(0, 0), point(1, 1)],
    [point(0, 0), point(1, 1), point(2, 2)]
  ])("returns null for degenerate points", (point1, point2, point3) => {
    expect(throughArcGeometryKernel(point1, point2, point3, 0, 90)).toBeNull();
  });
});
