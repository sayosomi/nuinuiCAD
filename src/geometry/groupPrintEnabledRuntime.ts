// Task 24: resolves group.printEnabled as a print-state axis, independent of
// Task 23's standard property runtime (propertyBindingRuntime.ts) and of
// activity (elementActivity.ts). This module deliberately does not add
// "group"/"printEnabled" to Task 23's STANDARD_PROPERTY_TARGETS allowlist -
// that allowlist drives per-element materialization before normal
// evaluation, which groups never go through and must not start going through
// here (printEnabled must not affect Canvas/evaluation).
//
// No new document-wide map is built. `doc.statementMap.byElementId`
// (elementId -> StatementInfo, carrying statementIndex) and
// `doc.propertyBindings` (Task 22's occurrence-keyed compiled binding
// sources) already exist, already built exactly once per compile. Chaining
// them is already O(1) per group with zero scanning, so
// `GroupPrintEnabledLookup` below is just a named pair of those two existing
// references - never a place to store a freshly scanned map.

import type { CadElement, ElementId, EvaluationResult } from "../types/geometry";
import type { CompiledDslDocument, StatementMap } from "../dsl/dslDocument";
import type { BindingId } from "../scalars/bindingCatalog";
import { propertyBindingOccurrenceKey } from "../scalars/propertyBindingCompiler";

/**
 * A thin alias bundling two already-compiled lookups for passing through
 * call sites together - not a computed map. Both fields are meant to be the
 * exact same references as `doc.propertyBindings` / `doc.statementMap.byElementId`.
 */
export type GroupPrintEnabledLookup = {
  propertyBindings: CompiledDslDocument["propertyBindings"];
  byElementId: StatementMap["byElementId"];
};

/** One statementIndex lookup + one occurrence-key lookup, both O(1). No scan. */
export const resolveGroupPrintEnabledBindingId = (
  groupId: ElementId,
  lookup: GroupPrintEnabledLookup
): BindingId | undefined => {
  if (!lookup.propertyBindings) return undefined;
  const statementIndex = lookup.byElementId.get(groupId)?.statementIndex;
  if (statementIndex === undefined) return undefined;
  const source = lookup.propertyBindings.get(propertyBindingOccurrenceKey(statementIndex, "printEnabled"));
  return source?.kind === "binding" ? source.bindingId : undefined;
};

/**
 * Whether `group` is print-enabled: the literal field when unbound, or the
 * resolved scalar binding value when bound. Fails closed to `false` on any
 * non-"ok"/non-boolean evaluation (including a poisoned binding), and never
 * touches `errors`/`warnings` - a print-disabled group is simply excluded
 * from print output, with no effect on Canvas or normal evaluation.
 */
export const isGroupPrintEnabled = (
  group: Extract<CadElement, { type: "group" }>,
  lookup: GroupPrintEnabledLookup | undefined,
  computedScalarBindings: EvaluationResult["computedScalarBindings"]
): boolean => {
  const bindingId = lookup ? resolveGroupPrintEnabledBindingId(group.id, lookup) : undefined;
  if (bindingId === undefined) return group.printEnabled === true;
  const evaluation = computedScalarBindings?.get(bindingId);
  return (
    evaluation?.status === "ok" &&
    evaluation.type.kind === "boolean" &&
    evaluation.value.value === true
  );
};
