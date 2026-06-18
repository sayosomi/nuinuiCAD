import { describe, expect, it } from "vitest";
import { hitTestCanvasGeometry } from "./DrawingCanvasHitTest";
import type { ComputedLine, ComputedPoint } from "../types/geometry";

const point = (elementId: string, x: number, y: number): ComputedPoint => ({
  kind: "point",
  elementId,
  name: elementId,
  x,
  y
});

const line = (
  elementId: string,
  start: ComputedPoint,
  end: ComputedPoint
): ComputedLine => ({
  kind: "line",
  elementId,
  name: elementId,
  startPointId: start.elementId,
  endPointId: end.elementId,
  start,
  end
});

describe("hitTestCanvasGeometry", () => {
  const start = point("point-a", 0, 0);
  const end = point("point-b", 100, 0);
  const baseLine = line("line-ab", start, end);

  it("selects a visible point within the point hit radius", () => {
    expect(
      hitTestCanvasGeometry({
        screen: { x: 54, y: 54 },
        lines: [],
        points: [{ point: start, screen: { x: 50, y: 50 } }]
      })
    ).toBe("point-a");
  });

  it("selects a visible line within the line hit distance", () => {
    expect(
      hitTestCanvasGeometry({
        screen: { x: 70, y: 55 },
        lines: [{ line: baseLine, start: { x: 20, y: 50 }, end: { x: 120, y: 50 } }],
        points: []
      })
    ).toBe("line-ab");
  });

  it("prefers points over lines when both are hit", () => {
    expect(
      hitTestCanvasGeometry({
        screen: { x: 50, y: 50 },
        lines: [{ line: baseLine, start: { x: 20, y: 50 }, end: { x: 120, y: 50 } }],
        points: [{ point: start, screen: { x: 50, y: 50 } }]
      })
    ).toBe("point-a");
  });

  it("uses later drawn same-kind geometry when hit targets overlap", () => {
    const laterPoint = point("point-c", 0, 0);

    expect(
      hitTestCanvasGeometry({
        screen: { x: 50, y: 50 },
        lines: [],
        points: [
          { point: start, screen: { x: 50, y: 50 } },
          { point: laterPoint, screen: { x: 50, y: 50 } }
        ]
      })
    ).toBe("point-c");
  });

  it("ignores hidden or unevaluated geometry because it is omitted from hit-test input", () => {
    expect(
      hitTestCanvasGeometry({
        screen: { x: 50, y: 50 },
        lines: [],
        points: []
      })
    ).toBeNull();
  });
});
