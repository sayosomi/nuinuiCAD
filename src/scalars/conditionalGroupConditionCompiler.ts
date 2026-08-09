// Compiles a `conditionalGroup.condition` DSL value into a typed boolean
// expression whenever it references a typed binding or uses typed-only
// syntax. Reference-free numeric conditions remain in the element-local
// numeric evaluation path.
//
// Unlike src/scalars/propertyBindingCompiler.ts (Task 22), this module does
// not route through ParameterDefinition.kind/SCALAR_ELIGIBLE_PARAMETER_KINDS
// at all: `condition`'s ParameterDefinition intentionally stays `kind:
// "number"` (its literal/UI shape is unchanged), and the whole
// attribute value here is a full expression - not a single `@name` token -
// so Task 22's bare-reference-only compiler cannot represent it.

import type { CadElement, ElementId } from "../types/geometry";
import type { DslDiagnostic, DslSpan, DslStatement } from "../dsl/dslTypes";
import type { DslStatementInclusion } from "../dsl/dslCompilationGuard";
import { exactPhysicalSpan, type DiagnosticSpanContext } from "../dsl/dslDiagnosticSpan";
import type { BindingAnalysis } from "./bindingAnalysis";
import { resolveReferencesAtSites, type SiteReferenceRequest } from "./bindingResolution";
import { parseScalarExpression } from "./expressionParser";
import { typecheckScalarExpression } from "./expressionTypecheck";
import { propertyBindingOccurrenceKey } from "./propertyBindingCompiler";
import {
  collectReferences,
  containsNonNumericScalarSyntax,
  unresolvedReferenceMessage
} from "./typedDeclarationAnalysis";
import type { TypedScalarExpression } from "./typedExpressionAst";

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

/** Exact-span-or-nothing (Task 48) - see typedDeclarationAnalysis.ts's
 * compileDiagnostic. No navigationTarget: a conditionalGroup.condition
 * occurrence that failed to resolve has no separate resolved-index entry to
 * jump to (Task 45's own consumer rows already fall back to a whole-element
 * jump for this same reason - "no Task 43 span index of its own"). */
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

  statements.forEach((statement, statementIndex) => {
    if (includeStatement && !includeStatement(statement, statementIndex)) return;
    if (statement.kind !== "element" || statement.type !== "conditionalGroup") return;
    const elementId = elementIdByStatementIndex.get(statementIndex);
    if (!elementId || !elementsById.has(elementId)) return;

    const attr = statement.attrs.find((item) => item.key === "condition");
    if (!attr) return;

    const span: DslSpan = { start: attr.valueStart, end: attr.valueEnd };
    const parsed = parseScalarExpression(" ".repeat(attr.valueStart) + attr.value, span);
    if (!parsed.ast) return; // Not scalar-expression syntax: numeric evaluation owns it.
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

    if (references.length === 0 && !containsNonNumericScalarSyntax(ast)) return;

    // Typed candidate: every reference must resolve to a usable typed
    // binding, or this occurrence fails closed with a diagnostic.
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

    const checked = typecheckScalarExpression(ast, {
      expectedType: { kind: "boolean" },
      references: references.map((_, index) => resolutionAt(index)!)
    });
    if (checked.diagnostics.length > 0) {
      diagnostics.push(...checked.diagnostics.map((diagnostic) =>
        diagnosticAt(spans, statement, diagnostic.span, CONDITIONAL_GROUP_CONDITION_TYPE_MISMATCH_CODE, diagnostic.message)
      ));
      return;
    }
    if (checked.type === null || checked.type.kind !== "boolean") {
      // Defensive: every silent-null source (unresolved reference, null
      // declaredType) was already diagnosed above, so this should be
      // unreachable - kept fail-closed rather than assumed impossible.
      diagnostics.push(diagnosticAt(
        spans, statement, span, CONDITIONAL_GROUP_CONDITION_TYPE_MISMATCH_CODE,
        "条件式はboolean型である必要があります。"
      ));
      return;
    }

    sourcesByOccurrenceKey.set(occurrenceKey, checked.typed);
  });

  return { sourcesByOccurrenceKey, diagnostics };
};
