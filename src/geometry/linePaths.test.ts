import { describe, expect, it } from "vitest";

import type { ComputedOffsetLine, ComputedOffsetLineSegment } from "../types/geometry";
import { cubicPointAt } from "./bezierMath";
import { tangentAtPointOnLineLikeGeometry } from "./linePaths";
import { projectPointOntoOffsetLine } from "./offsetSegmentProjection";
import { computedPoint } from "./offsetPathMath";

const point = (x: number, y: number) => computedPoint("", "", { x, y });

const offsetLine = (segments: ComputedOffsetLineSegment[]): ComputedOffsetLine => ({
  kind: "offsetLine",
  elementId: "offset",
  name: "オフセット",
  baseLineIds: [],
  start: segments[0]?.start ?? null,
  end: segments.at(-1)?.end ?? null,
  segments,
  closed: false,
  length: segments.reduce((total, segment) => total + segment.length, 0),
  startTangentAngleDeg: null,
  endTangentAngleDeg: null
});

describe("offset line projection and tangent lookup", () => {
  it("returns the nearest offset segment identity with the existing exact projection", () => {
    const line: ComputedOffsetLineSegment = {
      kind: "line",
      start: point(0, 0),
      end: point(10, 0),
      length: 10
    };
    const bezier: ComputedOffsetLineSegment = {
      kind: "bezier",
      start: point(0, 0.2),
      control1: { x: 0, y: 5 },
      control2: { x: 10, y: 5 },
      end: point(10, 0.2),
      length: 10
    };

    expect(projectPointOntoOffsetLine({ x: 5, y: 0 }, [line, bezier])).toMatchObject({
      segmentIndex: 0,
      localT: 0.5,
      point: { x: 5, y: 0 },
      distance: 0
    });
    expect(projectPointOntoOffsetLine({ x: 5, y: 3.95 }, [line, bezier])).toMatchObject({
      segmentIndex: 1,
      distance: expect.any(Number)
    });
  });

  it("uses the selected line segment tangent when a nearby Bezier is not selected", () => {
    const line: ComputedOffsetLineSegment = {
      kind: "line",
      start: point(0, 0),
      end: point(10, 0),
      length: 10
    };
    const nearbyBezier: ComputedOffsetLineSegment = {
      kind: "bezier",
      start: point(0, 0.2),
      control1: { x: 0, y: 5 },
      control2: { x: 10, y: 5 },
      end: point(10, 0.2),
      length: 10
    };

    expect(tangentAtPointOnLineLikeGeometry(offsetLine([line, nearbyBezier]), { x: 5, y: 0 })).toEqual({
      angleDeg: 0,
      distanceFromLine: 0
    });
  });

  it("uses the exact selected cubic derivative instead of a sampled chord", () => {
    const segment: ComputedOffsetLineSegment = {
      kind: "bezier",
      start: point(0, 0),
      control1: { x: 0, y: 100 },
      control2: { x: 100, y: -100 },
      end: point(100, 0),
      length: 0
    };
    const basePoint = cubicPointAt(segment, 0.37);

    const tangent = tangentAtPointOnLineLikeGeometry(offsetLine([segment]), basePoint);
    expect(tangent).not.toBeNull();
    expect(tangent?.angleDeg).toBeCloseTo(319.46962847643573, 10);
    expect(tangent?.distanceFromLine).toBeCloseTo(0, 10);
  });

  it("uses the exact projected radial tangent for positive and negative arcs", () => {
    const positiveArc: ComputedOffsetLineSegment = {
      kind: "arc",
      center: point(0, 0),
      start: point(10, 0),
      end: point(0, 10),
      radius: 10,
      startAngleDeg: 0,
      sweepAngleDeg: 90,
      length: 10 * Math.PI / 2
    };
    const negativeArc: ComputedOffsetLineSegment = {
      ...positiveArc,
      end: point(0, -10),
      startAngleDeg: 0,
      sweepAngleDeg: -90
    };
    const positivePoint = { x: 10 * Math.cos(33.3 * Math.PI / 180), y: 10 * Math.sin(33.3 * Math.PI / 180) };
    const negativePoint = { x: positivePoint.x, y: -positivePoint.y };

    const positiveTangent = tangentAtPointOnLineLikeGeometry(offsetLine([positiveArc]), positivePoint);
    const negativeTangent = tangentAtPointOnLineLikeGeometry(offsetLine([negativeArc]), negativePoint);
    expect(positiveTangent).not.toBeNull();
    expect(negativeTangent).not.toBeNull();
    expect(positiveTangent?.angleDeg).toBeCloseTo(123.3, 10);
    expect(positiveTangent?.distanceFromLine).toBeCloseTo(0, 10);
    expect(negativeTangent?.angleDeg).toBeCloseTo(236.7, 10);
    expect(negativeTangent?.distanceFromLine).toBeCloseTo(0, 10);
  });
});
