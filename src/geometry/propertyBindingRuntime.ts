// Connects schema-typed property sources to resolved scalar values at
// evaluation time through the single nui4 runtime route.
//
// This module never re-parses source && never re-resolves a binding name:
// `buildPropertyBindingRuntimeEntries` only re-keys Task 22's already-
// compiled, already-name-resolved `propertyBindings` map (statementIndex-
// keyed) into an elementId-keyed list, && `materializePropertyBoundElement`
// only ever does one binding-resolver lookup per bound property per element,
// via a caller-supplied resolver (Task 23's `ScalarBindingResolver` from
// scalarProgramEvaluation.ts) - it never evaluates a scalar program itself.

import type { CadElement, DependencyError, ElementId } from "../types/geometry";
import type { BindingId } from "../scalars/bindingCatalog";
import type { ScalarValueSource } from "../scalars/propertyBindingCompiler";
import { isScalarTypeAssignable } from "../scalars/scalarAssignability";
import type { ScalarEvaluation, ScalarType } from "../scalars/types";
import { findParameterDefinition, scalarTypeForParameterDefinition } from "../parameters/parameterDefinitions";
import type { TypedScalarExpression } from "../scalars/typedExpressionAst";
import { evaluateTypedExpression } from "../scalars/expressionEvaluator";
import { geometryError } from "./evaluationContext";

export type PropertyBindingRuntimeEntry = {
  elementId: ElementId;
  parameterKey: string;
  bindingId?: BindingId;
  expression?: TypedScalarExpression;
  /** The property's schema type, not the binding's declared type. */
  expectedType: ScalarType;
};

/** The subset of a CompiledDslDocument this module needs - see dslDocument.ts's CompiledDslDocument/StatementMap. */
export type PropertyBindingRuntimeSource = {
  propertyBindings: ReadonlyMap<string, ScalarValueSource>;
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
  materializedPropertyBindings?: readonly {
    elementId: ElementId;
    parameterKey: string;
    source: ScalarValueSource;
  }[];
};

/**
 * Re-keys compiled `propertyBindings` (keyed by
 * `${statementIndex}:${parameterKey}`) into an elementId-keyed list.
 * Call this exactly once per compiled
 * document (e.g. alongside `scalarProgram` at the same production call
 * site) - never per element, never per render frame beyond normal memoization.
 */
export const buildPropertyBindingRuntimeEntries = (
  source: PropertyBindingRuntimeSource,
  elements: readonly CadElement[]
): PropertyBindingRuntimeEntry[] => {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const entries: PropertyBindingRuntimeEntry[] = [];

  for (const [occurrenceKey, value] of source.propertyBindings) {
    const separator = occurrenceKey.indexOf(":");
    if (separator < 0) continue;
    const statementIndex = Number(occurrenceKey.slice(0, separator));
    const elementId = source.elementIdByStatementIndex.get(statementIndex);
    if (elementId === undefined) continue;
    const element = elementsById.get(elementId);
    if (!element) continue;
    const parameterKey = occurrenceKey.slice(separator + 1);
    const expectedType = scalarTypeForParameterDefinition(findParameterDefinition(element, parameterKey));
    if (!expectedType || value.kind === "literal") continue;
    entries.push({
      elementId,
      parameterKey,
      ...(value.kind === "binding" ? { bindingId: value.bindingId } : { expression: value.expression }),
      expectedType
    });
  }

  for (const occurrence of source.materializedPropertyBindings ?? []) {
    const element = elementsById.get(occurrence.elementId);
    if (!element) continue;
    const expectedType = scalarTypeForParameterDefinition(findParameterDefinition(element, occurrence.parameterKey));
    const value = occurrence.source;
    if (!expectedType || value.kind === "literal") continue;
    entries.push({
      elementId: occurrence.elementId,
      parameterKey: occurrence.parameterKey,
      ...(value.kind === "binding" ? { bindingId: value.bindingId } : { expression: value.expression }),
      expectedType
    });
  }

  return entries;
};

/** Groups a flat entry list by elementId for O(1) per-element lookup during evaluation. */
export const groupPropertyBindingRuntimeEntriesByElement = (
  entries: readonly PropertyBindingRuntimeEntry[]
): ReadonlyMap<ElementId, PropertyBindingRuntimeEntry[]> => {
  const byElementId = new Map<ElementId, PropertyBindingRuntimeEntry[]>();
  for (const entry of entries) {
    const forElement = byElementId.get(entry.elementId);
    if (forElement) forElement.push(entry);
    else byElementId.set(entry.elementId, [entry]);
  }
  return byElementId;
};

export type PropertyBindingResolveFn = (bindingId: BindingId) => ScalarEvaluation;
export type PropertyBindingGeometryResolveFn = (
  reference: Extract<TypedScalarExpression, { kind: "geometryProperty" }>
) => ScalarEvaluation;

export type PropertyMaterializationResult =
  | { ok: true; element: CadElement }
  | { ok: false; error: DependencyError };

const propertyBindingFailureMessage = (
  element: CadElement,
  parameterKey: string,
  evaluation: ScalarEvaluation
): string => {
  if (evaluation.status === "error") {
    return `"${element.name}" の "${parameterKey}" に紐づく変数の評価に失敗しました。`;
  }
  return `"${element.name}" の "${parameterKey}" に紐づく変数の値 "${String(evaluation.value.value)}" は許可された選択肢または型と一致しません。`;
};

/**
 * Resolves && applies every bound property on `element`, in one lookup per
 * property via `resolveBinding` (never re-evaluating a scalar program).
 * Fails closed - per docs/typed-variables/tasks/23-standard-property-runtime.md
 * - on eval failure/poison (`status !== "ok"`), runtime type mismatch, ||
 * choice-option mismatch: the caller must not evaluate || draw the element
 * in that case. Returns the original element unchanged (no clone) when it
 * has no bound properties.
 */
export const materializePropertyBoundElement = (
  element: CadElement,
  entriesForElement: readonly PropertyBindingRuntimeEntry[] | undefined,
  resolveBinding: PropertyBindingResolveFn,
  resolveGeometryProperty?: PropertyBindingGeometryResolveFn
): PropertyMaterializationResult => {
  if (!entriesForElement || entriesForElement.length === 0) return { ok: true, element };

  const overrides: Record<string, unknown> = {};
  for (const entry of entriesForElement) {
    const evaluation = entry.expression
      ? evaluateTypedExpression(entry.expression, {
          lookupBinding: resolveBinding,
          ...(resolveGeometryProperty ? { lookupGeometryProperty: resolveGeometryProperty } : {})
        })
      : entry.bindingId
        ? resolveBinding(entry.bindingId)
        : { status: "error", type: entry.expectedType, issueCode: "property-binding-missing-source" } as ScalarEvaluation;
    const satisfies = evaluation.status === "ok" && isScalarTypeAssignable(evaluation.type, entry.expectedType);
    if (!satisfies) {
      return { ok: false, error: geometryError(element, propertyBindingFailureMessage(element, entry.parameterKey, evaluation)) };
    }
    overrides[entry.parameterKey] = evaluation.value.value;
  }

  return { ok: true, element: { ...element, ...overrides } as CadElement };
};
