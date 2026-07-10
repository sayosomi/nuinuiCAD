import { describe, expect, it } from "vitest";
import type { ComputedArcLine, ComputedBezierCurve, ComputedLine, ComputedOffsetLine, ComputedPoint } from "../types/geometry";
import { findLineIntersections } from "./lineIntersections";

const point = (x: number, y: number): ComputedPoint => ({
  kind: "point",
  elementId: "",
  name: "",
  x,
  y
});

const offsetBezier = (
  id: string,
  start: ComputedPoint,
  control1: { x: number; y: number },
  control2: { x: number; y: number },
  end: ComputedPoint
): ComputedOffsetLine => ({
  kind: "offsetLine",
  elementId: id,
  name: id,
  baseLineIds: [],
  start,
  end,
  segments: [
    {
      kind: "bezier",
      start,
      control1,
      control2,
      end,
      length: Math.hypot(end.x - start.x, end.y - start.y)
    }
  ],
  closed: false,
  length: Math.hypot(end.x - start.x, end.y - start.y),
  startTangentAngleDeg: null,
  endTangentAngleDeg: null
});

const circleArc = (radius: number, startAngleDeg: number, sweepAngleDeg: number): ComputedArcLine => {
  const startRad = (startAngleDeg * Math.PI) / 180;
  const endRad = ((startAngleDeg + sweepAngleDeg) * Math.PI) / 180;
  return {
    kind: "arcLine",
    elementId: "circle",
    name: "circle",
    centerPointId: null,
    center: point(0, 0),
    start: point(radius * Math.cos(startRad), radius * Math.sin(startRad)),
    end: point(radius * Math.cos(endRad), radius * Math.sin(endRad)),
    radius,
    startAngleDeg,
    endAngleDeg: startAngleDeg + sweepAngleDeg,
    startTangentAngleDeg: 0,
    endTangentAngleDeg: 0,
    sweepAngleDeg,
    length: Math.max(radius, 0) * Math.abs((sweepAngleDeg * Math.PI) / 180)
  };
};

const horizontalLine = (y: number): ComputedLine => ({
  kind: "line",
  elementId: "horizontal-line",
  name: "水平線",
  startPointId: null,
  endPointId: null,
  start: point(-200, y),
  end: point(200, y),
  length: 400,
  startAngleDeg: 0,
  endAngleDeg: 180,
  startTangentAngleDeg: 0,
  endTangentAngleDeg: 180
});

const verticalBezier = (): ComputedBezierCurve => {
  // A cubic whose control points are all on x=0 stays exactly on x=0 for
  // every t, crossing a radius-50 circle centered at the origin at exactly
  // (0, -50) and (0, 50).
  const start = point(0, -100);
  const end = point(0, 100);
  return {
    kind: "bezierCurve",
    elementId: "curve",
    name: "曲線",
    startPointId: null,
    endPointId: null,
    intermediatePointIds: [],
    segments: [
      {
        startPointId: null,
        endPointId: null,
        start,
        control1: { x: 0, y: -33 },
        control2: { x: 0, y: 33 },
        end
      }
    ],
    length: 200,
    startTangentAngleDeg: 90,
    endTangentAngleDeg: 90,
    startHandleAngleDeg: 90,
    startHandleLength: 67,
    endHandleAngleDeg: 270,
    endHandleLength: 67
  };
};

