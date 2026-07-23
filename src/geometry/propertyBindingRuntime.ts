// Task 23: connects Task 22's compiled property-binding sources
// (propertyBindingCompiler.ts) to Task 21's resolved scalar binding values at
// evaluation time, for exactly the "standard" boolean/choice properties this
// task owns. text.text (Task 27/28), group.printEnabled (Task 24), and
// forGroup.showGenerated (Task 25) are deliberately excluded even though
// parameterDefinitions.ts's propertyBindingCapabilities registry also opts
// them in - STANDARD_PROPERTY_TARGETS below is this module's own explicit
// allowlist, checked by (elementType, parameterKey) pair, and is the single
// place that decides which properties this task actually connects. Do not
// derive membership from "has a propertyCapability" - that would silently
// implement 24-26 early.
//
// This module never re-parses source and never re-resolves a binding name:
// `buildPropertyBindingRuntimeEntries` only re-keys Task 22's already-
// compiled, already-name-resolved `propertyBindings` map (statementIndex-
// keyed) into an elementId-keyed list, and `materializePropertyBoundElement`
// only ever does one binding-resolver lookup per bound property per element,
// via a caller-supplied resolver (Task 23's `ScalarBindingResolver` from
// scalarProgramEvaluation.ts) - it never evaluates a scalar program itself.

import type { CadElement, CadElementType, DependencyError, ElementId } from "../types/geometry";
import type { BindingId } from "../scalars/bindingCatalog";
import { propertyBindingOccurrenceKey, type ScalarValueSource } from "../scalars/propertyBindingCompiler";
import { scalarValueSatisfiesPropertyCapability } from "../scalars/scalarAssignability";
import type { ScalarEvaluation, ScalarType } from "../scalars/types";
import { findParameterDefinition } from "../parameters/parameterDefinitions";
import { geometryError } from "./evaluationContext";

/**
 * The only (elementType, parameterKey) pairs this task connects. Kept
 * separate from parameterDefinitions.ts's propertyBindingCapabilities, which
 * also declares text.text/group.printEnabled/forGroup.showGenerated for
 * later tasks' compile-time typecheck (Task 22) - this list is Task 23's own
 * runtime scope boundary, not a copy of the compile-time opt-in registry.
 */
const STANDARD_PROPERTY_TARGETS: Readonly<Partial<Record<CadElementType, readonly string[]>>> = {
  offsetLine: ["side", "closed", "suppressTrimWarnings"],
  intersectionPoint: ["useExtensions"],
  copyLine: ["mirrorX"],
  move: ["mirrorX"],
  image: ["mirrorX"]
};

export type PropertyBindingRuntimeEntry = {
  elementId: ElementId;
  parameterKey: string;
  bindingId: BindingId;
  /** The property's own canonical capability type (parameterDefinitions.ts), not the binding's declared type. */
  expectedType: ScalarType;
};

/** The subset of a CompiledDslDocument this module needs - see dslDocument.ts's CompiledDslDocument/StatementMap. */
export type PropertyBindingRuntimeSource = {
  propertyBindings: ReadonlyMap<string, ScalarValueSource>;
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
};

/**
 * Re-keys Task 22's compiled `propertyBindings` (keyed by
 * `${statementIndex}:${parameterKey}`) into an elementId-keyed list, filtered
 * through STANDARD_PROPERTY_TARGETS. Call this exactly once per compiled
 * document (e.g. alongside `scalarProgram` at the same production call
 * site) - never per element, never per render frame beyond normal memoization.
 */
export const buildPropertyBindingRuntimeEntries = (
  source: PropertyBindingRuntimeSource,
  elements: readonly CadElement[]
): PropertyBindingRuntimeEntry[] => {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const entries: PropertyBindingRuntimeEntry[] = [];

  for (const [statementIndex, elementId] of source.elementIdByStatementIndex) {
    const element = elementsById.get(elementId);
    if (!element) continue;
    const parameterKeys = STANDARD_PROPERTY_TARGETS[element.type];
    if (!parameterKeys) continue;

    for (const parameterKey of parameterKeys) {
      const value = source.propertyBindings.get(propertyBindingOccurrenceKey(statementIndex, parameterKey));
      if (!value || value.kind !== "binding") continue;
      const expectedType = findParameterDefinition(element, parameterKey)?.propertyCapability?.propertyType;
      if (!expectedType) continue;
      entries.push({ elementId, parameterKey, bindingId: value.bindingId, expectedType });
    }
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
 * Resolves and applies every bound property on `element`, in one lookup per
 * property via `resolveBinding` (never re-evaluating a scalar program).
 * Fails closed - per docs/typed-variables/tasks/23-standard-property-runtime.md
 * - on eval failure/poison (`status !== "ok"`), runtime type mismatch, or
 * choice-option mismatch: the caller must not evaluate or draw the element
 * in that case. Returns the original element unchanged (no clone) when it
 * has no bound properties.
 */
export const materializePropertyBoundElement = (
  element: CadElement,
  entriesForElement: readonly PropertyBindingRuntimeEntry[] | undefined,
  resolveBinding: PropertyBindingResolveFn
): PropertyMaterializationResult => {
  if (!entriesForElement || entriesForElement.length === 0) return { ok: true, element };

  const overrides: Record<string, unknown> = {};
  for (const entry of entriesForElement) {
    const evaluation = resolveBinding(entry.bindingId);
    const satisfies =
      evaluation.status === "ok" &&
      evaluation.type.kind === entry.expectedType.kind &&
      scalarValueSatisfiesPropertyCapability(evaluation.value, { propertyType: entry.expectedType });
    if (!satisfies) {
      return { ok: false, error: geometryError(element, propertyBindingFailureMessage(element, entry.parameterKey, evaluation)) };
    }
    overrides[entry.parameterKey] = evaluation.value.value;
  }

  return { ok: true, element: { ...element, ...overrides } as CadElement };
};
