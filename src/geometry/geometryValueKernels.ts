import type { ArcDirection } from "../types/geometry";
import { CIRCLE_EPSILON, degreesToRadians, directedSweepDegrees } from "./evaluateGeometryPrimitives";
import { arcTangentAngles, lineTangentAngles } from "./lineMeasurements";

export type StructuralPoint = { x: number; y: number };

export type StructuralLine = {
  kind: "line";
  start: StructuralPoint;
  end: StructuralPoint;
  length: number;
  startAngleDeg: number | null;
  endAngleDeg: number | null;
  startTangentAngleDeg: number | null;
  endTangentAngleDeg: number | null;
};

export type StructuralArcLine = {
  kind: "arcLine";
  center: StructuralPoint;
  start: StructuralPoint;
  end: StructuralPoint;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
  startTangentAngleDeg: number;
  endTangentAngleDeg: number;
  sweepAngleDeg: number;
  length: number;
};

export const coordinateGeometryKernel = (x: number, y: number): StructuralPoint => ({ x, y });

export const segmentGeometryKernel = (start: StructuralPoint, end: StructuralPoint): StructuralLine => ({
  kind: "line",
  start,
  end,
  length: Math.hypot(end.x - start.x, end.y - start.y),
  ...lineTangentAngles(start, end)
});

export const arcGeometryKernel = (
  center: StructuralPoint,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
  direction: ArcDirection
): StructuralArcLine => {
  const sweepAngleDeg = directedSweepDegrees(startAngleDeg, endAngleDeg, direction);
  const startAngleRad = degreesToRadians(startAngleDeg);
  const endAngleRad = degreesToRadians(endAngleDeg);
  return {
    kind: "arcLine",
    center,
    start: {
      x: center.x + Math.cos(startAngleRad) * radius,
      y: center.y + Math.sin(startAngleRad) * radius
    },
    end: {
      x: center.x + Math.cos(endAngleRad) * radius,
      y: center.y + Math.sin(endAngleRad) * radius
    },
    radius,
    startAngleDeg,
    endAngleDeg,
    ...arcTangentAngles({ startAngleDeg, endAngleDeg, sweepAngleDeg }),
    sweepAngleDeg,
    length: radius * Math.abs(degreesToRadians(sweepAngleDeg))
  };
};

export const throughArcGeometryKernel = (
  point1: StructuralPoint,
  point2: StructuralPoint,
  point3: StructuralPoint,
  startAngleDeg: number,
  endAngleDeg: number
): StructuralArcLine | null => {
  const denominator =
    2 *
    (point1.x * (point2.y - point3.y) +
      point2.x * (point3.y - point1.y) +
      point3.x * (point1.y - point2.y));

  if (Math.abs(denominator) < CIRCLE_EPSILON) return null;

  const point1Squared = point1.x * point1.x + point1.y * point1.y;
  const point2Squared = point2.x * point2.x + point2.y * point2.y;
  const point3Squared = point3.x * point3.x + point3.y * point3.y;
  const centerX =
    (point1Squared * (point2.y - point3.y) +
      point2Squared * (point3.y - point1.y) +
      point3Squared * (point1.y - point2.y)) /
    denominator;
  const centerY =
    (point1Squared * (point3.x - point2.x) +
      point2Squared * (point1.x - point3.x) +
      point3Squared * (point2.x - point1.x)) /
    denominator;
  const radius = Math.hypot(point1.x - centerX, point1.y - centerY);

  if (!Number.isFinite(centerX) || !Number.isFinite(centerY) || !Number.isFinite(radius) || radius <= CIRCLE_EPSILON) {
    return null;
  }
  return arcGeometryKernel({ x: centerX, y: centerY }, radius, startAngleDeg, endAngleDeg, "counterclockwise");
};
