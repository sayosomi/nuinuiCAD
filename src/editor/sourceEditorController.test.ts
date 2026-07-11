import { undoDepth, redoDepth } from "@codemirror/commands";
import { foldedRanges } from "@codemirror/language";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { SourceEditorController } from "./sourceEditorController";

type ControllerInternals = {
  view: {
    state: {
      doc: { length: number; line: (number: number) => { from: number }; lineAt: (position: number) => { from: number } };
      selection: { main: { head: number }; ranges: readonly unknown[] };
    };
    dispatch: (spec: unknown) => void;
  };
  runUndo: () => boolean;
  runRedo: () => boolean;
  handleFoldGutterMouseDown: (lineFrom: number, event: MouseEvent) => boolean;
};

describe("SourceEditorController commit and history boundaries", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    vi.useFakeTimers();
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => []
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("clears CM history after an editor commit, store undo/redo, and reset", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const append = (text: string) => internals.view.dispatch({
      changes: { from: internals.view.state.doc.length, insert: text }
    });

    append("\n# burst A");
    expect(undoDepth(internals.view.state as never)).toBeGreaterThan(0);
    internals.runUndo();
    expect(undoDepth(internals.view.state as never)).toBe(0);
    expect(redoDepth(internals.view.state as never)).toBe(0);

    append("\n# burst B");
    vi.advanceTimersByTime(300);
    expect(useCadDocumentStore.getState().sourceText).toContain("# burst B");
    expect(undoDepth(internals.view.state as never)).toBe(0);
    expect(redoDepth(internals.view.state as never)).toBe(0);

    useCadDocumentStore.getState().undo();
    expect(undoDepth(internals.view.state as never)).toBe(0);
    expect(redoDepth(internals.view.state as never)).toBe(0);
    useCadDocumentStore.getState().redo();
    expect(undoDepth(internals.view.state as never)).toBe(0);
    expect(redoDepth(internals.view.state as never)).toBe(0);

    useCadDocumentStore.getState().replaceTextDocument("nui 1\n# reset", {
      currentFilePath: null,
      dirtySinceSave: false
    });
    expect(undoDepth(internals.view.state as never)).toBe(0);
    expect(redoDepth(internals.view.state as never)).toBe(0);
    controller.destroy();
  });

  it("removes only burst B on CM undo, then removes burst A on store undo, verified by text content", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const append = (text: string) => internals.view.dispatch({
      changes: { from: internals.view.state.doc.length, insert: text }
    });
    const baseline = useCadDocumentStore.getState().sourceText;

    append("\n# burst A");
    vi.advanceTimersByTime(300);
    const afterA = useCadDocumentStore.getState().sourceText;
    expect(afterA).toBe(`${baseline}\n# burst A`);

    append("\n# burst B");
    expect(internals.view.state.doc.toString()).toBe(`${afterA}\n# burst B`);
    expect(useCadDocumentStore.getState().sourceText).toBe(afterA);

    internals.runUndo();
    expect(internals.view.state.doc.toString()).toBe(afterA);
    expect(useCadDocumentStore.getState().sourceText).toBe(afterA);

    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().sourceText).toBe(baseline);
    controller.destroy();
  });

  it("never reaches pre-commit CM history across typing, model patch, and store undo/redo cycles", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0)\npoint B = (1, 1)", "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const append = (text: string) => internals.view.dispatch({
      changes: { from: internals.view.state.doc.length, insert: text }
    });
    const cmDepthIsZero = () => {
      expect(undoDepth(internals.view.state as never)).toBe(0);
      expect(redoDepth(internals.view.state as never)).toBe(0);
    };

    for (const cycle of [1, 2, 3]) {
      // typing burst → commit
      append(`\n# cycle ${cycle}`);
      vi.advanceTimersByTime(300);
      const committed = useCadDocumentStore.getState().sourceText;
      expect(committed).toContain(`# cycle ${cycle}`);
      cmDepthIsZero();

      // Canvas-equivalent model patch on the clean editor
      const patched = useCadDocumentStore.getState().elements.map((element) =>
        element.name === "A" ? { ...element, locked: cycle % 2 === 1 } : element
      );
      const result = useCadDocumentStore.getState().commitDocumentChange({ elements: patched });
      expect(result).toEqual({ status: "applied" });
      const afterPatch = useCadDocumentStore.getState().sourceText;
      expect(internals.view.state.doc.toString()).toBe(afterPatch);
      cmDepthIsZero();

      // store undo removes the patch, redo restores it; CM history stays fenced
      useCadDocumentStore.getState().undo();
      expect(useCadDocumentStore.getState().sourceText).toBe(committed);
      expect(internals.view.state.doc.toString()).toBe(committed);
      cmDepthIsZero();
      useCadDocumentStore.getState().redo();
      expect(useCadDocumentStore.getState().sourceText).toBe(afterPatch);
      expect(internals.view.state.doc.toString()).toBe(afterPatch);
      cmDepthIsZero();

      // a fresh dirty burst: CM undo restores exactly the last committed text,
      // never anything from before the commit boundary
      append("\n# transient");
      expect(internals.runUndo()).toBe(true);
      expect(internals.view.state.doc.toString()).toBe(afterPatch);
      expect(useCadDocumentStore.getState().sourceText).toBe(afterPatch);
      cmDepthIsZero();
    }
    controller.destroy();
  });

  it("does not commit a scheduled burst while composing, and resumes after compositionend", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const content = parent.querySelector(".cm-content")!;
    const baseline = useCadDocumentStore.getState().sourceText;

    internals.view.dispatch({
      changes: { from: internals.view.state.doc.length, insert: "\n# a" }
    });
    fireEvent.compositionStart(content);
    vi.advanceTimersByTime(300);
    expect(useCadDocumentStore.getState().sourceText).toBe(baseline);

    fireEvent.compositionEnd(content);
    vi.advanceTimersByTime(300);
    expect(useCadDocumentStore.getState().sourceText).toBe(`${baseline}\n# a`);
    controller.destroy();
  });

  it("blocks CM undo/redo while composing, leaving the doc and store unchanged", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const content = parent.querySelector(".cm-content")!;
    const baseline = useCadDocumentStore.getState().sourceText;

    internals.view.dispatch({
      changes: { from: internals.view.state.doc.length, insert: "\n# a" }
    });
    fireEvent.compositionStart(content);

    expect(internals.runUndo()).toBe(true);
    expect(internals.runRedo()).toBe(true);
    expect(internals.view.state.doc.toString()).toBe(`${baseline}\n# a`);
    expect(useCadDocumentStore.getState().sourceText).toBe(baseline);

    fireEvent.compositionEnd(content);
    controller.destroy();
  });

  it("flushes a blur-blocked commit after compositionend", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const content = parent.querySelector(".cm-content")!;
    const baseline = useCadDocumentStore.getState().sourceText;

    internals.view.dispatch({
      changes: { from: internals.view.state.doc.length, insert: "\n# a" }
    });
    fireEvent.compositionStart(content);
    fireEvent.blur(content);
    expect(useCadDocumentStore.getState().sourceText).toBe(baseline);

    fireEvent.compositionEnd(content);
    expect(useCadDocumentStore.getState().sourceText).toBe(`${baseline}\n# a`);
    controller.destroy();
  });

  it("preserves a CRLF-uniform document through an editor commit round trip", () => {
    useCadDocumentStore.getState().commitText("nui 1\r\npoint A = (0, 0)", "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;

    internals.view.dispatch({
      changes: { from: internals.view.state.doc.length, insert: "\npoint B = (1, 1)" }
    });
    vi.advanceTimersByTime(300);

    const expected = "nui 1\r\npoint A = (0, 0)\r\npoint B = (1, 1)";
    expect(useCadDocumentStore.getState().sourceText).toBe(expected);
    expect(controller.getText()).toBe(expected);
    controller.destroy();
  });

  it("normalizes a mixed-newline document to LF on the first editor commit", () => {
    useCadDocumentStore.getState().commitText("nui 1\r\npoint A = (0, 0)\npoint B = (1, 1)", "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;

    internals.view.dispatch({
      changes: { from: internals.view.state.doc.length, insert: "\npoint C = (2, 2)" }
    });
    vi.advanceTimersByTime(300);

    expect(useCadDocumentStore.getState().sourceText).toBe(
      "nui 1\npoint A = (0, 0)\npoint B = (1, 1)\npoint C = (2, 2)"
    );
    controller.destroy();
  });

  it("flushes pending text on destroy when not composing", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const baseline = useCadDocumentStore.getState().sourceText;

    internals.view.dispatch({
      changes: { from: internals.view.state.doc.length, insert: "\n# pending" }
    });
    expect(useCadDocumentStore.getState().sourceText).toBe(baseline);

    controller.destroy();
    expect(useCadDocumentStore.getState().sourceText).toBe(`${baseline}\n# pending`);
  });

  it("does not throw when destroyed mid-composition, and logs instead of silently committing", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const content = parent.querySelector(".cm-content")!;
    const baseline = useCadDocumentStore.getState().sourceText;

    internals.view.dispatch({
      changes: { from: internals.view.state.doc.length, insert: "\n# ime" }
    });
    fireEvent.compositionStart(content);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => controller.destroy()).not.toThrow();
    expect(errorSpy).toHaveBeenCalled();
    // The in-progress IME input is unrecoverable once the view is destroyed mid-composition.
    expect(useCadDocumentStore.getState().sourceText).toBe(baseline);
  });

  it("pairs an undo snapshot with the cursor line from before the burst, not after", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0)", "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;

    useCadUiStore.getState().setSourceCursorLine(2);

    const beforeLength = internals.view.state.doc.length;
    const insertText = "\npoint B = (1, 1)";
    internals.view.dispatch({
      changes: { from: beforeLength, insert: insertText },
      selection: { anchor: beforeLength + insertText.length }
    });
    expect(useCadUiStore.getState().sourceCursorLine).toBe(3);

    // The cursor keeps moving during the same burst (e.g. arrow-key navigation).
    internals.view.dispatch({ selection: { anchor: 0 } });
    expect(useCadUiStore.getState().sourceCursorLine).toBe(1);

    vi.advanceTimersByTime(300);
    const afterBurstText = useCadDocumentStore.getState().sourceText;

    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().sourceText).toBe("nui 1\npoint A = (0, 0)");
    expect(useCadUiStore.getState().sourceCursorLine).toBe(2);

    useCadDocumentStore.getState().redo();
    expect(useCadDocumentStore.getState().sourceText).toBe(afterBurstText);
    controller.destroy();
  });

  it("keeps Canvas multiple selection as one cursor plus secondary line decoration", () => {
    useCadDocumentStore.getState().commitText(
      "nui 1\npoint A = (0, 0)\npoint B = (1, 1)",
      "test"
    );
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const [pointA, pointB] = useCadDocumentStore.getState().elements;

    useCadUiStore.getState().setSelectedElementIds([pointA.id, pointB.id], pointA.id);

    expect(internals.view.state.selection.ranges).toHaveLength(1);
    expect(internals.view.state.selection.main.head).toBe(internals.view.state.doc.line(2).from);
    expect(parent.querySelectorAll(".cm-secondary-selection")).toHaveLength(1);

    internals.view.dispatch({ changes: { from: internals.view.state.selection.main.head, insert: "# " } });
    expect((internals.view.state.doc as unknown as { toString: () => string }).toString()).toContain("# point A");
    expect((internals.view.state.doc as unknown as { toString: () => string }).toString()).toContain("point B = (1, 1)");
    controller.destroy();
  });

  it("uses mapped ranges for unnamed elements after a fatal editor commit", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0)\npoint = (1, 1)", "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const unnamed = useCadDocumentStore.getState().elements.find((element) => element.name === "")!;

    internals.view.dispatch({ changes: { from: 0, insert: "# dirty\n" } });
    internals.view.dispatch({ changes: { from: 8, to: 9, insert: "x" } });
    vi.advanceTimersByTime(300);
    expect(useCadDocumentStore.getState().docText).not.toBe(useCadDocumentStore.getState().sourceText);

    useCadUiStore.getState().setSelectedElementId(unnamed.id);
    expect(internals.view.state.selection.main.head).toBe(internals.view.state.doc.line(4).from);
    controller.destroy();
  });

  it("defers Canvas cursor and fold projection until composition ends", () => {
    useCadDocumentStore.getState().commitText("nui 1\ngroup G {\n  point A = (0, 0)\n}\npoint B = (1, 1)", "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const content = parent.querySelector(".cm-content")!;
    const [group, pointA, pointB] = useCadDocumentStore.getState().elements;

    useCadUiStore.getState().setSelectedElementId(pointA.id);
    fireEvent.compositionStart(content);
    useCadUiStore.getState().setSelectedElementId(pointB.id);
    useCadUiStore.getState().setGroupFold(group.id, { expanded: false });

    expect(internals.view.state.selection.main.head).toBe(internals.view.state.doc.line(3).from);
    expect(foldedRanges(internals.view.state as never).size).toBe(0);

    fireEvent.compositionEnd(content);
    expect(internals.view.state.selection.main.head).toBe(internals.view.state.doc.line(5).from);
    expect(foldedRanges(internals.view.state as never).size).toBeGreaterThan(0);
    controller.destroy();
  });

  it("uses dirty mapped fold positions rather than stale statement line numbers", () => {
    useCadDocumentStore.getState().commitText("nui 1\ngroup G {\n  point A = (0, 0)\n}", "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const group = useCadDocumentStore.getState().elements.find((element) => element.name === "G")!;

    internals.view.dispatch({ changes: { from: 0, insert: "# dirty\n" } });
    const handled = internals.handleFoldGutterMouseDown(internals.view.state.doc.line(3).from, new MouseEvent("mousedown"));

    expect(handled).toBe(true);
    expect(useCadUiStore.getState().groupFoldById.get(group.id)?.expanded).toBe(true);
    expect(foldedRanges(internals.view.state as never).size).toBe(0);
    controller.destroy();
  });

  it("projects nested group and else folds from cadUiStore, expanding ancestors before an external jump", () => {
    useCadDocumentStore.getState().commitText([
      "nui 1",
      "group Outer {",
      "  if Branch condition=1 {",
      "    point Then = (0, 0)",
      "  } else {",
      "    group Inner {",
      "      point Else = (1, 1)",
      "    }",
      "  }",
      "}"
    ].join("\n"), "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const elements = useCadDocumentStore.getState().elements;
    const outer = elements.find((element) => element.name === "Outer")!;
    const branch = elements.find((element) => element.name === "Branch")!;
    const inner = elements.find((element) => element.name === "Inner")!;
    const elsePoint = elements.find((element) => element.name === "Else")!;

    useCadUiStore.getState().setGroupFold(branch.id, { elseExpanded: false });
    useCadUiStore.getState().setSelectedElementId(elsePoint.id);

    expect(useCadUiStore.getState().groupFoldById.get(outer.id)?.expanded).toBe(true);
    expect(useCadUiStore.getState().groupFoldById.get(branch.id)).toMatchObject({ expanded: true, elseExpanded: true });
    expect(useCadUiStore.getState().groupFoldById.get(inner.id)?.expanded).toBe(true);
    expect(internals.view.state.selection.main.head).toBe(internals.view.state.doc.line(7).from);

    internals.handleFoldGutterMouseDown(internals.view.state.doc.line(6).from, new MouseEvent("mousedown"));
    expect(useCadUiStore.getState().groupFoldById.get(inner.id)?.expanded).toBe(false);
    expect(foldedRanges(internals.view.state as never).size).toBeGreaterThan(0);
    controller.destroy();
  });
});
