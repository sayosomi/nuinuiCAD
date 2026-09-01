import type { NumericMeasurementKey } from "./numericExpressions";
import { computedReferencePathValue } from "./numericExpressions";
import { propertyLabels } from "./numericExpressionProperties";
import {
  numericReferencePropertiesForGeometry,
  type NumericReferenceGeometry
} from "./numericReferenceProperties";
import type {
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedGeometry,
  ComputedLine,
  ComputedOffsetLine,
  ComputedPolyline,
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

export const formatAngleDeg = (degrees: number | null | undefined) =>
  degrees === null || degrees === undefined ? "未定義" : `${formatNumber(normalizeDegrees(degrees))}°`;

export const numericReferenceProperties = (
  geometry: NumericReferenceGeometry
) => numericReferencePropertiesForGeometry(geometry);

export const numericReferenceExpression = (
  geometry: ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine | ComputedPolyline,
  property: NumericMeasurementKey
) => `${geometry.elementId}.${property}`;

export const numericReferenceValue = (
  geometry: ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine | ComputedPolyline,
  property: NumericMeasurementKey
) => {
  const value = computedReferencePathValue(geometry, property);
  if (value === undefined) return "未定義";
  if (property === "sweepAngleDeg") return `${formatNumber(value)}°`;
  if (property.toLowerCase().includes("angle") || property.endsWith("Deg")) return formatAngleDeg(value);
  if (property === "length" || property === "radius" || property.endsWith("Length")) return formatMillimeters(value);
  return "";
};

export const numericReferenceLabel = (
  geometry: ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine | ComputedPolyline,
  property: NumericMeasurementKey
) => propertyLabels[property];

export const pointCoordinateRows = (point: ComputedPoint): GeometryInfoRow[] => [
  { label: "座標", value: formatCoordinate(point) }
];

export const lineInfoRows = (line: ComputedLine): GeometryInfoRow[] => [
  { label: "始点", value: formatCoordinate(line.start) },
  { label: "終点", value: formatCoordinate(line.end) },
  { label: propertyLabels.startAngleDeg, value: numericReferenceValue(line, "startAngleDeg") },
  { label: propertyLabels.endAngleDeg, value: numericReferenceValue(line, "endAngleDeg") },
  { label: "長さ", value: formatMillimeters(line.length) }
];

export const arcLineInfoRows = (arc: ComputedArcLine): GeometryInfoRow[] => [
  { label: "中心点", value: formatCoordinate(arc.center) },
  { label: "始点", value: formatCoordinate(arc.start) },
  { label: "終点", value: formatCoordinate(arc.end) },
  { label: "半径", value: formatMillimeters(arc.radius) },
  { label: propertyLabels.startAngleDeg, value: numericReferenceValue(arc, "startAngleDeg") },
  { label: propertyLabels.endAngleDeg, value: numericReferenceValue(arc, "endAngleDeg") },
  { label: propertyLabels.startRadiusAngleDeg, value: numericReferenceValue(arc, "startRadiusAngleDeg") },
  { label: propertyLabels.endRadiusAngleDeg, value: numericReferenceValue(arc, "endRadiusAngleDeg") },
  { label: propertyLabels.sweepAngleDeg, value: numericReferenceValue(arc, "sweepAngleDeg") },
  { label: "長さ", value: formatMillimeters(arc.length) }
];

export const bezierCurveInfoRows = (curve: ComputedBezierCurve): GeometryInfoRow[] => {
  const endpoints = bezierCurveEndpointPoints(curve);
  return [
    { label: "始点", value: endpoints.start ? formatCoordinate(endpoints.start) : "未定義" },
    { label: "終点", value: endpoints.end ? formatCoordinate(endpoints.end) : "未定義" },
    { label: propertyLabels.startAngleDeg, value: numericReferenceValue(curve, "startAngleDeg") },
    { label: propertyLabels.endAngleDeg, value: numericReferenceValue(curve, "endAngleDeg") },
    { label: propertyLabels.startHandleAngleDeg, value: numericReferenceValue(curve, "startHandleAngleDeg") },
    { label: propertyLabels.startHandleLength, value: numericReferenceValue(curve, "startHandleLength") },
    { label: propertyLabels.endHandleAngleDeg, value: numericReferenceValue(curve, "endHandleAngleDeg") },
    { label: propertyLabels.endHandleLength, value: numericReferenceValue(curve, "endHandleLength") },
    { label: "長さ", value: formatMillimeters(curve.length) }
  ];
};

export const offsetLineInfoRows = (line: ComputedOffsetLine): GeometryInfoRow[] => [
  { label: "始点", value: line.start ? formatCoordinate(line.start) : "未定義" },
  { label: "終点", value: line.end ? formatCoordinate(line.end) : "未定義" },
  { label: propertyLabels.startAngleDeg, value: numericReferenceValue(line, "startAngleDeg") },
  { label: propertyLabels.endAngleDeg, value: numericReferenceValue(line, "endAngleDeg") },
  { label: "長さ", value: formatMillimeters(line.length) },
  ...(line.closed ? [{ label: "閉じる", value: "はい" }] : [])
];

export const polylineInfoRows = (line: ComputedPolyline): GeometryInfoRow[] => [
  { label: "始点", value: formatCoordinate(line.start) },
  { label: "終点", value: formatCoordinate(line.end) },
  { label: propertyLabels.startAngleDeg, value: numericReferenceValue(line, "startAngleDeg") },
  { label: propertyLabels.endAngleDeg, value: numericReferenceValue(line, "endAngleDeg") },
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
  if (geometry.kind === "polyline") return polylineInfoRows(geometry);
  return [];
};
