import type { StatementInfo, StatementMap } from "../dsl/dslDocument";
import { isGroupElement } from "../model/groups";
import type { ElementCreationTarget } from "../model/elementCreationPlacement";
import type { CadElement, ElementId } from "../types/geometry";
import { insertionAnchorForCommandLineCreation, resolveCommandLineInsertionAnchor } from "./commandLineInsertionAnchor";

/** Plain Source Editor data; no CodeMirror type crosses this boundary. */
export type SourceCreationCursor = {
  sourceRevision: number;
  line: number;
  lineCount: number;
  elementId: ElementId | null;
};

/** A source-backed insertion point captured before a multi-step creation flow. */
export type SourceCreationInsertion = {
  sourceRevision: number;
  insertionTarget: ElementCreationTarget;
  /** 1-based line before which the serialized declarations are inserted. */
  sourceInsertionLine: number;
};

export type SourceCreationInsertionOrigin = "source-cursor" | "document-end";

export type SourceCreationInsertionUnsafeReason =
  | "stale-source-revision"
  | "fatal-source-text"
  | "missing-statement-metadata"
  | "missing-element-statement"
  | "ambiguous-source-location"
  | "unresolved-source-location";

export type SourceCreationInsertionResolution =
  | { kind: "none" }
  | { kind: "safe"; insertion: SourceCreationInsertion }
  | { kind: "unsafe"; reason: SourceCreationInsertionUnsafeReason };

export const sourceCreationInsertionUnsafeError =
  "現在のSource位置では安全な挿入境界を特定できません。ステートメント間へキャレットを移動してから再試行してください。";

type Scope = { parentGroupId?: ElementId; conditionalBranch?: "then" | "else" };

type SourceInsertionAttempt =
  | { kind: "safe"; insertion: SourceCreationInsertion }
  | { kind: "unsafe"; reason: Exclude<SourceCreationInsertionUnsafeReason, "stale-source-revision"> };

type ScopeResolution =
  | { kind: "safe"; scope: Scope }
  | { kind: "unsafe"; reason: "ambiguous-source-location" | "missing-statement-metadata" };

const statementInfoHasCurrentRange = (info: StatementInfo, lineCount: number, sourceRevision: number) =>
  info.sourceRevision === sourceRevision &&
  Number.isInteger(info.line) &&
  Number.isInteger(info.endLine) &&
  info.line >= 1 &&
  info.line <= info.endLine &&
  info.endLine <= lineCount &&
  Number.isInteger(info.range.startLine) &&
  Number.isInteger(info.range.endLine) &&
  info.range.startLine >= 1 &&
  info.range.startLine <= info.range.endLine &&
  info.range.endLine <= lineCount;

const sourceStatementMapUnsafeReason = (
  elements: readonly CadElement[],
  statementMap: StatementMap,
  sourceRevision: number,
  lineCount: number
): SourceCreationInsertionUnsafeReason | null => {
  if (statementMap.sourceRevision !== sourceRevision) return "stale-source-revision";
  if (!Array.isArray(statementMap.statements) || statementMap.statements.length === 0) {
    return "missing-statement-metadata";
  }
  if (statementMap.statements.some((info) => !statementInfoHasCurrentRange(info, lineCount, sourceRevision))) {
    return "missing-statement-metadata";
  }
  for (const element of elements) {
    const info = statementMap.byElementId.get(element.id);
    if (!info) return "missing-element-statement";
    if (!statementInfoHasCurrentRange(info, lineCount, sourceRevision)) return "missing-statement-metadata";
  }
  return null;
};

