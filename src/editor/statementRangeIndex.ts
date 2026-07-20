import { MapMode, Text, type ChangeDesc } from "@codemirror/state";
import type { StatementInfo, StatementMap } from "../dsl/dslDocument";
import type { FoldTarget } from "../model/groups";
import type { ElementId } from "../types/geometry";

type FoldAnchor = { from: number; to: number };

/** A single presentation branch, captured from one synchronized CM snapshot. */
export type StatementFoldTarget = FoldTarget & {
  /** Physical row on which CodeMirror renders the gutter marker. */
  gutterLineFrom: number;
  /** CM replacement range; deliberately independent from gutterLineFrom. */
  foldFrom: number;
  foldTo: number;
  /** Editing any structural delimiter disables this target until a valid compile refreshes it. */
  anchors: readonly FoldAnchor[];
};

export type StatementRange = {
  elementId: ElementId;
  statement: StatementInfo;
  from: number;
  to: number;
  /** Fold positions are captured from a synchronized CM document and thereafter mapped, never re-derived from stale lines. */
  foldTargets: readonly StatementFoldTarget[];
};

export type StatementRangeIndex = ReadonlyMap<ElementId, StatementRange>;

/** Builds CM logical-document positions only while the matching statementMap is current. */
export const createStatementRangeIndex = (doc: Text, statementMap: StatementMap): StatementRangeIndex => {
  const ranges = new Map<ElementId, StatementRange>();
  for (const [elementId, statement] of statementMap.byElementId) {
    if (statement.line < 1 || statement.line > doc.lines) continue;
    const line = doc.line(statement.line);
    const statementEndLine = statement.endLine <= doc.lines ? doc.line(statement.endLine) : null;
    const closeLine = statement.closeBraceLine && statement.closeBraceLine <= doc.lines ? doc.line(statement.closeBraceLine) : null;
    const openLine = statement.openBraceLine && statement.openBraceLine <= doc.lines ? doc.line(statement.openBraceLine) : null;
    // A block may open on the final physical header row (the canonical form)
    // or on a following standalone brace row. Never fall back to the first
    // header row: multi-line handwritten headers must keep their continuation
    // rows visible when folded.
    const braceLine = openLine ?? (closeLine ? statementEndLine : null);
    const elseLine = statement.elseBraceLine && statement.elseBraceLine <= doc.lines ? doc.line(statement.elseBraceLine) : null;
    const foldTargets: StatementFoldTarget[] = [];
    // Ordinary multiline statements (for example `point A = offset(`) get
    // their own presentation target. Keep the opening header and final close
    // row visible so the folded statement still reads naturally as `… )`.
    // Block statements use their brace targets below instead, avoiding two
    // competing gutter controls on a single structural header.
    if (!closeLine && statement.line < statement.endLine && statementEndLine && line.to < statementEndLine.from) {
      foldTargets.push({
        elementId,
        branch: "statement",
        gutterLineFrom: line.from,
        foldFrom: line.to,
        foldTo: statementEndLine.from,
        anchors: [
          { from: line.from, to: line.to },
          { from: statementEndLine.from, to: statementEndLine.to }
        ]
      });
    }
    if (braceLine && closeLine && braceLine.number < closeLine.number) {
      const foldTo = elseLine ? elseLine.from - 1 : closeLine.from;
      if (foldTo > braceLine.to) {
        foldTargets.push({
          elementId,
          branch: "primary",
          gutterLineFrom: braceLine.from,
          foldFrom: braceLine.to,
          foldTo,
          anchors: [
            { from: braceLine.from, to: braceLine.to },
            { from: (elseLine ?? closeLine).from, to: (elseLine ?? closeLine).to }
          ]
        });
      }
    }
    if (elseLine && closeLine && elseLine.number < closeLine.number && closeLine.from > elseLine.to) {
      foldTargets.push({
        elementId,
        branch: "else",
        gutterLineFrom: elseLine.from,
        foldFrom: elseLine.to,
        foldTo: closeLine.from,
        anchors: [
          { from: elseLine.from, to: elseLine.to },
          { from: closeLine.from, to: closeLine.to }
        ]
      });
    }
    ranges.set(elementId, {
      elementId,
      statement,
      from: line.from,
      to: statementEndLine?.to ?? line.to,
      foldTargets
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
    // A value at the statement's final character is still part of that
    // statement. TrackBefore would drop the whole range when that value is
    // replaced, so map the end after its replacement while the start keeps the
    // stricter identity guard below.
    const to = changes.mapPos(range.to, 1, MapMode.Simple);
    if (from === null || to === null || to < from) continue;
    const foldTargets = range.foldTargets.flatMap((target): StatementFoldTarget[] => {
      // Structural delimiter rows are the snapshot's identity anchors. A
      // changed anchor is intentionally unavailable while the buffer is dirty
      // rather than being guessed from stale StatementInfo line numbers.
      if (target.anchors.some((anchor) => changes.touchesRange(anchor.from, anchor.to) !== false)) return [];
      const foldFrom = changes.mapPos(target.foldFrom, 1, MapMode.TrackAfter);
      const foldTo = changes.mapPos(target.foldTo, -1, MapMode.TrackBefore);
      const gutterLineFrom = changes.mapPos(target.gutterLineFrom, 1, MapMode.TrackAfter);
      const anchors = target.anchors.map((anchor) => ({
        from: changes.mapPos(anchor.from, 1, MapMode.TrackAfter),
        to: changes.mapPos(anchor.to, -1, MapMode.TrackBefore)
      }));
      if (
        foldFrom === null || foldTo === null || foldTo <= foldFrom || gutterLineFrom === null ||
        anchors.some((anchor) => anchor.from === null || anchor.to === null || anchor.to < anchor.from)
      ) return [];
      return [{
        ...target,
        foldFrom,
        foldTo,
        gutterLineFrom,
        anchors: anchors as FoldAnchor[]
      }];
    });
    mapped.set(elementId, {
      ...range,
      from,
      to,
      foldTargets
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

export type PrintLayoutRange = { printLayoutId: string; from: number; to: number };
export type PrintLayoutRangeIndex = ReadonlyMap<string, PrintLayoutRange>;

/**
 * Mirrors createStatementRangeIndex for printLayout block-opening lines.
 * statementMap.byKey entries keyed `printLayout:<id>` never appear in the
 * element-keyed StatementRangeIndex (printLayout/place/layoutVar produce no
 * CadElement), so `@variable` completion for printLayout-block attributes
 * needs this separate live-line -> committed-id index. Only valid while the
 * matching statementMap is current, same contract as createStatementRangeIndex.
 */
export const createPrintLayoutRangeIndex = (doc: Text, statementMap: StatementMap): PrintLayoutRangeIndex => {
  const ranges = new Map<string, PrintLayoutRange>();
  for (const [key, info] of statementMap.byKey) {
    if (!key.startsWith("printLayout:")) continue;
    if (info.line < 1 || info.line > doc.lines) continue;
    const printLayoutId = key.slice("printLayout:".length);
    const line = doc.line(info.line);
    ranges.set(printLayoutId, { printLayoutId, from: line.from, to: line.to });
  }
  return ranges;
};

/**
 * Mirrors mapStatementRangeIndex: re-projects each printLayout block-opening
 * line's last-known-good position through a CM ChangeDesc. No fold ranges are
 * tracked here (unlike StatementRange) since this index exists only for live
 * @variable completion identity lookup, not decoration/gutter positioning.
 */
export const mapPrintLayoutRangeIndex = (ranges: PrintLayoutRangeIndex, changes: ChangeDesc): PrintLayoutRangeIndex => {
  const mapped = new Map<string, PrintLayoutRange>();
  for (const [printLayoutId, range] of ranges) {
    if (changes.touchesRange(range.from, range.to) === "cover") continue;
    const from = changes.mapPos(range.from, 1, MapMode.TrackAfter);
    const to = changes.mapPos(range.to, 1, MapMode.Simple);
    if (from === null || to === null || to < from) continue;
    mapped.set(printLayoutId, { printLayoutId, from, to });
  }
  return mapped;
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
