import { lineTangentAngles } from "./lineMeasurements";

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

export const coordinateGeometryKernel = (x: number, y: number): StructuralPoint => ({ x, y });

export const segmentGeometryKernel = (start: StructuralPoint, end: StructuralPoint): StructuralLine => ({
  kind: "line",
  start,
  end,
  length: Math.hypot(end.x - start.x, end.y - start.y),
  ...lineTangentAngles(start, end)
});