const scopeForLine = (
  line: number,
  elements: readonly CadElement[],
  statementMap: StatementMap
): ScopeResolution => {
  const elementById = new Map(elements.map((element) => [element.id, element]));
  const containingGroups = elements.flatMap((element): Array<{ element: CadElement; info: StatementInfo | null }> => {
    if (!isGroupElement(element)) return [];
    const info = statementMap.byElementId.get(element.id);
    if (!info) return [{ element, info: null }];
    return info && info.range.startLine <= line && line <= info.range.endLine
      ? [{ element, info }]
      : [];
  });
  if (containingGroups.some((candidate) => candidate.info === null)) {
    return { kind: "unsafe", reason: "missing-statement-metadata" };
  }
  const maxDepth = Math.max(...containingGroups.map((candidate) => candidate.info!.indentDepth), -1);
  const nearestCandidates = containingGroups.filter((candidate) => candidate.info!.indentDepth === maxDepth);
  if (nearestCandidates.length > 1) return { kind: "unsafe", reason: "ambiguous-source-location" };
  const nearest = nearestCandidates[0];
  if (!nearest) return { kind: "safe", scope: {} };
  const parent = elementById.get(nearest.element.id);
  return {
    kind: "safe",
    scope: {
      parentGroupId: nearest.element.id,
      ...(parent?.type === "conditionalGroup"
        ? { conditionalBranch: nearest.info!.elseLine !== undefined && line > nearest.info!.elseLine ? "else" as const : "then" as const }
        : {})
    }
  };
};

const hasScope = (element: CadElement, scope: Scope) =>
  element.parentGroupId === scope.parentGroupId &&
  (scope.conditionalBranch === undefined || (element.conditionalBranch ?? "then") === scope.conditionalBranch);

/**
 * Converts a physical editor position into both a semantic creation target &&
 * a line-splice anchor. A cursor in an element retains the established
 * "after the complete statement" behavior. A non-element cursor in a logical
 * statement's header is normalized to that statement's first physical line;
 * blank/comment/stop lines retain their physical boundary.
 */
const sourceInsertionAttemptForCreation = ({
  cursor,
  elements,
  statementMap
}: {
  cursor: SourceCreationCursor;
  elements: CadElement[];
  statementMap: StatementMap;
}): SourceInsertionAttempt => {
  if (cursor.elementId) {
    const target = resolveCommandLineInsertionAnchor(
      insertionAnchorForCommandLineCreation(cursor.elementId),
      elements
    );
    const info = statementMap.byElementId.get(cursor.elementId);
    if (target && info) {
      return {
        kind: "safe",
        insertion: {
          sourceRevision: cursor.sourceRevision,
          insertionTarget: target,
          sourceInsertionLine: Math.max(info.range.endLine, info.endLine) + 1
        }
      };
    }
    return {
      kind: "unsafe",
      reason: info ? "unresolved-source-location" : "missing-element-statement"
    };
  }

  const statementsAtCursor = statementMap.statements.filter((info) =>
    info.line <= cursor.line && cursor.line <= info.endLine
  );
  if (statementsAtCursor.length > 1) {
    return { kind: "unsafe", reason: "ambiguous-source-location" };
  }
  const elementStatementIndexes = new Set(
    elements.flatMap((element) => {
      const info = statementMap.byElementId.get(element.id);
      return info ? [info.statementIndex] : [];
    })
  );
  if (statementsAtCursor.some((info) => elementStatementIndexes.has(info.statementIndex))) {
    return { kind: "unsafe", reason: "unresolved-source-location" };
  }

  const logicalStatement = statementsAtCursor[0];
  const versionLine = statementMap.byKey.get("version")?.line ?? 0;
  const requestedLine = logicalStatement?.line ?? cursor.line;
  const sourceInsertionLine = Math.max(
    versionLine + 1,
    Math.min(requestedLine, Math.max(1, cursor.lineCount))
  );
  const scopeResolution = scopeForLine(sourceInsertionLine, elements, statementMap);
  if (scopeResolution.kind === "unsafe") return scopeResolution;
  const scope = scopeResolution.scope;
  const nextSibling = elements.flatMap((element) => {
    const info = statementMap.byElementId.get(element.id);
    return hasScope(element, scope) && info ? [{ element, info }] : [];
  })
    .filter((entry) => entry.info.line >= sourceInsertionLine)
    .sort((left, right) => left.info.line - right.info.line)[0];
  if (nextSibling) {
    return {
      kind: "safe",
      insertion: {
        sourceRevision: cursor.sourceRevision,
        insertionTarget: {
          insertionIndex: elements.findIndex((element) => element.id === nextSibling.element.id),
          ...scope
        },
        sourceInsertionLine
      },
    };
  }

  const previousSibling = [...elements].reverse().find((element) => hasScope(element, scope));
  if (previousSibling) {
    const target = resolveCommandLineInsertionAnchor(
      insertionAnchorForCommandLineCreation(previousSibling.id),
      elements
    );
    if (target) {
      return {
        kind: "safe",
        insertion: {
          sourceRevision: cursor.sourceRevision,
          insertionTarget: { ...target, ...scope },
          sourceInsertionLine
        }
      };
    }
    return { kind: "unsafe", reason: "unresolved-source-location" };
  }

  const parentIndex = scope.parentGroupId
    ? elements.findIndex((element) => element.id === scope.parentGroupId)
    : elements.length;
  return {
    kind: "safe",
    insertion: {
      sourceRevision: cursor.sourceRevision,
      insertionTarget: { insertionIndex: parentIndex < 0 ? elements.length : parentIndex + 1, ...scope },
      sourceInsertionLine
    }
  };
};

