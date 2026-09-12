// Assignability rules for typed scalar bindings. nui1 uses exact structural
// matching for both ordinary bindings && schema-typed property bindings.

import { scalarTypesEqual, type ChoiceScalarType, type ScalarExpressionType, type ScalarType } from "./types";
import { isDslValueTypeAssignable } from "../dsl/dslValueTypes";

/** Bindings, set targets, && schema-typed properties require exact types. */
export const isScalarTypeAssignable = (from: ScalarType, to: ScalarType): boolean => scalarTypesEqual(from, to);

/** Scalar expression assignability delegates to the canonical DSL value type. */
export const isScalarExpressionTypeAssignable = (from: ScalarExpressionType, to: ScalarExpressionType): boolean =>
  isDslValueTypeAssignable(from, to);

export const scalarExpressionTypesEqual = (from: ScalarExpressionType, to: ScalarExpressionType): boolean =>
  isScalarExpressionTypeAssignable(from, to) && isScalarExpressionTypeAssignable(to, from);

export const isChoiceOptionMember = (type: ChoiceScalarType, literal: string): boolean => type.options.includes(literal);
