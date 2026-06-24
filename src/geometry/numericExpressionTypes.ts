import type { ElementId } from "../types/geometry";

export type NumericMeasurementKey =
  | "length"
  | "startAngleDeg"
  | "endAngleDeg"
  | "startTangentAngleDeg"
  | "endTangentAngleDeg"
  | "startHandleAngleDeg"
  | "startHandleLength"
  | "endHandleAngleDeg"
  | "endHandleLength";

export type LineMeasurementKey =
  | "length"
  | "startAngleDeg"
  | "endAngleDeg"
  | "startTangentAngleDeg"
  | "endTangentAngleDeg";

export type NumericExpressionReference = {
  elementId: ElementId;
  property?: NumericMeasurementKey;
};

export type NumericExpressionError = {
  dependencyId: ElementId;
  dependencyName?: string;
  message: string;
};
