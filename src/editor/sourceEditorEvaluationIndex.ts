import {
  effectiveEnabledElementIds,
  effectiveVisibleElementIds,
  groupStateByElementId,
  isForGroupElement,
  isGroupExpanded,
  visibleOutlineElements,
  type GroupFoldById
} from "../model/groups";
import type { PickCandidate } from "../model/pickCandidates";
import {
  effectiveVisibleElementIdsForProfile,
  visibilityProfileById
} from "../model/visibilityProfiles";
import { resolvedElementColorMap } from "../palette/elementColors";
import type { CadElement, DocumentPalette, ElementId, EvaluationResult, ForGroupGeneratedRow, VisibilityProfile } from "../types/geometry";
import type { StatementRange, StatementRangeIndex } from "./statementRangeIndex";

export type VisibleRange = { from: number; to: number };

export type IndexedLineStatus = {
  elementId: ElementId;
  from: number;
  to: number;
  hasError: boolean;
  hasWarning: boolean;
  hiddenSelf: boolean;
  hiddenByGroup: boolean;
  hiddenByProfile: boolean;
  disabledSelf: boolean;
  disabledByGroup: boolean;
  conditionInactive: boolean;
  isEvaluated: boolean;
  locked: boolean;
  printEnabled: boolean;
  canToggleVisibility: boolean;
  canTogglePrint: boolean;
  color: string;
};

export type IndexedGeneratedWidget = {
  forGroupId: ElementId;
  afterPos: number;
  rows: ForGroupGeneratedRow[];
};

export type EvaluationDecorationIndex = {
  statuses: readonly IndexedLineStatus[];
  statusByLineFrom: ReadonlyMap<number, IndexedLineStatus>;
  generatedWidgets: readonly IndexedGeneratedWidget[];
  pickLines: readonly { elementId: ElementId; from: number; to: number }[];
};

const lowerBound = <T>(items: readonly T[], position: number, getPosition: (item: T) => number) => {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (getPosition(items[middle]) < position) low = middle + 1;
    else high = middle;
  }
  return low;
};

export const entriesInVisibleRanges = <T extends { from: number; to: number }>(
  entries: readonly T[],
  visible: readonly VisibleRange[]
) => {
  const selected: T[] = [];
  for (const range of visible) {
    let index = lowerBound(entries, range.from, (entry) => entry.to);
    while (index < entries.length && entries[index].from <= range.to) {
      selected.push(entries[index]);
      index += 1;
    }
  }
  return selected;
};

const groupedRows = (rows: readonly ForGroupGeneratedRow[] | undefined) => {
  const byOwner = new Map<ElementId, ForGroupGeneratedRow[]>();
  for (const row of rows ?? []) byOwner.set(row.forGroupId, [...(byOwner.get(row.forGroupId) ?? []), row]);
  return byOwner;
};

const groupIssueIds = (elements: readonly CadElement[], evaluation: EvaluationResult) => {
  const errorIds = new Set(evaluation.errors.map((item) => item.elementId));
  const warningIds = new Set(evaluation.warnings.map((item) => item.elementId));
  const byId = new Map(elements.map((item) => [item.id, item]));
  for (const sourceId of [...errorIds]) {
    let current = byId.get(sourceId);
    while (current?.parentGroupId) {
      errorIds.add(current.parentGroupId);
      current = byId.get(current.parentGroupId);
    }
  }
  for (const sourceId of [...warningIds]) {
    let current = byId.get(sourceId);
    while (current?.parentGroupId) {
      warningIds.add(current.parentGroupId);
      current = byId.get(current.parentGroupId);
    }
  }
  return { errorIds, warningIds };
};

/** Builds document-wide immutable lookup data only when source/evaluation/UI state changes.
 * Scrolling reads it through entriesInVisibleRanges and never scans the whole document. */
