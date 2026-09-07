import type { ArcDirection } from "../types/geometry";
import { degreesToRadians, directedSweepDegrees } from "./evaluateGeometryPrimitives";
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
