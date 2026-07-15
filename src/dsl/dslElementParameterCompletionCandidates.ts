import { dslScopeBeforeParsedLine, parseDsl } from "./dslParser";
import { liveElementsBeforeLine, type DslLiveStatementIdentity } from "./dslCompletionCandidates";
import {
  elementParameterReferenceOptionsForPosition,
  type ElementParameterReferenceOption
} from "../geometry/elementParameterReferenceOptions";
import type { CadElement, ComputedGeometry, ComputedVariable, DependencyError, ElementId } from "../types/geometry";
import type { DslStatement } from "./dslTypes";

const attrValue = (statement: DslStatement, key: string) => statement.attrs.find((attr) => attr.key === key)?.value;
const disabledAttrValues = new Set(["false", "0", "no", "off"]);

/**
 * Generalizes dslVariableCompletionCandidates.ts's isVariableStatementDisabled
 * to any element statement kind - the `enabled=` attribute grammar is uniform
 * across every element type, not variable-specific.
 */
const isStatementDisabled = (statement: DslStatement) => {
  const value = attrValue(statement, "enabled")?.toLowerCase();
  return value !== undefined && disabledAttrValues.has(value);
};

/**
 * Live-buffer candidates for `ElementName.parameterKey` completion, reparsing
 * `source` fresh on every call (never falling back to a stale compiled
 * document for element identity/name/scope - only the last-applied
 * evaluation's computedGeometry/computedVariables/errors are necessarily
 * stale relative to dirty text, matching dslVariableCompletionOptions's own
 * Tier B compromise).
 *
 * Live/compiled matching guard: liveElementsBeforeLine already excludes a
 * statement whose live type no longer matches the compiled element's type.
 * On top of that, this module additionally excludes a statement whose live
 * `enabled=` attribute no longer agrees with the compiled element's own
 * `enabled` - dirty-editing a statement's enabled state must never keep
 * showing candidates derived from the previous (now stale) evaluation.
 */
export const dslElementParameterCompletionOptions = ({
  source,
  cursorLine,
  statementElementIds,
  elements,
  elementToken,
  computedGeometry,
  computedVariables,
  effectiveEnabledElementIds,
  errors
}: {
  source: string;
  cursorLine: number;
  statementElementIds: DslLiveStatementIdentity;
  elements: readonly CadElement[];
  elementToken: string;
  computedGeometry: Map<ElementId, ComputedGeometry>;
  computedVariables?: Map<ElementId, ComputedVariable>;
  effectiveEnabledElementIds?: Set<ElementId>;
  errors: DependencyError[];
}): ElementParameterReferenceOption[] => {
  if (!elementToken.trim()) return [];

  const parsed = parseDsl(source);
  const scope = dslScopeBeforeParsedLine(parsed, cursorLine);
  const scopeStatement = scope ? parsed.statements[scope.statementIndex] : null;
  const parentGroupId = scopeStatement ? statementElementIds.get(scopeStatement.line) : undefined;
  if (scopeStatement && !parentGroupId) return [];

  const firstAtStopLine = parsed.statements.find((statement) => statement.kind === "atStop")?.line ?? Infinity;
  const cutoffLine = Math.min(cursorLine, firstAtStopLine);
  const live = liveElementsBeforeLine(parsed, cutoffLine, statementElementIds, elements);

  const liveElementIds = new Set(live.map((element) => element.id));
  const statementByElementId = new Map<ElementId, DslStatement>();
  for (const statement of parsed.statements) {
    if (statement.line >= cutoffLine) continue;
    const elementId = statementElementIds.get(statement.line);
    if (elementId && liveElementIds.has(elementId)) statementByElementId.set(elementId, statement);
  }
  const trustworthyLive = live.filter((element) => {
    const statement = statementByElementId.get(element.id);
    return statement !== undefined && isStatementDisabled(statement) === !element.enabled;
  });

  return elementParameterReferenceOptionsForPosition({
    referenceElements: trustworthyLive,
    elementToken,
    currentElement: { parentGroupId },
    evaluation: {
      computedGeometry,
      computedVariables: computedVariables ?? new Map(),
      effectiveEnabledElementIds,
      errors
    }
  });
};
