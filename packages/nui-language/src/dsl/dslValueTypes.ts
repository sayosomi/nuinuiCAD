import { scalarTypesEqual, type ScalarType } from "../scalars/types";
import { isModuleGeometryInterfaceAssignable } from "./moduleGeometryInterfaces";

/** Host-neutral geometry value type used by the source-level value model. */
export type DslGeometryValueType = {
  readonly kind: "point" | "line" | "path";
};

/** Source-level nominal record identity. This never enters ScalarType/runtime. */
export type DslRecordTypeReference = {
  readonly kind: "record";
  readonly name: string;
  /** Resolved semantic identity when a source owner has already established it. */
  readonly identity?: string;
};

/** A value type that is not an array, before optionality is applied. */
export type DslRequiredNonArrayValueType = ScalarType | DslGeometryValueType | DslRecordTypeReference;

/**
 * The single optionality authority for immutable DSL values. The underlying
 * type is never optional, which makes repeated `?` a structural impossibility
 * as well as a parser diagnostic. Arrays remain one-dimensional: an optional
 * array is a wrapper around the array, while an optional array member is the
 * element type of the array.
 */
export type DslOptionalValueType = {
  readonly kind: "optional";
  readonly valueType: DslRequiredNonArrayValueType | DslArrayValueType;
};

/** A non-array value also includes one optional wrapper, never an optional of optional. */
export type DslNonArrayValueType = DslRequiredNonArrayValueType | DslOptionalValueType;

/** The one-dimensional array value type. Nested arrays are structurally excluded. */
export type DslArrayValueType = {
  readonly kind: "array";
  readonly elementType: DslNonArrayValueType;
};

/** Canonical host-neutral source-level immutable declaration value type. */
export type DslValueType = DslNonArrayValueType | DslArrayValueType;

const scalarKinds = new Set<ScalarType["kind"]>(["number", "string", "boolean", "choice"]);

export const isDslScalarValueType = (valueType: DslValueType | null | undefined): valueType is ScalarType =>
  valueType !== null && valueType !== undefined && scalarKinds.has(valueType.kind as ScalarType["kind"]);

export const isDslGeometryValueType = (
  valueType: DslValueType | null | undefined
): valueType is DslGeometryValueType =>
  valueType?.kind === "point" || valueType?.kind === "line" || valueType?.kind === "path";

export const isDslRecordValueType = (
  valueType: DslValueType | null | undefined
): valueType is DslRecordTypeReference => valueType?.kind === "record";

export const isDslArrayValueType = (
  valueType: DslValueType | null | undefined
): valueType is DslArrayValueType => valueType?.kind === "array";

export const isDslOptionalValueType = (
  valueType: DslValueType | null | undefined
): valueType is DslOptionalValueType => valueType?.kind === "optional";

/** Project the scalar portion of a source value type for scalar consumers. */
export const scalarTypeOfDslValueType = (
  valueType: DslValueType | null | undefined
): ScalarType | null => isDslScalarValueType(valueType) ? valueType : null;

/** Project the scalar expression subset, preserving a scalar optional wrapper. */
export const scalarExpressionTypeOfDslValueType = (
  valueType: DslValueType | null | undefined
): ScalarType | DslOptionalValueType | null => {
  if (isDslScalarValueType(valueType)) return valueType;
  if (isDslOptionalValueType(valueType) && isDslScalarValueType(valueType.valueType)) return valueType;
  return null;
};

/** Project nominal record identity without widening ScalarType. */
export const recordTypeReferenceOfDslValueType = (
  valueType: DslValueType | null | undefined
): DslRecordTypeReference | null => isDslRecordValueType(valueType) ? valueType : null;

/** Explicit alias for callers that describe the projection as nominal-record type. */
export const nominalRecordTypeOfDslValueType = recordTypeReferenceOfDslValueType;

/** Project the canonical array type while preserving the non-array element boundary. */
export const arrayValueTypeOfDslValueType = (
  valueType: DslValueType | null | undefined
): DslArrayValueType | null => isDslArrayValueType(valueType) ? valueType : null;

/** Project the geometry-only subset used by current geometry-array compatibility code. */
export const geometryArrayValueTypeOfDslValueType = (
  valueType: DslValueType | null | undefined
): DslArrayValueType | null => {
  if (!isDslArrayValueType(valueType) || !isDslGeometryValueType(valueType.elementType)) return null;
  return valueType;
};

const isAssignableArrayElement = (
  actual: DslNonArrayValueType,
  expected: DslNonArrayValueType
): boolean => isDslValueTypeAssignable(actual, expected);

/**
 * Canonical value-type assignability. Every immutable value family, including
 * optional values and one-dimensional collections, uses this boundary.
 * Optionality widens only on the expected side; it is never implicitly
 * unwrapped.
 */
export const isDslValueTypeAssignable = (actual: DslValueType, expected: DslValueType): boolean => {
  if (isDslOptionalValueType(expected)) {
    return isDslOptionalValueType(actual)
      ? isDslValueTypeAssignable(actual.valueType, expected.valueType)
      : isDslValueTypeAssignable(actual, expected.valueType);
  }
  if (isDslOptionalValueType(actual)) return false;

  if (isDslArrayValueType(actual) || isDslArrayValueType(expected)) {
    if (!isDslArrayValueType(actual) || !isDslArrayValueType(expected)) return false;
    return isAssignableArrayElement(actual.elementType, expected.elementType);
  }
  if (actual.kind !== expected.kind) {
    return isDslGeometryValueType(actual) && isDslGeometryValueType(expected)
      ? isModuleGeometryInterfaceAssignable(actual.kind, expected.kind)
      : false;
  }
  if (isDslScalarValueType(actual) && isDslScalarValueType(expected)) return scalarTypesEqual(actual, expected);
  if (isDslGeometryValueType(actual) && isDslGeometryValueType(expected)) {
    return isModuleGeometryInterfaceAssignable(actual.kind, expected.kind);
  }
  if (isDslRecordValueType(actual) && isDslRecordValueType(expected)) {
    return actual.identity !== undefined && expected.identity !== undefined
      ? actual.identity === expected.identity
      : actual.name === expected.name;
  }
  return false;
};

export const dslValueTypesEqual = (actual: DslValueType, expected: DslValueType): boolean =>
  isDslValueTypeAssignable(actual, expected) && isDslValueTypeAssignable(expected, actual);

export const dslValueTypeName = (valueType: DslValueType): string => {
  if (isDslOptionalValueType(valueType)) {
    const underlying = dslValueTypeName(valueType.valueType);
    return `${underlying}?`;
  }
  if (isDslArrayValueType(valueType)) {
    const element = valueType.elementType;
    return `${dslValueTypeName(element)}[]`;
  }
  if (isDslRecordValueType(valueType)) return valueType.name;
  if (isDslScalarValueType(valueType) && valueType.kind === "choice") return `choice(${valueType.options.join(", ")})`;
  return valueType.kind;
};
