import { EditorState, Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  buildDecorations,
  diffChangedTokens,
  patchHighlightField,
  patchHighlightPayloadForChanges,
  setPatchHighlight,
  type PatchHighlightPayload
} from "./sourceEditorPatchHighlight";

const decorationEntries = (state: EditorState, payload: PatchHighlightPayload) => {
  const entries: { from: number; to: number; className: string }[] = [];
  buildDecorations(state, payload).between(0, state.doc.length, (from, to, decoration) => {
    const spec = decoration.spec as { class?: string; widget?: { toDOM: () => HTMLElement } };
    const className = spec.class ?? spec.widget?.toDOM().className ?? "";
    entries.push({ from, to, className });
  });
  return entries;
};

/** Builds a real old Text + ChangeSet for a single-change replace, matching
 * how lineSplicesToSourceTextChanges actually replaces a whole changed line
 * verbatim (old span -> new span), so patchHighlightPayloadForChanges has
 * real text on both sides to diff. */
const wholeLineReplace = (oldText: string, newText: string) => {
  const state = EditorState.create({ doc: oldText });
  const changes = state.changes({ from: 0, to: oldText.length, insert: newText });
  return { oldDoc: state.doc, changes };
};

const slice = (text: string, range: { from: number; to: number }) => text.slice(range.from, range.to);

describe("diffChangedTokens", () => {
  it("highlights only the changed numeric values, not the whole statement (motivating case)", () => {
    const oldText = "curve 曲線AC = 点A -> 点C startAngle=256 startLength=30 endAngle=359 endLength=112";
    const newText = "curve 曲線AC = 点A -> 点C startAngle=200 startLength=50 endAngle=359 endLength=112";
    const { marks, deletionPoints } = diffChangedTokens(oldText, newText);
    expect(deletionPoints).toEqual([]);
    expect(marks.map((range) => slice(newText, range))).toEqual(["200", "50"]);
  });

  it("highlights only the changed value when the attribute has spaces around '='", () => {
    const oldText = "startAngle = 256";
    const newText = "startAngle = 200";
    const { marks, deletionPoints } = diffChangedTokens(oldText, newText);
    expect(deletionPoints).toEqual([]);
    expect(marks).toHaveLength(1);
    expect(slice(newText, marks[0])).toBe("200");
  });

  it("highlights a single changed value with the rest of the line untouched", () => {
    const oldText = "point A = (1, 1)";
    const newText = "point A = (777, 1)";
    const { marks } = diffChangedTokens(oldText, newText);
    expect(marks).toHaveLength(1);
    expect(slice(newText, marks[0])).toBe("777");
  });

  it("highlights a changed identifier/reference token", () => {
    const oldText = "point A = (1, 1)";
    const newText = "point B = (1, 1)";
    const { marks } = diffChangedTokens(oldText, newText);
    expect(marks).toHaveLength(1);
    expect(slice(newText, marks[0])).toBe("B");
  });

  it("merges adjacent changed tokens with no shared anchor between them into one range", () => {
    const oldText = "keep a-b keep2";
    const newText = "keep x+y keep2";
    const { marks } = diffChangedTokens(oldText, newText);
    expect(marks).toHaveLength(1);
    expect(slice(newText, marks[0])).toBe("x+y");
  });

  it("falls back to highlighting the whole new text when nothing is shared", () => {
    const oldText = "foo-bar";
    const newText = "baz+qux";
    const result = diffChangedTokens(oldText, newText);
    expect(result).toEqual({ marks: [{ from: 0, to: newText.length }], deletionPoints: [] });
  });

  it("records a deletion point when an attribute is removed from the middle, with no mark", () => {
    const oldText = "a=1 b=2 c=3";
    const newText = "a=1 c=3";
    const { marks, deletionPoints } = diffChangedTokens(oldText, newText);
    expect(marks).toEqual([]);
    expect(deletionPoints).toHaveLength(1);
    expect(slice(newText, { from: deletionPoints[0], to: deletionPoints[0] })).toBe("");
    expect(newText.slice(0, deletionPoints[0])).toBe("a=1 ");
    expect(newText.slice(deletionPoints[0])).toBe("c=3");
  });

  it("records a deletion point at the very start when the first token is removed", () => {
    const oldText = "a b c";
    const newText = "b c";
    const { marks, deletionPoints } = diffChangedTokens(oldText, newText);
    expect(marks).toEqual([]);
    expect(deletionPoints).toEqual([0]);
  });

  it("records a deletion point at newText.length when the last token is removed", () => {
    const oldText = "a b c";
    const newText = "a b";
    const { marks, deletionPoints } = diffChangedTokens(oldText, newText);
    expect(marks).toEqual([]);
    expect(deletionPoints).toEqual([newText.length]);
  });
});

