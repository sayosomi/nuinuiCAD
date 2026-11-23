import type { CadElement, ElementId } from "../types/geometry";
import type { DslDiagnostic, DslSpan, DslStatement } from "../dsl/dslTypes";
import type { DslStatementInclusion } from "./dslCompilationGuard";
import { exactPhysicalSpan, type DiagnosticSpanContext } from "./dslDiagnosticSpan";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import { getParameterValue } from "../parameters/parameterAccess";
import { isNumericExpression } from "../geometry/numericExpressions";
import { resolveParameterValueSpan } from "./dslParameterSpans";
import { coordinateComponent } from "./dslParameterSpanScanner";
import { layoutNumericAttrKeys, placeCoordinateAttrKeys, placeNumericAttrKeys, printNumericAttrKeys, svgNumericAttrKeys } from "./dslPrintLayoutAttributes";
import { parseDslSourceReferenceAt, readDslReferencePath } from "./dslReferenceTokens";
import { tokenizeScalarExpression } from "../scalars/expressionTokenizer";
import { transformationNumericInputs } from "../scalars/numericBindingCompiler";
import type { NumericValue } from "../types/geometry";
import type { TransformationRecipe } from "./transformationRecipes";

export type PropertyReferenceSyntaxCompilation = {
  diagnostics: readonly DslDiagnostic[];
};

const diagnosticAt = (
  spans: DiagnosticSpanContext,
  statement: DslStatement,
  span: DslSpan,
  code: string,
  message: string,
  presentation?: DslDiagnostic["presentation"]
): DslDiagnostic => {
  const physicalSpan = exactPhysicalSpan(spans, statement, span);
  return {
    severity: "error",
    line: statement.line,
    column: span.start + 1,
    code,
    message,
    presentation: presentation ?? { key: `diagnostic.${code}` },
    exactSpanOnly: true,
    ...(physicalSpan ? { physicalSpan } : {})
  };
};

/**
 * `nui 1` geometry-property references use the same bare path spelling as
 * other geometry references. Property resolution, target validation and type
 * diagnostics remain owned by the scalar/compiler pipeline; this hook only
 * rejects the removed legacy sigil spelling.
 */
export const compilePropertyReferenceSyntax = ({
  statements,
  elementIdByStatementIndex,
  elements,
  spans,
  includeStatement,
  transformationRecipes
}: {
  statements: readonly DslStatement[];
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
  elements: readonly CadElement[];
  spans: DiagnosticSpanContext;
  includeStatement?: DslStatementInclusion;
  transformationRecipes?: readonly TransformationRecipe[];
}): PropertyReferenceSyntaxCompilation => {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const recipeByStatementIndex = new Map(transformationRecipes?.map(recipe => [recipe.sourceStatementIndex, recipe]));
  const diagnostics: DslDiagnostic[] = [];

  statements.forEach((statement, statementIndex) => {
    if (includeStatement && !includeStatement(statement, statementIndex)) return;
    const logical = spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
    if (!logical) return;
    const inspect = (valueSpan: DslSpan | null) => {
      if (!valueSpan) return;
      const valueSource = logical.logicalText.slice(valueSpan.start, valueSpan.end);
      if (!/[@'"]/.test(valueSource)) return;
      const { tokens, error } = tokenizeScalarExpression(valueSource, { start: 0, end: valueSource.length });
      const reportQuoted = (span: DslSpan) => diagnostics.push(diagnosticAt(
        spans, statement,
        { start: valueSpan.start + span.start, end: valueSpan.start + span.end },
        "quoted-identifier-not-allowed",
        "参照名を引用符で囲むことはできません。"
      ));
      const markedByStart = new Map<number, number>();
      const inspectMarker = (marker: number, malformed: boolean) => {
        const parsed = parseDslSourceReferenceAt(valueSource, marker + 1, valueSource.length, { allowOptionalProperty: true });
        if (parsed.kind === "valid" && (parsed.reference.property !== null || parsed.reference.occurrenceIndex !== null ||
          parsed.reference.path.absolute || parsed.reference.path.segments.length > 1)) {
          markedByStart.set(marker, parsed.end);
        } else if (malformed) {
          const rawPath = readDslReferencePath(valueSource, marker + 1);
          markedByStart.set(marker, rawPath.kind === "valid" ? rawPath.end : marker + 1);
        }
      };
      if (error?.code === "unexpected-token" && valueSource[error.span.start] === "@") {
        inspectMarker(error.span.start, true);
      }
      if (error?.code === "unexpected-token" && ["\"", "'"].includes(valueSource[error.span.start] ?? "")) {
        reportQuoted(error.span);
      }
      for (const [index, token] of tokens.entries()) {
        if (token.kind !== "literal") continue;
        if (token.choiceMarker) inspectMarker(token.literal.span.start, false);
        if (token.literal.kind !== "string") continue;
        const next = tokens[index + 1];
        if (next?.kind !== "postfixProperty" && next?.kind !== "optionalPostfixProperty" &&
          next?.kind !== "leftBracket" && !valueSource.slice(token.literal.span.end).trimStart().startsWith("::")) continue;
        reportQuoted(token.literal.span);
      }
      for (const [start, end] of markedByStart) {
        const referenceText = valueSource.slice(start, end);
        diagnostics.push(diagnosticAt(
          spans,
          statement,
          { start: valueSpan.start + start, end: valueSpan.start + end },
          "invalid-source-reference",
          `通常参照に「@」は使えません。(${referenceText})`,
          { key: "diagnostic.invalid-source-reference", parameters: { reference: referenceText } }
        ));
      }
    };

    if (statement.kind === "element" || statement.kind === "group") {
      const element = byId.get(elementIdByStatementIndex.get(statementIndex) ?? "");
      if (!element) return;
      for (const definition of getParameterDefinitions(element)) {
        if (definition.kind !== "number") continue;
        const value = getParameterValue(element, definition.key) as NumericValue | undefined;
        if (!value || !isNumericExpression(value)) continue;
        inspect(resolveParameterValueSpan(logical.logicalText, element, definition.key));
      }
      return;
    }

    const attributeSpan = (key: string): DslSpan | null => {
      const attribute = statement.attrs.find(attr => attr.key === key);
      return attribute ? { start: attribute.valueStart, end: attribute.valueEnd } : null;
    };
    if (statement.kind === "transformation") {
      const recipe = recipeByStatementIndex.get(statementIndex);
      if (!recipe) return;
      for (const numeric of transformationNumericInputs(recipe.operation)) {
        const outer = attributeSpan(numeric.argumentKey);
        const axis = numeric.parameterPath.endsWith(".x") ? "x" : numeric.parameterPath.endsWith(".y") ? "y" : null;
        inspect(outer && axis ? coordinateComponent(logical.logicalText, outer, axis) : outer);
      }
      return;
    }
    const numericKeys = statement.kind === "layout" ? layoutNumericAttrKeys
      : statement.kind === "print" ? printNumericAttrKeys
      : statement.kind === "svg" ? svgNumericAttrKeys
      : statement.kind === "place" ? placeNumericAttrKeys
      : [];
    for (const key of numericKeys) inspect(attributeSpan(key));
    if (statement.kind === "place") {
      for (const key of placeCoordinateAttrKeys) {
        const outer = attributeSpan(key);
        if (!outer) continue;
        inspect(coordinateComponent(logical.logicalText, outer, "x"));
        inspect(coordinateComponent(logical.logicalText, outer, "y"));
      }
    }
  });

  return { diagnostics };
};
