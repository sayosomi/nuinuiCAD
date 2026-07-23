// Task 25: compiles a `conditionalGroup.condition` DSL value into a typed
// boolean expression when it is genuinely typed-only syntax, leaving every
// legacy numeric condition (including one that happens to use comparisons or
// `&&`/`||`, which the legacy numeric grammar already supports) completely
// untouched. See docs/typed-variables/tasks/25-boolean-control-flow-runtime.md.
//
// Classification is NOT "does it parse as a scalar expression" - the legacy
// numeric expression grammar (src/geometry/numericExpressionParser.ts) also
// parses comparisons and `&&`/`||`, producing 0/1. A condition is only
// legacy-eligible when it contains no syntax the legacy grammar cannot
// represent at all (boolean/string/choice literals, unary `!`) AND every
// `@name` reference inside it resolves to a definite legacy var
// (`declaredType === null`, or is absent entirely - zero references is
// vacuously legacy-eligible too, since it's already fully expressible in the
// old system). Anything else is a typed candidate: an unresolved reference,
// a legacy-var reference mixed into otherwise-typed-only syntax, or a
// non-boolean result type all become a fail-closed compile diagnostic - never
// a silent fallback to the legacy adapter once committed to the typed path.
//
// Unlike src/scalars/propertyBindingCompiler.ts (Task 22), this module does
// not route through ParameterDefinition.kind/SCALAR_ELIGIBLE_PARAMETER_KINDS
// at all: `condition`'s ParameterDefinition intentionally stays `kind:
// "number"` (its legacy literal/UI shape is unchanged), and the whole
// attribute value here is a full expression - not a single `@name` token -
// so Task 22's bare-reference-only compiler cannot represent it.

import type { CadElement, ElementId } from "../types/geometry";
import type { DslDiagnostic, DslSpan, DslStatement } from "../dsl/dslTypes";
import type { BindingAnalysis } from "./bindingAnalysis";
import { resolveReferencesAtSites, type BindingResolution, type SiteReferenceRequest } from "./bindingResolution";
import type { ScalarExpressionAst } from "./expressionAst";
import { parseScalarExpression } from "./expressionParser";
import { typecheckScalarExpression } from "./expressionTypecheck";
import { propertyBindingOccurrenceKey } from "./propertyBindingCompiler";
import { collectReferences } from "./typedDeclarationAnalysis";
import type { TypedScalarExpression } from "./typedExpressionAst";

export const CONDITIONAL_GROUP_CONDITION_UNRESOLVED_CODE = "conditional-group-condition-unresolved";
export const CONDITIONAL_GROUP_CONDITION_INVALID_CODE = "conditional-group-condition-invalid";
export const CONDITIONAL_GROUP_CONDITION_LEGACY_REFERENCE_CODE = "conditional-group-condition-legacy-reference";
export const CONDITIONAL_GROUP_CONDITION_TYPE_MISMATCH_CODE = "conditional-group-condition-type-mismatch";

export type CompileConditionalGroupConditionsInput = {
  statements: readonly DslStatement[];
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
  elements: readonly CadElement[];
  bindingAnalysis: BindingAnalysis;
};

export type ConditionalGroupConditionCompilation = {
  sourcesByOccurrenceKey: ReadonlyMap<string, TypedScalarExpression>;
  diagnostics: readonly DslDiagnostic[];
};

const diagnosticAt = (statement: DslStatement, span: DslSpan, code: string, message: string): DslDiagnostic => ({
  severity: "error",
  line: statement.line,
  column: span.start + 1,
  code,
  message,
  physicalSpan: statement.physicalSpan
});

/** Any occurrence of these forms anywhere in the tree (through `group`
 * wrapping) is syntax the legacy numeric grammar cannot represent at all, so
 * this text could never have been a working legacy condition regardless of
 * what its references resolve to. */
const containsLegacyIncompatibleSyntax = (ast: ScalarExpressionAst): boolean => {
  switch (ast.kind) {
    case "booleanLiteral":
    case "stringLiteral":
    case "unresolvedChoiceLiteral":
      return true;
    case "unary":
      return ast.operator === "!" || containsLegacyIncompatibleSyntax(ast.operand);
    case "binary":
      return containsLegacyIncompatibleSyntax(ast.left) || containsLegacyIncompatibleSyntax(ast.right);
    case "group":
      return containsLegacyIncompatibleSyntax(ast.expression);
    default:
      return false;
  }
};

