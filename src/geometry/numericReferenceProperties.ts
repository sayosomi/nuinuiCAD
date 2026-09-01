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
import {
  NUMERIC_COMPUTED_GEOMETRY_MEASUREMENT_PROPERTIES,
  numericGeometryMeasurementPropertiesForStaticTarget,
  numericGeometryStaticTargetForComputedGeometry,
  numericGeometryStaticTargetForElement,
  type NumericGeometryStaticTarget
} from "./numericGeometryProperties";

export type NumericReferenceGeometry =
  | ComputedLine
  | ComputedArcLine
  | ComputedBezierCurve
  | ComputedOffsetLine
  | ComputedPolyline;

export const numericReferencePickProperties: readonly NumericMeasurementKey[] =
  NUMERIC_COMPUTED_GEOMETRY_MEASUREMENT_PROPERTIES;

export const numericReferencePropertiesForGeometry = (
  geometry: NumericReferenceGeometry,
  staticTarget?: NumericGeometryStaticTarget | null
): readonly NumericMeasurementKey[] => numericGeometryMeasurementPropertiesForStaticTarget(
  staticTarget === undefined ? numericGeometryStaticTargetForComputedGeometry(geometry) : staticTarget
) as readonly NumericMeasurementKey[];

export const numericReferencePropertiesForElement = (
  element: CadElement,
  options: { baseTarget?: NumericGeometryStaticTarget | null } = {}
): readonly NumericMeasurementKey[] => numericGeometryMeasurementPropertiesForStaticTarget(
  numericGeometryStaticTargetForElement(element, options)
) as readonly NumericMeasurementKey[];

export const numericReferenceGeometrySupportsProperty = (
  geometry: NumericReferenceGeometry,
  property: NumericMeasurementKey,
  staticTarget?: NumericGeometryStaticTarget | null
) => numericReferencePropertiesForGeometry(geometry, staticTarget).includes(property);

/**
 * Default measurement to start a numeric-reference pick on, before the user
 * cycles through `numericReferencePickProperties` (Left/Right). Angle-shaped
 * target parameters (recognized by their `stepLevels`) start on an angle
 * instead of always defaulting to length. "length" and "startAngleDeg" are
 * both supported by every NumericReferenceGeometry kind (see
 * numericReferencePropertiesForGeometry above), so either default is always a
 * valid starting candidate regardless of what geometry the user picks.
 */
export const initialNumericReferencePickProperty = (
  stepLevels?: readonly number[]
): NumericMeasurementKey => (stepLevels === angleNumericParameterStepLevels ? "startAngleDeg" : "length");
