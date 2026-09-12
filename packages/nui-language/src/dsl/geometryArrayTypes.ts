import {
  isModuleGeometryInterfaceAssignable,
  type ModuleGeometryInterfaceType
} from "./moduleGeometryInterfaces";
import {
  geometryArrayValueTypeOfDslValueType,
  isDslValueTypeAssignable,
  type DslArrayValueType,
  type DslNonArrayValueType,
  type DslValueType
} from "./dslValueTypes";

/** Source-level immutable geometry-array type. Never enters ScalarType/runtime. */
export type GeometryArrayType = {
  kind: "geometryArray";
  elementType: ModuleGeometryInterfaceType;
};

export const dslGeometryArrayTypeNames = ["point[]", "line[]", "path[]"] as const;

export type GeometryArrayTypeName = (typeof dslGeometryArrayTypeNames)[number];

const geometryKindOfTypeName = (text: string): ModuleGeometryInterfaceType | null => {
  if (text === "point[]") return "point";
  if (text === "line[]") return "line";
  if (text === "path[]") return "path";
  return null;
};

/** Convert the existing compatibility shape into the canonical value model. */
export const dslValueTypeOfGeometryArrayType = (type: GeometryArrayType): DslArrayValueType => ({
  kind: "array",
  elementType: { kind: type.elementType }
});

/** Convert the canonical geometry array subset into the existing compatibility shape. */
export const geometryArrayTypeOfDslValueType = (valueType: DslValueType | null | undefined): GeometryArrayType | null => {
  const arrayValueType = geometryArrayValueTypeOfDslValueType(valueType);
  if (!arrayValueType) return null;
  const elementType = arrayValueType.elementType.kind;
  return elementType === "point" || elementType === "line" || elementType === "path"
    ? { kind: "geometryArray", elementType }
    : null;
};

/** Parse the current declaration-facing geometry-array vocabulary into valueType. */
export const dslValueTypeOfGeometryArrayTypeName = (text: string): DslArrayValueType | null => {
  const elementType = geometryKindOfTypeName(text);
  return elementType ? { kind: "array", elementType: { kind: elementType } } : null;
};

export const parseGeometryArrayTypeName = (text: string): GeometryArrayType | null => {
  const elementType = geometryKindOfTypeName(text);
  return elementType ? { kind: "geometryArray", elementType } : null;
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

/** Shared element-level assignability for the generalized immutable array. */
export const isDslNonArrayValueTypeAssignable = (
  actual: DslNonArrayValueType | null | undefined,
  expected: DslNonArrayValueType | null | undefined
): boolean => !!actual && !!expected && isDslValueTypeAssignable(actual, expected);

/** Array assignability is the existing element contract lifted one level. */
export const isDslArrayValueTypeAssignable = (
  actual: DslArrayValueType | null | undefined,
  expected: DslArrayValueType | null | undefined
): boolean => !!actual && !!expected && isDslValueTypeAssignable(actual, expected);

export const dslArrayValueTypeName = (type: DslArrayValueType): string => {
  const element = type.elementType;
  if (element.kind === "choice") return `choice(${element.options.join(", ")})[]`;
  if (element.kind === "optional") {
    const underlying = element.valueType;
    if (underlying.kind === "choice") return `choice(${underlying.options.join(", ")})?[]`;
    return `${underlying.kind === "record" ? underlying.name : underlying.kind}?[]`;
  }
  return `${element.kind === "record" ? element.name : element.kind}[]`;
};
