// Runtime materialization for compiled typed occurrences inside general
// numeric expressions. The numeric-expression compiler owns non-typed
// untyped numeric syntax;
// this module replaces only compiler-proven BindingId slots before that
// parser runs.  It never inserts a typed value into a name map || resolves a
// typed name at runtime.
import type { CadElement, DependencyError, ElementId, NumericValue } from "../types/geometry";
import type { BindingId } from "@nuinuicad/nui-language";
import type { CompiledNumericBinding } from "@nuinuicad/nui-language";
import { propertyBindingOccurrenceKey } from "@nuinuicad/nui-language";
import type { ScalarEvaluation } from "@nuinuicad/nui-language";
import { evaluateTypedExpression } from "../scalars/expressionEvaluator";
import type { GeometryBuiltinTargetLookupResult } from "../scalars/expressionEvaluator";
import type {
  ScalarExpressionResolvedGeometryTarget,
  ScalarExpressionResolvedOptionalMemberTarget,
  ScalarExpressionType,
  TypedScalarExpression
} from "@nuinuicad/nui-language";
import { getParameterValue, setParameterValue } from "@nuinuicad/nui-language";
import { isNumericExpression } from "./numericExpressions";
import { geometryError } from "./evaluationContext";
import { numericLiteralForExpression } from "@nuinuicad/nui-language";
import { runtimeIssueMessage } from "../scalars/runtimeIssueMessages";

export type NumericBindingRuntimeEntry = {
  elementId: ElementId;
  parameterKey: string;
  expression: string;
  typedExpression?: TypedScalarExpression;
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
  materializedNumericBindings?: readonly {
    elementId: ElementId;
    binding: CompiledNumericBinding;
  }[];
};

