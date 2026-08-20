import {
  isForGroupElement,
  isGroupExpanded,
  visibleOutlineElements,
  type GroupFoldById
} from "../model/groups";
import {
  createElementPresentationStatusIndex,
  type ElementPresentationStatus
} from "../model/elementPresentationStatus";
import type { PickCandidate } from "../model/pickCandidates";
import type { CadElement, DocumentPalette, ElementId, EvaluationResult, ForGroupGeneratedRow, VisibilityProfile } from "../types/geometry";
import type { StatementRange, StatementRangeIndex } from "./statementRangeIndex";

export type VisibleRange = { from: number; to: number };

export type IndexedLineStatus = ElementPresentationStatus & {
  from: number;
  to: number;
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

/** Builds document-wide immutable lookup data only when source/evaluation/UI state changes.
 * Scrolling reads it through entriesInVisibleRanges && never scans the whole document. */
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
  const statusesByElementId = createElementPresentationStatusIndex({
    elements,
    evaluation,
    groupFoldById,
    palette,
    visibilityProfiles,
    activeVisibilityProfileId,
  });
  const byId = new Map(elements.map((element) => [element.id, element]));
  const statuses: IndexedLineStatus[] = [];
  for (const range of [...ranges.values()].sort((left, right) => left.from - right.from)) {
    const status = statusesByElementId.get(range.elementId);
    if (!status) continue;
    statuses.push({
      from: range.from,
      to: range.to,
      ...status
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
    if (!isForGroupElement(element)) continue;
    // Task 25: the literal `showGenerated` field when unbound/no evaluation
    // has populated this set yet (falls back to today's behavior exactly);
    // the resolved typed boolean binding's effective value when bound.
    const effectiveShowGenerated = evaluation.forGroupEffectiveShowGeneratedIds?.has(element.id) ?? element.showGenerated;
    if (!effectiveShowGenerated || !isGroupExpanded(element.id, groupFoldById)) continue;
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
