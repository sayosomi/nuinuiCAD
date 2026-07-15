import { undoDepth, redoDepth } from "@codemirror/commands";
import { foldedRanges } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import type { CadElement } from "../types/geometry";
import { dispatchCommand } from "../commands/commands";
import { startCommandLineCreation } from "../commands/commandLineSessionCommands";
import { SourceEditorController } from "./sourceEditorController";

type ControllerInternals = {
  view: {
    state: {
      doc: {
        length: number;
        line: (number: number) => { from: number; to: number; text: string };
        lineAt: (position: number) => { from: number; to: number; text: string };
        toString: () => string;
      };
      selection: { main: { head: number; from: number; to: number; empty: boolean }; ranges: readonly unknown[] };
    };
    dispatch: (spec: unknown) => void;
  };
  runUndo: () => boolean;
  runRedo: () => boolean;
  handleFoldGutterMouseDown: (lineFrom: number, event: MouseEvent) => boolean;
  handleValueClick: (event: MouseEvent, view: ControllerInternals["view"]) => boolean;
  navigateValueSpan: (direction: "next" | "previous") => boolean;
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

  it("selects a parameter value without letting selection sync project it back to the line start", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (12, 34)\npoint B = (56, 78)", "test");
    const parent = document.createElement("div");
    document.body.append(parent);
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const element = useCadDocumentStore.getState().elements.find((item) => item.name === "A")!;
    const otherElement = useCadDocumentStore.getState().elements.find((item) => item.name === "B")!;
    const undoBefore = undoDepth(internals.view.state as never);
    const storeHistoryBefore = useCadDocumentStore.getState().past.length;
    useCadUiStore.getState().setSelectedElementId(otherElement.id);

    expect(controller.jumpToParameterValue(element.id, "y")).toBe(true);
    const selection = internals.view.state.selection.main;
    expect(internals.view.state.doc.toString().slice(selection.from, selection.to)).toBe("34");
    expect(useCadUiStore.getState().selectedElementId).toBe(element.id);
    expect(undoDepth(internals.view.state as never)).toBe(undoBefore);
    expect(useCadDocumentStore.getState().past).toHaveLength(storeHistoryBefore);
    expect(parent.contains(document.activeElement)).toBe(true);
    controller.destroy();
    parent.remove();
  });

  it("resolves a dirty intermediate value against its committed statement without selecting another record", () => {
    useCadDocumentStore.getState().commitText([
      "nui 1",
      "point A = (0, 0)",
      "point B = (100, 0)",
      "curve C = A -> B startAngle=0 startLength=1 endAngle=2 endLength=3 intermediates=[(4,5):45:6:7]"
    ].join("\n"), "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const curve = useCadDocumentStore.getState().elements.find((item) => item.name === "C") as Extract<CadElement, { type: "bezierCurve" }>;
    const intermediate = curve.intermediatePoints[0];
    const source = internals.view.state.doc.toString();
    const outgoing = source.lastIndexOf(":7]");
    internals.view.dispatch({ changes: { from: outgoing + 1, to: outgoing + 2, insert: "8" } });

    expect(controller.jumpToParameterValue(curve.id, `intermediate:${intermediate.id}:outgoingHandleLength`)).toBe(true);
    const selection = internals.view.state.selection.main;
    expect(internals.view.state.doc.toString().slice(selection.from, selection.to)).toBe("8");
    controller.destroy();
  });

  it("does not jump or focus while composing", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (12, 34)", "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const element = useCadDocumentStore.getState().elements.find((item) => item.name === "A")!;
    const content = parent.querySelector(".cm-content")!;
    const before = internals.view.state.selection.main.head;
    fireEvent.compositionStart(content);

    expect(controller.jumpToParameterValue(element.id, "y")).toBe(false);
    expect(internals.view.state.selection.main.head).toBe(before);
    expect(parent.contains(document.activeElement)).toBe(false);
    fireEvent.compositionEnd(content);
    controller.destroy();
  });

  it("falls back to the element line for a parameter omitted by DSL defaults", () => {
    useCadDocumentStore.getState().commitText("nui 1\ngroup G {\n}", "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const element = useCadDocumentStore.getState().elements.find((item) => item.name === "G")!;

    expect(controller.jumpToParameterValue(element.id, "printEnabled")).toBe(false);
    expect(internals.view.state.selection.main.head).toBe(internals.view.state.doc.line(2).from);
    controller.destroy();
  });

  it("starts the matching Canvas picker from a complete selected parameter value", () => {
    useCadDocumentStore.getState().commitText([
      "nui 1",
      "point A = (0, 0)",
      "point B = offset A dx=10 dy=20",
      "line AB = A -> B",
      "point Cross = intersection AB AB index=0 extensions=false",
      "line Seam = offset [AB] distance=10 side=left closed=false"
    ].join("\n"), "test");
    const parent = document.createElement("div");
    document.body.append(parent);
    const controller = new SourceEditorController(parent);
    const byName = (name: string) => useCadDocumentStore.getState().elements.find((element) => element.name === name)!;

    const point = byName("B");
    expect(controller.jumpToParameterValue(point.id, "fromPoint")).toBe(true);
    expect(dispatchCommand("startCanvasPickFromSourceSelection")).toBe(true);
    expect(useCadUiStore.getState().activePointPickTarget).toEqual({
      elementId: point.id,
      parameterKey: "fromPoint"
    });

    useCadUiStore.setState({ activePointPickTarget: null });
    expect(controller.jumpToParameterValue(point.id, "dx")).toBe(true);
    expect(dispatchCommand("startCanvasPickFromSourceSelection")).toBe(true);
    expect(useCadUiStore.getState().activeNumericReferencePickTarget).toMatchObject({
      elementId: point.id,
      parameterKey: "dx",
      mode: "replace"
    });

    useCadUiStore.setState({ activeNumericReferencePickTarget: null });
    const cross = byName("Cross");
    expect(controller.jumpToParameterValue(cross.id, "line1Id")).toBe(true);
    expect(dispatchCommand("startCanvasPickFromSourceSelection")).toBe(true);
    expect(useCadUiStore.getState().activeLinePickTarget).toMatchObject({
      elementId: cross.id,
      parameterKey: "line1Id"
    });

    useCadUiStore.setState({ activeLinePickTarget: null });
    const seam = byName("Seam");
    expect(controller.jumpToParameterValue(seam.id, "baseLineIds")).toBe(true);
    expect(dispatchCommand("startCanvasPickFromSourceSelection")).toBe(true);
    expect(useCadUiStore.getState().activeLinePickTarget).toMatchObject({
      elementId: seam.id,
      parameterKey: "baseLineIds",
      draftLineIds: [byName("AB").id]
    });

    controller.destroy();
    parent.remove();
  });

  it("rejects unsupported, partial, multiline, invalid, or already-active Source Editor selections", () => {
    useCadDocumentStore.getState().commitText([
      "nui 1",
      "point A = (0, 0)",
      "point B = offset A dx=10 dy=20"
    ].join("\n"), "test");
    const parent = document.createElement("div");
    document.body.append(parent);
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const point = useCadDocumentStore.getState().elements.find((element) => element.name === "B")!;

    expect(controller.jumpToParameterValue(point.id, "name")).toBe(true);
    expect(dispatchCommand("startCanvasPickFromSourceSelection")).toBe(false);

    expect(controller.jumpToParameterValue(point.id, "dx")).toBe(true);
    const selected = internals.view.state.selection.main;
    internals.view.dispatch({ selection: EditorSelection.single(selected.from, selected.to - 1) });
    expect(dispatchCommand("startCanvasPickFromSourceSelection")).toBe(false);

    internals.view.dispatch({ selection: EditorSelection.single(0, selected.to) });
    expect(dispatchCommand("startCanvasPickFromSourceSelection")).toBe(false);

    expect(controller.jumpToParameterValue(point.id, "dx")).toBe(true);
    useCadUiStore.setState({ activePointPickTarget: { elementId: point.id, parameterKey: "fromPoint" } });
    expect(dispatchCommand("startCanvasPickFromSourceSelection")).toBe(false);
    expect(useCadUiStore.getState().activePointPickTarget).toEqual({ elementId: point.id, parameterKey: "fromPoint" });

    useCadUiStore.setState({ activePointPickTarget: null });
    const valueLine = internals.view.state.doc.lineAt(internals.view.state.selection.main.from);
    internals.view.dispatch({ changes: { from: valueLine.from, to: valueLine.to, insert: "point B = impossible" } });
    expect(dispatchCommand("startCanvasPickFromSourceSelection")).toBe(false);
    expect(useCadUiStore.getState().activeNumericReferencePickTarget).toBeNull();

    controller.destroy();
    parent.remove();
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

  it("cancels an active source creation before CodeMirror undo changes text", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const baseline = internals.view.state.doc.toString();
    expect(startCommandLineCreation("freePoint", { sourceEditorCreation: true })).toBe(true);
    internals.view.dispatch({ changes: { from: internals.view.state.doc.length, insert: "\n# pending" } });

    expect(internals.runUndo()).toBe(true);
    expect(useCadUiStore.getState().commandLineSession).toBeNull();
    expect(internals.view.state.doc.toString()).toBe(`${baseline}\n# pending`);

    expect(internals.runUndo()).toBe(true);
    expect(internals.view.state.doc.toString()).toBe(baseline);
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

describe("SourceEditorController value-span click selection", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const clickEvent = (init?: MouseEventInit) => new MouseEvent("mouseup", { button: 0, ...init });

  const clickAt = (internals: ControllerInternals, pos: number, init?: MouseEventInit) => {
    internals.view.dispatch({ selection: EditorSelection.cursor(pos) });
    return internals.handleValueClick(clickEvent(init), internals.view);
  };

  it("selects the whole value under a plain click ending without movement", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0) length=120", "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const text = internals.view.state.doc.toString();
    const valueStart = text.lastIndexOf("120");

    const handled = clickAt(internals, valueStart + 1);

    expect(handled).toBe(true);
    const selection = internals.view.state.selection.main;
    expect(text.slice(selection.from, selection.to)).toBe("120");
    controller.destroy();
  });

  it("leaves a normal cursor on a click at a non-value position (element name)", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0) length=120", "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const text = internals.view.state.doc.toString();
    const namePos = text.lastIndexOf("point A") + "point ".length;

    const handled = clickAt(internals, namePos);

    expect(handled).toBe(false);
    expect(internals.view.state.selection.main.empty).toBe(true);
    expect(internals.view.state.selection.main.head).toBe(namePos);
    controller.destroy();
  });

  it("does not override a drag-created range selection", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0) length=120", "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const text = internals.view.state.doc.toString();
    const valueStart = text.lastIndexOf("120");
    const dragFrom = valueStart - 4;
    const dragTo = valueStart + 1;

    internals.view.dispatch({ selection: EditorSelection.range(dragFrom, dragTo) });
    const handled = internals.handleValueClick(clickEvent(), internals.view);

    expect(handled).toBe(false);
    expect(internals.view.state.selection.main.from).toBe(dragFrom);
    expect(internals.view.state.selection.main.to).toBe(dragTo);
    controller.destroy();
  });

  // This editor never enables CM's `allowMultipleSelections` (dispatching a multi-range
  // selection collapses to one range), so Mod-click on content never produces a real
  // multi-range CM selection to preserve. The guard that matters in practice is that a
  // modifier-held click must not be hijacked into a value selection at all.
  it("does not select a value on a Mod-click even when the resulting selection is a single collapsed cursor", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0) length=120", "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const text = internals.view.state.doc.toString();
    const valueStart = text.lastIndexOf("120");

    const handled = clickAt(internals, valueStart + 1, { metaKey: true });

    expect(handled).toBe(false);
    expect(internals.view.state.selection.main.empty).toBe(true);
    controller.destroy();
  });

  it("selects against the live dirty buffer, not a stale last-good value", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0) length=120", "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    internals.view.dispatch({ changes: { from: internals.view.state.doc.length, insert: "0" } });
    const text = internals.view.state.doc.toString();
    expect(text.endsWith("length=1200")).toBe(true);

    const handled = clickAt(internals, text.length - 1);

    expect(handled).toBe(true);
    const selection = internals.view.state.selection.main;
    expect(text.slice(selection.from, selection.to)).toBe("1200");
    controller.destroy();
  });

  it("falls through to a normal click when the clicked line fails to parse (fatal-safe)", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0) length=120", "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    // Append a stray "{" mid-line: no longer a valid statement, so no value spans exist.
    internals.view.dispatch({ changes: { from: internals.view.state.doc.length, insert: " {" } });
    const text = internals.view.state.doc.toString();
    const pos = text.lastIndexOf("120") + 1;

    const handled = clickAt(internals, pos);

    expect(handled).toBe(false);
    expect(internals.view.state.selection.main.empty).toBe(true);
    expect(internals.view.state.selection.main.head).toBe(pos);
    controller.destroy();
  });

  it("treats the value span as half-open: a click right after the value keeps a normal cursor", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0) length=120", "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const text = internals.view.state.doc.toString();
    const afterValue = text.lastIndexOf("120") + "120".length;

    const handled = clickAt(internals, afterValue);

    expect(handled).toBe(false);
    expect(internals.view.state.selection.main.empty).toBe(true);
    controller.destroy();
  });

  it("does not add the value-selection dispatch to CM undo history", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0) length=120", "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const text = internals.view.state.doc.toString();
    const valueStart = text.lastIndexOf("120");

    const handled = clickAt(internals, valueStart + 1);

    expect(handled).toBe(true);
    expect(undoDepth(internals.view.state as never)).toBe(0);
    expect(redoDepth(internals.view.state as never)).toBe(0);
    controller.destroy();
  });

  it("does not select a value on a non-element (directive) line like nui", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0) length=120", "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const text = internals.view.state.doc.toString();
    const valuePos = text.indexOf("nui 1") + "nui ".length;

    const handled = clickAt(internals, valuePos);

    expect(handled).toBe(false);
    expect(internals.view.state.selection.main.empty).toBe(true);
    controller.destroy();
  });
});