export const sourceInsertionForCreation = ({
  cursor,
  elements,
  statementMap
}: {
  cursor: SourceCreationCursor;
  elements: CadElement[];
  statementMap: StatementMap;
}): SourceCreationInsertion | null => {
  const attempt = sourceInsertionAttemptForCreation({ cursor, elements, statementMap });
  return attempt.kind === "safe" ? attempt.insertion : null;
};

export const resolveSourceCreationInsertion = ({
  cursor,
  sourceRevision,
  elements,
  statementMap
}: {
  cursor: SourceCreationCursor | null;
  sourceRevision: number;
  elements: CadElement[];
  statementMap: StatementMap | null;
}): SourceCreationInsertionResolution => {
  if (!cursor) return { kind: "none" };
  if (cursor.sourceRevision !== sourceRevision) return { kind: "unsafe", reason: "stale-source-revision" };
  if (!statementMap) return { kind: "unsafe", reason: "missing-statement-metadata" };
  if (!cursor.elementId && (
    !Number.isInteger(cursor.lineCount) ||
    cursor.lineCount < 1 ||
    !Number.isInteger(cursor.line) ||
    cursor.line < 1 ||
    cursor.line > cursor.lineCount
  )) {
    return { kind: "unsafe", reason: "unresolved-source-location" };
  }
  const metadataReason = sourceStatementMapUnsafeReason(
    elements,
    statementMap,
    sourceRevision,
    cursor.lineCount
  );
  if (metadataReason) return { kind: "unsafe", reason: metadataReason };
  return sourceInsertionAttemptForCreation({ cursor, elements, statementMap });
};

/**
 * Resolves the physical append boundary for a creation that has no Source
 * Editor cursor. The document-end path still requires an exact, valid source
 * snapshot: the last-good document must describe the current canonical text
 * and every statement range must fit that text before an append is allowed.
 */
export const resolveDocumentEndSourceCreationInsertion = ({
  sourceText,
  documentText,
  sourceRevision,
  elements,
  statementMap
}: {
  sourceText: string;
  documentText: string;
  sourceRevision: number;
  elements: CadElement[];
  statementMap: StatementMap | null;
}): SourceCreationInsertionResolution => {
  if (sourceText !== documentText) return { kind: "unsafe", reason: "fatal-source-text" };
  if (!statementMap) return { kind: "unsafe", reason: "missing-statement-metadata" };

  const sourceLines = sourceText.replace(/\r\n/g, "\n").split("\n");
  const metadataReason = sourceStatementMapUnsafeReason(
    elements,
    statementMap,
    sourceRevision,
    sourceLines.length
  );
  if (metadataReason) return { kind: "unsafe", reason: metadataReason };

  // A trailing newline already owns the empty terminal physical line. Insert
  // before that line; otherwise append after the current final line. This
  // keeps comments, blank lines, and the existing newline bytes untouched.
  const sourceInsertionLine = sourceText.endsWith("\n")
    ? sourceLines.length
    : sourceLines.length + 1;
  return {
    kind: "safe",
    insertion: {
      sourceRevision,
      insertionTarget: { insertionIndex: elements.length },
      sourceInsertionLine
    }
  };
};

export const sourceCreationInsertionIsCurrent = (
  insertion: SourceCreationInsertion,
  sourceRevision: number
) => insertion.sourceRevision === sourceRevision;
