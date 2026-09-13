import type { ModuleScalarExpressionSemantic, ModuleScalarExpressionSite, ModuleScalarSourceTarget } from "../dsl/moduleSemanticTypes";
import type { CadElement, NumericValue } from "../types/geometry";
import { getParameterValue } from "../parameters/parameterAccess";
import { isNumericExpression } from "../geometry/numericExpressions";
import { scanExpressionReferences } from "../dsl/expressionReferenceToken";
import { collectScalarExpressionReferences } from "./expressionReferenceCollector";
import type { ScalarExpressionAst } from "./expressionAst";
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

type NumericSurfaceReferenceMatch = { query: string; from: number; to: number };

/** The legacy numeric scanner treats `@Name[index].property` as one
 * property token. The index is still a normal typed scalar reference, so
 * expose the AST-owned index spans as additional surface matches for module
 * materialization. */
const occurrenceIndexMatchesIn = (
  ast: ScalarExpressionAst,
  expressionStart: number
): NumericSurfaceReferenceMatch[] => {
  const matches: NumericSurfaceReferenceMatch[] = [];
  const visitIndex = (node: ScalarExpressionAst): void => {
    if (node.kind === "reference") {
      matches.push({
        query: node.name,
        from: node.span.start - expressionStart,
        to: node.span.end - expressionStart
      });
      return;
    }
    if (node.kind === "collectionIndex") {
      visitIndex(node.index);
      return;
    }
    if (node.kind === "geometryProperty") {
      if (node.occurrenceIndex) visitIndex(node.occurrenceIndex);
      return;
    }
    if (node.kind === "unary") return visitIndex(node.operand);
    if (node.kind === "binary") {
      visitIndex(node.left);
      visitIndex(node.right);
      return;
    }
    if (node.kind === "group") return visitIndex(node.expression);
    if (node.kind === "valueIf") {
      visitIndex(node.condition);
      visitIndex(node.thenBranch);
      if (node.elseBranch) visitIndex(node.elseBranch);
      return;
    }
    if (node.kind === "valueMatch") {
      visitIndex(node.scrutinee);
      node.arms.forEach((arm) => visitIndex(arm.expression));
      return;
    }
    if (node.kind === "call") node.args.forEach((argument) => visitIndex(argument.expression));
  };
  const visit = (node: ScalarExpressionAst): void => {
    if (node.kind === "geometryProperty") {
      if (node.occurrenceIndex) visitIndex(node.occurrenceIndex);
      return;
    }
    if (node.kind === "collectionIndex") return visit(node.index);
    if (node.kind === "unary") return visit(node.operand);
    if (node.kind === "binary") {
      visit(node.left);
      visit(node.right);
      return;
    }
    if (node.kind === "group") return visit(node.expression);
    if (node.kind === "valueIf") {
      visit(node.condition);
      visit(node.thenBranch);
      if (node.elseBranch) visit(node.elseBranch);
      return;
    }
    if (node.kind === "valueMatch") {
      visit(node.scrutinee);
      node.arms.forEach((arm) => visit(arm.expression));
      return;
    }
    if (node.kind === "call") node.args.forEach((argument) => visit(argument.expression));
  };
  visit(ast);
  return matches;
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

  const matches = [
    ...scanExpressionReferences(value.expression)
      .filter((match): match is Extract<typeof match, { kind: "binding" }> => match.kind === "binding")
      .map((match) => ({ query: match.query, from: match.from, to: match.to })),
    ...occurrenceIndexMatchesIn(site.expression.ast, site.expression.ast.span.start)
  ];
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
    // A geometry property with a generated occurrence index is evaluated by
    // the typed path. Its index may be a module for-group iteration binding,
    // which is intentionally not a legacy numeric source-splice reference.
    // Keep the typed expression even when that is the only dependency.
    if (loweredExpression && site.expression.geometryProperties.length > 0) {
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