describe("SourceEditorController Tab/Shift-Tab value-span navigation", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("moves between point X/Y in source order and cycles at both ends", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 10)", "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const text = internals.view.state.doc.toString();
    const xStart = text.lastIndexOf("(") + 1;
    const selected = () => {
      const main = internals.view.state.selection.main;
      return text.slice(main.from, main.to);
    };

    internals.view.dispatch({ selection: EditorSelection.cursor(xStart) });
    expect(internals.navigateValueSpan("next")).toBe(true);
    expect(selected()).toBe("10");
    expect(internals.navigateValueSpan("next")).toBe(true);
    expect(selected()).toBe("0");
    expect(internals.navigateValueSpan("previous")).toBe(true);
    expect(selected()).toBe("10");
    controller.destroy();
  });

  it("does not change the document, CM undo history, or Canvas selection", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 10)", "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const text = internals.view.state.doc.toString();
    const xStart = text.lastIndexOf("(") + 1;
    internals.view.dispatch({ selection: EditorSelection.cursor(xStart) });
    const before = {
      sourceText: useCadDocumentStore.getState().sourceText,
      revision: useCadDocumentStore.getState().compiledDocumentRevision,
      selectedElementId: useCadUiStore.getState().selectedElementId
    };

    expect(internals.navigateValueSpan("next")).toBe(true);

    expect(internals.view.state.doc.toString()).toBe(text);
    expect(undoDepth(internals.view.state as never)).toBe(0);
    expect(redoDepth(internals.view.state as never)).toBe(0);
    expect(useCadDocumentStore.getState().sourceText).toBe(before.sourceText);
    expect(useCadDocumentStore.getState().compiledDocumentRevision).toBe(before.revision);
    expect(useCadUiStore.getState().selectedElementId).toBe(before.selectedElementId);
    controller.destroy();
  });

  it("falls through when the selection spans more than one line", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 10)\npoint B = (1, 1)", "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const lineTwo = internals.view.state.doc.line(2);
    const lineThree = internals.view.state.doc.line(3);
    internals.view.dispatch({ selection: EditorSelection.range(lineTwo.from, lineThree.to) });

    expect(internals.navigateValueSpan("next")).toBe(false);
    controller.destroy();
  });

  it("keeps navigating against the live dirty buffer, not a stale value", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0) length=120", "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    // Uncommitted edit: "length=120" becomes "length=1200" — one character longer than
    // the store's last-good parse still knows about.
    internals.view.dispatch({ changes: { from: internals.view.state.doc.length, insert: "0" } });
    const text = internals.view.state.doc.toString();
    expect(text.endsWith("length=1200")).toBe(true);
    const firstZero = text.indexOf("(0, 0)") + 1;
    internals.view.dispatch({ selection: EditorSelection.cursor(firstZero) });

    // Wrapping backward from the first coordinate should land on the whole dirty,
    // now-4-character value — a stale 3-character "120" span would clip it short.
    expect(internals.navigateValueSpan("previous")).toBe(true);

    const main = internals.view.state.selection.main;
    expect(text.slice(main.from, main.to)).toBe("1200");
    controller.destroy();
  });

  const buildController = () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const content = parent.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("Missing CodeMirror content");
    return { controller, content, parent };
  };

  it("moves the real selection on a real Tab keydown", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 10)", "test");
    const { controller, content } = buildController();
    const text = controller.getText();
    const xStart = text.lastIndexOf("(") + 1;
    const internals = controller as unknown as ControllerInternals;
    internals.view.dispatch({ selection: EditorSelection.cursor(xStart) });

    fireEvent.keyDown(content, { key: "Tab" });

    const main = internals.view.state.selection.main;
    expect(text.slice(main.from, main.to)).toBe("10");
    controller.destroy();
  });

  it("falls through (leaves selection and document untouched) when the line has no values", () => {
    // This app registers no other Tab/Shift-Tab binding (defaultKeymap itself doesn't
    // bind bare Tab — only Mod-]/Mod-[ and the separate, unused indentWithTab preset
    // do), so "falls through" here is observed as our handler declining without
    // producing any side effect, leaving Tab as an ordinary, currently-unclaimed key.
    useCadDocumentStore.getState().commitText("nui 1\n# just a comment", "test");
    const { controller, content } = buildController();
    const internals = controller as unknown as ControllerInternals;
    const commentLine = internals.view.state.doc.line(2);
    internals.view.dispatch({ selection: EditorSelection.cursor(commentLine.from) });
    const before = internals.view.state.doc.toString();

    fireEvent.keyDown(content, { key: "Tab" });

    expect(internals.view.state.doc.toString()).toBe(before);
    expect(internals.view.state.selection.main.empty).toBe(true);
    expect(internals.view.state.selection.main.from).toBe(commentLine.from);
    controller.destroy();
  });

  it("does not navigate a value while the search panel's own input has focus", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 10)", "test");
    const { controller, parent } = buildController();
    const internals = controller as unknown as ControllerInternals;
    const text = internals.view.state.doc.toString();
    const xStart = text.lastIndexOf("(") + 1;
    internals.view.dispatch({ selection: EditorSelection.cursor(xStart) });

    controller.openTextSearch();
    const searchInput = parent.querySelector<HTMLInputElement>(".cm-panels [main-field]");
    expect(searchInput).not.toBeNull();
    fireEvent.keyDown(searchInput!, { key: "Tab" });

    const main = internals.view.state.selection.main;
    expect(main.empty).toBe(true);
    expect(main.from).toBe(xStart);
    controller.destroy();
  });

  it("consumes Tab during composition (no value-jump, no default indent) and recovers after compositionend", async () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 10)", "test");
    const { controller, content } = buildController();
    const internals = controller as unknown as ControllerInternals;
    const text = internals.view.state.doc.toString();
    const xStart = text.lastIndexOf("(") + 1;
    internals.view.dispatch({ selection: EditorSelection.cursor(xStart) });

    fireEvent.compositionStart(content);
    fireEvent.keyDown(content, { key: "Tab" });

    expect(internals.view.state.doc.toString()).toBe(text);
    expect(internals.view.state.selection.main.empty).toBe(true);
    expect(internals.view.state.selection.main.from).toBe(xStart);

    fireEvent.compositionEnd(content);
    // jsdom reports a WebKit navigator.vendor, so CodeMirror applies its Safari IME
    // guard: the first key event within 100ms of compositionend is dropped.
    await new Promise((resolve) => setTimeout(resolve, 110));
    fireEvent.keyDown(content, { key: "Tab" });

    const main = internals.view.state.selection.main;
    expect(text.slice(main.from, main.to)).toBe("10");
    controller.destroy();
  });
});
