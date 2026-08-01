import type { StatementInfo, StatementMap } from "../dsl/dslDocument";
import type { NumericVariableReferenceOption } from "../geometry/variableReferenceOptions";
import { isGroupElement } from "../model/groups";
import type { CadElement } from "../types/geometry";
import type { BindingAnalysis } from "../scalars/bindingAnalysis";
import { bindingIdForStableStatementId } from "../scalars/bindingCatalog";
import type { ScopeId } from "../scalars/lexicalScopeIndex";
import { visibleTypedBindingsAtLivePosition } from "../scalars/liveTypedBindingVisibility";
import { typedBindingReferenceCandidates } from "../scalars/typedValueCandidates";
import type { CommandLineSession } from "./commandLineSession";
import { resolveCommandLineInsertionAnchor } from "./commandLineInsertionAnchor";

const lineStartOffset = (source: string, line: number): number | null => {
  if (!Number.isInteger(line) || line < 1) return null;
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const newline = source.indexOf("\n", offset);
    if (newline < 0) return current + 1 === line ? source.length : null;
    offset = newline + 1;
  }
  return offset;
};

const offsetAfterStatement = (source: string, statement: StatementInfo): number | null =>
  lineStartOffset(source, statement.range.endLine + 1);

const sameTarget = (
  left: CommandLineSession["insertionTarget"],
  right: CommandLineSession["insertionTarget"]
) =>
  left.insertionIndex === right.insertionIndex &&
  left.parentGroupId === right.parentGroupId &&
  left.conditionalBranch === right.conditionalBranch;

const sourceOffsetForSession = ({
  session,
  source,
  statementMap,
  elements
}: {
  session: CommandLineSession;
  source: string;
  statementMap: StatementMap;
  elements: readonly CadElement[];
}): number | null => {
  if (session.sourceInsertionLine !== null) return lineStartOffset(source, session.sourceInsertionLine);

  const resolvedTarget = resolveCommandLineInsertionAnchor(session.insertionAnchor, [...elements]);
  if (!resolvedTarget || !sameTarget(resolvedTarget, session.insertionTarget)) return null;
  if (session.insertionAnchor.kind === "documentEnd") return source.length;
  const statement = statementMap.byElementId.get(session.insertionAnchor.elementId);
  return statement ? offsetAfterStatement(source, statement) : null;
};

const scopeIdForInsertionTarget = ({
  target,
  elements,
  statementMap,
  source,
  insertionOffset,
  bindingAnalysis
}: {
  target: CommandLineSession["insertionTarget"];
  elements: readonly CadElement[];
  statementMap: StatementMap;
  source: string;
  insertionOffset: number;
  bindingAnalysis: BindingAnalysis;
}): ScopeId | null => {
  if (!target.parentGroupId) {
    if (target.conditionalBranch) return null;
    const insideAnyGroup = elements.some((element) => {
      if (!isGroupElement(element)) return false;
      const statement = statementMap.byElementId.get(element.id);
      if (!statement) return false;
      const start = lineStartOffset(source, statement.line);
      const end = offsetAfterStatement(source, statement);
      return start !== null && end !== null && insertionOffset > start && insertionOffset < end;
    });
    return insideAnyGroup ? null : bindingAnalysis.catalog.scopeIndex.rootScopeId;
  }

  const parent = elements.find((element) => element.id === target.parentGroupId);
  const statement = parent ? statementMap.byElementId.get(parent.id) : undefined;
  if (!parent || !statement || !isGroupElement(parent)) return null;
  const start = lineStartOffset(source, statement.line);
  const end = offsetAfterStatement(source, statement);
  if (start === null || end === null || insertionOffset <= start || insertionOffset >= end) return null;

  let scopeId: ScopeId;
  if (parent.type === "conditionalGroup") {
    if (!target.conditionalBranch) return null;
    const elseOffset = statement.elseLine === undefined ? null : lineStartOffset(source, statement.elseLine);
    if (target.conditionalBranch === "then") {
      if (elseOffset !== null && insertionOffset >= elseOffset) return null;
    } else {
      const afterElse = statement.elseLine === undefined ? null : lineStartOffset(source, statement.elseLine + 1);
      if (afterElse === null || insertionOffset < afterElse) return null;
    }
    scopeId = `if:${parent.id}:${target.conditionalBranch}`;
  } else {
    if (target.conditionalBranch) return null;
    scopeId = parent.type === "forGroup" ? `for:${parent.id}` : `group:${parent.id}`;
  }
  return bindingAnalysis.catalog.scopeIndex.scopes.has(scopeId) ? scopeId : null;
};

/**
 * Typed-number candidates for a command-line numeric field. The session's
 * insertion boundary is resolved against the same physical source structure
 * that final creation uses; unavailable or stale metadata returns no options.
 */
export const commandLineTypedBindingSuggestions = ({
  session,
  sourceText,
  docText,
  statementMap,
  bindingAnalysis,
  elements
}: {
  session: CommandLineSession | null;
  sourceText: string;
  docText: string;
  statementMap: StatementMap;
  bindingAnalysis: BindingAnalysis | undefined;
  elements: readonly CadElement[];
}): NumericVariableReferenceOption[] => {
  if (!session || sourceText !== docText || !bindingAnalysis) return [];
  const insertionOffset = sourceOffsetForSession({ session, source: sourceText, statementMap, elements });
  if (insertionOffset === null) return [];
  const scopeId = scopeIdForInsertionTarget({
    target: session.insertionTarget,
    elements,
    statementMap,
    source: sourceText,
    insertionOffset,
    bindingAnalysis
  });
  if (!scopeId) return [];

  const bindingOffset = (bindingId: string) => {
    const binding = bindingAnalysis.catalog.bindingsById.get(bindingId);
    if (!binding) return undefined;
    const statement = statementMap.statements[binding.statementIndex];
    const stableId = statementMap.statementIdByStatementIndex?.get(binding.statementIndex);
    if (!statement || statement.kind !== "typedDeclaration" || !stableId || bindingIdForStableStatementId(stableId) !== bindingId) return undefined;
    return lineStartOffset(sourceText, statement.line) ?? undefined;
  };
  const liveVisibleBindings = visibleTypedBindingsAtLivePosition({
    catalog: bindingAnalysis.catalog,
    containingScopeId: scopeId,
    // The statement is inserted *before* its physical boundary. A declaration
    // on that boundary is therefore forward and must remain unavailable.
    cursorOffset: insertionOffset - 0.5,
    offsetForBinding: bindingOffset
  }, () => true);
  return typedBindingReferenceCandidates({
    catalog: bindingAnalysis.catalog,
    entriesById: bindingAnalysis.entriesById,
    liveVisibleBindings,
    accepts: (type) => type?.kind === "number"
  }).map((candidate) => ({
    expression: `@${candidate.name}`,
    displayExpression: `@${candidate.name}`,
    label: candidate.name,
    detail: "typed number binding",
    source: "typed" as const
  }));
};
