// Resolves group.printEnabled as a print-state axis, independent of normal
// activity && geometry evaluation. It remains a dedicated physical route
// during the migration so printEnabled does not affect Canvas/evaluation;
// its scalar source is still compiled by the common typed-property frontend.
//
// No new document-wide map is built. `doc.statementMap.byElementId`
// (elementId -> StatementInfo, carrying statementIndex) &&
// `doc.propertyBindings` (Task 22's occurrence-keyed compiled binding
// sources) already exist, already built exactly once per compile. Chaining
// them is already O(1) per group with zero scanning, so
// `GroupPrintEnabledLookup` below is just a named pair of those two existing
// references - never a place to store a freshly scanned map.

import type { CadElement, ElementId, EvaluationResult } from "../types/geometry";
import type { CompiledDslDocument, StatementMap } from "../dsl/dslDocument";
import type { BindingId } from "../scalars/bindingCatalog";
import { evaluateTypedExpression } from "../scalars/expressionEvaluator";
import type { ScalarEvaluation } from "../scalars/types";
import { propertyBindingOccurrenceKey, type ScalarValueSource } from "../scalars/propertyBindingCompiler";

/**
 * A thin alias bundling two already-compiled lookups for passing through
 * call sites together - not a computed map. Both fields are meant to be the
 * exact same references as `doc.propertyBindings` / `doc.statementMap.byElementId`.
 */
export type GroupPrintEnabledLookup = {
  propertyBindings: CompiledDslDocument["propertyBindings"];
  byElementId: StatementMap["byElementId"];
  materializedPropertyBindings?: CompiledDslDocument["materializedPropertyBindings"];
  materializedBindingsByElementId?: ReadonlyMap<ElementId, ScalarValueSource>;
};

/** One statementIndex lookup + one occurrence-key lookup, both O(1). No scan. */
const resolveGroupPrintEnabledSource = (
  groupId: ElementId,
  lookup: GroupPrintEnabledLookup
): ScalarValueSource | undefined => {
  const materializedSource = lookup.materializedBindingsByElementId?.get(groupId);
  if (materializedSource) return materializedSource;
  const materialized = lookup.materializedPropertyBindings?.find((entry) =>
    entry.elementId === groupId && entry.parameterKey === "printEnabled"
  );
  if (materialized) return materialized.source;
  if (!lookup.propertyBindings) return undefined;
  const statementIndex = lookup.byElementId.get(groupId)?.statementIndex;
  if (statementIndex === undefined) return undefined;
  return lookup.propertyBindings.get(propertyBindingOccurrenceKey(statementIndex, "printEnabled"));
};

export const resolveGroupPrintEnabledBindingId = (
  groupId: ElementId,
  lookup: GroupPrintEnabledLookup
): BindingId | undefined => {
  const source = resolveGroupPrintEnabledSource(groupId, lookup);
  return source?.kind === "binding" ? source.bindingId : undefined;
};

/**
 * Whether `group` is print-enabled: the literal field when unbound, || the
 * resolved scalar binding value when bound. Fails closed to `false` on any
 * non-"ok"/non-boolean evaluation (including a poisoned binding), && never
 * touches `errors`/`warnings` - a print-disabled group is simply excluded
 * from print output, with no effect on Canvas || normal evaluation.
 */
export const isGroupPrintEnabled = (
  group: Extract<CadElement, { type: "group" }>,
  lookup: GroupPrintEnabledLookup | undefined,
  computedScalarBindings: EvaluationResult["computedScalarBindings"]
): boolean => {
  const source = lookup ? resolveGroupPrintEnabledSource(group.id, lookup) : undefined;
  if (!source || source.kind === "literal") return group.printEnabled === true;
  const resolveBinding = (bindingId: BindingId): ScalarEvaluation =>
    computedScalarBindings?.get(bindingId) ?? {
      status: "error",
      type: { kind: "number" },
      issueCode: "group-print-binding-missing"
    };
  const evaluation = source.kind === "expression"
    ? evaluateTypedExpression(source.expression, { lookupBinding: resolveBinding })
    : resolveBinding(source.bindingId);
  return (
    evaluation?.status === "ok" &&
    evaluation.type.kind === "boolean" &&
    evaluation.value.value === true
  );
};
