// Compiles every condition that the shared scalar parser can represent into a
// typed boolean expression. Syntax outside that parser remains on the
// migration-era numeric path until the final cleanup task.

import type { CadElement, ElementId } from "../types/geometry";
import type { DslDiagnostic, DslSpan, DslStatement } from "../dsl/dslTypes";
import type { DslStatementInclusion } from "../dsl/dslCompilationGuard";
import { exactPhysicalSpan, type DiagnosticSpanContext } from "../dsl/dslDiagnosticSpan";
import type { BindingAnalysis } from "./bindingAnalysis";
import { resolveReferencesAtSites, type SiteReferenceRequest } from "./bindingResolution";
import { parseScalarExpression } from "./expressionParser";
import { typecheckScalarExpression } from "./expressionTypecheck";
import { propertyBindingOccurrenceKey } from "./propertyBindingCompiler";
import { collectReferences, unresolvedReferenceMessage } from "./typedDeclarationAnalysis";
import type { TypedScalarExpression } from "./typedExpressionAst";
import { resolveTypedGeometryProperties } from "./typedGeometryPropertyResolution";
import { createElementNameContext } from "../model/elementNames";
import { prepareRecordScalarExpressionFromCatalog } from "./recordScalarLowering";

export const CONDITIONAL_GROUP_CONDITION_UNRESOLVED_CODE = "conditional-group-condition-unresolved";
export const CONDITIONAL_GROUP_CONDITION_INVALID_CODE = "conditional-group-condition-invalid";
export const CONDITIONAL_GROUP_CONDITION_TYPE_MISMATCH_CODE = "conditional-group-condition-type-mismatch";

export type CompileConditionalGroupConditionsInput = {
  statements: readonly DslStatement[];
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
  elements: readonly CadElement[];
  bindingAnalysis: BindingAnalysis;
  spans: DiagnosticSpanContext;
  includeStatement?: DslStatementInclusion;
};

export type ConditionalGroupConditionCompilation = {
  sourcesByOccurrenceKey: ReadonlyMap<string, TypedScalarExpression>;
  diagnostics: readonly DslDiagnostic[];
};

const diagnosticAt = (spans: DiagnosticSpanContext, statement: DslStatement, span: DslSpan, code: string, message: string): DslDiagnostic => {
  const physicalSpan = exactPhysicalSpan(spans, statement, span);
  return {
    severity: "error",
    line: statement.line,
    column: span.start + 1,
    code,
    message,
    exactSpanOnly: true,
    ...(physicalSpan ? { physicalSpan } : {})
  };
};

export const compileConditionalGroupConditions = ({
  statements,
  elementIdByStatementIndex,
  elements,
  bindingAnalysis,
  spans,
  includeStatement
}: CompileConditionalGroupConditionsInput): ConditionalGroupConditionCompilation => {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const diagnostics: DslDiagnostic[] = [];
  const sourcesByOccurrenceKey = new Map<string, TypedScalarExpression>();
  const sourceOrderByElementId = new Map<ElementId, number>();
  for (const [sourceOrder, elementId] of elementIdByStatementIndex) sourceOrderByElementId.set(elementId, sourceOrder);
  const nameContext = createElementNameContext([...elements]);

  statements.forEach((statement, statementIndex) => {
    if (includeStatement && !includeStatement(statement, statementIndex)) return;
    if (statement.kind !== "element" || statement.type !== "conditionalGroup") return;
    const elementId = elementIdByStatementIndex.get(statementIndex);
    if (!elementId || !elementsById.has(elementId)) return;

    const attr = statement.attrs.find((item) => item.key === "condition");
    if (!attr) return;

    const span: DslSpan = { start: attr.valueStart, end: attr.valueEnd };
    const parsed = parseScalarExpression(" ".repeat(attr.valueStart) + attr.value, span);
    if (!parsed.ast) return;
    const ast = parsed.ast;

    const references = collectReferences(ast);
    const occurrenceKey = propertyBindingOccurrenceKey(statementIndex, "condition");
    const scopeId = bindingAnalysis.catalog.scopeIndex.scopeOfStatement.get(statementIndex)
      ?? bindingAnalysis.catalog.scopeIndex.rootScopeId;
    const requestKey = (index: number) => `${occurrenceKey}:${index}`;
    const requests: SiteReferenceRequest[] = references.map((reference, index) => ({
      key: requestKey(index),
      name: reference.name,
      site: { scopeId, statementIndex }
    }));
    const resolutions = resolveReferencesAtSites(bindingAnalysis.catalog, requests);
    const resolutionAt = (index: number) => resolutions.get(requestKey(index));

    let hasReferenceDiagnostic = false;
    references.forEach((reference, index) => {
      const resolution = resolutionAt(index);
      if (!resolution || resolution.kind !== "resolved") {
        diagnostics.push(diagnosticAt(
          spans, statement, reference.span, CONDITIONAL_GROUP_CONDITION_UNRESOLVED_CODE,
          unresolvedReferenceMessage(reference.name, resolution)
        ));
        hasReferenceDiagnostic = true;
        return;
      }
      const entry = bindingAnalysis.entriesById.get(resolution.binding.id);
      if (entry?.status.kind === "invalid") {
        diagnostics.push(diagnosticAt(
          spans, statement, reference.span, CONDITIONAL_GROUP_CONDITION_INVALID_CODE,
          `"${reference.name}" は無効な宣言のため参照できません。`
        ));
        hasReferenceDiagnostic = true;
      }
    });
    if (hasReferenceDiagnostic) return;

    const prepared = prepareRecordScalarExpressionFromCatalog({
      ast,
      statementIndex,
      catalog: bindingAnalysis.catalog,
      referenceResolutions: references.map((_, index) => resolutionAt(index)!)
    });
    if (prepared.issues.length > 0) {
      diagnostics.push(...prepared.issues.map((issue) =>
        diagnosticAt(spans, statement, issue.span, CONDITIONAL_GROUP_CONDITION_INVALID_CODE, issue.message)
      ));
      return;
    }

    const checked = typecheckScalarExpression(prepared.ast, {
      expectedType: { kind: "boolean" },
      references: prepared.references
    });
    if (checked.diagnostics.length > 0) {
      diagnostics.push(...checked.diagnostics.map((diagnostic) =>
        diagnosticAt(spans, statement, diagnostic.span, CONDITIONAL_GROUP_CONDITION_TYPE_MISMATCH_CODE, diagnostic.message)
      ));
      return;
    }
    if (checked.type === null || checked.type.kind !== "boolean") {
      diagnostics.push(diagnosticAt(
        spans, statement, span, CONDITIONAL_GROUP_CONDITION_TYPE_MISMATCH_CODE,
        "条件式はboolean型である必要があります。"
      ));
      return;
    }

    const element = elementsById.get(elementId);
    const geometryResolution = resolveTypedGeometryProperties(
      checked.typed,
      elements,
      sourceOrderByElementId,
      { currentElement: element, nameContext, currentSourceOrder: statementIndex }
    );
    if (geometryResolution.issues.length > 0) {
      diagnostics.push(...geometryResolution.issues.map((issue) =>
        diagnosticAt(spans, statement, issue.span, "geometry-property-invalid", issue.message)
      ));
      return;
    }
    sourcesByOccurrenceKey.set(occurrenceKey, geometryResolution.expression);
  });

  return { sourcesByOccurrenceKey, diagnostics };
};
