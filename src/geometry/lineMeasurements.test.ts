import { describe, expect, it } from "vitest";
import type { ComputedOffsetLineSegment, ComputedPoint } from "../types/geometry";
import { offsetLineEndpointMeasurements } from "./lineMeasurements";

const point = (id: string, x: number, y: number): ComputedPoint => ({
  kind: "point",
  elementId: id,
  name: id,
  x,
  y
});

describe("offsetLineEndpointMeasurements", () => {
  it("scans past directionless leading and trailing segments", () => {
    const segments: ComputedOffsetLineSegment[] = [
      { kind: "line", start: point("start", 0, 0), end: point("zero", 0, 0), length: 0 },
      { kind: "line", start: point("zero", 0, 0), end: point("middle", 10, 0), length: 10 },
      { kind: "line", start: point("middle", 10, 0), end: point("end", 10, 0), length: 0 }
    ];

    expect(offsetLineEndpointMeasurements(segments)).toMatchObject({
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
      startTangentAngleDeg: 0,
      endTangentAngleDeg: 180
    });
  });

  it("uses actual arc endpoints and leaves an entirely directionless path undefined", () => {
    const arc: ComputedOffsetLineSegment = {
      kind: "arc",
      center: point("center", 0, 0),
      start: point("arc-start", 0, 10),
      end: point("arc-end", 10, 0),
      radius: 10,
      startAngleDeg: 0,
      sweepAngleDeg: 90,
      length: Math.PI * 5
    };
    expect(offsetLineEndpointMeasurements([arc])).toMatchObject({
      startTangentAngleDeg: 180,
      endTangentAngleDeg: 270
    });

    const directionless: ComputedOffsetLineSegment[] = [
      { kind: "line", start: point("a", 0, 0), end: point("a", 0, 0), length: 0 },
      {
        kind: "bezier",
        start: point("b", 0, 0),
        control1: { x: 0, y: 0 },
        control2: { x: 0, y: 0 },
        end: point("b", 0, 0),
        length: 0
      },
      {
        kind: "arc",
        center: point("c", 0, 0),
        start: point("c-start", 0, 0),
        end: point("c-end", 0, 0),
        radius: 0,
        startAngleDeg: 45,
        sweepAngleDeg: 0,
        length: 0
      }
    ];
    expect(offsetLineEndpointMeasurements(directionless)).toMatchObject({
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0 },
      startTangentAngleDeg: null,
      endTangentAngleDeg: null
    });
  });
});
