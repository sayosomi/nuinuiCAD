import type { ModuleScalarExpressionSemantic, ModuleScalarExpressionSite, ModuleScalarSourceTarget } from "../dsl/moduleSemanticTypes";
import type { CadElement, NumericValue } from "../types/geometry";
import { getParameterValue } from "../parameters/parameterAccess";
import { isNumericExpression } from "../geometry/numericExpressions";
import { tokenizeScalarExpression } from "./expressionTokenizer";
import { collectScalarExpressionReferences } from "./expressionReferenceCollector";
import type { Binding } from "./bindingCatalog";
import type { CompiledNumericBinding, CompiledNumericBindingReference } from "./numericBindingCompiler";
import type { TypedScalarExpression } from "./typedExpressionAst";

const scalarValueExpression = (element: CadElement, parameterKey: string): Extract<NumericValue, { kind: "expression" }> | undefined => {
  const value = getParameterValue(element, parameterKey) as NumericValue | undefined;
  return value !== undefined && isNumericExpression(value) ? value : undefined;
};

const semanticReferencesUsedByAst = (semantic: ModuleScalarExpressionSemantic) => {
  const astReferences = collectScalarExpressionReferences(semantic.ast);
  return semantic.references.filter((reference) =>
    astReferences.some((astReference) => astReference.span.start === reference.span.start)
  );
};

/**
 * Compiles canonical scalar occurrences in a materialized numeric value,
 * including module-owned iteration bindings.
 */
export const numericSourceForModuleSite = (
  element: CadElement,
  site: ModuleScalarExpressionSite,
  bindingForTarget: (target: ModuleScalarSourceTarget, name: string, statementIndex: number) => Binding | undefined,
  loweredExpression?: TypedScalarExpression
): CompiledNumericBinding | undefined => {
  // Source record position selects the already-compiled stable slot. Runtime
  // payloads carry that slot id, never the source array position as identity.
  const intermediate = site.parameterKey?.match(/^intermediates:(\d+):(.+)$/);
  const slot = intermediate && element.type === "bezierCurve" ? element.intermediatePoints[Number(intermediate[1])] : undefined;
  const parameterKey = intermediate
    ? slot ? `intermediate:${slot.id}:${intermediate[2]}` : undefined
    : site.parameterKey;
  if (!parameterKey) return undefined;
  const value = scalarValueExpression(element, parameterKey);
  return value
    ? numericSourceForModuleValue(value, parameterKey, site, bindingForTarget, loweredExpression)
    : undefined;
};

/** Module transformation arguments are recipe values rather than element
 * properties. Feed their already-lowered NumericValue through the same
 * semantic-target to canonical-BindingId path as ordinary numeric sites. */
export const numericSourceForModuleValue = (
  value: Extract<NumericValue, { kind: "expression" }>,
  parameterKey: string,
  site: ModuleScalarExpressionSite,
  bindingForTarget: (target: ModuleScalarSourceTarget, name: string, statementIndex: number) => Binding | undefined,
  loweredExpression?: TypedScalarExpression
): CompiledNumericBinding | undefined => {
  // Materialized references retain the semantic target selected by Module
  // analysis, including its canonical iteration BindingId.
  let runtimeReady = true;
  if (!value || site.expression.type?.kind !== "number") return undefined;

  const { tokens } = tokenizeScalarExpression(value.expression, { start: 0, end: value.expression.length });
  const matches = tokens.filter((token) => token.kind === "reference");
  const references = semanticReferencesUsedByAst(site.expression);

  const compiledReferences: CompiledNumericBindingReference[] = [];
  const usedMatchIndexes = new Set<number>();
  for (const reference of references) {
    const matchIndex = matches.findIndex((candidate, index) =>
      !usedMatchIndexes.has(index) && candidate.name === reference.name
    );
    if (matchIndex < 0) return undefined;
    usedMatchIndexes.add(matchIndex);
    const match = matches[matchIndex];
    if (!match) return undefined;
    const target = reference.target;
    if (!target || (target.kind !== "parameter" && target.kind !== "moduleLocal" && target.kind !== "documentBinding" && target.kind !== "iteration" && target.kind !== "deferredModuleScalarExport")) {
      runtimeReady = false;
      continue;
    }
    const binding = bindingForTarget(target as ModuleScalarSourceTarget, reference.name, reference.span.start);
    if (!binding || (binding.kind !== "typed" && binding.kind !== "iteration")) {
      runtimeReady = false;
      continue;
    }
    compiledReferences.push({
      bindingId: binding.id,
      name: reference.name,
      span: reference.span,
      nameSpan: reference.nameSpan,
      physicalNameSpan: null,
      expressionStart: match.nameSpan.start,
      expressionEnd: match.nameSpan.end,
      site: { scopeId: "module-runtime", statementIndex: reference.span.start }
    });
  }

  if (runtimeReady && loweredExpression && loweredExpression.type?.kind !== "number") return undefined;
  if (!runtimeReady || !loweredExpression) {
    // A geometry property with a generated occurrence index is evaluated by
    // the typed path. Its index may be a module for-group iteration binding,
    // which is intentionally not a legacy numeric source-splice reference.
    // Keep the typed expression even when that is the only dependency.
    if (loweredExpression && (site.expression.geometryProperties.length > 0 ||
        site.expression.references.some(reference => reference.collectionValueId !== undefined))) {
      return {
        parameterKey,
        expression: value.expression,
        references: compiledReferences,
        typedExpression: loweredExpression
      };
    }
    return compiledReferences.length === 0
      ? undefined
      : { parameterKey, expression: value.expression, references: compiledReferences };
  }
  return {
    parameterKey,
    expression: value.expression,
    references: compiledReferences,
    ...(loweredExpression ? { typedExpression: loweredExpression } : {})
  };
};
