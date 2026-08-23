import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import { evaluateElements } from "./evaluate";

const elements: CadElement[] = [
  {
    id: "a",
    name: "A",
    type: "freePoint",
    activity: "visible",
    x: 0,
    y: 0
  },
  {
    id: "b",
    name: "B",
    type: "freePoint",
    activity: "visible",
    x: 100,
    y: 0
  },
  {
    id: "base",
    name: "Base",
    type: "line",
    activity: "visible",
    startPoint: { mode: "reference", pointId: "a" },
    endPoint: { mode: "reference", pointId: "b" }
  },
  {
    id: "offset",
    name: "Seam",
    type: "offsetLine",
    activity: "visible",
    baseLineIds: ["base"],
    offset: 10,
    side: "left",
    closed: false
  }
];

describe("offset inspection metadata", () => {
  it("retains the evaluated distance and authored side on computed offset geometry", () => {
    const result = evaluateElements(elements);
    const geometry = result.computedGeometry.get("offset") as unknown as Record<string, unknown>;

    expect(geometry).toMatchObject({
      kind: "offsetLine",
      baseLineIds: ["base"],
      offsetDistance: 10,
      offsetSide: "left"
    });
  });
});
