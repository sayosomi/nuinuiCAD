import { groupStateByElementId, isGroupExpanded, isForGroupElement, type GroupFoldById } from "../model/groups";
import type { PickCandidate } from "../model/pickCandidates";
import type {
  CadElement,
  ElementId,
  EvaluationResult,
  ForGroupElement,
  ForGroupGeneratedRow
} from "../types/geometry";
import type { StatementRangeIndex } from "./statementRangeIndex";

export type VisibleRange = { from: number; to: number };

export type LineStatus = {
  elementId: ElementId;
  from: number;
  to: number;
  hasError: boolean;
  hasWarning: boolean;
  hiddenByGroup: boolean;
  disabledByGroup: boolean;
  conditionInactive: boolean;
  isEvaluated: boolean;
  locked: boolean;
  printEnabled: boolean;
};

const rangeIntersectsVisible = (from: number, to: number, visible: readonly VisibleRange[]) =>
  visible.some((range) => from <= range.to && to >= range.from);

/**
 * Derives the same per-element flags useElementListData.getRowData already computes,
 * restricted to statement ranges intersecting the given viewport ranges only. Never
 * builds a full-document decoration set.
 */
export const visibleLineStatuses = (
  ranges: StatementRangeIndex,
  elements: readonly CadElement[],
  evaluation: EvaluationResult,
  groupFoldById: GroupFoldById,
  visible: readonly VisibleRange[]
): LineStatus[] => {
  const errorElementIds = new Set(evaluation.errors.map((error) => error.elementId));
  const warningElementIds = new Set(evaluation.warnings.map((warning) => warning.elementId));
  const conditionInactiveElementIds = evaluation.conditionInactiveElementIds ?? new Set<ElementId>();
  const evaluatedElementIds = evaluation.evaluatedElementIds ?? new Set(elements.map((element) => element.id));
  const groupStates = groupStateByElementId([...elements], groupFoldById);
  const statuses: LineStatus[] = [];

  for (const [elementId, range] of ranges) {
    if (!rangeIntersectsVisible(range.from, range.to, visible)) continue;
    const element = elements.find((item) => item.id === elementId);
    if (!element) continue;
    const groupState = groupStates.get(elementId);
    statuses.push({
      elementId,
      from: range.from,
      to: range.to,
      hasError: errorElementIds.has(elementId),
      hasWarning: warningElementIds.has(elementId),
      hiddenByGroup: Boolean(groupState?.hiddenByGroupId),
      disabledByGroup: Boolean(groupState?.disabledByGroupId),
      conditionInactive: conditionInactiveElementIds.has(elementId),
      isEvaluated: evaluatedElementIds.has(elementId),
      locked: Boolean(element.locked),
      printEnabled: element.type === "group" && element.printEnabled === true
    });
  }
  return statuses;
};

export type GeneratedWidgetSpec = {
  forGroupId: ElementId;
  /** Insert the widget after this document position (end of the anchor line). */afterPos: number;
  rows: ForGroupGeneratedRow[];
};

/**
 * Per visible expanded forGroup with showGenerated, resolves the insertion point
 * (end of its last visible descendant's line, or its own line if it has none visible)
 * and the generated rows to render as a read-only widget there.
 */
export const forGroupGeneratedWidgetSpecs = (
  ranges: StatementRangeIndex,
  elements: readonly CadElement[],
  evaluation: EvaluationResult,
  groupFoldById: GroupFoldById,
  visible: readonly VisibleRange[]
): GeneratedWidgetSpec[] => {
  const rowsByForGroupId = new Map<ElementId, ForGroupGeneratedRow[]>();
  for (const row of evaluation.forGroupGeneratedRows ?? []) {
    rowsByForGroupId.set(row.forGroupId, [...(rowsByForGroupId.get(row.forGroupId) ?? []), row]);
  }
  if (rowsByForGroupId.size === 0) return [];

  const specs: GeneratedWidgetSpec[] = [];
  for (const element of elements) {
    if (!isForGroupElement(element) || !element.showGenerated) continue;
    if (!isGroupExpanded(element.id, groupFoldById)) continue;
    const rows = rowsByForGroupId.get(element.id);
    if (!rows || rows.length === 0) continue;

    const anchorElement = lastVisibleDescendant(elements, element) ?? element;
    const anchorRange = ranges.get(anchorElement.id);
    if (!anchorRange) continue;
    if (!rangeIntersectsVisible(anchorRange.from, anchorRange.to, visible)) continue;
    specs.push({ forGroupId: element.id, afterPos: anchorRange.to, rows });
  }
  return specs;
};

const lastVisibleDescendant = (elements: readonly CadElement[], forGroup: ForGroupElement): CadElement | null => {
  let last: CadElement | null = null;
  for (const element of elements) {
    if (isDescendantOf(elements, element, forGroup.id)) last = element;
  }
  return last;
};

const isDescendantOf = (elements: readonly CadElement[], element: CadElement, ancestorId: ElementId): boolean => {
  let current = element;
  const byId = new Map(elements.map((item) => [item.id, item]));
  const visited = new Set<ElementId>();
  while (current.parentGroupId && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.parentGroupId === ancestorId) return true;
    const parent = byId.get(current.parentGroupId);
    if (!parent) return false;
    current = parent;
  }
  return false;
};

export type PickCandidateLine = { elementId: ElementId; from: number; to: number; isCursor: boolean };

/** Line-level view of pickCandidates restricted to the given viewport ranges. */
export const pickCandidateLines = (
  ranges: StatementRangeIndex,
  candidates: readonly PickCandidate[],
  cursorElementId: ElementId | null,
  visible: readonly VisibleRange[]
): PickCandidateLine[] => {
  const lines: PickCandidateLine[] = [];
  for (const candidate of candidates) {
    const range = ranges.get(candidate.elementId);
    if (!range || !rangeIntersectsVisible(range.from, range.to, visible)) continue;
    lines.push({
      elementId: candidate.elementId,
      from: range.from,
      to: range.to,
      isCursor: candidate.elementId === cursorElementId
    });
  }
  return lines;
};
