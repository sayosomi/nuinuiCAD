import type { ElementId } from "../types/geometry";

export type NumericMeasurementKey =
  | "length"
  | "startAngleDeg"
  | "endAngleDeg"
  | "radius"
  | "sweepAngleDeg"
  | "startRadiusAngleDeg"
  | "endRadiusAngleDeg"
  | "startHandleAngleDeg"
  | "startHandleLength"
  | "endHandleAngleDeg"
  | "endHandleLength";

export type LineMeasurementKey =
  | "length"
  | "startAngleDeg"
  | "endAngleDeg";

export type NumericExpressionReference = {
  elementId: ElementId;
  property?: string;
};

export type NumericExpressionError = {
  dependencyId: ElementId;
  dependencyName?: string;
  message: string;
};
