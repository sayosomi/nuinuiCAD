import type { StatementMap } from "../dsl/dslDocument";
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

type Scope = { parentGroupId?: ElementId; conditionalBranch?: "then" | "else" };

const scopeForLine = (
  line: number,
  elements: readonly CadElement[],
  statementMap: StatementMap
): Scope => {
  const elementById = new Map(elements.map((element) => [element.id, element]));
  const containingGroups = elements.flatMap((element) => {
    if (!isGroupElement(element)) return [];
    const info = statementMap.byElementId.get(element.id);
    return info && info.range.startLine <= line && line <= info.range.endLine
      ? [{ element, info }]
      : [];
  });
  const nearest = containingGroups.sort((left, right) => right.info.indentDepth - left.info.indentDepth)[0];
  if (!nearest) return {};
  const parent = elementById.get(nearest.element.id);
  return {
    parentGroupId: nearest.element.id,
    ...(parent?.type === "conditionalGroup"
      ? { conditionalBranch: nearest.info.elseLine !== undefined && line > nearest.info.elseLine ? "else" as const : "then" as const }
      : {})
  };
};

const hasScope = (element: CadElement, scope: Scope) =>
  element.parentGroupId === scope.parentGroupId &&
  (scope.conditionalBranch === undefined || (element.conditionalBranch ?? "then") === scope.conditionalBranch);

/**
 * Converts a physical editor position into both a semantic creation target and
 * a line-splice anchor. A cursor in an element retains the established
 * "after the complete statement" behavior; all other cursor lines insert
 * immediately before that physical line.
 */
export const sourceInsertionForCreation = ({
  cursor,
  elements,
  statementMap
}: {
  cursor: SourceCreationCursor;
  elements: CadElement[];
  statementMap: StatementMap;
}): SourceCreationInsertion => {
  if (cursor.elementId) {
    const target = resolveCommandLineInsertionAnchor(
      insertionAnchorForCommandLineCreation(cursor.elementId),
      elements
    );
    const info = statementMap.byElementId.get(cursor.elementId);
    if (target && info) {
      return {
        sourceRevision: cursor.sourceRevision,
        insertionTarget: target,
        sourceInsertionLine: info.range.endLine + 1
      };
    }
  }

  const versionLine = statementMap.byKey.get("version")?.line ?? 0;
  const sourceInsertionLine = Math.max(
    versionLine + 1,
    Math.min(cursor.line, Math.max(1, cursor.lineCount))
  );
  const scope = scopeForLine(sourceInsertionLine, elements, statementMap);
  const nextSibling = elements.flatMap((element) => {
    const info = statementMap.byElementId.get(element.id);
    return hasScope(element, scope) && info ? [{ element, info }] : [];
  })
    .filter((entry) => entry.info.line >= sourceInsertionLine)
    .sort((left, right) => left.info.line - right.info.line)[0];
  if (nextSibling) {
    return {
      sourceRevision: cursor.sourceRevision,
      insertionTarget: {
        insertionIndex: elements.findIndex((element) => element.id === nextSibling.element.id),
        ...scope
      },
      sourceInsertionLine
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
        sourceRevision: cursor.sourceRevision,
        insertionTarget: { ...target, ...scope },
        sourceInsertionLine
      };
    }
  }

  const parentIndex = scope.parentGroupId
    ? elements.findIndex((element) => element.id === scope.parentGroupId)
    : elements.length;
  return {
    sourceRevision: cursor.sourceRevision,
    insertionTarget: { insertionIndex: parentIndex < 0 ? elements.length : parentIndex + 1, ...scope },
    sourceInsertionLine
  };
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
}): SourceCreationInsertion | null => {
  if (!cursor || cursor.sourceRevision !== sourceRevision || !statementMap) return null;
  return sourceInsertionForCreation({ cursor, elements, statementMap });
};

export const sourceCreationInsertionIsCurrent = (
  insertion: SourceCreationInsertion,
  sourceRevision: number
) => insertion.sourceRevision === sourceRevision;
