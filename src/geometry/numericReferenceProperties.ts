import { angleNumericParameterStepLevels } from "../parameters/parameterDefinitions";
import type {
  CadElement,
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedLine,
  ComputedOffsetLine,
  ComputedPolyline
} from "../types/geometry";
import type { NumericMeasurementKey } from "./numericExpressionTypes";

export type NumericReferenceGeometry =
  | ComputedLine
  | ComputedArcLine
  | ComputedBezierCurve
  | ComputedOffsetLine
  | ComputedPolyline;

export const numericReferencePickProperties: readonly NumericMeasurementKey[] = [
  "length",
  "startTangentAngleDeg",
  "endTangentAngleDeg",
  "startAngleDeg",
  "endAngleDeg",
  "startHandleAngleDeg",
  "startHandleLength",
  "endHandleAngleDeg",
  "endHandleLength"
];

export const isNumericMeasurementKey = (value: unknown): value is NumericMeasurementKey =>
  typeof value === "string" && numericReferencePickProperties.includes(value as NumericMeasurementKey);

export const numericReferencePropertiesForGeometry = (
  geometry: NumericReferenceGeometry
): readonly NumericMeasurementKey[] => {
  if (geometry.kind === "arcLine") {
    return ["length", "startAngleDeg", "endAngleDeg", "startTangentAngleDeg", "endTangentAngleDeg"];
  }

  if (geometry.kind === "bezierCurve") {
    return [
      "length",
      "startTangentAngleDeg",
      "endTangentAngleDeg",
      "startHandleAngleDeg",
      "startHandleLength",
      "endHandleAngleDeg",
      "endHandleLength"
    ];
  }

  return ["length", "startTangentAngleDeg", "endTangentAngleDeg"];
};

export const numericReferencePropertiesForElement = (
  element: CadElement
): readonly NumericMeasurementKey[] => {
  if (
    element.type === "line" ||
    element.type === "angleLengthLine" ||
    element.type === "commonTangentLine" ||
    element.type === "arcLine" ||
    element.type === "threePointArcLine" ||
    element.type === "cornerRadiusArcLine"
  ) {
    return ["length", "startAngleDeg", "endAngleDeg", "startTangentAngleDeg", "endTangentAngleDeg"];
  }

  if (element.type === "polyline") {
    return ["length", "startTangentAngleDeg", "endTangentAngleDeg"];
  }

  if (element.type === "bezierCurve") {
    return [
      "length",
      "startTangentAngleDeg",
      "endTangentAngleDeg",
      "startHandleAngleDeg",
      "startHandleLength",
      "endHandleAngleDeg",
      "endHandleLength"
    ];
  }

  if (
    element.type === "offsetLine" ||
    element.type === "copyLine" ||
    element.type === "symmetricCopyLine"
  ) {
    return ["length", "startTangentAngleDeg", "endTangentAngleDeg"];
  }

  return [];
};

export const numericReferenceGeometrySupportsProperty = (
  geometry: NumericReferenceGeometry,
  property: NumericMeasurementKey
) => numericReferencePropertiesForGeometry(geometry).includes(property);

/**
 * Default measurement to start a numeric-reference pick on, before the user
 * cycles through `numericReferencePickProperties` (Left/Right). Angle-shaped
 * target parameters (recognized by their `stepLevels`) start on an angle
 * instead of always defaulting to length. "length" && "startTangentAngleDeg"
 * are both supported by every NumericReferenceGeometry kind (see
 * numericReferencePropertiesForGeometry above), so either default is always a
 * valid starting candidate regardless of what geometry the user picks.
 */
export const initialNumericReferencePickProperty = (
  stepLevels?: readonly number[]
): NumericMeasurementKey => (stepLevels === angleNumericParameterStepLevels ? "startTangentAngleDeg" : "length");