export const createEvaluationDecorationIndex = ({
  ranges,
  elements,
  evaluation,
  groupFoldById,
  palette,
  visibilityProfiles,
  activeVisibilityProfileId,
  pickCandidates
}: {
  ranges: StatementRangeIndex;
  elements: readonly CadElement[];
  evaluation: EvaluationResult | null;
  groupFoldById: GroupFoldById;
  palette: DocumentPalette;
  visibilityProfiles: readonly VisibilityProfile[];
  activeVisibilityProfileId: string;
  pickCandidates: readonly PickCandidate[];
}): EvaluationDecorationIndex => {
  if (!evaluation) return { statuses: [], statusByLineFrom: new Map(), generatedWidgets: [], pickLines: [] };
  const byId = new Map(elements.map((element) => [element.id, element]));
  const groupStates = groupStateByElementId([...elements], groupFoldById);
  const profile = visibilityProfileById([...visibilityProfiles], activeVisibilityProfileId);
  const profileVisible = effectiveVisibleElementIdsForProfile({ elements: [...elements], profile });
  const baseVisible = evaluation.effectiveVisibleElementIds ?? effectiveVisibleElementIds([...elements]);
  const enabled = evaluation.effectiveEnabledElementIds ?? effectiveEnabledElementIds([...elements]);
  const conditionInactive = evaluation.conditionInactiveElementIds ?? new Set<ElementId>();
  const evaluated = evaluation.evaluatedElementIds ?? new Set(elements.map((element) => element.id));
  const colors = resolvedElementColorMap([...elements], palette);
  const { errorIds, warningIds } = groupIssueIds(elements, evaluation);
  const statuses: IndexedLineStatus[] = [];
  for (const range of [...ranges.values()].sort((left, right) => left.from - right.from)) {
    const element = byId.get(range.elementId);
    if (!element) continue;
    const groupState = groupStates.get(element.id);
    statuses.push({
      elementId: element.id,
      from: range.from,
      to: range.to,
      hasError: errorIds.has(element.id),
      hasWarning: warningIds.has(element.id),
      hiddenSelf: !element.visible,
      hiddenByGroup: Boolean(groupState?.hiddenByGroupId),
      hiddenByProfile: element.visible && !groupState?.hiddenByGroupId && !profileVisible.has(element.id),
      disabledSelf: !element.enabled,
      disabledByGroup: Boolean(groupState?.disabledByGroupId),
      conditionInactive: conditionInactive.has(element.id),
      isEvaluated: evaluated.has(element.id) && enabled.has(element.id) && baseVisible.has(element.id),
      locked: Boolean(element.locked),
      printEnabled: element.type === "group" && element.printEnabled === true,
      canToggleVisibility: element.type !== "variable",
      canTogglePrint: element.type === "group",
      color: colors.get(element.id) ?? "#31322f"
    });
  }
  const visibleOutline = visibleOutlineElements([...elements], groupFoldById);
  const lastVisibleDescendant = new Map<ElementId, ElementId>();
  for (const element of visibleOutline) {
    let current = element;
    while (current.parentGroupId) {
      const parent = byId.get(current.parentGroupId);
      if (!parent) break;
      if (isForGroupElement(parent)) lastVisibleDescendant.set(parent.id, element.id);
      current = parent;
    }
  }
  const rowsByOwner = groupedRows(evaluation.forGroupGeneratedRows);
  const generatedWidgets: IndexedGeneratedWidget[] = [];
  for (const element of elements) {
    if (!isForGroupElement(element) || !element.showGenerated || !isGroupExpanded(element.id, groupFoldById)) continue;
    const rows = rowsByOwner.get(element.id);
    const anchor = ranges.get(lastVisibleDescendant.get(element.id) ?? element.id);
    if (rows?.length && anchor) generatedWidgets.push({ forGroupId: element.id, afterPos: anchor.to, rows });
  }
  generatedWidgets.sort((left, right) => left.afterPos - right.afterPos);
  const pickLines = pickCandidates
    .map((candidate) => ranges.get(candidate.elementId))
    .filter((range): range is StatementRange => Boolean(range))
    .map((range) => ({ elementId: range.elementId, from: range.from, to: range.to }))
    .sort((left, right) => left.from - right.from);
  return {
    statuses,
    statusByLineFrom: new Map(statuses.map((status) => [status.from, status])),
    generatedWidgets,
    pickLines
  };
};
