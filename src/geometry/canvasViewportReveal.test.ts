import { describe, expect, it } from "vitest";
import { minimumCanvasPanForBounds } from "./canvasViewportReveal";

const viewport = { zoom: 2, panX: 0, panY: 0 };
const bounds = (minX: number, minY: number, maxX: number, maxY: number) => ({ minX, minY, maxX, maxY });

describe("minimumCanvasPanForBounds", () => {
  it("keeps a fully visible target exactly unchanged", () => {
    expect(minimumCanvasPanForBounds(bounds(-10, -10, 10, 10), viewport, { width: 100, height: 100 }))
      .toEqual({ dx: 0, dy: 0 });
  });

  it.each([
    [bounds(-40, -10, -30, 10), { dx: 30, dy: 0 }],
    [bounds(30, -10, 40, 10), { dx: -30, dy: 0 }],
    [bounds(-10, 30, 10, 40), { dx: 0, dy: 30 }],
    [bounds(-10, -40, 10, -30), { dx: 0, dy: -30 }],
    [bounds(30, 30, 40, 40), { dx: -30, dy: 30 }]
  ])("pans only the minimum overflowing axes", (target, expected) => {
    expect(minimumCanvasPanForBounds(target, viewport, { width: 100, height: 100 })).toEqual(expected);
  });

  it("fails closed for unsafe bounds without changing zoom", () => {
    expect(minimumCanvasPanForBounds(bounds(Number.NaN, 0, 1, 1), viewport, { width: 100, height: 100 })).toBeNull();
  });
});
