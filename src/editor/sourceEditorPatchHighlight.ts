import { RangeSetBuilder, StateEffect, StateField, Transaction, type ChangeSet, type EditorState, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { diffTexts } from "../document/statementReconciler";
import { highlightDslLine } from "../dsl/dslHighlight";

export type PatchHighlightPayload = {
  /** insert.length > 0 splices, in new-document coordinates. */
  marks: readonly { from: number; to: number }[];
  /** Whole line removed (LineSplice with no replacement) — resolve via
   * doc.lineAt(point).from and render as a full-line Decoration.line.
   * Raw collapse offsets, NOT line-start positions. */
  deletionPoints: readonly number[];
  /** Token(s) removed from *within* an otherwise-surviving (replaced) line,
   * with nothing new inserted at that exact position — render as a small
   * zero-width Decoration.widget, never a line highlight. */
  deletionMarkers: readonly number[];
} | null;

/**
 * This highlight is NOT time-based: it has no timer or animation-driven
 * expiry. It is set once per applied model patch and persists, unchanged,
 * until the next genuine user-driven transaction (see patchHighlightField
 * below) — including across the controller's own follow-up housekeeping
 * dispatches (history clear, decoration refresh, selection/fold projection).
 */
export const setPatchHighlight = StateEffect.define<PatchHighlightPayload>();

export const patchHighlightField = StateField.define<PatchHighlightPayload>({
  create: () => null,
  update: (value, tr) => {
    for (const effect of tr.effects) {
      if (effect.is(setPatchHighlight)) return effect.value;
    }
    if (value === null) return null;
    // A real user-driven transaction (typing, IME commit, pointer/keyboard
    // selection, CM's own undo/redo) always carries this annotation; the
    // controller's own programmatic dispatches never set it.
    if (tr.annotation(Transaction.userEvent) !== undefined) return null;
    if (!tr.changes.empty) {
      return {
        marks: value.marks.map(({ from, to }) => ({ from: tr.changes.mapPos(from), to: tr.changes.mapPos(to, 1) })),
        deletionPoints: value.deletionPoints.map((pos) => tr.changes.mapPos(pos)),
        deletionMarkers: value.deletionMarkers.map((pos) => tr.changes.mapPos(pos))
      };
    }
    return value;
  }
});

class DeletionMarkerWidget extends WidgetType {
  eq() {
    return true; // stateless — all instances render identically
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-patch-highlight-deletion-marker";
    return span;
  }

  ignoreEvent() {
    return true;
  }
}

/** Exported for tests: resolves deletionPoints to their containing lines
 * (deduplicated) and builds mark/line/widget decorations from a payload. */
export const buildDecorations = (state: EditorState, payload: PatchHighlightPayload): DecorationSet => {
  if (!payload) return Decoration.none;
  const entries: { from: number; to: number; decoration: Decoration }[] = [];
  for (const mark of payload.marks) {
    if (mark.from >= mark.to) continue;
    entries.push({ from: mark.from, to: mark.to, decoration: Decoration.mark({ class: "cm-patch-highlight-range" }) });
  }
  const lineStarts = new Set<number>();
  for (const point of payload.deletionPoints) {
    const clamped = Math.min(Math.max(point, 0), state.doc.length);
    lineStarts.add(state.doc.lineAt(clamped).from);
  }
  for (const lineFrom of lineStarts) {
    entries.push({ from: lineFrom, to: lineFrom, decoration: Decoration.line({ class: "cm-patch-highlight-line" }) });
  }
  const markerPositions = new Set<number>();
  for (const point of payload.deletionMarkers) {
    markerPositions.add(Math.min(Math.max(point, 0), state.doc.length));
  }
  for (const pos of markerPositions) {
    entries.push({ from: pos, to: pos, decoration: Decoration.widget({ widget: new DeletionMarkerWidget(), side: 1 }) });
  }
  entries.sort((left, right) => left.from - right.from || left.to - right.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const entry of entries) builder.add(entry.from, entry.to, entry.decoration);
  return builder.finish();
};

/** Derives the DecorationSet purely from patchHighlightField — no ViewPlugin needed. */
export const patchHighlightDecorations = EditorView.decorations.compute(
  [patchHighlightField],
  (state) => buildDecorations(state, state.field(patchHighlightField))
);

export const sourceEditorPatchHighlightExtension: Extension = [patchHighlightField, patchHighlightDecorations];

/**
 * Locates each DSL token's real position in `line` by searching from a
 * running cursor, rather than assuming `highlightDslLine`'s returned tokens
 * partition the line with no gaps (that invariant is not guaranteed by the
 * `{kind, text}`-only `DslHighlightToken` type, and must not be inferred by
 * summing token lengths).
 */
const lineTokensWithOffsets = (line: string): { text: string; from: number; to: number }[] => {
  const result: { text: string; from: number; to: number }[] = [];
  let cursor = 0;
  for (const token of highlightDslLine(line)) {
    if (!token.text) continue;
    const from = line.indexOf(token.text, cursor);
    if (from === -1) break; // tokenizer contract violated — stop rather than mis-position later tokens
    const to = from + token.text.length;
    result.push({ text: token.text, from, to });
    cursor = to;
  }
  return result;
};

/** Tokenizes possibly multi-line text into {text, from, to} with offsets
 * relative to the start of `text`. Lines are tokenized independently (via
 * lineTokensWithOffsets) and stitched with an explicit "\n" token so
 * multi-line spans diff correctly. */
const tokensWithOffsets = (text: string): { text: string; from: number; to: number }[] => {
  const lines = text.split("\n");
  const result: { text: string; from: number; to: number }[] = [];
  let lineStart = 0;
  lines.forEach((line, index) => {
    for (const token of lineTokensWithOffsets(line)) {
      result.push({ text: token.text, from: lineStart + token.from, to: lineStart + token.to });
    }
    lineStart += line.length;
    if (index < lines.length - 1) {
      result.push({ text: "\n", from: lineStart, to: lineStart + 1 });
      lineStart += 1;
    }
  });
  return result;
};

/** Position where tokens[index] starts, or textLength if index is past the
 * end. Never reads a token's own `.to` — only verified `.from` values (each
 * independently located via indexOf) or the text's own length. */
const boundaryAt = (tokens: readonly { from: number }[], index: number, textLength: number) =>
  index < tokens.length ? tokens[index].from : textLength;

/**
 * Exported for tests. Diffs oldText against newText at DSL-token granularity
 * (same tokenizer the line lens uses) and returns only what actually
 * changed: `marks` are new/changed token ranges (in newText coordinates),
 * `deletionPoints` are positions where old tokens were removed with nothing
 * new inserted there. When nothing is shared between old and new, this
 * naturally resolves to a single mark spanning the whole newText (via
 * boundaryAt, not a special case).
 */
export const diffChangedTokens = (
  oldText: string,
  newText: string
): { marks: { from: number; to: number }[]; deletionPoints: number[] } => {
  const oldTokens = tokensWithOffsets(oldText);
  const newTokens = tokensWithOffsets(newText);
  const { hunks } = diffTexts(oldTokens.map((token) => token.text), newTokens.map((token) => token.text));
  const marks: { from: number; to: number }[] = [];
  const deletionPoints: number[] = [];
  for (const hunk of hunks) {
    const from = boundaryAt(newTokens, hunk.newStart, newText.length);
    if (hunk.newEnd > hunk.newStart) {
      marks.push({ from, to: boundaryAt(newTokens, hunk.newEnd, newText.length) });
    } else if (hunk.oldEnd > hunk.oldStart) {
      deletionPoints.push(from); // pure deletion within the span: nothing new at this position
    }
  }
  return { marks, deletionPoints };
};

/** Converts a just-built ChangeSet (new-document coordinates from iterChanges),
 * together with the pre-patch document (for slicing old text to diff against),
 * into a payload. */
export const patchHighlightPayloadForChanges = (oldDoc: Text, changes: ChangeSet): PatchHighlightPayload => {
  const marks: { from: number; to: number }[] = [];
  const deletionPoints: number[] = [];
  const deletionMarkers: number[] = [];
  changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    if (fromB === toB) {
      if (toA > fromA) deletionPoints.push(fromB);
      return;
    }
    if (fromA === toA) {
      marks.push({ from: fromB, to: toB }); // pure insertion — nothing old to diff against
      return;
    }
    const diff = diffChangedTokens(oldDoc.sliceString(fromA, toA), inserted.toString());
    for (const range of diff.marks) marks.push({ from: fromB + range.from, to: fromB + range.to });
    for (const point of diff.deletionPoints) deletionMarkers.push(fromB + point);
  }, true);
  if (marks.length === 0 && deletionPoints.length === 0 && deletionMarkers.length === 0) return null;
  return { marks, deletionPoints, deletionMarkers };
};
