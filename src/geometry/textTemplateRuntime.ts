// Task 27: connects Task 26's compiled TextTemplateAst and Task 22's
// bare-`@binding` `text.text` property source to Task 16's expression
// evaluator and Task 20/21's scalar binding resolver, for the TS reference
// evaluation path. Mirrors propertyBindingRuntime.ts/controlBooleanRuntime.ts's
// three-step shape (re-key once per compiled document -> group/lookup by
// elementId -> resolve/materialize via a caller-supplied resolver), never
// re-parsing source or re-resolving a binding name.
//
// Two independent pieces, exactly like Task 26 kept them apart:
// - `text.text` bare `@name` (no quotes/braces) is a plain property binding,
//   already compiled by Task 22 into `propertyBindings` - deliberately
//   excluded from Task 23's STANDARD_PROPERTY_TARGETS pending this task (see
//   that file's comment). TEXT_PROPERTY_TARGETS below is this task's own,
//   separate allowlist - never merged into STANDARD_PROPERTY_TARGETS.
// - A quoted `"...{...}..."` value is a compiled TextTemplateAst (Task 26);
//   `evaluateElementTextTemplate` walks its segments via Task 16's
//   evaluateTypedExpression for typed holes and uses the existing local
//   numeric-expression evaluator for numeric holes, scoped to one compiled
//   hole rather than a whole-string scan.

import type { CadElement, CadElementType, ComputedGeometry, ElementId } from "../types/geometry";
import type { BindingId } from "../scalars/bindingCatalog";
import { propertyBindingOccurrenceKey, type ScalarValueSource } from "../scalars/propertyBindingCompiler";
import type { TextTemplateAst } from "../scalars/textTemplate";
import { evaluateTextTemplate, type EvaluateNumericExpressionHole } from "../scalars/textTemplateEvaluator";
import type { ScalarEvaluation } from "../scalars/types";
import type { TypedScalarExpression } from "../scalars/typedExpressionAst";
import { findParameterDefinition } from "../parameters/parameterDefinitions";
import type { NumericExpressionError } from "./numericExpressionTypes";
import { evaluateNumericValue, normalizeNumericExpressionInput, textNumber } from "./numericExpressions";
import type { PropertyBindingRuntimeEntry } from "./propertyBindingRuntime";

export type TextTemplateRuntimeSource = {
  textTemplates: ReadonlyMap<string, TextTemplateAst>;
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
};

/**
 * Re-keys Task 26's compiled `textTemplates` (statementIndex-keyed occurrence
 * map) into an elementId-keyed map - one AST per element (`label(text:...)`
 * has exactly one `text:` attribute per statement), mirroring
 * controlBooleanRuntime.ts's buildConditionalGroupConditionsByElementId
 * shape rather than the array-based standard-property builders. Call this
 * exactly once per compiled document, never per element or per evaluation.
 */
export const buildTextTemplateEntriesByElementId = (
  source: TextTemplateRuntimeSource
): ReadonlyMap<ElementId, TextTemplateAst> => {
  const byElementId = new Map<ElementId, TextTemplateAst>();
  for (const [statementIndex, elementId] of source.elementIdByStatementIndex) {
    const ast = source.textTemplates.get(propertyBindingOccurrenceKey(statementIndex, "text"));
    if (ast) byElementId.set(elementId, ast);
  }
  return byElementId;
};

/** Evaluation-only projection for Rust: spans and dependency metadata remain
 * TypeScript-only compiler/editor data, while Rust receives the compiled
 * segment content and already-resolved typed expression AST unchanged. */
export type RustTextTemplateSegment =
  | { kind: "literal"; cooked: string }
  | { kind: "hole"; holeKind: "numeric"; raw: string }
  | { kind: "hole"; holeKind: "string" | "number"; expression: TypedScalarExpression };

export const toRustTextTemplateSegments = (ast: TextTemplateAst): RustTextTemplateSegment[] =>
  ast.segments.map((segment): RustTextTemplateSegment => {
    if (segment.kind === "literal") return { kind: "literal", cooked: segment.cooked };
    if (segment.holeKind === "numeric") return { kind: "hole", holeKind: "numeric", raw: segment.raw };
    return { kind: "hole", holeKind: segment.holeKind, expression: segment.expression };
  });

