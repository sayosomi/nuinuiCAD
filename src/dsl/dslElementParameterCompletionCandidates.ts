import { blockFrameKind, dslScopeBeforeParsedLine, parseDsl } from "./dslParser";
import { liveElementsBeforeLine, type DslLiveStatementIdentity } from "./dslCompletionCandidates";
import {
  elementParameterReferenceOptionsForPosition,
  type ElementParameterReferenceOption
} from "../geometry/elementParameterReferenceOptions";
import type { CadElement, ComputedGeometry, DependencyError, ElementId } from "../types/geometry";
import type { ScalarType } from "../scalars/types";
import type { DslStatement } from "./dslTypes";

const attrValue = (statement: DslStatement, key: string) => statement.attrs.find((attr) => attr.key === key)?.value;
const isStatementDisabled = (statement: DslStatement) => attrValue(statement, "state")?.toLowerCase() === "disabled";

/**
 * Live-buffer candidates for `ElementName.parameterKey` completion, reparsing
 * `source` fresh on every call (never falling back to a stale compiled
 * document for element identity/name/scope - only the last-applied
 * evaluation's computedGeometry/errors are necessarily
 * stale relative to dirty text, matching dslVariableCompletionOptions's own
 * Tier B compromise).
 *
 * Live/compiled matching guard: liveElementsBeforeLine already excludes a
 * statement whose live type no longer matches the compiled element's type.
 * On top of that, this module additionally excludes a statement whose live
 * `state:` attribute no longer agrees with the compiled element's own
 * activity - dirty-editing a statement's state must never keep
 * showing candidates derived from the previous (now stale) evaluation.
 */
export const dslElementParameterCompletionOptions = ({
  source,
  cursorLine,
  statementElementIds,
  elements,
  elementToken,
  expectedScalarType = { kind: "number" },
  computedGeometry,
  effectiveEnabledElementIds,
  errors
}: {
  source: string;
  cursorLine: number;
  statementElementIds: DslLiveStatementIdentity;
  elements: readonly CadElement[];
  elementToken: string;
  expectedScalarType?: ScalarType;
  computedGeometry: Map<ElementId, ComputedGeometry>;
  effectiveEnabledElementIds?: Set<ElementId>;
  errors: DependencyError[];
}): ElementParameterReferenceOption[] => {
  if (!elementToken.trim()) return [];

  const parsed = parseDsl(source);
  const scope = dslScopeBeforeParsedLine(parsed, cursorLine);
  const scopeStatement = scope ? parsed.statements[scope.statementIndex] : null;
  // Only an element-backed group scope (group/conditionalGroup/forGroup - reusing
  // dslParser.ts's own blockFrameKind, the authority dslScopeBeforeParsedLine's stack
  // is built from) requires resolving a parentGroupId here. Source outputs are also a
  // BlockFrame kind (its stack treats it identically to a group for line-range
  // purposes) but it is never a CadElement && has no entry in statementElementIds,
  // && has no lexical scope of its own (mirrors the source-output binding site's
  // root-scope treatment) - allowlist the real group kinds explicitly rather than
  // excluding source outputs by name, so a future non-element-backed block kind doesn't
  // silently fall into this same bug.
  const scopeFrameKind = scopeStatement ? blockFrameKind(scopeStatement) : null;
  const groupScopeStatement =
    scopeFrameKind === "group" || scopeFrameKind === "conditionalGroup" || scopeFrameKind === "forGroup"
      ? scopeStatement
      : null;
  const parentGroupId = groupScopeStatement ? statementElementIds.get(groupScopeStatement.line) : undefined;
  if (groupScopeStatement && !parentGroupId) return [];

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
    return statement !== undefined && isStatementDisabled(statement) === (element.activity === "disabled");
  });

  return elementParameterReferenceOptionsForPosition({
    referenceElements: trustworthyLive,
    elementToken,
    expectedScalarType,
    currentElement: { parentGroupId },
    evaluation: {
      computedGeometry,
      effectiveEnabledElementIds,
      errors
    }
  });
};
