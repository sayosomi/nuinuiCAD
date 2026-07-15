import { parseDsl, dslScopeBeforeParsedLine } from "./dslParser";
import type { DslStatement } from "./dslTypes";
import type { DslLiveStatementIdentity } from "./dslCompletionCandidates";
import { tokenize, Parser } from "../geometry/numericExpressionParser";
import { variableIsInScope } from "../geometry/variableScope";
import type { NumericVariableReferenceOption } from "../geometry/variableReferenceOptions";
import type { CadElement, ComputedVariable, ElementId, VariableElement } from "../types/geometry";

type DslVariableStatement = Extract<DslStatement, { kind: "variable" }>;

const attrValue = (statement: DslStatement, key: string) => statement.attrs.find((attr) => attr.key === key)?.value;

const disabledAttrValues = new Set(["false", "0", "no", "off"]);
const isVariableStatementDisabled = (statement: DslStatement) => {
  const value = attrValue(statement, "enabled")?.toLowerCase();
  return value !== undefined && disabledAttrValues.has(value);
};

/**
 * Syntax-only validity check: does the expression tokenize and parse without
 * needing any real computed value? The stub callbacks always return 0 and are
 * never used to produce a real value, so this never requires evaluation,
 * computedGeometry, or computedVariables — it only proves operator/paren/token
 * structure, matching the "parseできない変数宣言" exclusion, independent of the
 * separate "evaluator上で無効・未計算" (Tier B) exclusion below.
 */
export const isExpressionSyntaxValid = (expression: string): boolean => {
  try {
    new Parser(tokenize(expression), () => 0, () => 0, () => 0).parse();
    return true;
  } catch {
    return false;
  }
};

const variableScopeOf = (statement: DslVariableStatement): "global" | "group" =>
  attrValue(statement, "scope") === "group" ? "group" : "global";

/**
 * Live-buffer candidates for top-level `var Name = expr` declarations, built by
 * reparsing `source` fresh on every call (never falling back to a possibly-stale
 * compiled document). Mirrors dslReferenceCompletionOptions's live-scope/live-
 * identity pattern (dslCompletionCandidates.ts) for scope and statement-identity
 * cross-referencing, extended with the exclusions specific to @variable:
 *
 * - forward reference / @stop cutoff: only statements strictly before
 *   min(cursorLine, first @stop line) are considered at all.
 * - disabled: an `enabled=false` (or 0/no/off) attribute excludes the statement.
 * - unparseable: a syntactically invalid expression excludes the statement
 *   (Tier A, always live, never needs a compiled/evaluated result).
 * - scope: variableIsInScope is the sole authority (never reimplemented).
 * - evaluator-invalid/uncomputed (Tier B): only excluded when this specific live
 *   statement still cross-references an unedited compiled `variable` element
 *   (compiled.type === "variable") AND that element is missing from
 *   computedVariables. A brand-new, never-compiled declaration has no such
 *   cross-reference and is never excluded on this basis alone — excluding it
 *   would mean a variable typed in this same editing session could never be
 *   offered to later expressions, contradicting the live-buffer requirement.
 */
export const dslVariableCompletionOptions = ({
  source,
  cursorLine,
  statementElementIds,
  elements,
  computedVariables
}: {
  source: string;
  cursorLine: number;
  statementElementIds: DslLiveStatementIdentity;
  elements: readonly CadElement[];
  computedVariables?: Map<ElementId, ComputedVariable>;
}): NumericVariableReferenceOption[] => {
  const parsed = parseDsl(source);
  const scope = dslScopeBeforeParsedLine(parsed, cursorLine);
  const scopeStatement = scope ? parsed.statements[scope.statementIndex] : null;
  const parentGroupId = scopeStatement ? statementElementIds.get(scopeStatement.line) : undefined;
  if (scopeStatement && !parentGroupId) return [];

  const firstAtStopLine = parsed.statements.find((statement) => statement.kind === "atStop")?.line ?? Infinity;
  const cutoffLine = Math.min(cursorLine, firstAtStopLine);
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const consumer: Pick<CadElement, "parentGroupId"> = { parentGroupId };

  const eligible = parsed.statements.filter(
    (statement): statement is DslVariableStatement =>
      statement.kind === "variable" &&
      statement.line < cutoffLine &&
      statement.name.trim().length > 0 &&
      !isVariableStatementDisabled(statement) &&
      isExpressionSyntaxValid(statement.expression)
  );

  const filtered = eligible.filter((statement) => {
    const enclosing = statement.enclosing ? parsed.statements[statement.enclosing.statementIndex] : null;
    const liveParentGroupId = enclosing ? statementElementIds.get(enclosing.line) : undefined;
    if (enclosing && !liveParentGroupId) return false;
    const syntheticVariable: Pick<VariableElement, "scope" | "parentGroupId"> = {
      scope: variableScopeOf(statement),
      parentGroupId: liveParentGroupId
    };
    if (!variableIsInScope({ variable: syntheticVariable, consumer, elementsById })) return false;

    const elementId = statementElementIds.get(statement.line);
    const compiled = elementId ? elementsById.get(elementId) : undefined;
    if (compiled && compiled.type === "variable" && computedVariables && !computedVariables.has(compiled.id)) return false;
    return true;
  });

  const nameCounts = new Map<string, number>();
  for (const statement of filtered) nameCounts.set(statement.name, (nameCounts.get(statement.name) ?? 0) + 1);

  return filtered
    .map((statement): NumericVariableReferenceOption => {
      const elementId = statementElementIds.get(statement.line);
      const varScope = variableScopeOf(statement);
      const expression = (nameCounts.get(statement.name) ?? 0) > 1 && elementId
        ? `@${elementId}`
        : `@${statement.name}`;
      return {
        expression,
        displayExpression: `@${statement.name}`,
        label: `@${statement.name}`,
        detail: varScope === "global" ? "全体変数" : "グループ変数",
        source: varScope,
        elementId
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label, "ja"));
};
