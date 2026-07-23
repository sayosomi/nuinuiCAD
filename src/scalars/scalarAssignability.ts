// Assignability rules for typed scalar bindings, including the single
// sanctioned subset-assignment path: property capability (D07). Normal
// binding-to-binding assignment never allows a subset relationship or any
// implicit conversion (D01).

import { isChoiceScalarType, scalarTypesEqual, type ChoiceScalarType, type ScalarType, type ScalarValue } from "./types";

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

/**
 * Task 23: whether a *runtime* ScalarValue (the already-resolved value of a
 * bound property's binding) is actually usable for that property, checked
 * again at evaluation time rather than trusted from the compile-time
 * `isAssignableToPropertyCapability` check above. This is deliberately not
 * `scalarValueMatchesType` (types.ts) - that function requires the value's
 * own option list to be structurally identical to the type being checked
 * against, which would incorrectly reject the legitimate case D07 exists
 * for: a binding declared with a narrower choice type than the property it
 * is assigned to (e.g. a `choice(right)` binding assigned to
 * `offsetLine.side: choice(right, left)`). Here we only need to know whether
 * the concrete runtime literal is a member of the *property's* own option
 * set, regardless of what option list the binding's own declared type
 * carries.
 */
export const scalarValueSatisfiesPropertyCapability = (
  value: ScalarValue,
  capability: PropertyBindingCapability
): boolean => {
  const propertyType = capability.propertyType;
  if (value.kind !== propertyType.kind) return false;
  if (isChoiceScalarType(propertyType) && value.kind === "choice") {
    return propertyType.options.includes(value.value);
  }
  return true;
};