describe("patchHighlightPayloadForChanges", () => {
  it("classifies a pure insertion as a mark, not a deletion point", () => {
    const state = EditorState.create({ doc: "abcde" });
    const changes = state.changes({ from: 3, to: 3, insert: "XY" });
    const payload = patchHighlightPayloadForChanges(state.doc, changes);
    expect(payload).toEqual({ marks: [{ from: 3, to: 5 }], deletionPoints: [], deletionMarkers: [] });
  });

  it("classifies a pure deletion as a deletion point, not a mark", () => {
    const state = EditorState.create({ doc: "abcde" });
    const changes = state.changes({ from: 2, to: 4, insert: "" });
    const payload = patchHighlightPayloadForChanges(state.doc, changes);
    expect(payload).toEqual({ marks: [], deletionPoints: [2], deletionMarkers: [] });
  });

  it("classifies a replacement as a mark over only the changed token, not the whole span", () => {
    const { oldDoc, changes } = wholeLineReplace("point A = (1, 1)", "point A = (777, 1)");
    const payload = patchHighlightPayloadForChanges(oldDoc, changes);
    expect(payload?.deletionPoints).toEqual([]);
    expect(payload?.deletionMarkers).toEqual([]);
    expect(payload?.marks).toHaveLength(1);
    const mark = payload!.marks[0];
    expect(mark.to - mark.from).toBe("777".length);
  });

  it("routes a within-line pure deletion into deletionMarkers, not deletionPoints", () => {
    const { oldDoc, changes } = wholeLineReplace("a=1 b=2 c=3", "a=1 c=3");
    const payload = patchHighlightPayloadForChanges(oldDoc, changes);
    expect(payload?.marks).toEqual([]);
    expect(payload?.deletionPoints).toEqual([]);
    expect(payload?.deletionMarkers).toHaveLength(1);
  });

  it("keeps multiple non-adjacent changes as independent entries (individual=true)", () => {
    const state = EditorState.create({ doc: "abcde" });
    const changes = state.changes([
      { from: 0, to: 0, insert: "A" },
      { from: 3, to: 3, insert: "B" }
    ]);
    const payload = patchHighlightPayloadForChanges(state.doc, changes);
    expect(payload?.marks).toHaveLength(2);
    expect(payload?.marks).toEqual([{ from: 0, to: 1 }, { from: 4, to: 5 }]);
  });

  it("returns null when there is nothing to highlight", () => {
    const state = EditorState.create({ doc: "" });
    const changes = state.changes({ from: 0, to: 0, insert: "" });
    expect(patchHighlightPayloadForChanges(state.doc, changes)).toBeNull();
  });
});

describe("patchHighlightField", () => {
  const emptyPayload = { marks: [], deletionPoints: [], deletionMarkers: [] };
  const stateWith = (payload: PatchHighlightPayload, doc = "aaaa bbbb cccc") => {
    const base = EditorState.create({ doc, extensions: [patchHighlightField] });
    return base.update({ effects: setPatchHighlight.of(payload) }).state;
  };

  it("is null until a patch is applied", () => {
    const state = EditorState.create({ doc: "abc", extensions: [patchHighlightField] });
    expect(state.field(patchHighlightField)).toBeNull();
  });

  it("is set by setPatchHighlight", () => {
    const payload: PatchHighlightPayload = { ...emptyPayload, marks: [{ from: 1, to: 2 }] };
    const state = stateWith(payload);
    expect(state.field(patchHighlightField)).toEqual(payload);
  });

  it("is replaced (not merged) by a newer setPatchHighlight effect", () => {
    const first = stateWith({ ...emptyPayload, marks: [{ from: 1, to: 2 }] });
    const second = first.update({ effects: setPatchHighlight.of({ ...emptyPayload, deletionPoints: [5] }) }).state;
    expect(second.field(patchHighlightField)).toEqual({ ...emptyPayload, deletionPoints: [5] });
  });

  it("is cleared by setPatchHighlight.of(null)", () => {
    const set = stateWith({ ...emptyPayload, marks: [{ from: 1, to: 2 }] });
    const cleared = set.update({ effects: setPatchHighlight.of(null) }).state;
    expect(cleared.field(patchHighlightField)).toBeNull();
  });

  it("is cleared by any transaction carrying a Transaction.userEvent annotation", () => {
    const set = stateWith({ ...emptyPayload, marks: [{ from: 1, to: 2 }] });
    const typed = set.update({
      changes: { from: 0, to: 0, insert: "z" },
      annotations: Transaction.userEvent.of("input.type")
    }).state;
    expect(typed.field(patchHighlightField)).toBeNull();
  });

  it("survives a programmatic transaction with no effect and no userEvent annotation, remapping marks, deletionPoints, and deletionMarkers through its changes", () => {
    // Mirrors the controller's own follow-up housekeeping dispatches (history
    // clear reconfigure, decoration refresh, selection/fold projection) that
    // run immediately after a model patch but must not clear the highlight.
    const set = stateWith({ marks: [{ from: 5, to: 7 }], deletionPoints: [9], deletionMarkers: [11] });
    const housekeeping = set.update({ changes: { from: 0, to: 0, insert: "XX" } }).state;
    expect(housekeeping.field(patchHighlightField)).toEqual({
      marks: [{ from: 7, to: 9 }],
      deletionPoints: [11],
      deletionMarkers: [13]
    });
  });

  it("survives with no timer: still present after simulated time passes with no further transaction", () => {
    const payload: PatchHighlightPayload = { ...emptyPayload, marks: [{ from: 1, to: 2 }] };
    const state = stateWith(payload);
    // No transaction dispatched — the field only changes value in response to
    // a transaction's update() call, so simply reading it again (as a stand-in
    // for "time passing") must return the same value.
    expect(state.field(patchHighlightField)).toEqual(payload);
    expect(state.field(patchHighlightField)).toEqual(payload);
  });
});

