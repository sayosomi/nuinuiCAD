import { describe, expect, it } from "vitest";

import { referenceAnchor } from "../model/pointAnchors";
import type { CadElement, ComputedPolyline } from "../types/geometry";
import { isFillEligibleClosedPath } from "./linePaths";
import { evaluateElements } from "./evaluate";

const point = (id: string, x: number, y: number): CadElement => ({
  id,
  name: id,
  type: "freePoint",
  activity: "visible",
  x,
  y
});

const polyline = (id: string, points: string[], closed: boolean): CadElement => ({
  id,
  name: id,
  type: "polyline",
  activity: "visible",
  points: points.map(referenceAnchor),
  closed
});

const fillModifier = {
  name: "Fill",
  fill: { kind: "fixed" as const, hex: "#123456" },
  fillOpacity: 0.4
};

describe("closed path fill semantics", () => {
  it("uses the semantic closed flag instead of endpoint coincidence", () => {
    const result = evaluateElements([
      point("a", 0, 0),
      point("b", 10, 0),
      point("c", 10, 10),
      { ...polyline("open", ["a", "b", "a"], false), modifierNames: ["Fill"] },
      { ...polyline("closed", ["a", "b", "c"], true), modifierNames: ["Fill"] }
    ], {
      drawingModifiers: [fillModifier]
    });
    const open = result.computedGeometry.get("open");
    const closed = result.computedGeometry.get("closed");

    expect(isFillEligibleClosedPath(open)).toBe(false);
    expect(isFillEligibleClosedPath(closed)).toBe(true);
    expect(result.effectiveDrawingModifierResolutions?.get("open")?.fill.value).toEqual(fillModifier.fill);
    expect(result.warnings).toEqual([]);
  });

  it("keeps a self-intersecting path and stroke while warning and suppressing fill later", () => {
    const result = evaluateElements([
      point("a", 0, 0),
      point("b", 10, 10),
      point("c", 0, 10),
      point("d", 10, 0),
      {
        ...polyline("crossing", ["a", "b", "c", "d"], true),
        modifierNames: ["Fill"]
      }
    ], {
      drawingModifiers: [fillModifier]
    });

    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get("crossing")?.kind).toBe("polyline");
    expect(result.effectiveDrawingModifierStrokes?.get("crossing")).toBeDefined();
    expect(result.warnings).toEqual([
      expect.objectContaining({ elementId: "crossing", message: expect.stringContaining("自己交差") })
    ]);
  });

  it("does not warn for a zero-area path with no traversed boundary", () => {
    const result = evaluateElements([
      point("a", 0, 0),
      {
        ...polyline("zero", ["a", "a", "a"], true),
        modifierNames: ["Fill"]
      }
    ], {
      drawingModifiers: [fillModifier]
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect((result.computedGeometry.get("zero") as ComputedPolyline).closed).toBe(true);
  });
});
