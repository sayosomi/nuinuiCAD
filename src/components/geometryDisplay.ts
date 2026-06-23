import type { NumericMeasurementKey } from "../geometry/numericExpressions";
import type {
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedLine,
  ComputedOffsetLine,
  ComputedPoint
} from "../types/geometry";
import { bezierCurveEndpointPoints } from "../geometry/lineMeasurements";

export const formatNumber = (value: number) =>
  Number.isInteger(value) ? `${value}` : value.toFixed(2).replace(/\.?0+$/, "");

export const formatMillimeters = (value: number) => `${formatNumber(value)} mm`;

export const formatCoordinate = (point: ComputedPoint) =>
  `(${formatNumber(point.x)}, ${formatNumber(point.y)})`;

const normalizeDegrees = (degrees: number) => (degrees + 360) % 360;

export const formatAngleDeg = (degrees: number | null) =>
  degrees === null ? "未定義" : `${formatNumber(normalizeDegrees(degrees))}°`;

export const numericReferenceProperties = (
  geometry: ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine
) =>
  geometry.kind === "arcLine"
    ? ([
        "length",
        "startAngleDeg",
        "endAngleDeg",
        "startTangentAngleDeg",
        "endTangentAngleDeg"
      ] as const)
    : (["length", "startTangentAngleDeg", "endTangentAngleDeg"] as const);

export const numericReferenceExpression = (
  geometry: ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine,
  property: NumericMeasurementKey
) => `${geometry.elementId}.${property}`;

export const numericReferenceValue = (
  geometry: ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine,
  property: NumericMeasurementKey
) => {
  if (property === "length") return formatMillimeters(geometry.length);
  if ((geometry.kind === "line" || geometry.kind === "arcLine") && property === "startAngleDeg") {
    return formatAngleDeg(geometry.startAngleDeg);
  }
  if ((geometry.kind === "line" || geometry.kind === "arcLine") && property === "endAngleDeg") {
    return formatAngleDeg(geometry.endAngleDeg);
  }
  if (property === "startTangentAngleDeg") {
    return formatAngleDeg(geometry.startTangentAngleDeg);
  }
  if (property === "endTangentAngleDeg") {
    return formatAngleDeg(geometry.endTangentAngleDeg);
  }
  return "";
};

export const numericReferenceLabel = (
  geometry: ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine,
  property: NumericMeasurementKey
) => {
  if (geometry.kind === "arcLine" && property === "startAngleDeg") return "始トリム角度";
  if (geometry.kind === "arcLine" && property === "endAngleDeg") return "終トリム角度";
  if (property === "startTangentAngleDeg") return "始接線角度";
  if (property === "endTangentAngleDeg") return "終接線角度";
  if (geometry.kind === "line" && property === "startAngleDeg") return "始接線角度";
  if (geometry.kind === "line" && property === "endAngleDeg") return "終接線角度";
  return property === "length" ? "長さ" : property;
};

export const pointCoordinateRows = (point: ComputedPoint) => [
  { label: "座標", value: formatCoordinate(point) }
];

export const lineInfoRows = (line: ComputedLine) => [
  { label: "始点", value: formatCoordinate(line.start) },
  { label: "終点", value: formatCoordinate(line.end) },
  { label: "始接線角度", value: formatAngleDeg(line.startTangentAngleDeg) },
  { label: "終接線角度", value: formatAngleDeg(line.endTangentAngleDeg) },
  { label: "長さ", value: formatMillimeters(line.length) }
];

export const arcLineInfoRows = (arc: ComputedArcLine) => [
  { label: "中心点", value: formatCoordinate(arc.center) },
  { label: "始点", value: formatCoordinate(arc.start) },
  { label: "終点", value: formatCoordinate(arc.end) },
  { label: "半径", value: formatMillimeters(arc.radius) },
  { label: "始トリム角度", value: formatAngleDeg(arc.startAngleDeg) },
  { label: "終トリム角度", value: formatAngleDeg(arc.endAngleDeg) },
  { label: "始接線角度", value: formatAngleDeg(arc.startTangentAngleDeg) },
  { label: "終接線角度", value: formatAngleDeg(arc.endTangentAngleDeg) },
  { label: "長さ", value: formatMillimeters(arc.length) }
];

export const bezierCurveInfoRows = (curve: ComputedBezierCurve) => {
  const endpoints = bezierCurveEndpointPoints(curve);
  return [
    { label: "始点", value: endpoints.start ? formatCoordinate(endpoints.start) : "未定義" },
    { label: "終点", value: endpoints.end ? formatCoordinate(endpoints.end) : "未定義" },
    { label: "始接線角度", value: formatAngleDeg(curve.startTangentAngleDeg) },
    { label: "終接線角度", value: formatAngleDeg(curve.endTangentAngleDeg) },
    { label: "長さ", value: formatMillimeters(curve.length) }
  ];
};

export const offsetLineInfoRows = (line: ComputedOffsetLine) => [
  { label: "始点", value: line.start ? formatCoordinate(line.start) : "未定義" },
  { label: "終点", value: line.end ? formatCoordinate(line.end) : "未定義" },
  { label: "始接線角度", value: formatAngleDeg(line.startTangentAngleDeg) },
  { label: "終接線角度", value: formatAngleDeg(line.endTangentAngleDeg) },
  { label: "長さ", value: formatMillimeters(line.length) },
  ...(line.closed ? [{ label: "閉じる", value: "はい" }] : [])
];
