import { parseDsl, dslScopeBeforeParsedLine } from "./dslParser";
import type { DslStatement } from "./dslTypes";
import { liveElementsBeforeLine, type DslLiveStatementIdentity } from "./dslCompletionCandidates";
import { elementNameTokensForContext } from "../model/elementNames";
import { numericExpressionSyntaxIsValid } from "../geometry/numericExpressionParser";
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
 * Matches the "parseできない変数宣言" exclusion (Tier A), independent of the
 * separate "evaluator上で無効・未計算" (Tier B) exclusion below. The check
 * itself lives with the numeric expression parser; this re-export keeps the
 * established completion-side name.
 */
export const isExpressionSyntaxValid = numericExpressionSyntaxIsValid;

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

  // Duplicate-name candidates must insert a token that stays resolvable after
  // save→reload. Runtime element ids are session-scoped (plan.md design
  // decision 6), so falling back to `@<runtime id>` writes a reference into
  // canonical text that breaks on the next load. Instead:
  //   1. an explicit `id=` attribute is itself persisted text — reuse it;
  //   2. otherwise use the shortest live namespace-qualified token that
  //      uniquely names this variable (the same elementNameTokensForContext
  //      the compiler's own resolution uses);
  //   3. otherwise suppress the candidate — never guess (the layoutVar
  //      completion's established policy).
  const uniqueTokensById = (() => {
    let cached: Map<ElementId, string> | null = null;
    return () => {
      if (cached) return cached;
      const live = liveElementsBeforeLine(parsed, cutoffLine, statementElementIds, elements);
      const variableTokens = elementNameTokensForContext({ elements: live, currentElement: consumer })
        .filter((item) => item.element.type === "variable");
      const tokenCounts = new Map<string, number>();
      for (const { token } of variableTokens) tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
      const duplicatePlainNames = new Set(
        filtered.filter((statement) => (nameCounts.get(statement.name) ?? 0) > 1).map((statement) => statement.name)
      );
      cached = new Map<ElementId, string>();
      for (const { token, element } of variableTokens) {
        if ((tokenCounts.get(token) ?? 0) !== 1) continue;
        // A token equal to a duplicated plain name may still collide with a
        // never-compiled twin that liveElementsBeforeLine cannot see yet.
        if (duplicatePlainNames.has(token)) continue;
        const existing = cached.get(element.id);
        if (!existing || token.length < existing.length) cached.set(element.id, token);
      }
      return cached;
    };
  })();

  return filtered
    .flatMap((statement): NumericVariableReferenceOption[] => {
      const elementId = statementElementIds.get(statement.line);
      const varScope = variableScopeOf(statement);
      const detail = varScope === "global" ? "全体変数" : "グループ変数";
      let token = statement.name;
      if ((nameCounts.get(statement.name) ?? 0) > 1) {
        const explicitId = attrValue(statement, "id");
        const qualified = explicitId ?? (elementId ? uniqueTokensById().get(elementId) : undefined);
        if (!qualified) return [];
        token = qualified;
      }
      return [{
        expression: `@${token}`,
        displayExpression: `@${token}`,
        label: `@${token}`,
        detail,
        source: varScope,
        elementId
      }];
    })
    .sort((left, right) => left.label.localeCompare(right.label, "ja"));
};
