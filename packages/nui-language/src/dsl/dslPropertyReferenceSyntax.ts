import type { CadElement, ElementId } from "../types/geometry";
import type { DslDiagnostic, DslSpan, DslStatement } from "../dsl/dslTypes";
import type { DslStatementInclusion } from "./dslCompilationGuard";
import { exactPhysicalSpan, type DiagnosticSpanContext } from "./dslDiagnosticSpan";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import { getParameterValue } from "../parameters/parameterAccess";
import { isNumericExpression } from "../geometry/numericExpressions";
import { resolveParameterValueSpan } from "./dslParameterSpans";
import { scanExpressionReferences } from "./expressionReferenceToken";
import type { NumericValue } from "../types/geometry";

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
  includeStatement
}: {
  statements: readonly DslStatement[];
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
  elements: readonly CadElement[];
  spans: DiagnosticSpanContext;
  includeStatement?: DslStatementInclusion;
}): PropertyReferenceSyntaxCompilation => {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const diagnostics: DslDiagnostic[] = [];

  statements.forEach((statement, statementIndex) => {
    if (includeStatement && !includeStatement(statement, statementIndex)) return;
    if (statement.kind !== "element" && statement.kind !== "group") return;
    const element = byId.get(elementIdByStatementIndex.get(statementIndex) ?? "");
    const logical = spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
    if (!element || !logical) return;

    for (const definition of getParameterDefinitions(element)) {
      if (definition.kind !== "number") continue;
      const value = getParameterValue(element, definition.key) as NumericValue | undefined;
      if (!value || !isNumericExpression(value)) continue;
      const valueSpan = resolveParameterValueSpan(logical.logicalText, element, definition.key);
      if (!valueSpan) continue;
      const valueSource = logical.logicalText.slice(valueSpan.start, valueSpan.end);
      for (const reference of scanExpressionReferences(valueSource)) {
        if (reference.kind !== "elementProperty" || !reference.sigil) continue;
        const referenceText = valueSource.slice(reference.tokenStart, reference.tokenEnd);
        diagnostics.push(diagnosticAt(
          spans,
          statement,
          { start: valueSpan.start + reference.tokenStart, end: valueSpan.start + reference.tokenEnd },
          "invalid-source-reference",
          `通常参照に「@」は使えません。(${referenceText})`,
          { key: "diagnostic.invalid-source-reference", parameters: { reference: referenceText } }
        ));
      }
    }
  });

  return { diagnostics };
};