const isDefiniteLegacyReference = (resolution: BindingResolution | undefined): boolean =>
  resolution?.kind === "resolved" && resolution.binding.declaredType === null;

const unresolvedMessage = (name: string, resolution: BindingResolution | undefined): string => {
  if (resolution?.kind === "forward") return `"${name}" はこの位置より後で宣言されているため、まだ参照できません。`;
  if (resolution?.kind === "duplicate") return `"${name}" は複数の宣言と一致するため一意に解決できません。`;
  return `未定義の変数 "${name}" を参照しています。`;
};

export const compileConditionalGroupConditions = ({
  statements,
  elementIdByStatementIndex,
  elements,
  bindingAnalysis
}: CompileConditionalGroupConditionsInput): ConditionalGroupConditionCompilation => {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const diagnostics: DslDiagnostic[] = [];
  const sourcesByOccurrenceKey = new Map<string, TypedScalarExpression>();

  statements.forEach((statement, statementIndex) => {
    if (statement.kind !== "element" || statement.type !== "conditionalGroup") return;
    const elementId = elementIdByStatementIndex.get(statementIndex);
    if (!elementId || !elementsById.has(elementId)) return;

    const attr = statement.attrs.find((item) => item.key === "condition");
    if (!attr) return;

    const span: DslSpan = { start: attr.valueStart, end: attr.valueEnd };
    const parsed = parseScalarExpression(" ".repeat(attr.valueStart) + attr.value, span);
    if (!parsed.ast) return; // Not valid scalar-expression syntax at all - legacy path, untouched.
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

    const hasTypedOnlySyntax = containsLegacyIncompatibleSyntax(ast);
    const legacyEligible = !hasTypedOnlySyntax
      && references.every((_, index) => isDefiniteLegacyReference(resolutionAt(index)));
    if (legacyEligible) return; // Fully expressible in - and left to - the legacy numeric adapter.

    // Typed candidate: every reference must resolve to a usable typed
    // binding, or this occurrence fails closed with a diagnostic rather than
    // silently falling back to legacy (it is committed to the typed path).
    let hasReferenceDiagnostic = false;
    references.forEach((reference, index) => {
      const resolution = resolutionAt(index);
      if (!resolution || resolution.kind !== "resolved") {
        diagnostics.push(diagnosticAt(
          statement, reference.span, CONDITIONAL_GROUP_CONDITION_UNRESOLVED_CODE,
          unresolvedMessage(reference.name, resolution)
        ));
        hasReferenceDiagnostic = true;
        return;
      }
      if (resolution.binding.declaredType === null) {
        const message = resolution.binding.kind === "legacy"
          ? `"${reference.name}" はlegacy変数であり、型付き条件式の中では使用できません。`
          : `"${reference.name}" は無効な宣言のため参照できません。`;
        diagnostics.push(diagnosticAt(statement, reference.span, CONDITIONAL_GROUP_CONDITION_LEGACY_REFERENCE_CODE, message));
        hasReferenceDiagnostic = true;
        return;
      }
      const entry = bindingAnalysis.entriesById.get(resolution.binding.id);
      if (entry?.status.kind === "invalid") {
        diagnostics.push(diagnosticAt(
          statement, reference.span, CONDITIONAL_GROUP_CONDITION_INVALID_CODE,
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
        diagnosticAt(statement, diagnostic.span, CONDITIONAL_GROUP_CONDITION_TYPE_MISMATCH_CODE, diagnostic.message)
      ));
      return;
    }
    if (checked.type === null || checked.type.kind !== "boolean") {
      // Defensive: every silent-null source (unresolved reference, null
      // declaredType) was already diagnosed above, so this should be
      // unreachable - kept fail-closed rather than assumed impossible.
      diagnostics.push(diagnosticAt(
        statement, span, CONDITIONAL_GROUP_CONDITION_TYPE_MISMATCH_CODE,
        "条件式はboolean型である必要があります。"
      ));
      return;
    }

    sourcesByOccurrenceKey.set(occurrenceKey, checked.typed);
  });

  return { sourcesByOccurrenceKey, diagnostics };
};
