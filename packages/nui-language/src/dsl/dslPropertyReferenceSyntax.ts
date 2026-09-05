// Task 51: nui 1 requires element-property references to carry the `@`
// sigil (`@Element.property`, disambiguated from `@name` typed-binding
// references by the presence of `.`). This module flags every bare
// `Element.property` occurrence (no leading `@`) in a nui 1 document's
// numeric-expression-bearing statements as an explicit diagnostic, rather
// than silently accepting the pre-migration spelling || silently rewriting
// it. Callers invoke it only for `nui 1` compilation (mirrors compileTextTemplates'
// own gate in dslDocument.ts, not compileNumericBindings' scalarAnalysis
// gate, since a nui 1 document with zero const/let/set statements never
// runs scalar analysis but must still reject bare property references).
import type { CadElement, ElementId } from "../types/geometry";
import type { DslDiagnostic, DslSpan, DslStatement } from "../dsl/dslTypes";
import type { DslStatementInclusion } from "./dslCompilationGuard";
import { exactPhysicalSpan, type DiagnosticSpanContext } from "./dslDiagnosticSpan";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import { getParameterValue } from "../parameters/parameterAccess";
import { resolveParameterValueSpan } from "./dslParameterSpans";
import { isNumericExpression } from "../geometry/numericExpressions";
import { barePropertyReferenceIssues } from "./expressionReferenceToken";
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
      const issues = barePropertyReferenceIssues(
        logical.logicalText.slice(valueSpan.start, valueSpan.end),
        valueSpan.start
      );
      for (const issue of issues) {
        diagnostics.push(
          diagnosticAt(
            spans,
            statement,
            { start: issue.start, end: issue.end },
            issue.code,
            issue.message,
            issue.code === "missing-sigil"
              ? { key: "diagnostic.missing-sigil", parameters: { reference: `${issue.elementToken}.${issue.query}` } }
              : undefined
          )
        );
      }
    }
  });

  return { diagnostics };
};