/** This task's own runtime scope boundary for the bare `@name` `text.text`
 * case - mirrors propertyBindingRuntime.ts's STANDARD_PROPERTY_TARGETS and
 * controlBooleanRuntime.ts's CONTROL_BOOLEAN_PROPERTY_TARGETS but kept
 * separate, per propertyBindingRuntime.ts's explicit comment forbidding
 * merging text.text into STANDARD_PROPERTY_TARGETS. */
const TEXT_PROPERTY_TARGETS: Readonly<Partial<Record<CadElementType, readonly string[]>>> = {
  text: ["text"]
};

export type TextPropertyBindingRuntimeSource = {
  propertyBindings: ReadonlyMap<string, ScalarValueSource>;
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
};

/**
 * Re-keys the already-compiled bare `text.text` binding source(s) into an
 * elementId-keyed list, exactly once per compiled document - never per
 * element, never per evaluation.
 */
export const buildTextPropertyBindingRuntimeEntries = (
  source: TextPropertyBindingRuntimeSource,
  elements: readonly CadElement[]
): PropertyBindingRuntimeEntry[] => {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const entries: PropertyBindingRuntimeEntry[] = [];

  for (const [statementIndex, elementId] of source.elementIdByStatementIndex) {
    const element = elementsById.get(elementId);
    if (!element) continue;
    const parameterKeys = TEXT_PROPERTY_TARGETS[element.type];
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

export type TextTemplateElementContext = {
  computedGeometry: Map<ElementId, ComputedGeometry>;
  elementsById: Map<ElementId, CadElement>;
  localVariables?: Map<string, number>;
  localVariableNames?: Map<string, string>;
  currentElement: CadElement;
  elements?: CadElement[];
};

/** Evaluation result consumed by textEvaluator.ts. */
export type TextTemplateRuntimeResult = { text?: string; error?: NumericExpressionError };

/**
 * Evaluates one element's compiled TextTemplateAst. Returns the same
 * `{text}` / `{error: NumericExpressionError}` result. textEvaluator.ts turns
 * numeric-expression-hole failures into DependencyError entries. Typed-hole
 * failures use the element's own id as `dependencyId` (mirrors evaluationContext.ts's
 * `geometryError` convention: a self-referential evaluation error, not a
 * missing geometry dependency).
 */
export const evaluateElementTextTemplate = (
  ast: TextTemplateAst,
  context: TextTemplateElementContext,
  resolveBinding: (bindingId: BindingId) => ScalarEvaluation
): TextTemplateRuntimeResult => {
  const evaluateNumericExpressionHole: EvaluateNumericExpressionHole = (raw) => {
    const normalizedExpression = normalizeNumericExpressionInput(
      raw,
      context.elements ?? Array.from(context.elementsById.values()),
      context.currentElement.numericVariables ?? [],
      context.currentElement
    );
    const result = evaluateNumericValue({
      value: { kind: "expression", expression: normalizedExpression },
      computedGeometry: context.computedGeometry,
      elementsById: context.elementsById,
      localVariables: context.localVariables,
      localVariableNames: context.localVariableNames,
      currentElement: context.currentElement,
      elements: context.elements
    });
    if (result.error) {
      return { ok: false, message: result.error.message, dependencyId: result.error.dependencyId, dependencyName: result.error.dependencyName };
    }
    return { ok: true, text: textNumber(result.value ?? 0) };
  };

  const result = evaluateTextTemplate(ast, { lookupBinding: resolveBinding }, evaluateNumericExpressionHole, textNumber);
  if (result.status === "ok") return { text: result.text };

  if (result.error.origin === "numeric") {
    return {
      error: {
        dependencyId: result.error.dependencyId ?? context.currentElement.id,
        dependencyName: result.error.dependencyName,
        message: result.error.message
      }
    };
  }
  return {
    error: {
      dependencyId: context.currentElement.id,
      dependencyName: context.currentElement.name,
      message: result.error.message
    }
  };
};
