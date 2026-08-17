import type { ModuleScalarExpressionSemantic, ModuleScalarExpressionSite, ModuleScalarSourceTarget } from "../dsl/moduleSemanticTypes";
import type { CadElement, NumericValue } from "../types/geometry";
import { getParameterValue } from "../parameters/parameterAccess";
import { isNumericExpression } from "../geometry/numericExpressions";
import { scanExpressionReferences } from "../dsl/expressionReferenceToken";
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
 * Compiles only typed scalar occurrences in a materialized numeric value.
 * Iteration references remain in the legacy numeric evaluator, so a single
 * expression can combine the typed and runtime-only systems.
 */
export const numericSourceForModuleSite = (
  element: CadElement,
  site: ModuleScalarExpressionSite,
  bindingForTarget: (target: ModuleScalarSourceTarget, name: string, statementIndex: number) => Binding | undefined,
  loweredExpression?: TypedScalarExpression
): CompiledNumericBinding | undefined => {
  // Iteration values remain owned by the legacy numeric evaluator. A mixed
  // expression may retain source-splice references, but must not be partially
  // lowered to the standalone typed evaluator.
  let runtimeReady = true;
  const parameterKey = site.parameterKey;
  if (!parameterKey) return undefined;

  const value = scalarValueExpression(element, parameterKey);
  if (!value || site.expression.type?.kind !== "number") return undefined;

  const matches = scanExpressionReferences(value.expression).filter((match) => match.kind === "binding");
  const references = semanticReferencesUsedByAst(site.expression);

  const compiledReferences: CompiledNumericBindingReference[] = [];
  const usedMatchIndexes = new Set<number>();
  for (const reference of references) {
    const matchIndex = matches.findIndex((candidate, index) =>
      !usedMatchIndexes.has(index) && candidate.query === reference.name
    );
    if (matchIndex < 0) return undefined;
    usedMatchIndexes.add(matchIndex);
    const match = matches[matchIndex];
    if (!match) return undefined;
    const target = reference.target;
    if (!target || (target.kind !== "parameter" && target.kind !== "moduleLocal" && target.kind !== "documentBinding")) {
      runtimeReady = false;
      continue;
    }
    const binding = bindingForTarget(target as ModuleScalarSourceTarget, reference.name, reference.span.start);
    if (!binding || binding.kind !== "typed") {
      runtimeReady = false;
      continue;
    }
    compiledReferences.push({
      bindingId: binding.id,
      name: reference.name,
      span: reference.span,
      nameSpan: { start: reference.span.start + 1, end: reference.span.end },
      physicalNameSpan: null,
      expressionStart: match.from,
      expressionEnd: match.to,
      site: { scopeId: "module-runtime", statementIndex: reference.span.start }
    });
  }

  if (runtimeReady && loweredExpression && loweredExpression.type?.kind !== "number") return undefined;
  if (!runtimeReady || !loweredExpression) {
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
