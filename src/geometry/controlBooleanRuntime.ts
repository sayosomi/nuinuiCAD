// Task 25: connects Task 22/25's compiled typed-boolean control sources
// (conditionalGroup.condition, forGroup.showGenerated) to Task 21's resolved
// scalar binding environment at evaluation time. See
// docs/typed-variables/tasks/25-boolean-control-flow-runtime.md.
//
// Two independent, related pieces:
// - showGenerated is a plain single-`@name` property binding (already
//   compiled by Task 22's propertyBindingCompiler.ts into `doc.propertyBindings`
//   - no new compile step needed here), deliberately excluded from Task 23's
//   STANDARD_PROPERTY_TARGETS pending this task. `buildControlBooleanRuntimeEntries`
//   mirrors `propertyBindingRuntime.ts`'s own re-keying, with its own 1-entry
//   allowlist - never derived from "has a propertyCapability".
// - condition is a full typed boolean expression (conditionalGroupConditionCompiler.ts),
//   resolved directly through the document's existing binding resolver via
//   `evaluateTypedExpression` (Task 16) - never re-parsed, never a second
//   resolver instance.
//
// Both resolvers fail closed (never throw, never touch errors/warnings) on
// anything other than a clean `{status:"ok", type.kind:"boolean"}` result -
// this module never evaluates a scalar program itself, only reads through a
// caller-supplied resolver.

import type { CadElement, CadElementType, ElementId } from "../types/geometry";
import type { BindingId } from "../scalars/bindingCatalog";
import { propertyBindingOccurrenceKey, type ScalarValueSource } from "../scalars/propertyBindingCompiler";
import type { TypedScalarExpression } from "../scalars/typedExpressionAst";
import { evaluateTypedExpression } from "../scalars/expressionEvaluator";
import type { ScalarEvaluation, ScalarType } from "../scalars/types";
import { findParameterDefinition } from "../parameters/parameterDefinitions";
import type { PropertyBindingRuntimeEntry } from "./propertyBindingRuntime";

/** This task's own runtime scope boundary for `showGenerated` - mirrors
 * propertyBindingRuntime.ts's STANDARD_PROPERTY_TARGETS but kept separate
 * (never merged into it), since `showGenerated`'s presentation-only,
 * never-affects-iteration contract is distinct from the standard properties'
 * literal-override materialization. */
const CONTROL_BOOLEAN_PROPERTY_TARGETS: Readonly<Partial<Record<CadElementType, readonly string[]>>> = {
  forGroup: ["showGenerated"]
};

export type ControlBooleanRuntimeSource = {
  propertyBindings: ReadonlyMap<string, ScalarValueSource>;
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
};

/** Re-keys Task 25's compiled `conditionalGroupConditions` (statementIndex-
 * keyed occurrence map) into an elementId-keyed map, exactly once per
 * compiled document - mirrors `buildControlBooleanRuntimeEntries` above and
 * Task 23's `buildPropertyBindingRuntimeEntries`, never rebuilt per element
 * or per evaluation call. */
export const buildConditionalGroupConditionsByElementId = (
  conditionalGroupConditions: ReadonlyMap<string, TypedScalarExpression>,
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>
): ReadonlyMap<ElementId, TypedScalarExpression> => {
  const byElementId = new Map<ElementId, TypedScalarExpression>();
  for (const [statementIndex, elementId] of elementIdByStatementIndex) {
    const expression = conditionalGroupConditions.get(propertyBindingOccurrenceKey(statementIndex, "condition"));
    if (expression) byElementId.set(elementId, expression);
  }
  return byElementId;
};

/** Re-keys the already-compiled `showGenerated` binding source(s) into an
 * elementId-keyed list, exactly once per compiled document - never per
 * element, never per iteration. */
export const buildControlBooleanRuntimeEntries = (
  source: ControlBooleanRuntimeSource,
  elements: readonly CadElement[]
): PropertyBindingRuntimeEntry[] => {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const entries: PropertyBindingRuntimeEntry[] = [];

  for (const [statementIndex, elementId] of source.elementIdByStatementIndex) {
    const element = elementsById.get(elementId);
    if (!element) continue;
    const parameterKeys = CONTROL_BOOLEAN_PROPERTY_TARGETS[element.type];
    if (!parameterKeys) continue;

    for (const parameterKey of parameterKeys) {
      const value = source.propertyBindings.get(propertyBindingOccurrenceKey(statementIndex, parameterKey));
      if (!value || value.kind !== "binding") continue;
      const expectedType: ScalarType | undefined = findParameterDefinition(element, parameterKey)?.propertyCapability?.propertyType;
      if (!expectedType) continue;
      entries.push({ elementId, parameterKey, bindingId: value.bindingId, expectedType });
    }
  }

  return entries;
};

export type ControlBooleanResolveFn = (bindingId: BindingId) => ScalarEvaluation;

/**
 * `showGenerated`'s effective value: the literal, unchanged, when unbound
 * (today's evaluation-inert behavior, exact parity); the resolved binding
 * value when bound, failing closed to `false` on anything other than
 * `{status:"ok", type.kind:"boolean", value.value:true}` (poison, wrong
 * runtime type, or an evaluation error) - mirrors
 * groupPrintEnabledRuntime.ts's `isGroupPrintEnabled` fail-closed shape.
 * Never affects iteration count/rows - this is a presentation-only signal.
 */
export const resolveForGroupEffectiveShowGenerated = (
  entry: PropertyBindingRuntimeEntry | undefined,
  literalShowGenerated: boolean,
  resolveBinding: ControlBooleanResolveFn
): boolean => {
  if (!entry) return literalShowGenerated;
  const evaluation = resolveBinding(entry.bindingId);
  return (
    evaluation.status === "ok" &&
    evaluation.type.kind === "boolean" &&
    evaluation.value.value === true
  );
};

/**
 * A `conditionalGroup`'s active branch from its typed boolean condition:
 * `undefined` means no compiled typed expression exists for this occurrence
 * (the literal `NumericValue` path applies instead - the caller is
 * responsible for that fallback, this function is never called in that
 * case). When an expression exists, it is evaluated exactly once via the
 * caller's existing binding resolver; any result other than a clean
 * `{status:"ok", type.kind:"boolean"}` becomes `null` (poisoned - both
 * branches inactive), identical to the established poison semantics so
 * `inactiveConditionalGroupId`'s `activeBranch !== branch` comparison keeps
 * working unmodified for the typed path too.
 */
export const resolveConditionalGroupBranch = (
  expression: TypedScalarExpression,
  resolveBinding: ControlBooleanResolveFn
): "then" | "else" | null => {
  const evaluation = evaluateTypedExpression(expression, { lookupBinding: resolveBinding });
  if (evaluation.status !== "ok" || evaluation.type.kind !== "boolean") return null;
  return evaluation.value.value ? "then" : "else";
};
