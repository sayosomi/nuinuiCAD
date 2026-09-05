import {
  isModuleGeometryInterfaceAssignable,
  type ModuleGeometryInterfaceType
} from "./moduleGeometryInterfaces";

/** Source-level immutable geometry-array type. Never enters ScalarType/runtime. */
export type GeometryArrayType = {
  kind: "geometryArray";
  elementType: ModuleGeometryInterfaceType;
};

export const dslGeometryArrayTypeNames = ["point[]", "line[]", "path[]"] as const;

export type GeometryArrayTypeName = (typeof dslGeometryArrayTypeNames)[number];

export const parseGeometryArrayTypeName = (text: string): GeometryArrayType | null => {
  if (text === "point[]") return { kind: "geometryArray", elementType: "point" };
  if (text === "line[]") return { kind: "geometryArray", elementType: "line" };
  if (text === "path[]") return { kind: "geometryArray", elementType: "path" };
  return null;
};

export const geometryArrayTypeName = (type: GeometryArrayType): GeometryArrayTypeName => `${type.elementType}[]`;

/** Array compatibility lifts the existing geometry-interface rule element-wise. */
export const isGeometryArrayTypeAssignable = (
  actual: GeometryArrayType | null | undefined,
  expected: GeometryArrayType | null | undefined
): boolean =>
  !!actual &&
  !!expected &&
  isModuleGeometryInterfaceAssignable(actual.elementType, expected.elementType);