describe("findLineIntersections", () => {
  it("refines circle x line intersections to analytic precision", () => {
    // The old 64-chord-per-360-degree sampling was off by ~0.1mm here; this
    // asserts the new analytic refinement lands within 1e-6.
    const circle = circleArc(50, 0, 360);
    const line = horizontalLine(30);

    const result = findLineIntersections(circle, line, { useExtensions: false });

    expect(result.error).toBeUndefined();
    expect(result.intersections).toHaveLength(2);
    const xs = result.intersections.map((item) => item.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(-40, 6);
    expect(xs[1]).toBeCloseTo(40, 6);
    for (const item of result.intersections) {
      expect(item.y).toBeCloseTo(30, 9);
    }
  });

  it("excludes a circle x line root outside the arc's sweep range", () => {
    // A quarter-circle from -45 to 45 degrees only covers the right-hand side
    // of the circle. The line y=30 intersects the *full* circle at x=+/-40,
    // but only x=+40 falls inside this arc's sweep.
    const arc = circleArc(50, -45, 90);
    const line = horizontalLine(30);

    const result = findLineIntersections(arc, line, { useExtensions: false });

    expect(result.error).toBeUndefined();
    expect(result.intersections).toHaveLength(1);
    expect(result.intersections[0].x).toBeCloseTo(40, 6);
  });

  it("refines circle x line intersections with a negative sweep", () => {
    const arc = circleArc(50, 45, -90);
    const line = horizontalLine(30);

    const result = findLineIntersections(arc, line, { useExtensions: false });

    expect(result.error).toBeUndefined();
    expect(result.intersections).toHaveLength(1);
    expect(result.intersections[0].x).toBeCloseTo(40, 6);
  });

  it("refines a tangent line-to-circle intersection", () => {
    const circle = circleArc(50, 0, 360);
    const line = horizontalLine(50);

    const result = findLineIntersections(circle, line, { useExtensions: false });

    expect(result.error).toBeUndefined();
    expect(result.intersections).toHaveLength(1);
    expect(result.intersections[0].x).toBeCloseTo(0, 6);
    expect(result.intersections[0].y).toBeCloseTo(50, 9);
  });

  it("refines circle x circle intersections to analytic precision", () => {
    // Circle A: center (0,0) r=50. Circle B: center (60,0) r=50. Analytic
    // solution crosses at exactly (30, +/-40).
    const a = circleArc(50, 0, 360);
    a.center = point(0, 0);
    const b: ComputedArcLine = { ...circleArc(50, 0, 360), elementId: "b", center: point(60, 0) };

    const result = findLineIntersections(a, b, { useExtensions: false });

    expect(result.error).toBeUndefined();
    expect(result.intersections).toHaveLength(2);
    const ys = result.intersections.map((item) => item.y).sort((left, right) => left - right);
    expect(ys[0]).toBeCloseTo(-40, 6);
    expect(ys[1]).toBeCloseTo(40, 6);
    for (const item of result.intersections) {
      expect(item.x).toBeCloseTo(30, 6);
    }
  });

  it("excludes a circle x circle root outside the arc's sweep range", () => {
    // Same two circles as above, but circle A is only a quarter-arc from -10
    // to 100 degrees. Relative to A's center (0,0), (30,40) sits at ~53.13
    // degrees (inside the sweep) while (30,-40) sits at ~-53.13 degrees
    // (outside), so only the first point should survive.
    const a: ComputedArcLine = { ...circleArc(50, -10, 110), center: point(0, 0) };
    const b: ComputedArcLine = { ...circleArc(50, 0, 360), elementId: "b", center: point(60, 0) };

    const result = findLineIntersections(a, b, { useExtensions: false });

    expect(result.error).toBeUndefined();
    expect(result.intersections).toHaveLength(1);
    expect(result.intersections[0].y).toBeCloseTo(40, 6);
  });

  it("refines circle x circle intersections with a negative sweep", () => {
    const a: ComputedArcLine = { ...circleArc(50, 100, -110), center: point(0, 0) };
    const b: ComputedArcLine = { ...circleArc(50, 0, 360), elementId: "b", center: point(60, 0) };

    const result = findLineIntersections(a, b, { useExtensions: false });

    expect(result.error).toBeUndefined();
    expect(result.intersections).toHaveLength(1);
    expect(result.intersections[0].y).toBeCloseTo(40, 6);
  });

  it("refines a near-tangent circle x circle intersection stably", () => {
    // Centers 99.99 apart (both radius 50, so 0.01mm short of exactly
    // externally tangent): true single-point tangency isn't reliably
    // seedable through the rough-crossing pass (a smooth external tangency's
    // chord approximation bulges inward on both sides and generally never
    // actually crosses), but a hair short of tangent still gives two genuine,
    // very-close-together crossings for the seed to find. This exercises the
    // quadratic solver right at the edge of its near-zero-discriminant
    // branch without depending on exact tangency being seedable.
    const d = 99.99;
    const a: ComputedArcLine = { ...circleArc(50, 0, 360), center: point(0, 0) };
    const b: ComputedArcLine = { ...circleArc(50, 0, 360), elementId: "b", center: point(d, 0) };

    const result = findLineIntersections(a, b, { useExtensions: false });

    expect(result.error).toBeUndefined();
    expect(result.intersections).toHaveLength(2);
    for (const item of result.intersections) {
      expect(Math.hypot(item.x, item.y)).toBeCloseTo(50, 6);
      expect(Math.hypot(item.x - d, item.y)).toBeCloseTo(50, 6);
    }
  });

  it("refines bezier x circle intersections to analytic precision", () => {
    const curve = verticalBezier();
    const circle = circleArc(50, 0, 360);

    const result = findLineIntersections(curve, circle, { useExtensions: false });

    expect(result.error).toBeUndefined();
    expect(result.intersections).toHaveLength(2);
    const ys = result.intersections.map((item) => item.y).sort((left, right) => left - right);
    expect(ys[0]).toBeCloseTo(-50, 6);
    expect(ys[1]).toBeCloseTo(50, 6);
    for (const item of result.intersections) {
      expect(item.x).toBeCloseTo(0, 6);
    }
  });

  it("excludes a bezier x circle root outside the arc's sweep range", () => {
    // Only the right-hand quarter circle (-45..45 degrees) is present. The
    // vertical bezier crosses the *full* circle at (0,-50) and (0,50), but
    // neither of those points (at 90 and -90 degrees) lies inside this arc's
    // sweep, so no intersections should be reported at all.
    const curve = verticalBezier();
    const arc = circleArc(50, -45, 90);

    const result = findLineIntersections(curve, arc, { useExtensions: false });

    expect(result.error).toBeUndefined();
    expect(result.intersections).toHaveLength(0);
  });

  it("refines a bezier x circle intersection with a negative sweep", () => {
    // Arc swept backward from 135 down to 45 degrees covers exactly (0,50)
    // (90 degrees) and excludes (0,-50) (-90 degrees, outside this sweep).
    const curve = verticalBezier();
    const arc = circleArc(50, 135, -90);

    const result = findLineIntersections(curve, arc, { useExtensions: false });

    expect(result.error).toBeUndefined();
    expect(result.intersections).toHaveLength(1);
    expect(result.intersections[0].y).toBeCloseTo(50, 6);
    expect(result.intersections[0].x).toBeCloseTo(0, 6);
  });

  it("refines bezier x bezier intersections to analytic precision", () => {
    // The vertical bezier stays exactly on x=0; a second bezier whose control
    // points all sit on y=25 stays exactly on y=25. They cross at exactly
    // (0, 25). Before this refinement, TS had no bezier x bezier precision
    // pass at all, so this asserts newly-enabled behavior (Rust already had
    // this via refine_bezier_bezier_intersection).
    const vertical = verticalBezier();
    const horizontal: ComputedBezierCurve = {
      ...verticalBezier(),
      elementId: "horizontal",
      segments: [
        {
          startPointId: null,
          endPointId: null,
          start: point(-50, 25),
          control1: { x: -16, y: 25 },
          control2: { x: 16, y: 25 },
          end: point(50, 25)
        }
      ]
    };

    const result = findLineIntersections(vertical, horizontal, { useExtensions: false });

    expect(result.error).toBeUndefined();
    expect(result.intersections).toHaveLength(1);
    expect(result.intersections[0].x).toBeCloseTo(0, 6);
    expect(result.intersections[0].y).toBeCloseTo(25, 6);
  });

  it.each([
    [1, 358],
    [359, -358]
  ])("keeps a near-full %i degree arc intersection exact", (startAngleDeg, sweepAngleDeg) => {
    const result = findLineIntersections(verticalBezier(), circleArc(50, startAngleDeg, sweepAngleDeg), {
      useExtensions: false
    });

    expect(result.error).toBeUndefined();
    expect(result.intersections).toHaveLength(2);
    for (const item of result.intersections) {
      expect(Math.hypot(item.x, item.y)).toBeCloseTo(50, 6);
      expect(item.x).toBeCloseTo(0, 6);
    }
  });

  it("keeps the full-circle seam in the seed chord that owns it", () => {
    const angleDeg = 17;
    const angleRad = (angleDeg * Math.PI) / 180;
    const radial = { x: Math.cos(angleRad), y: Math.sin(angleRad) };
    const tangent = { x: -radial.y, y: radial.x };
    const contact = { x: radial.x * 50, y: radial.y * 50 };
    const line: ComputedLine = {
      ...horizontalLine(0),
      elementId: "seam-tangent",
      start: point(contact.x - tangent.x * 100, contact.y - tangent.y * 100),
      end: point(contact.x + tangent.x * 100, contact.y + tangent.y * 100)
    };

    const result = findLineIntersections(circleArc(50, angleDeg, 360), line, { useExtensions: false });

    expect(result.error).toBeUndefined();
    expect(result.intersections).toHaveLength(1);
    expect(result.intersections[0].x).toBeCloseTo(contact.x, 6);
    expect(result.intersections[0].y).toBeCloseTo(contact.y, 6);
  });

  it("keeps all three local roots of a multi-root bezier pair", () => {
    const wavy: ComputedBezierCurve = {
      ...verticalBezier(),
      elementId: "wavy",
      segments: [
        {
          startPointId: null,
          endPointId: null,
          start: point(0, -10),
          control1: { x: 100 / 3, y: 30 },
          control2: { x: 200 / 3, y: -30 },
          end: point(100, 10)
        }
      ]
    };
    const axis: ComputedBezierCurve = {
      ...verticalBezier(),
      elementId: "axis",
      segments: [
        {
          startPointId: null,
          endPointId: null,
          start: point(-10, 0),
          control1: { x: 30, y: 0 },
          control2: { x: 70, y: 0 },
          end: point(110, 0)
        }
      ]
    };

    const result = findLineIntersections(wavy, axis, { useExtensions: false });

    expect(result.error).toBeUndefined();
    expect(result.intersections).toHaveLength(3);
    expect(result.intersections.map((item) => item.x)).toEqual([...result.intersections.map((item) => item.x)].sort((a, b) => a - b));
    for (const item of result.intersections) expect(item.y).toBeCloseTo(0, 6);
  });

  it("discards a bezier x arc rough candidate when Newton cannot establish a root", () => {
    // The 1-degree arc's sole chord is slightly inside the circle. This
    // Bezier crosses that chord while remaining strictly inside the circle,
    // so there is no analytic intersection to return.
    const inside: ComputedBezierCurve = {
      ...verticalBezier(),
      elementId: "inside",
      segments: [
        {
          startPointId: null,
          endPointId: null,
          start: point(49.997, -1),
          control1: { x: 49.997, y: 0 },
          control2: { x: 49.997, y: 1 },
          end: point(49.997, 2)
        }
      ]
    };

    const result = findLineIntersections(inside, circleArc(50, 0, 1), { useExtensions: false });

    expect(result.error).toBeUndefined();
    expect(result.intersections).toHaveLength(0);
  });

  const horizontalBezierCurve = (): ComputedBezierCurve => ({
    kind: "bezierCurve",
    elementId: "horizontal",
    name: "horizontal",
    startPointId: null,
    endPointId: null,
    intermediatePointIds: [],
    segments: [
      {
        startPointId: null,
        endPointId: null,
        start: point(-50, 25),
        control1: { x: -16, y: 25 },
        control2: { x: 16, y: 25 },
        end: point(50, 25)
      }
    ],
    length: 100,
    startTangentAngleDeg: 0,
    endTangentAngleDeg: 0,
    startHandleAngleDeg: 0,
    startHandleLength: 34,
    endHandleAngleDeg: 180,
    endHandleLength: 34
  });

  it("refines an offset line's bezier segment against a bezier curve", () => {
    // The offset line's single "bezier" sub-segment is the same vertical
    // curve used elsewhere in this file (x=0 for all t). Before the offset
    // segment dispatch was rewritten to preserve analytic primitives, this
    // would have flattened to an approximate polyline and never reached
    // bezier x bezier Newton refinement at all.
    const offset = offsetBezier("offset", point(0, -100), { x: 0, y: -33 }, { x: 0, y: 33 }, point(0, 100));

    const result = findLineIntersections(offset, horizontalBezierCurve(), { useExtensions: false });

    expect(result.error).toBeUndefined();
    expect(result.intersections).toHaveLength(1);
    expect(result.intersections[0].x).toBeCloseTo(0, 6);
    expect(result.intersections[0].y).toBeCloseTo(25, 6);
  });

  it("refines an offset line's straight segment against a bezier curve", () => {
    // The offset line's single "line" sub-segment is a genuine straight
    // segment (offset of a straight base line), which should be treated as
    // an exact Line primitive and refined against the bezier via the
    // existing bisection path -- previously offsetLine sub-segments were
    // never marked "exact" so this refinement never fired.
    const offset: ComputedOffsetLine = {
      kind: "offsetLine",
      elementId: "offset",
      name: "offset",
      baseLineIds: [],
      start: point(0, -100),
      end: point(0, 100),
      segments: [{ kind: "line", start: point(0, -100), end: point(0, 100), length: 200 }],
      closed: false,
      length: 200,
      startTangentAngleDeg: null,
      endTangentAngleDeg: null
    };

    const result = findLineIntersections(offset, horizontalBezierCurve(), { useExtensions: false });

    expect(result.error).toBeUndefined();
    expect(result.intersections).toHaveLength(1);
    expect(result.intersections[0].x).toBeCloseTo(0, 6);
    expect(result.intersections[0].y).toBeCloseTo(25, 6);
  });

  it("refines an offset line's arc segment against a line", () => {
    const offset: ComputedOffsetLine = {
      kind: "offsetLine",
      elementId: "offset",
      name: "offset",
      baseLineIds: [],
      start: point(50, 0),
      end: point(50, 0),
      segments: [
        {
          kind: "arc",
          center: point(0, 0),
          start: point(50, 0),
          end: point(50, 0),
          radius: 50,
          startAngleDeg: 0,
          sweepAngleDeg: 360,
          length: 2 * Math.PI * 50
        }
      ],
      closed: false,
      length: 2 * Math.PI * 50,
      startTangentAngleDeg: null,
      endTangentAngleDeg: null
    };
    const line = horizontalLine(30);

    const result = findLineIntersections(offset, line, { useExtensions: false });

    expect(result.error).toBeUndefined();
    expect(result.intersections).toHaveLength(2);
    const xs = result.intersections.map((item) => item.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(-40, 6);
    expect(xs[1]).toBeCloseTo(40, 6);
  });

  it("finds intersections against a closed offset line", () => {
    // Regression test: TS already returned intersections for closed offset
    // lines (this mirrors the Rust-side regression fix for the same case,
    // where the equivalent path used to early-return an empty segment list).
    const offset: ComputedOffsetLine = {
      kind: "offsetLine",
      elementId: "offset",
      name: "offset",
      baseLineIds: [],
      start: point(-50, -50),
      end: point(-50, -50),
      segments: [
        { kind: "line", start: point(-50, -50), end: point(50, -50), length: 100 },
        { kind: "line", start: point(50, -50), end: point(50, 50), length: 100 },
        { kind: "line", start: point(50, 50), end: point(-50, 50), length: 100 },
        { kind: "line", start: point(-50, 50), end: point(-50, -50), length: 100 }
      ],
      closed: true,
      length: 400,
      startTangentAngleDeg: null,
      endTangentAngleDeg: null
    };
    const vertical: ComputedLine = {
      kind: "line",
      elementId: "vertical-line",
      name: "垂直線",
      startPointId: null,
      endPointId: null,
      start: point(0, -200),
      end: point(0, 200),
      length: 400,
      startAngleDeg: 90,
      endAngleDeg: 270,
      startTangentAngleDeg: 90,
      endTangentAngleDeg: 270
    };

    const result = findLineIntersections(offset, vertical, { useExtensions: false });

    expect(result.error).toBeUndefined();
    expect(result.intersections).toHaveLength(2);
    const ys = result.intersections.map((item) => item.y).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(-50, 6);
    expect(ys[1]).toBeCloseTo(50, 6);
  });

  it("uses offset Bezier endpoint tangents for extension intersections", () => {
    const horizontal = offsetBezier(
      "horizontal",
      point(-100, 0),
      { x: -70, y: 0 },
      { x: -30, y: 0 },
      point(0, 0)
    );
    const vertical = offsetBezier(
      "vertical",
      point(10, 10),
      { x: 10, y: 13 },
      { x: 10, y: 17 },
      point(10, 20)
    );

    expect(findLineIntersections(horizontal, vertical, { useExtensions: false }).intersections).toHaveLength(0);

    const result = findLineIntersections(horizontal, vertical, { useExtensions: true });

    expect(result.error).toBeUndefined();
    expect(result.intersections[0]).toMatchObject({
      x: 10,
      y: 0
    });
  });
});
