import { describe, expect, it } from "vitest";
import {
  CANVAS_DIRECTION_ARROW_MIN_PATH_LENGTH_PX,
  canvasDirectionArrowGeometryForPath
} from "./canvasDirectionArrow";
import { sampleArcLineScreenPoints, samplePolylineScreenPoints } from "./DrawingCanvasHitTest";
import type { ComputedArcLine, ComputedPoint, ComputedPolyline } from "../types/geometry";

const point = (elementId: string, x: number, y: number): ComputedPoint => ({
  kind: "point",
  elementId,
  name: elementId,
  x,
  y
});

const arcForSweep = (sweepAngleDeg: number): ComputedArcLine => {
  const radius = 40;
  const radians = (sweepAngleDeg * Math.PI) / 180;
  return {
    kind: "arcLine",
    elementId: `arc-${sweepAngleDeg}`,
    name: "arc",
    centerPointId: null,
    center: point("center", 0, 0),
    start: point("start", radius, 0),
    end: point("end", radius * Math.cos(radians), radius * Math.sin(radians)),
    radius,
    startAngleDeg: 0,
    endAngleDeg: sweepAngleDeg,
    startTangentAngleDeg: 90 * Math.sign(sweepAngleDeg),
    endTangentAngleDeg: (90 + sweepAngleDeg) * Math.sign(sweepAngleDeg),
    sweepAngleDeg,
    length: radius * Math.abs(radians)
  };
};

describe("Canvas path direction arrows", () => {
  it("uses the path-length midpoint and its local ordered tangent", () => {
    expect(canvasDirectionArrowGeometryForPath([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 30 }
    ])).toEqual({
      center: { x: 10, y: 10 },
      direction: { x: 0, y: 1 }
    });
  });

  it("follows reversed sample order and ignores zero-length intervals", () => {
    expect(canvasDirectionArrowGeometryForPath([
      { x: 30, y: 0 },
      { x: 30, y: 0 },
      { x: 0, y: 0 }
    ])).toEqual({
      center: { x: 15, y: 0 },
      direction: { x: -1, y: 0 }
    });
  });

  it("includes the supplied closed-path traversal order", () => {
    expect(canvasDirectionArrowGeometryForPath([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 0 }
    ])).toEqual({
      center: { x: 20, y: Math.hypot(20, 20) / 2 },
      direction: { x: 0, y: 1 }
    });
  });

  it.each([90, -90])("follows the ordered local tangent of a %s degree arc sweep", (sweepAngleDeg) => {
    const points = sampleArcLineScreenPoints(arcForSweep(sweepAngleDeg), (value) => value);
    const geometry = canvasDirectionArrowGeometryForPath(points);

    expect(geometry).not.toBeNull();
    expect(geometry!.direction.x).toBeLessThan(0);
    expect(Math.sign(geometry!.direction.y)).toBe(Math.sign(sweepAngleDeg));
  });

  it("samples the closed polyline closing segment before finding its ordered midpoint", () => {
    const start = point("polyline-start", 0, 0);
    const corner = point("polyline-corner", 20, 0);
    const end = point("polyline-end", 20, 20);
    const polyline: ComputedPolyline = {
      kind: "polyline",
      elementId: "closed-polyline",
      name: "Closed",
      segments: [
        { kind: "line", start, end: corner, length: 20 },
        { kind: "line", start: corner, end, length: 20 },
        { kind: "line", start: end, end: start, length: Math.hypot(20, 20) }
      ],
      closed: true,
      start,
      end: start,
      length: 40 + Math.hypot(20, 20),
      startTangentAngleDeg: 0,
      endTangentAngleDeg: -135
    };
    const geometry = canvasDirectionArrowGeometryForPath(samplePolylineScreenPoints(polyline, (value) => value));

    expect(geometry).toEqual({
      center: { x: 20, y: Math.hypot(20, 20) / 2 },
      direction: { x: 0, y: 1 }
    });
  });

  it("omits degenerate, too-short, and non-finite paths", () => {
    expect(canvasDirectionArrowGeometryForPath([{ x: 0, y: 0 }, { x: 0, y: 0 }])).toBeNull();
    expect(canvasDirectionArrowGeometryForPath([
      { x: 0, y: 0 },
      { x: CANVAS_DIRECTION_ARROW_MIN_PATH_LENGTH_PX - 1, y: 0 }
    ])).toBeNull();
    expect(canvasDirectionArrowGeometryForPath([
      { x: 0, y: 0 },
      { x: Number.NaN, y: 10 }
    ])).toBeNull();
  });
});
