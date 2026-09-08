import type { ScalarType } from "../scalars/types";

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

/** A value type that is not an array. Array element types use this boundary. */
export type DslNonArrayValueType = ScalarType | DslGeometryValueType | DslRecordTypeReference;

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

/** Project the scalar portion of a source value type for scalar consumers. */
export const scalarTypeOfDslValueType = (
  valueType: DslValueType | null | undefined
): ScalarType | null => isDslScalarValueType(valueType) ? valueType : null;

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
