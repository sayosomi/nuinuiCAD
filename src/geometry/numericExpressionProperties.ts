import type { NumericMeasurementKey } from "./numericExpressionTypes";

export const propertyLabels: Record<NumericMeasurementKey, string> = {
  length: "長さ",
  startAngleDeg: "始点からパス内部への角度",
  endAngleDeg: "終点からパス内部への角度",
  radius: "半径",
  sweepAngleDeg: "スイープ角度",
  startRadiusAngleDeg: "中心から始点への角度",
  endRadiusAngleDeg: "中心から終点への角度",
  startHandleAngleDeg: "始点ハンドル角度",
  startHandleLength: "始点ハンドル長",
  endHandleAngleDeg: "終点ハンドル角度",
  endHandleLength: "終点ハンドル長"
};

export const lineMeasurementLabel = (property: NumericMeasurementKey) => propertyLabels[property];
