import type { NumericMeasurementKey } from "./numericExpressionTypes";

export const propertyLabels: Record<NumericMeasurementKey, string> = {
  length: "長さ",
  startAngleDeg: "始角度",
  endAngleDeg: "終角度",
  startTangentAngleDeg: "始接線角度",
  endTangentAngleDeg: "終接線角度",
  startHandleAngleDeg: "始点角度",
  startHandleLength: "始点ハンドル長",
  endHandleAngleDeg: "終点角度",
  endHandleLength: "終点ハンドル長"
};

export const labelToProperty = new Map<string, NumericMeasurementKey>(
  Object.entries(propertyLabels).map(([key, label]) => [label, key as NumericMeasurementKey])
);

export const lineMeasurementLabel = (property: NumericMeasurementKey) => propertyLabels[property];