describe("buildDecorations line resolution", () => {
  const emptyPayload = { marks: [], deletionPoints: [], deletionMarkers: [] };

  it("highlights the containing line when only mid-line characters were deleted", () => {
    const doc = "line one\nline two\nline three";
    const state = EditorState.create({ doc });
    const line2 = state.doc.line(2);
    const midLinePoint = line2.from + 3;
    expect(midLinePoint).not.toBe(line2.from);

    const entries = decorationEntries(state, { ...emptyPayload, deletionPoints: [midLinePoint] });
    expect(entries).toEqual([{ from: line2.from, to: line2.from, className: "cm-patch-highlight-line" }]);
  });

  it("highlights the correct merged line after a newline deletion", () => {
    // "line one" + "line two" merged into one line by deleting the newline
    // that used to separate them; the collapse point sits right at the
    // former boundary, inside the merged line rather than at its start.
    const doc = "line oneline two\nline three";
    const state = EditorState.create({ doc });
    const mergedLine = state.doc.line(1);
    const boundaryPoint = 8; // where "line one" ended && "line two" began

    const entries = decorationEntries(state, { ...emptyPayload, deletionPoints: [boundaryPoint] });
    expect(entries).toEqual([{ from: mergedLine.from, to: mergedLine.from, className: "cm-patch-highlight-line" }]);
  });

  it("resolves a deletion at the very end of the document to the last line", () => {
    const doc = "line one\nline two";
    const state = EditorState.create({ doc });
    const lastLine = state.doc.line(state.doc.lines);
    expect(doc.length).toBe(state.doc.length);

    const entries = decorationEntries(state, { ...emptyPayload, deletionPoints: [state.doc.length] });
    expect(entries).toEqual([{ from: lastLine.from, to: lastLine.from, className: "cm-patch-highlight-line" }]);
  });

  it("deduplicates multiple deletion splices that resolve to the same line", () => {
    const doc = "line one\nline two\nline three";
    const state = EditorState.create({ doc });
    const line2 = state.doc.line(2);
    const firstPoint = line2.from + 1;
    const secondPoint = line2.from + 5;
    expect(firstPoint).not.toBe(secondPoint);

    const entries = decorationEntries(state, { ...emptyPayload, deletionPoints: [firstPoint, secondPoint] });
    expect(entries).toEqual([{ from: line2.from, to: line2.from, className: "cm-patch-highlight-line" }]);
  });

  it("still highlights character-range marks alongside deletion-only lines", () => {
    const doc = "line one\nline two\nline three";
    const state = EditorState.create({ doc });
    const line3 = state.doc.line(3);
    const markFrom = line3.from + 5;
    const markTo = markFrom + 4;

    const entries = decorationEntries(state, { marks: [{ from: markFrom, to: markTo }], deletionPoints: [1], deletionMarkers: [] });
    expect(entries).toEqual([
      { from: 0, to: 0, className: "cm-patch-highlight-line" },
      { from: markFrom, to: markTo, className: "cm-patch-highlight-range" }
    ]);
  });
});

describe("buildDecorations deletion markers", () => {
  const emptyPayload = { marks: [], deletionPoints: [], deletionMarkers: [] };

  it("emits exactly one zero-width widget decoration per deletion-marker position", () => {
    const doc = "point A = (1, 1)";
    const state = EditorState.create({ doc });
    const entries = decorationEntries(state, { ...emptyPayload, deletionMarkers: [4] });
    expect(entries).toEqual([{ from: 4, to: 4, className: "cm-patch-highlight-deletion-marker" }]);
  });

  it("deduplicates duplicate deletion-marker positions into a single widget", () => {
    const doc = "point A = (1, 1)";
    const state = EditorState.create({ doc });
    const entries = decorationEntries(state, { ...emptyPayload, deletionMarkers: [4, 4, 4] });
    expect(entries).toEqual([{ from: 4, to: 4, className: "cm-patch-highlight-deletion-marker" }]);
  });

  it("keeps deletion markers distinct from whole-line deletion highlighting", () => {
    const doc = "point A = (1, 1)\npoint B = (2, 2)";
    const state = EditorState.create({ doc });
    const line2 = state.doc.line(2);
    const entries = decorationEntries(state, { ...emptyPayload, deletionPoints: [line2.from + 2], deletionMarkers: [4] });
    expect(entries).toEqual([
      { from: 4, to: 4, className: "cm-patch-highlight-deletion-marker" },
      { from: line2.from, to: line2.from, className: "cm-patch-highlight-line" }
    ]);
  });
});
