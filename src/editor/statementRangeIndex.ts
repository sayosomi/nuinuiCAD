import { MapMode, Text, type ChangeDesc } from "@codemirror/state";
import type { StatementInfo, StatementMap } from "../dsl/dslDocument";
import type { ElementId } from "../types/geometry";

export type StatementRange = {
  elementId: ElementId;
  statement: StatementInfo;
  from: number;
  to: number;
  /** Fold positions are captured from a synchronized CM document and thereafter mapped, never re-derived from stale lines. */
  groupFoldRange?: { from: number; to: number };
  elseFoldRange?: { from: number; to: number };
  elseLineFrom?: number;
};

export type StatementRangeIndex = ReadonlyMap<ElementId, StatementRange>;

/** Builds CM logical-document positions only while the matching statementMap is current. */
export const createStatementRangeIndex = (doc: Text, statementMap: StatementMap): StatementRangeIndex => {
  const ranges = new Map<ElementId, StatementRange>();
  for (const [elementId, statement] of statementMap.byElementId) {
    if (statement.line < 1 || statement.line > doc.lines) continue;
    const line = doc.line(statement.line);
    const endLine = statement.range.endLine <= doc.lines ? doc.line(statement.range.endLine) : null;
    const elseLine = statement.elseLine && statement.elseLine <= doc.lines ? doc.line(statement.elseLine) : null;
    ranges.set(elementId, {
      elementId,
      statement,
      from: line.from,
      to: line.to,
      ...(endLine && endLine.number > line.number
        ? { groupFoldRange: { from: line.to, to: endLine.to } }
        : {}),
      ...(elseLine && endLine && endLine.number > elseLine.number
        ? { elseLineFrom: elseLine.from, elseFoldRange: { from: elseLine.to, to: endLine.from } }
        : {})
    });
  }
  return ranges;
};

/**
 * Keeps last-known-good element ranges aligned with an uncommitted or fatal CM buffer.
 * A statement line deleted wholesale loses its identity until a valid compile replaces it.
 */
export const mapStatementRangeIndex = (
  ranges: StatementRangeIndex,
  changes: ChangeDesc
): StatementRangeIndex => {
  const mapped = new Map<ElementId, StatementRange>();
  for (const [elementId, range] of ranges) {
    if (changes.touchesRange(range.from, range.to) === "cover") continue;
    const from = changes.mapPos(range.from, 1, MapMode.TrackAfter);
    const to = changes.mapPos(range.to, -1, MapMode.TrackBefore);
    if (from === null || to === null || to < from) continue;
    const mapFoldRange = (foldRange: { from: number; to: number } | undefined) => {
      if (!foldRange || changes.touchesRange(foldRange.from, foldRange.to) === "cover") return undefined;
      const foldFrom = changes.mapPos(foldRange.from, 1, MapMode.TrackAfter);
      const foldTo = changes.mapPos(foldRange.to, -1, MapMode.TrackBefore);
      return foldFrom === null || foldTo === null || foldTo <= foldFrom
        ? undefined
        : { from: foldFrom, to: foldTo };
    };
    mapped.set(elementId, {
      ...range,
      from,
      to,
      groupFoldRange: mapFoldRange(range.groupFoldRange),
      elseFoldRange: mapFoldRange(range.elseFoldRange),
      elseLineFrom: range.elseLineFrom === undefined
        ? undefined
        : changes.mapPos(range.elseLineFrom, 1, MapMode.TrackAfter) ?? undefined
    });
  }
  return mapped;
};

export const elementIdAtCursor = (ranges: StatementRangeIndex, head: number): ElementId | null => {
  for (const [elementId, range] of ranges) {
    if (head >= range.from && head <= range.to) return elementId;
  }
  return null;
};

export const statementRangeAtLine = (ranges: StatementRangeIndex, lineFrom: number): StatementRange | null => {
  for (const range of ranges.values()) {
    if (range.from === lineFrom) return range;
  }
  return null;
};

export type AtStopRange = { from: number; to: number };

/**
 * Mirrors createStatementRangeIndex for the single non-element "@stop" line: only
 * valid while the matching statementMap is current (docText === sourceText).
 */
export const createAtStopRange = (doc: Text, statementMap: StatementMap): AtStopRange | null => {
  const statement = statementMap.byKey.get("atStop");
  if (!statement || statement.line < 1 || statement.line > doc.lines) return null;
  const line = doc.line(statement.line);
  return { from: line.from, to: line.to };
};

/**
 * Mirrors mapStatementRangeIndex: re-projects the last-known-good "@stop" position
 * through a CM ChangeDesc. Returns null once the position becomes unrecoverable
 * (fully covered by an edit), rather than ever falling back to a raw stale line number.
 */
export const mapAtStopRange = (range: AtStopRange | null, changes: ChangeDesc): AtStopRange | null => {
  if (!range) return null;
  // Unlike element statements, @stop has no runtime identity to retain through an
  // in-place edit. Any touch can change or remove the directive, so wait for a
  // successful compile rather than leaving a marker on an unrelated line.
  if (changes.touchesRange(range.from, range.to) !== false) return null;
  const from = changes.mapPos(range.from, 1, MapMode.TrackAfter);
  const to = changes.mapPos(range.to, -1, MapMode.TrackBefore);
  return from === null || to === null || to < from ? null : { from, to };
};
