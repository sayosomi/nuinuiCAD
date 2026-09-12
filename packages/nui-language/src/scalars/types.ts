// Scalar type/value/evaluation contracts shared by the scalar subsystem.
// This module defines the current scalar type, value, and evaluation contract.
// No implicit conversion between kinds is ever performed here.

import type { DslOptionalValueType } from "../dsl/dslValueTypes";

export type ScalarType =
  | { kind: "number" }
  | { kind: "string" }
  | { kind: "boolean" }
  | { kind: "choice"; options: readonly string[] };

/** Scalar expression values add only the canonical host-neutral optional wrapper. */
export type ScalarExpressionType = ScalarType | DslOptionalValueType;

export type ScalarValue =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "choice"; value: string; options: readonly string[] }
  | { kind: "none" };

export type ScalarEvaluationErrorContext = {
  kind: "geometryBuiltinTarget";
  targetElementId: string;
  pointKey?: string;
};

export type ScalarEvaluation =
  | { status: "ok"; type: ScalarExpressionType; value: ScalarValue }
  | {
      status: "error";
      type: ScalarExpressionType;
      issueCode: string;
      bindingId?: string;
      context?: ScalarEvaluationErrorContext;
    };

export type NumberScalarType = Extract<ScalarType, { kind: "number" }>;
export type StringScalarType = Extract<ScalarType, { kind: "string" }>;
export type BooleanScalarType = Extract<ScalarType, { kind: "boolean" }>;
export type ChoiceScalarType = Extract<ScalarType, { kind: "choice" }>;

export const isNumberScalarType = (type: ScalarType): type is NumberScalarType => type.kind === "number";
export const isStringScalarType = (type: ScalarType): type is StringScalarType => type.kind === "string";
export const isBooleanScalarType = (type: ScalarType): type is BooleanScalarType => type.kind === "boolean";
export const isChoiceScalarType = (type: ScalarType): type is ChoiceScalarType => type.kind === "choice";

/**
 * Structural equality between two scalar types. Choice types are equal only
 * when their options are identical in both membership && order (D07): order
 * is part of choice identity because it also drives completion/cycle order.
 */
export const scalarTypesEqual = (a: ScalarType, b: ScalarType): boolean => {
  if (a.kind !== b.kind) return false;
  if (isChoiceScalarType(a) && isChoiceScalarType(b)) {
    return a.options.length === b.options.length && a.options.every((option, index) => option === b.options[index]);
  }
  return true;
};

/**
 * Checks that a runtime ScalarValue actually matches its declared
 * ScalarType, including choice option identity && literal membership.
 * Used to fail closed when validating payloads crossing a trust boundary.
 */
export const scalarValueMatchesType = (type: ScalarExpressionType, value: ScalarValue): boolean => {
  if (type.kind === "optional") {
    if (value.kind === "none") return true;
    const underlying = type.valueType;
    if (underlying.kind !== "number" && underlying.kind !== "string" && underlying.kind !== "boolean" && underlying.kind !== "choice") {
      return false;
    }
    return scalarValueMatchesType(underlying, value);
  }
  if (value.kind === "none") return false;
  if (type.kind !== value.kind) return false;
  if (isChoiceScalarType(type) && value.kind === "choice") {
    return scalarTypesEqual(type, { kind: "choice", options: value.options }) && value.options.includes(value.value);
  }
  return true;
};
