import { describe, expect, it } from "vitest";

import { referenceAnchor } from "../model/pointAnchors";
import type { CadElement, ComputedPolyline } from "../types/geometry";
import { evaluateElements } from "./evaluate";

const point = (id: string, name: string, x: number, y: number): CadElement => ({
  id,
  name,
  type: "freePoint",
  activity: "visible",
  x,
  y
});

const polyline = (id: string, points: string[], closed = false): CadElement => ({
  id,
  name: id,
  type: "polyline",
  activity: "visible",
  points: points.map((pointId) => referenceAnchor(pointId)),
  closed
});

describe("polyline evaluation", () => {
  it("preserves authored order, duplicate points, and adds one closure segment", () => {
    const result = evaluateElements([
      point("a", "A", 0, 0),
      point("b", "B", 10, 0),
      point("c", "C", 10, 10),
      polyline("open", ["a", "a", "b", "c"]),
      polyline("closed", ["a", "b", "c"], true)
    ]);

    const open = result.computedGeometry.get("open") as ComputedPolyline;
    const closed = result.computedGeometry.get("closed") as ComputedPolyline;
    expect(open.segments.map((segment) => segment.length)).toEqual([0, 10, 10]);
    expect(open.closed).toBe(false);
    expect(open.start).toMatchObject({ x: 0, y: 0 });
    expect(open.end).toMatchObject({ x: 10, y: 10 });
    expect(closed.segments).toHaveLength(3);
    expect(closed.segments.at(-1)).toMatchObject({ start: { x: 10, y: 10 }, end: { x: 0, y: 0 } });
    expect(closed.length).toBe(10 + 10 + Math.sqrt(200));
    expect(closed.startTangentAngleDeg).toBe(0);
    expect(closed.endTangentAngleDeg).toBeCloseTo(45);
  });

  it("does not duplicate an already coincident closure endpoint and returns null tangents for all-zero traversal", () => {
    const result = evaluateElements([
      point("a", "A", 0, 0),
      point("b", "B", 10, 0),
      polyline("coincident", ["a", "b", "a"], true),
      polyline("zero", ["a", "a", "a"])
    ]);

    const coincident = result.computedGeometry.get("coincident") as ComputedPolyline;
    const zero = result.computedGeometry.get("zero") as ComputedPolyline;
    expect(coincident.segments).toHaveLength(2);
    expect(zero.segments.map((segment) => segment.length)).toEqual([0, 0]);
    expect(zero.startTangentAngleDeg).toBeNull();
    expect(zero.endTangentAngleDeg).toBeNull();
  });

  it("uses the first point as the closed end when closure is suppressed within epsilon", () => {
    const result = evaluateElements([
      point("a", "A", 0, 0),
      point("b", "B", 10, 0),
      point("c", "C", 0, 1e-10),
      polyline("closed", ["a", "b", "c"], true)
    ]);

    const closed = result.computedGeometry.get("closed") as ComputedPolyline;
    expect(closed.segments).toHaveLength(2);
    expect(closed.end).toMatchObject({ x: 0, y: 0 });
  });

  it("fails closed for open and closed cardinality violations", () => {
    const result = evaluateElements([
      point("a", "A", 0, 0),
      polyline("open", ["a"]),
      polyline("closed", ["a", "a"], true)
    ]);

    expect(result.computedGeometry.has("open")).toBe(false);
    expect(result.computedGeometry.has("closed")).toBe(false);
    expect(result.errors.map((error) => error.elementId)).toEqual(["open", "closed"]);
  });

  it("supports splitting a polyline through the existing broad path consumer", () => {
    const result = evaluateElements([
      point("a", "A", 0, 0),
      point("b", "B", 10, 0),
      point("c", "C", 10, 10),
      polyline("base", ["a", "b", "c"]),
      {
        id: "split",
        name: "Split",
        type: "splitLine",
        activity: "visible",
        baseLineId: "base",
        splitPoint: { mode: "coordinate", x: 5, y: 0 }
      }
    ]);

    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get("base")).toMatchObject({
      kind: "polyline",
      closed: false,
      length: 5,
      end: { x: 5, y: 0 }
    });
    expect(result.computedGeometry.get("split")).toMatchObject({
      kind: "polyline",
      length: 15,
      start: { x: 5, y: 0 },
      end: { x: 10, y: 10 }
    });
  });
});
