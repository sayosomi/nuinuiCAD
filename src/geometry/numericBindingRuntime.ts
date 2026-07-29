// Runtime materialization for compiled typed occurrences inside general
// numeric expressions.  The legacy parser still owns every non-typed token;
// this module replaces only compiler-proven BindingId slots before that
// parser runs.  It never inserts a typed value into a name map or resolves a
// typed name at runtime.
import type { CadElement, DependencyError, ElementId, NumericValue } from "../types/geometry";
import type { BindingId } from "../scalars/bindingCatalog";
import type { CompiledNumericBinding } from "../scalars/numericBindingCompiler";
import { propertyBindingOccurrenceKey } from "../scalars/propertyBindingCompiler";
import type { ScalarEvaluation } from "../scalars/types";
import { getParameterValue, setParameterValue } from "../parameters/parameterAccess";
import { isNumericExpression } from "./numericExpressions";
import { geometryError } from "./evaluationContext";
import { numericLiteralForExpression } from "../scalars/numericLiteral";

export type NumericBindingRuntimeEntry = {
  elementId: ElementId;
  parameterKey: string;
  expression: string;
  references: readonly {
    bindingId: BindingId;
    name: string;
    expressionStart: number;
    expressionEnd: number;
  }[];
};

export type NumericBindingRuntimeSource = {
  numericBindings: ReadonlyMap<string, CompiledNumericBinding>;
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
};

/** Re-keys a source-statement occurrence exactly once.  The entry retains
 * both canonical element identity and parameter path; expression equality is
 * only an additional fail-closed integrity check, never an identity lookup. */
export const buildNumericBindingRuntimeEntries = (
  source: NumericBindingRuntimeSource,
  elements: readonly CadElement[]
): NumericBindingRuntimeEntry[] => {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const entries: NumericBindingRuntimeEntry[] = [];
  for (const [statementIndex, elementId] of source.elementIdByStatementIndex) {
    if (!elementsById.has(elementId)) continue;
    for (const [key, binding] of source.numericBindings) {
      if (key !== propertyBindingOccurrenceKey(statementIndex, binding.parameterKey)) continue;
      entries.push({
        elementId,
        parameterKey: binding.parameterKey,
        expression: binding.expression,
        references: binding.references.map((reference) => ({
          bindingId: reference.bindingId,
          name: reference.name,
          expressionStart: reference.expressionStart,
          expressionEnd: reference.expressionEnd
        }))
      });
    }
  }
  return entries;
};

export const groupNumericBindingRuntimeEntriesByElement = (
  entries: readonly NumericBindingRuntimeEntry[]
): ReadonlyMap<ElementId, NumericBindingRuntimeEntry[]> => {
  const result = new Map<ElementId, NumericBindingRuntimeEntry[]>();
  for (const entry of entries) {
    const bucket = result.get(entry.elementId);
    if (bucket) bucket.push(entry);
    else result.set(entry.elementId, [entry]);
  }
  return result;
};

type NumericBindingResolveFn = (bindingId: BindingId) => ScalarEvaluation;

export type NumericMaterializationResult =
  | { ok: true; element: CadElement }
  | { ok: false; error: DependencyError };

const numericBindingFailure = (element: CadElement, parameterKey: string) =>
  geometryError(element, `"${element.name}" の "${parameterKey}" に紐づく数値変数の評価に失敗しました。`);

const mappingFailure = (element: CadElement, parameterKey: string) =>
  geometryError(element, `"${element.name}" の "${parameterKey}" の数値式を正準の型付き参照へ対応付けられません。`);

export const materializeNumericBindingElement = (
  element: CadElement,
  entries: readonly NumericBindingRuntimeEntry[] | undefined,
  resolveBinding: NumericBindingResolveFn
): NumericMaterializationResult => {
  if (!entries?.length) return { ok: true, element };
  let materialized = element;
  for (const entry of entries) {
    const value = getParameterValue(materialized, entry.parameterKey) as NumericValue | undefined;
    if (!value || !isNumericExpression(value) || value.expression !== entry.expression) {
      return { ok: false, error: mappingFailure(materialized, entry.parameterKey) };
    }
    let expression = value.expression;
    for (const reference of [...entry.references].reverse()) {
      const evaluation = resolveBinding(reference.bindingId);
      if (evaluation.status !== "ok" || evaluation.type.kind !== "number" || typeof evaluation.value.value !== "number" || !Number.isFinite(evaluation.value.value)) {
        return { ok: false, error: numericBindingFailure(materialized, entry.parameterKey) };
      }
      if (expression.slice(reference.expressionStart, reference.expressionEnd) !== `@${reference.name}`) {
        return { ok: false, error: mappingFailure(materialized, entry.parameterKey) };
      }
      const literal = numericLiteralForExpression(evaluation.value.value);
      if (literal === null) return { ok: false, error: numericBindingFailure(materialized, entry.parameterKey) };
      expression = `${expression.slice(0, reference.expressionStart)}${literal}${expression.slice(reference.expressionEnd)}`;
    }
    materialized = setParameterValue(materialized, entry.parameterKey, { kind: "expression", expression });
  }
  return { ok: true, element: materialized };
};
