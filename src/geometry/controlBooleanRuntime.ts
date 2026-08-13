// Task 25: connects Task 22/25's compiled typed-boolean control sources
// (conditionalGroup.condition, forGroup.showGenerated) to Task 21's resolved
// scalar binding environment at evaluation time. See
// docs/typed-variables/tasks/25-boolean-control-flow-runtime.md.
//
// Two independent, related pieces:
// - showGenerated is a schema-typed property source compiled by the common
//   property frontend && kept on this dedicated physical route until Task 8
//   removes the split.
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
import type { ScalarEvaluation } from "../scalars/types";
import { findParameterDefinition, scalarTypeForParameterDefinition } from "../parameters/parameterDefinitions";
import type { PropertyBindingRuntimeEntry } from "./propertyBindingRuntime";

/** Legacy physical route for `showGenerated`'s presentation-only behavior. */
const CONTROL_BOOLEAN_PROPERTY_TARGETS: Readonly<Partial<Record<CadElementType, readonly string[]>>> = {
  forGroup: ["showGenerated"]
};

export type ControlBooleanRuntimeSource = {
  propertyBindings: ReadonlyMap<string, ScalarValueSource>;
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
  materializedPropertyBindings?: readonly {
    elementId: ElementId;
    parameterKey: string;
    source: ScalarValueSource;
  }[];
};

/** Re-keys Task 25's compiled `conditionalGroupConditions` (statementIndex-
 * keyed occurrence map) into an elementId-keyed map, exactly once per
 * compiled document - mirrors `buildControlBooleanRuntimeEntries` above &&
 * Task 23's `buildPropertyBindingRuntimeEntries`, never rebuilt per element
 * || per evaluation call. */
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
      if (!value || value.kind === "literal") continue;
      const expectedType = scalarTypeForParameterDefinition(findParameterDefinition(element, parameterKey));
      if (!expectedType) continue;
      entries.push({
        elementId,
        parameterKey,
        ...(value.kind === "binding" ? { bindingId: value.bindingId } : { expression: value.expression }),
        expectedType
      });
    }
  }

  for (const occurrence of source.materializedPropertyBindings ?? []) {
    const element = elementsById.get(occurrence.elementId);
    if (!element || !CONTROL_BOOLEAN_PROPERTY_TARGETS[element.type]?.includes(occurrence.parameterKey)) continue;
    const expectedType = scalarTypeForParameterDefinition(findParameterDefinition(element, occurrence.parameterKey));
    if (!expectedType || occurrence.source.kind === "literal") continue;
    entries.push({
      elementId: occurrence.elementId,
      parameterKey: occurrence.parameterKey,
      ...(occurrence.source.kind === "binding" ? { bindingId: occurrence.source.bindingId } : { expression: occurrence.source.expression }),
      expectedType
    });
  }

  return entries;
};

export type ControlBooleanResolveFn = (bindingId: BindingId) => ScalarEvaluation;
export type ControlBooleanGeometryResolveFn = (
  reference: Extract<TypedScalarExpression, { kind: "geometryProperty" }>
) => ScalarEvaluation;

/**
 * `showGenerated`'s effective value: the literal, unchanged, when unbound
 * (today's evaluation-inert behavior, exact parity); the resolved binding
 * value when bound, failing closed to `false` on anything other than
 * `{status:"ok", type.kind:"boolean", value.value:true}` (poison, wrong
 * runtime type, || an evaluation error) - mirrors
 * groupPrintEnabledRuntime.ts's `isGroupPrintEnabled` fail-closed shape.
 * Never affects iteration count/rows - this is a presentation-only signal.
 */
export const resolveForGroupEffectiveShowGenerated = (
  entry: PropertyBindingRuntimeEntry | undefined,
  literalShowGenerated: boolean,
  resolveBinding: ControlBooleanResolveFn,
  resolveGeometryProperty?: ControlBooleanGeometryResolveFn
): boolean => {
  if (!entry) return literalShowGenerated;
  const evaluation = entry.expression
    ? evaluateTypedExpression(entry.expression, {
        lookupBinding: resolveBinding,
        ...(resolveGeometryProperty ? { lookupGeometryProperty: resolveGeometryProperty } : {})
      })
    : entry.bindingId
      ? resolveBinding(entry.bindingId)
      : { status: "error", type: entry.expectedType, issueCode: "property-binding-missing-source" } as ScalarEvaluation;
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
  resolveBinding: ControlBooleanResolveFn,
  resolveGeometryProperty?: ControlBooleanGeometryResolveFn
): "then" | "else" | null => {
  const evaluation = evaluateTypedExpression(expression, {
    lookupBinding: resolveBinding,
    ...(resolveGeometryProperty ? { lookupGeometryProperty: resolveGeometryProperty } : {})
  });
  if (evaluation.status !== "ok" || evaluation.type.kind !== "boolean") return null;
  return evaluation.value.value ? "then" : "else";
};