/** Re-keys a source-statement occurrence exactly once.  The entry retains
 * both canonical element identity && parameter path; expression equality is
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
        ...(binding.typedExpression ? { typedExpression: binding.typedExpression } : {}),
        references: binding.references.map((reference) => ({
          bindingId: reference.bindingId,
          name: reference.name,
          expressionStart: reference.expressionStart,
          expressionEnd: reference.expressionEnd
        }))
      });
    }
  }
  for (const occurrence of source.materializedNumericBindings ?? []) {
    if (!elementsById.has(occurrence.elementId)) continue;
    const binding = occurrence.binding;
    entries.push({
      elementId: occurrence.elementId,
      parameterKey: binding.parameterKey,
      expression: binding.expression,
      ...(binding.typedExpression ? { typedExpression: binding.typedExpression } : {}),
      references: binding.references.map((reference) => ({
        bindingId: reference.bindingId,
        name: reference.name,
        expressionStart: reference.expressionStart,
        expressionEnd: reference.expressionEnd
      }))
    });
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
type NumericBindingGeometryResolveFn = (
  reference: Extract<TypedScalarExpression, { kind: "geometryProperty" }>
) => ScalarEvaluation;
type NumericBindingGeometryTargetResolveFn = (
  target: ScalarExpressionResolvedGeometryTarget
) => GeometryBuiltinTargetLookupResult | undefined;
type NumericBindingOptionalMemberResolveFn = (
  target: ScalarExpressionResolvedOptionalMemberTarget,
  type: ScalarExpressionType
) => ScalarEvaluation;

export type NumericMaterializationResult =
  | { ok: true; element: CadElement }
  | { ok: false; errors: DependencyError[] };

const mappingFailure = (element: CadElement, parameterKey: string) =>
  geometryError(element, `"${element.name}" の "${parameterKey}" の数値式を正準の型付き参照へ対応付けられません。`);

const evaluationFailure = (
  element: CadElement,
  entry: NumericBindingRuntimeEntry,
  evaluation: ScalarEvaluation,
  elements?: readonly CadElement[]
): DependencyError => {
  const issueCode = evaluation.status === "error"
    ? evaluation.issueCode
    : evaluation.value.kind === "number" && !Number.isFinite(evaluation.value.value)
      ? "evaluation-non-finite-result"
      : "evaluation-runtime-value-type-mismatch";
  const context = evaluation.status === "error" ? evaluation.context : undefined;
  const bindingId = evaluation.status === "error" ? evaluation.bindingId : undefined;
  const target = bindingId === undefined && context?.kind === "geometryBuiltinTarget"
    ? elements?.find((candidate) => candidate.id === context.targetElementId)
    : undefined;
  const missingDependencyId = bindingId ?? (context?.kind === "geometryBuiltinTarget"
    ? context.targetElementId
    : entry.expression);

  return {
    elementId: element.id,
    elementName: element.name,
    missingDependencyId,
    ...(target ? { missingDependencyName: target.name } : {}),
    message: `${element.name} の数値式を評価できません。${runtimeIssueMessage(issueCode, context, elements)}`
  };
};

export const materializeNumericBindingElement = (
  element: CadElement,
  entries: readonly NumericBindingRuntimeEntry[] | undefined,
  resolveBinding: NumericBindingResolveFn,
  resolveGeometryProperty?: NumericBindingGeometryResolveFn,
  resolveGeometryTarget?: NumericBindingGeometryTargetResolveFn,
  resolveOptionalMember?: NumericBindingOptionalMemberResolveFn,
  elements?: readonly CadElement[]
): NumericMaterializationResult => {
  if (!entries?.length) return { ok: true, element };
  let materialized = element;
  const errors: DependencyError[] = [];
  for (const entry of entries) {
    let entryFailed = false;
    const value = getParameterValue(materialized, entry.parameterKey) as NumericValue | undefined;
    if (!value || !isNumericExpression(value) || value.expression !== entry.expression) {
      errors.push(mappingFailure(materialized, entry.parameterKey));
      return { ok: false, errors };
    }
    if (entry.typedExpression) {
      const evaluation = evaluateTypedExpression(entry.typedExpression, {
        lookupBinding: resolveBinding,
        ...(resolveGeometryProperty ? { lookupGeometryProperty: resolveGeometryProperty } : {}),
        ...(resolveGeometryTarget ? { lookupGeometryTarget: resolveGeometryTarget } : {}),
        ...(resolveOptionalMember ? { lookupOptionalMember: resolveOptionalMember } : {})
      });
      if (evaluation.status !== "ok" || evaluation.type.kind !== "number" || evaluation.value.kind !== "number" || !Number.isFinite(evaluation.value.value)) {
        errors.push(evaluationFailure(materialized, entry, evaluation, elements));
        continue;
      }
      materialized = setParameterValue(materialized, entry.parameterKey, evaluation.value.value);
      continue;
    }
    let expression = value.expression;
    for (const reference of [...entry.references].reverse()) {
      const evaluation = resolveBinding(reference.bindingId);
      const evaluatedValue = evaluation.status === "ok" ? evaluation.value : null;
      if (evaluation.status !== "ok" || evaluation.type.kind !== "number" || evaluatedValue?.kind !== "number" || !Number.isFinite(evaluatedValue.value)) {
        errors.push(evaluationFailure(materialized, entry, evaluation, elements));
        entryFailed = true;
        break;
      }
      if (expression.slice(reference.expressionStart, reference.expressionEnd) !== `@${reference.name}`) {
        errors.push(mappingFailure(materialized, entry.parameterKey));
        return { ok: false, errors };
      }
      const literal = numericLiteralForExpression(evaluatedValue.value);
      if (literal === null) {
        errors.push(evaluationFailure(materialized, entry, evaluation, elements));
        entryFailed = true;
        break;
      }
      expression = `${expression.slice(0, reference.expressionStart)}${literal}${expression.slice(reference.expressionEnd)}`;
    }
    if (entryFailed) continue;
    materialized = setParameterValue(materialized, entry.parameterKey, { kind: "expression", expression });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, element: materialized };
};
