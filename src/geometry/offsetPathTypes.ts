import type { ComputedOffsetLineSegment } from "../types/geometry";

export type Point = { x: number; y: number };

export type SourceSegment =
  | { kind: "line"; start: Point; end: Point }
  | {
      kind: "bezier";
      start: Point;
      control1: Point;
      control2: Point;
      end: Point;
    }
  | {
      kind: "arc";
      center: Point;
      radius: number;
      startAngleDeg: number;
      sweepAngleDeg: number;
    };

export type RawOffsetSegment = {
  segment: ComputedOffsetLineSegment;
  joinWithPrevious: "miter" | "smooth" | "none";
  source: SourceSegment;
};
