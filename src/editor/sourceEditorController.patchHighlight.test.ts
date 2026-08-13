import { undoDepth, redoDepth } from "@codemirror/commands";
import { Transaction, type EditorState } from "@codemirror/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { dslTextForElements } from "../dsl/dslDocumentTestUtils";
import { SourceEditorController } from "./sourceEditorController";
import { patchHighlightField, type PatchHighlightPayload } from "./sourceEditorPatchHighlight";

type ControllerInternals = {
  view: {
    state: EditorState;
    dispatch: (spec: unknown) => void;
    scrollDOM: { scrollTop: number; scrollLeft: number };
  };
};

const source = dslTextForElements([
  { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
  { id: "b", name: "B", type: "freePoint", activity: "visible", x: 1, y: 1 }
]);

describe("SourceEditorController patch-change highlight", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.getState().commitText(source, "test");
    vi.useFakeTimers();
    Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const highlight = (internals: ControllerInternals): PatchHighlightPayload => internals.view.state.field(patchHighlightField);

  const patchElement = (name: string) => {
    const elements = useCadDocumentStore.getState().elements;
    return useCadDocumentStore.getState().commitDocumentChange({
      elements: elements.map((element) => (element.name === name ? { ...element, activity: "disabled" } : element))
    });
  };

  it("highlights the changed range after a Canvas-equivalent model patch, surviving the controller's own follow-up dispatches", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    expect(highlight(internals)).toBeNull();

    expect(patchElement("A")).toEqual({ status: "applied" });
    expect(useCadDocumentStore.getState().sourceUpdate.kind).toBe("model-patch");

    // By this point apply() has already run its own follow-up dispatches
    // synchronously (clearCmHistory's history-compartment reconfigure x2,
    // refreshDecorationIndex's evaluationChanged effect, selection/fold
    // projection) — the highlight must have survived all of them.
    const payload = highlight(internals);
    expect(payload).not.toBeNull();
    expect(payload!.marks.length).toBeGreaterThan(0);
    controller.destroy();
  });

  it("highlights only the changed value, not the whole statement, when one of two numeric attributes changes", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;

    const elements = useCadDocumentStore.getState().elements;
    const pointA = elements.find((element) => element.name === "A")!;
    expect(pointA.type).toBe("freePoint");
    const changed = elements.map((element) =>
      element.id === pointA.id && element.type === "freePoint" ? { ...element, x: 777 } : element
    );
    expect(useCadDocumentStore.getState().commitDocumentChange({ elements: changed })).toEqual({ status: "applied" });

    const payload = highlight(internals);
    expect(payload).not.toBeNull();
    expect(payload!.deletionPoints).toEqual([]);
    expect(payload!.deletionMarkers).toEqual([]);
    expect(payload!.marks).toHaveLength(1);
    const mark = payload!.marks[0];
    const highlightedText = internals.view.state.doc.sliceString(mark.from, mark.to);
    expect(highlightedText).toBe("777");

    // x && y each sit on their own physical line in v2's canonical vertical
    // call, so the changed x line's own text must be exactly the mark (no
    // extra content highlighted alongside it), && the unchanged y line
    // (unaffected by this edit) must still read "y: 0,".
    const line = internals.view.state.doc.lineAt(mark.from);
    const fullLineText = internals.view.state.doc.sliceString(line.from, line.to);
    expect(fullLineText).toBe("  x: 777,");
    const yLine = internals.view.state.doc.line(line.number + 1);
    expect(internals.view.state.doc.sliceString(yLine.from, yLine.to)).toBe("  y: 0,");
    controller.destroy();
  });

  it("is cleared by a subsequent real user keystroke, not by the controller's own housekeeping", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    patchElement("A");
    expect(highlight(internals)).not.toBeNull();

    // A bare programmatic dispatch (as other suites use to simulate typing
    // bursts) does not itself carry CM's real input annotation. A genuine
    // keystroke does: CM6's own DOM input pipeline tags it with
    // Transaction.userEvent automatically, which is what actually clears it.
    internals.view.dispatch({
      changes: { from: internals.view.state.doc.length, insert: "\n# typed" },
      annotations: Transaction.userEvent.of("input.type")
    });
    expect(highlight(internals)).toBeNull();
    controller.destroy();
  });

  it("is cleared by store-level Undo and stays cleared through Redo", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    patchElement("A");
    expect(highlight(internals)).not.toBeNull();

    useCadDocumentStore.getState().undo();
    expect(highlight(internals)).toBeNull();

    // Undo/redo always produces a "reset" SourceUpdate (full-doc replace, not a
    // model-patch), so redo must not resurrect the highlight either.
    useCadDocumentStore.getState().redo();
    expect(highlight(internals)).toBeNull();
    controller.destroy();
  });

  it("replaces (does not merge with) an existing highlight when a second model patch arrives", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;

    patchElement("A");
    const first = highlight(internals);
    expect(first).not.toBeNull();

    patchElement("B");
    const second = highlight(internals);
    expect(second).not.toBeNull();
    expect(second).not.toEqual(first);
    controller.destroy();
  });

  it("does not move the cursor or scroll position, and never touches CM undo/redo history", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const line = internals.view.state.doc.line(2);
    internals.view.dispatch({ selection: { anchor: line.from + 3 } });
    internals.view.scrollDOM.scrollTop = 42;
    internals.view.scrollDOM.scrollLeft = 36;

    patchElement("B");

    expect(highlight(internals)).not.toBeNull();
    expect(internals.view.state.selection.main.head).toBe(line.from + 3);
    expect(internals.view.scrollDOM.scrollTop).toBe(42);
    expect(internals.view.scrollDOM.scrollLeft).toBe(36);
    expect(undoDepth(internals.view.state)).toBe(0);
    expect(redoDepth(internals.view.state)).toBe(0);
    controller.destroy();
  });

  it("has no timer: the highlight is still present after simulated time passes with no further transaction", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    patchElement("A");
    expect(highlight(internals)).not.toBeNull();

    vi.advanceTimersByTime(60_000);
    expect(highlight(internals)).not.toBeNull();
    controller.destroy();
  });
});
