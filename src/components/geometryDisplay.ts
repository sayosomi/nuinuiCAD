import type { NumericMeasurementKey } from "../geometry/numericExpressions";
import type {
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedLine,
  ComputedPoint
} from "../types/geometry";

export const formatNumber = (value: number) =>
  Number.isInteger(value) ? `${value}` : value.toFixed(2).replace(/\.?0+$/, "");

export const formatMillimeters = (value: number) => `${formatNumber(value)} mm`;

export const formatCoordinate = (point: ComputedPoint) =>
  `(${formatNumber(point.x)}, ${formatNumber(point.y)})`;

const normalizeDegrees = (degrees: number) => (degrees + 360) % 360;

export const formatAngleDeg = (degrees: number | null) =>
  degrees === null ? "未定義" : `${formatNumber(normalizeDegrees(degrees))}°`;

export const numericReferenceProperties = (
  geometry: ComputedLine | ComputedArcLine | ComputedBezierCurve
) =>
  geometry.kind === "line"
    ? (["length", "startAngleDeg", "endAngleDeg"] as const)
    : geometry.kind === "arcLine"
      ? (["length", "startAngleDeg", "endAngleDeg"] as const)
      : (["length"] as const);

export const numericReferenceExpression = (
  geometry: ComputedLine | ComputedArcLine | ComputedBezierCurve,
  property: NumericMeasurementKey
) => `${geometry.elementId}.${property}`;

export const numericReferenceValue = (
  geometry: ComputedLine | ComputedArcLine | ComputedBezierCurve,
  property: NumericMeasurementKey
) => {
  if (property === "length") return formatMillimeters(geometry.length);
  if ((geometry.kind === "line" || geometry.kind === "arcLine") && property === "startAngleDeg") {
    return formatAngleDeg(geometry.startAngleDeg);
  }
  if ((geometry.kind === "line" || geometry.kind === "arcLine") && property === "endAngleDeg") {
    return formatAngleDeg(geometry.endAngleDeg);
  }
  return "";
};

export const pointCoordinateRows = (point: ComputedPoint) => [
  { label: "座標", value: formatCoordinate(point) }
];

export const lineInfoRows = (line: ComputedLine) => [
  { label: "始点", value: formatCoordinate(line.start) },
  { label: "終点", value: formatCoordinate(line.end) },
  { label: "始角度", value: formatAngleDeg(line.startAngleDeg) },
  { label: "終角度", value: formatAngleDeg(line.endAngleDeg) },
  { label: "長さ", value: formatMillimeters(line.length) }
];

export const arcLineInfoRows = (arc: ComputedArcLine) => [
  { label: "中心点", value: formatCoordinate(arc.center) },
  { label: "始点", value: formatCoordinate(arc.start) },
  { label: "終点", value: formatCoordinate(arc.end) },
  { label: "半径", value: formatMillimeters(arc.radius) },
  { label: "始角度", value: formatAngleDeg(arc.startAngleDeg) },
  { label: "終角度", value: formatAngleDeg(arc.endAngleDeg) },
  { label: "長さ", value: formatMillimeters(arc.length) }
];

export const bezierCurveInfoRows = (curve: ComputedBezierCurve) => [
  { label: "区間数", value: `${curve.segments.length}` },
  { label: "長さ", value: formatMillimeters(curve.length) }
];
