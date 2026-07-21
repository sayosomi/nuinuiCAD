// Assignability rules for typed scalar bindings, including the single
// sanctioned subset-assignment path: property capability (D07). Normal
// binding-to-binding assignment never allows a subset relationship or any
// implicit conversion (D01).

import { isChoiceScalarType, scalarTypesEqual, type ChoiceScalarType, type ScalarType } from "./types";

/**
 * Normal scalar assignability: bindings, set targets, and choice equality
 * all require an exact structural type match. There is no subset or
 * widening rule here — that only exists for property capability below.
 */
export const isScalarTypeAssignable = (from: ScalarType, to: ScalarType): boolean => scalarTypesEqual(from, to);

export const isChoiceOptionMember = (type: ChoiceScalarType, literal: string): boolean => type.options.includes(literal);

/**
 * Describes the scalar type a single element property opts into accepting
 * a typed binding for. The property/element identity itself (e.g.
 * `offsetLine.side`) is out of scope for this task; later tasks attach one
 * of these per opted-in property.
 */
export type PropertyBindingCapability = {
  propertyType: ScalarType;
};

/**
 * Whether a binding's type may be assigned to a property capability.
 * Non-choice kinds require an exact kind match (equivalent to
 * scalarTypesEqual, since those kinds carry no parameters). Choice is the
 * one case where a subset is allowed: every option the binding can produce
 * must be a valid option of the property (D07) — the binding's own option
 * order need not match the property's.
 *
 * The subset check is O(n+m) via a local Set lookup over the property's
 * options, not O(n*m) via every+includes. That Set is a function-scoped
 * helper, never returned or serialized — it does not conflict with the
 * IPC boundary's "JSON only, no Map/Set" rule, which governs data crossing
 * the Tauri boundary rather than internal implementation detail.
 */
export const isAssignableToPropertyCapability = (
  bindingType: ScalarType,
  capability: PropertyBindingCapability
): boolean => {
  const propertyType = capability.propertyType;
  if (bindingType.kind !== propertyType.kind) return false;
  if (isChoiceScalarType(bindingType) && isChoiceScalarType(propertyType)) {
    const propertyOptionSet = new Set(propertyType.options);
    return bindingType.options.every((option) => propertyOptionSet.has(option));
  }
  return true;
};
