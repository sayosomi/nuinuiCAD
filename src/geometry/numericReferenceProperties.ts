import type {
  CadElement,
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedLine,
  ComputedOffsetLine
} from "../types/geometry";
import type { NumericMeasurementKey } from "./numericExpressionTypes";

export type NumericReferenceGeometry =
  | ComputedLine
  | ComputedArcLine
  | ComputedBezierCurve
  | ComputedOffsetLine;

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
    element.type === "arcLine" ||
    element.type === "threePointArcLine" ||
    element.type === "cornerRadiusArcLine"
  ) {
    return ["length", "startAngleDeg", "endAngleDeg", "startTangentAngleDeg", "endTangentAngleDeg"];
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
