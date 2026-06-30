import type { ComputedPoint, ElementId } from "../types/geometry";
import type { Point } from "./offsetPathTypes";

export const BEZIER_OFFSET_FLATNESS_TOLERANCE_MM = 0.1;
export const BEZIER_OFFSET_MAX_DEPTH = 12;
export const BEZIER_LENGTH_STEPS = 16;
export const OVER_OFFSET_SAMPLE_STEPS = 64;
export const OVER_OFFSET_MIN_SCALE = 0.02;
export const POINTED_JOIN_DOT_THRESHOLD = -0.95;
export const POINTED_JOIN_MITER_FACTOR = 4;
export const POINTED_JOIN_MAX_LENGTH = 200;
export const EPSILON = 1e-9;

export const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;
export const radiansToDegrees = (radians: number) => (radians * 180) / Math.PI;
export const normalizeDegrees = (degrees: number) => ((degrees % 360) + 360) % 360;
export const positiveSweepDegrees = (startAngleDeg: number, endAngleDeg: number) =>
  normalizeDegrees(endAngleDeg - startAngleDeg);

export const computedPoint = (
  elementId: ElementId,
  name: string,
  point: Point
): ComputedPoint => ({
  kind: "point",
  elementId,
  name,
  x: point.x,
  y: point.y
});

export const arcPoint = (center: Point, radius: number, angleDeg: number): Point => {
  const angleRad = degreesToRadians(angleDeg);
  return {
    x: center.x + Math.cos(angleRad) * radius,
    y: center.y + Math.sin(angleRad) * radius
  };
};

export const angleOfPoint = (center: Point, point: Point) =>
  normalizeDegrees(radiansToDegrees(Math.atan2(point.y - center.y, point.x - center.x)));

export const lineLength = (start: Point, end: Point) => Math.hypot(end.x - start.x, end.y - start.y);
