// Assignability rules for typed scalar bindings. nui1 uses exact structural
// matching for both ordinary bindings && schema-typed property bindings.

import { scalarTypesEqual, type ChoiceScalarType, type ScalarType } from "./types";

/** Bindings, set targets, && schema-typed properties require exact types. */
export const isScalarTypeAssignable = (from: ScalarType, to: ScalarType): boolean => scalarTypesEqual(from, to);

export const isChoiceOptionMember = (type: ChoiceScalarType, literal: string): boolean => type.options.includes(literal);
