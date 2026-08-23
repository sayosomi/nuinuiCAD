import type { NumericMeasurementKey } from "./numericExpressions";
import { propertyLabels } from "./numericExpressionProperties";
import {
  numericReferencePropertiesForGeometry,
  type NumericReferenceGeometry
} from "./numericReferenceProperties";
import type {
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedGeometry,
  ComputedJoinedPath,
  ComputedLine,
  ComputedOffsetLine,
  ComputedPoint
} from "../types/geometry";
import { bezierCurveEndpointPoints } from "./lineMeasurements";

export type GeometryInfoRow = {
  label: string;
  value: string;
};

export const formatNumber = (value: number) =>
  Number.isInteger(value) ? `${value}` : value.toFixed(2).replace(/\.?0+$/, "");

export const formatMillimeters = (value: number) => `${formatNumber(value)} mm`;

export const formatCoordinate = (point: ComputedPoint) =>
  `(${formatNumber(point.x)}, ${formatNumber(point.y)})`;

const normalizeDegrees = (degrees: number) => (degrees + 360) % 360;

export const formatAngleDeg = (degrees: number | null) =>
  degrees === null ? "未定義" : `${formatNumber(normalizeDegrees(degrees))}°`;

export const numericReferenceProperties = (
  geometry: NumericReferenceGeometry
) => numericReferencePropertiesForGeometry(geometry);

export const numericReferenceExpression = (
  geometry: ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine | ComputedJoinedPath,
  property: NumericMeasurementKey
) => `${geometry.elementId}.${property}`;

export const numericReferenceValue = (
  geometry: ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine | ComputedJoinedPath,
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
  if (geometry.kind === "bezierCurve" && property === "startHandleAngleDeg") {
    return formatAngleDeg(geometry.startHandleAngleDeg);
  }
  if (geometry.kind === "bezierCurve" && property === "startHandleLength") {
    return formatMillimeters(geometry.startHandleLength);
  }
  if (geometry.kind === "bezierCurve" && property === "endHandleAngleDeg") {
    return formatAngleDeg(geometry.endHandleAngleDeg);
  }
  if (geometry.kind === "bezierCurve" && property === "endHandleLength") {
    return formatMillimeters(geometry.endHandleLength);
  }
  return "";
};

export const numericReferenceLabel = (
  geometry: ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine | ComputedJoinedPath,
  property: NumericMeasurementKey
) => {
  if (geometry.kind === "arcLine" && property === "startAngleDeg") return "始トリム角度";
  if (geometry.kind === "arcLine" && property === "endAngleDeg") return "終トリム角度";
  if (property === "startTangentAngleDeg") return "始接線角度";
  if (property === "endTangentAngleDeg") return "終接線角度";
  if (geometry.kind === "line" && property === "startAngleDeg") return "始接線角度";
  if (geometry.kind === "line" && property === "endAngleDeg") return "終接線角度";
  return propertyLabels[property];
};

export const pointCoordinateRows = (point: ComputedPoint): GeometryInfoRow[] => [
  { label: "座標", value: formatCoordinate(point) }
];

export const lineInfoRows = (line: ComputedLine): GeometryInfoRow[] => [
  { label: "始点", value: formatCoordinate(line.start) },
  { label: "終点", value: formatCoordinate(line.end) },
  { label: "始接線角度", value: formatAngleDeg(line.startTangentAngleDeg) },
  { label: "終接線角度", value: formatAngleDeg(line.endTangentAngleDeg) },
  { label: "長さ", value: formatMillimeters(line.length) }
];

export const arcLineInfoRows = (arc: ComputedArcLine): GeometryInfoRow[] => [
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

export const bezierCurveInfoRows = (curve: ComputedBezierCurve): GeometryInfoRow[] => {
  const endpoints = bezierCurveEndpointPoints(curve);
  return [
    { label: "始点", value: endpoints.start ? formatCoordinate(endpoints.start) : "未定義" },
    { label: "終点", value: endpoints.end ? formatCoordinate(endpoints.end) : "未定義" },
    { label: "始接線角度", value: formatAngleDeg(curve.startTangentAngleDeg) },
    { label: "終接線角度", value: formatAngleDeg(curve.endTangentAngleDeg) },
    { label: "始点角度", value: formatAngleDeg(curve.startHandleAngleDeg) },
    { label: "始点ハンドル長", value: formatMillimeters(curve.startHandleLength) },
    { label: "終点角度", value: formatAngleDeg(curve.endHandleAngleDeg) },
    { label: "終点ハンドル長", value: formatMillimeters(curve.endHandleLength) },
    { label: "長さ", value: formatMillimeters(curve.length) }
  ];
};

export const offsetLineInfoRows = (line: ComputedOffsetLine): GeometryInfoRow[] => [
  { label: "始点", value: line.start ? formatCoordinate(line.start) : "未定義" },
  { label: "終点", value: line.end ? formatCoordinate(line.end) : "未定義" },
  { label: "始接線角度", value: formatAngleDeg(line.startTangentAngleDeg) },
  { label: "終接線角度", value: formatAngleDeg(line.endTangentAngleDeg) },
  { label: "長さ", value: formatMillimeters(line.length) },
  ...(line.closed ? [{ label: "閉じる", value: "はい" }] : [])
];

export const joinedPathInfoRows = (line: ComputedJoinedPath): GeometryInfoRow[] => [
  { label: "始点", value: line.start ? formatCoordinate(line.start) : "未定義" },
  { label: "終点", value: line.end ? formatCoordinate(line.end) : "未定義" },
  { label: "始接線角度", value: formatAngleDeg(line.startTangentAngleDeg) },
  { label: "終接線角度", value: formatAngleDeg(line.endTangentAngleDeg) },
  { label: "長さ", value: formatMillimeters(line.length) },
  ...(line.closed ? [{ label: "閉じる", value: "はい" }] : [])
];

/** Shared host-neutral measurement presentation for Inspector, Canvas, and native hosts. */
export const geometryInfoRows = (
  geometry: ComputedGeometry | undefined
): GeometryInfoRow[] => {
  if (!geometry) return [];
  if (geometry.kind === "point") return pointCoordinateRows(geometry);
  if (geometry.kind === "line") return lineInfoRows(geometry);
  if (geometry.kind === "arcLine") return arcLineInfoRows(geometry);
  if (geometry.kind === "bezierCurve") return bezierCurveInfoRows(geometry);
  if (geometry.kind === "offsetLine") return offsetLineInfoRows(geometry);
  if (geometry.kind === "joinedPath") return joinedPathInfoRows(geometry);
  return [];
};
