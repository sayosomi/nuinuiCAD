import { undoDepth, redoDepth } from "@codemirror/commands";
import { foldedRanges } from "@codemirror/language";
import { EditorSelection, Transaction } from "@codemirror/state";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import type { CadElement } from "../types/geometry";
import type { DslDocumentData } from "../dsl/dslDocument";
import { dslTextForElements } from "../dsl/dslDocumentTestUtils";
import { dispatchCommand } from "../commands/commands";
import { startCommandLineCreation } from "../commands/commandLineSessionCommands";
import { SourceEditorController } from "./sourceEditorController";

const freePoint = (id: string, name: string, x: number, y: number): DslDocumentData["elements"][number] => ({
  id, name, type: "freePoint", activity: "visible", x, y
});

const onePointSource = (x = 0, y = 0) => dslTextForElements([freePoint("a", "A", x, y)]);

const twoPointSource = (a: [number, number] = [0, 0], b: [number, number] = [1, 1]) => dslTextForElements([
  freePoint("a", "A", a[0], a[1]),
  freePoint("b", "B", b[0], b[1])
]);

// value-span click/nav tests系: 文書末尾を数値"120"で終わらせる(文末への
// 文字追記でその場が"1200"に伸びる、という各テストの前提を保つため)。
const numericValueSource = () => dslTextForElements([
  freePoint("a", "A", 0, 0),
  { id: "b", name: "B", type: "offsetPoint", activity: "visible", fromPoint: { mode: "reference", pointId: "a" }, dx: 0, dy: 120 }
]);

type ControllerInternals = {
  statementRanges: ReadonlyMap<string, {
    from: number;
    to: number;
    statement: { closeBraceLine?: number };
    foldTargets: Array<{ branch: "statement" | "primary" | "else"; gutterLineFrom: number; foldFrom: number; foldTo: number }>;
  }>;
  view: {
    state: {
      doc: {
        length: number;
        lines: number;
        line: (number: number) => { number: number; from: number; to: number; text: string };
        lineAt: (position: number) => { number: number; from: number; to: number; text: string };
        toString: () => string;
      };
      selection: { main: { head: number; from: number; to: number; empty: boolean }; ranges: readonly unknown[] };
    };
    dispatch: (spec: unknown) => void;
  };
  runUndo: () => boolean;
  runRedo: () => boolean;
  changeAllFolds: (expanded: boolean) => boolean;
  handleFoldGutterClick: (lineFrom: number, event: MouseEvent) => boolean;
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
    useCadDocumentStore.getState().commitText(twoPointSource([12, 34], [56, 78]), "test");
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

  it("places a creation-return cursor after a group's complete closing structure", () => {
    useCadDocumentStore.getState().commitText([
      "nui 3",
      "if 分岐 (1) {",
      "  point A = coordinate(x: 0, y: 0)",
      "} else {",
      "  point B = coordinate(x: 1, y: 1)",
      "}",
      "point C = coordinate(x: 2, y: 2)"
    ].join("\n"), "test");
    const parent = document.createElement("div");
    document.body.append(parent);
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const group = useCadDocumentStore.getState().elements.find((element) => element.name === "分岐")!;

    expect(internals.statementRanges.get(group.id)?.foldTargets).toEqual(expect.arrayContaining([
      expect.objectContaining({ branch: "primary" }),
      expect.objectContaining({ branch: "else" })
    ]));

    expect(controller.jumpToElementEnd(group.id)).toBe(true);

    const { head } = internals.view.state.selection.main;
    const source = internals.view.state.doc.toString();
    expect(source.slice(0, head)).toMatch(/\n}$/);
    expect(useCadUiStore.getState().selectedElementId).toBe(group.id);
    expect(parent.contains(document.activeElement)).toBe(true);
    controller.destroy();
    parent.remove();
  });

  it("uses the mapped statement end when an uncommitted deletion makes closeBraceLine stale", () => {
    useCadDocumentStore.getState().commitText([
      "nui 3",
      "# 上方の未commit行",
      "group G {",
      "  point A = coordinate(x: 0, y: 0)",
      "}",
      "point B = coordinate(x: 1, y: 1)"
    ].join("\n"), "test");
    const parent = document.createElement("div");
    document.body.append(parent);
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const group = useCadDocumentStore.getState().elements.find((element) => element.name === "G")!;
    const originalRange = internals.statementRanges.get(group.id)!;
    const removedLine = internals.view.state.doc.line(2);

    internals.view.dispatch({ changes: { from: removedLine.from, to: removedLine.to + 1, insert: "" } });

    const mappedRange = internals.statementRanges.get(group.id)!;
    expect(originalRange.statement.closeBraceLine).toBeLessThanOrEqual(internals.view.state.doc.lines);
    let jumped = false;
    expect(() => { jumped = controller.jumpToElementEnd(group.id); }).not.toThrow();
    expect(jumped).toBe(true);
    expect(internals.view.state.selection.main.head).toBe(mappedRange.to);
    controller.destroy();
    parent.remove();
  });

  it("rejects an invalid mapped range without changing selection or focus", () => {
    useCadDocumentStore.getState().commitText([
      "nui 3",
      "group G {",
      "  point A = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n"), "test");
    const parent = document.createElement("div");
    document.body.append(parent);
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const group = useCadDocumentStore.getState().elements.find((element) => element.name === "G")!;
    const range = internals.statementRanges.get(group.id)!;
    const before = internals.view.state.selection.main.head;
    (internals as unknown as { statementRanges: Map<string, unknown> }).statementRanges = new Map([
      [group.id, { ...range, from: -1, to: internals.view.state.doc.length + 1 }]
    ]);

    expect(controller.jumpToElementEnd(group.id)).toBe(false);
    expect(internals.view.state.selection.main.head).toBe(before);
    expect(parent.contains(document.activeElement)).toBe(false);
    controller.destroy();
    parent.remove();
  });

  it("resolves a dirty intermediate value against its committed statement without selecting another record", () => {
    useCadDocumentStore.getState().commitText(dslTextForElements([
      freePoint("a", "A", 0, 0),
      freePoint("b", "B", 100, 0),
      {
        id: "c", name: "C", type: "bezierCurve", activity: "visible",
        startPoint: { mode: "reference", pointId: "a" }, startHandleAngleDeg: 0, startHandleLength: 1,
        endPoint: { mode: "reference", pointId: "b" }, endHandleAngleDeg: 2, endHandleLength: 3,
        intermediatePoints: [{
          id: "pt1", point: { mode: "coordinate", x: 4, y: 5 }, handleAngleDeg: 45, incomingHandleLength: 6, outgoingHandleLength: 7
        }]
      }
    ]), "test");
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
    useCadDocumentStore.getState().commitText(onePointSource(12, 34), "test");
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

  it("does not move the creation-return cursor during composition, then moves after compositionend", () => {
    useCadDocumentStore.getState().commitText([
      "nui 3",
      "group G {",
      "  point A = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n"), "test");
    const parent = document.createElement("div");
    document.body.append(parent);
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const group = useCadDocumentStore.getState().elements.find((element) => element.name === "G")!;
    const content = parent.querySelector(".cm-content")!;
    const before = internals.view.state.selection.main.head;

    fireEvent.compositionStart(content);
    expect(controller.jumpToElementEnd(group.id)).toBe(false);
    expect(internals.view.state.selection.main.head).toBe(before);
    expect(parent.contains(document.activeElement)).toBe(false);

    fireEvent.compositionEnd(content);
    expect(controller.jumpToElementEnd(group.id)).toBe(true);
    expect(internals.view.state.selection.main.head).toBe(internals.view.state.doc.line(4).to);
    expect(parent.contains(document.activeElement)).toBe(true);
    controller.destroy();
    parent.remove();
  });

  it("falls back to the element line for a parameter omitted by DSL defaults", () => {
    useCadDocumentStore.getState().commitText(dslTextForElements([
      { id: "g", name: "G", type: "group", activity: "visible" }
    ]), "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const element = useCadDocumentStore.getState().elements.find((item) => item.name === "G")!;

    expect(controller.jumpToParameterValue(element.id, "printEnabled")).toBe(false);
    expect(internals.view.state.selection.main.head).toBe(internals.view.state.doc.line(2).from);
    controller.destroy();
  });

  it("starts the matching Canvas picker from a complete selected parameter value", () => {
    useCadDocumentStore.getState().commitText(dslTextForElements([
      freePoint("a", "A", 0, 0),
      { id: "b", name: "B", type: "offsetPoint", activity: "visible", fromPoint: { mode: "reference", pointId: "a" }, dx: 10, dy: 20 },
      { id: "ab", name: "AB", type: "line", activity: "visible", startPoint: { mode: "reference", pointId: "a" }, endPoint: { mode: "reference", pointId: "b" } },
      { id: "cross", name: "Cross", type: "intersectionPoint", activity: "visible", line1Id: "ab", line2Id: "ab", intersectionIndex: 0, useExtensions: false },
      { id: "seam", name: "Seam", type: "offsetLine", activity: "visible", baseLineIds: ["ab"], offset: 10, side: "left", closed: false }
    ]), "test");
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

  it("opens the rename prompt from its explicit F2 function-key binding", () => {
    useCadDocumentStore.getState().commitText(onePointSource(12, 34), "test");
    const parent = document.createElement("div");
    document.body.append(parent);
    const controller = new SourceEditorController(parent);
    const element = useCadDocumentStore.getState().elements.find((item) => item.name === "A")!;
    useCadUiStore.getState().setSelectedElementIds([element.id]);

    fireEvent.keyDown(parent.querySelector(".cm-content")!, { key: "F2" });
    expect(useCadUiStore.getState().renameElementPromptTargetId).toBe(element.id);

    controller.destroy();
    parent.remove();
  });

  it("rejects unsupported, partial, multiline, invalid, or already-active Source Editor selections", () => {
    useCadDocumentStore.getState().commitText(dslTextForElements([
      freePoint("a", "A", 0, 0),
      { id: "b", name: "B", type: "offsetPoint", activity: "visible", fromPoint: { mode: "reference", pointId: "a" }, dx: 10, dy: 20 }
    ]), "test");
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

  it("uses document Undo/Redo after a local Undo reaches the committed boundary", () => {
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
    expect(undoDepth(internals.view.state as never)).toBe(0);
    expect(redoDepth(internals.view.state as never)).toBe(0);

    // The second Cmd/Ctrl+Z is clean-editor document Undo, not a failed
    // CodeMirror operation. Cmd/Ctrl+Y and Cmd/Ctrl+Shift+Z share runRedo.
    internals.runUndo();
    expect(useCadDocumentStore.getState().sourceText).toBe(baseline);
    expect(internals.view.state.doc.toString()).toBe(baseline);
    internals.runRedo();
    expect(useCadDocumentStore.getState().sourceText).toBe(afterA);
    expect(internals.view.state.doc.toString()).toBe(afterA);
    expect(undoDepth(internals.view.state as never)).toBe(0);
    expect(redoDepth(internals.view.state as never)).toBe(0);
    controller.destroy();
  });

  it("does not fall through to document Undo when a dirty buffer has no local history entry", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const baseline = useCadDocumentStore.getState().sourceText;
    useCadDocumentStore.getState().commitText(`${baseline}\n# document history`, "test");
    const committed = useCadDocumentStore.getState().sourceText;
    const revision = useCadDocumentStore.getState().sourceRevision;
    const pastLength = useCadDocumentStore.getState().past.length;

    internals.view.dispatch({
      changes: { from: internals.view.state.doc.length, insert: "\n# uncommitted" },
      annotations: Transaction.addToHistory.of(false)
    });
    expect(undoDepth(internals.view.state as never)).toBe(0);

    expect(internals.runUndo()).toBe(true);
    expect(internals.view.state.doc.toString()).toBe(`${committed}\n# uncommitted`);
    expect(useCadDocumentStore.getState().sourceText).toBe(committed);
    expect(useCadDocumentStore.getState().sourceRevision).toBe(revision);
    expect(useCadDocumentStore.getState().past).toHaveLength(pastLength);
    controller.destroy();
  });

  it("cancels an active source creation before CodeMirror undo changes text", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const baseline = internals.view.state.doc.toString();
    expect(startCommandLineCreation("freePoint")).toBe(true);
    internals.view.dispatch({ changes: { from: internals.view.state.doc.length, insert: "\n# pending" } });

    expect(internals.runUndo()).toBe(true);
    expect(useCadUiStore.getState().commandLineSession).toBeNull();
    expect(internals.view.state.doc.toString()).toBe(`${baseline}\n# pending`);

    expect(internals.runUndo()).toBe(true);
    expect(internals.view.state.doc.toString()).toBe(baseline);
    controller.destroy();
  });

  it("never reaches pre-commit CM history across typing, model patch, and store undo/redo cycles", () => {
    useCadDocumentStore.getState().commitText(twoPointSource(), "test");
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
        element.name === "A" ? { ...element, activity: cycle % 2 === 0 ? "visible" as const : "disabled" as const } : element
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
    const initial = onePointSource(0, 0).replace(/\n/g, "\r\n");
    useCadDocumentStore.getState().commitText(initial, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;

    internals.view.dispatch({
      changes: { from: internals.view.state.doc.length, insert: "\npoint B = (1, 1)" }
    });
    vi.advanceTimersByTime(300);

    const expected = `${initial}\r\npoint B = (1, 1)`;
    expect(useCadDocumentStore.getState().sourceText).toBe(expected);
    expect(controller.getText()).toBe(expected);
    controller.destroy();
  });

  it("normalizes a mixed-newline document to LF on the first editor commit", () => {
    const lfSource = twoPointSource();
    // 先頭改行だけCRLFにし、以降はLFのまま(混在改行の入力を再現する)。
    const mixed = lfSource.replace("\n", "\r\n");
    useCadDocumentStore.getState().commitText(mixed, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;

    internals.view.dispatch({
      changes: { from: internals.view.state.doc.length, insert: "\npoint C = (2, 2)" }
    });
    vi.advanceTimersByTime(300);

    expect(useCadDocumentStore.getState().sourceText).toBe(`${lfSource}\npoint C = (2, 2)`);
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
    const baseline = onePointSource(0, 0);
    useCadDocumentStore.getState().commitText(baseline, "test");
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
    // onePointSource's v2 canonical call spans 5 physical lines (nui + header
    // + x + y + close), so the appended line is line 6, not v1's line 3.
    expect(useCadUiStore.getState().sourceCursorLine).toBe(6);

    // The cursor keeps moving during the same burst (e.g. arrow-key navigation).
    internals.view.dispatch({ selection: { anchor: 0 } });
    expect(useCadUiStore.getState().sourceCursorLine).toBe(1);

    vi.advanceTimersByTime(300);
    const afterBurstText = useCadDocumentStore.getState().sourceText;

    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().sourceText).toBe(baseline);
    expect(useCadUiStore.getState().sourceCursorLine).toBe(2);

    useCadDocumentStore.getState().redo();
    expect(useCadDocumentStore.getState().sourceText).toBe(afterBurstText);
    controller.destroy();
  });

  it("keeps Canvas multiple selection as one cursor plus secondary line decoration", () => {
    useCadDocumentStore.getState().commitText(
      "nui 3\npoint A = coordinate(x: 0, y: 0)\npoint B = coordinate(x: 1, y: 1)",
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
    expect((internals.view.state.doc as unknown as { toString: () => string }).toString()).toContain("point B = coordinate(x: 1, y: 1)");
    controller.destroy();
  });

  it("uses mapped ranges for unnamed elements after a fatal editor commit", () => {
    useCadDocumentStore.getState().commitText(dslTextForElements([
      freePoint("a", "A", 0, 0),
      freePoint("u", "", 1, 1)
    ]), "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const unnamed = useCadDocumentStore.getState().elements.find((element) => element.name === "")!;

    internals.view.dispatch({ changes: { from: 0, insert: "# dirty\n" } });
    internals.view.dispatch({ changes: { from: 8, to: 9, insert: "x" } });
    vi.advanceTimersByTime(300);
    expect(useCadDocumentStore.getState().docText).not.toBe(useCadDocumentStore.getState().sourceText);

    useCadUiStore.getState().setSelectedElementId(unnamed.id);
    // The unnamed element's v2 canonical call starts at physical line 6
    // (nui + A's 4-line call), +1 for the dirty line inserted at doc start.
    expect(internals.view.state.selection.main.head).toBe(internals.view.state.doc.line(7).from);
    controller.destroy();
  });

  it("defers Canvas cursor and fold projection until composition ends", () => {
    const source = dslTextForElements([
      { id: "g", name: "G", type: "group", activity: "visible" },
      { ...freePoint("a", "A", 0, 0), parentGroupId: "g" },
      freePoint("b", "B", 1, 1)
    ]);
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const content = parent.querySelector(".cm-content")!;
    const [group, pointA, pointB] = useCadDocumentStore.getState().elements;
    const lines = source.split("\n");
    const lineOfA = lines.findIndex((line) => line.includes("point A")) + 1;
    const lineOfB = lines.findIndex((line) => line.includes("point B")) + 1;

    useCadUiStore.getState().setSelectedElementId(pointA.id);
    fireEvent.compositionStart(content);
    useCadUiStore.getState().setSelectedElementId(pointB.id);
    useCadUiStore.getState().setGroupFold(group.id, { expanded: false });

    expect(internals.view.state.selection.main.head).toBe(internals.view.state.doc.line(lineOfA).from);
    expect(foldedRanges(internals.view.state as never).size).toBe(0);

    fireEvent.compositionEnd(content);
    expect(internals.view.state.selection.main.head).toBe(internals.view.state.doc.line(lineOfB).from);
    expect(foldedRanges(internals.view.state as never).size).toBeGreaterThan(0);
    controller.destroy();
  });

  it("uses dirty mapped fold positions rather than stale statement line numbers", () => {
    const source = dslTextForElements([
      { id: "g", name: "G", type: "group", activity: "visible" },
      { ...freePoint("a", "A", 0, 0), parentGroupId: "g" }
    ]);
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const group = useCadDocumentStore.getState().elements.find((element) => element.name === "G")!;
    // foldTargetAtLineは開き括弧「{」自体の行を見る(openBraceLineFrom)。v2正準形
    // では「{」はヘッダ行自体の末尾に乗る(次行単独の「{」ではない)ため、
    // 「group G」ヘッダ行そのもの、さらに先頭に1行挿入した分+1。
    const openBraceLineAfterDirtyInsert = source.split("\n").findIndex((line) => line.includes("group G")) + 2;

    internals.view.dispatch({ changes: { from: 0, insert: "# dirty\n" } });
    const handled = internals.handleFoldGutterClick(internals.view.state.doc.line(openBraceLineAfterDirtyInsert).from, new MouseEvent("mousedown"));

    expect(handled).toBe(true);
    expect(useCadUiStore.getState().groupFoldById.get(group.id)?.expanded).toBe(true);
    expect(foldedRanges(internals.view.state as never).size).toBe(0);
    controller.destroy();
  });

  it("unfolds an invalidated dirty target instead of retaining a stale brace row", () => {
    const source = ["nui 3", "group G {", "  point A = coordinate(x: 0, y: 0)", "}"].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const openBrace = internals.view.state.doc.toString().indexOf("{");

    expect(foldedRanges(internals.view.state as never).size).toBeGreaterThan(0);
    internals.view.dispatch({ changes: { from: openBrace, to: openBrace + 1, insert: "[" } });

    expect(foldedRanges(internals.view.state as never).size).toBe(0);
    controller.destroy();
  });

  it("projects nested group and else folds from cadUiStore, expanding ancestors before an external jump", () => {
    const source = dslTextForElements([
      { id: "outer", name: "Outer", type: "group", activity: "visible" },
      { id: "branch", name: "Branch", type: "conditionalGroup", activity: "visible", condition: 1, parentGroupId: "outer" },
      { id: "then", name: "Then", type: "freePoint", activity: "visible", x: 0, y: 0, parentGroupId: "branch", conditionalBranch: "then" },
      { id: "inner", name: "Inner", type: "group", activity: "visible", parentGroupId: "branch", conditionalBranch: "else" },
      { id: "else", name: "Else", type: "freePoint", activity: "visible", x: 1, y: 1, parentGroupId: "inner" }
    ]);
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const elements = useCadDocumentStore.getState().elements;
    const outer = elements.find((element) => element.name === "Outer")!;
    const branch = elements.find((element) => element.name === "Branch")!;
    const inner = elements.find((element) => element.name === "Inner")!;
    const elsePoint = elements.find((element) => element.name === "Else")!;
    const lines = source.split("\n");
    const lineOfElse = lines.findIndex((line) => line.includes("point Else")) + 1;
    // foldTargetAtLineは開き括弧「{」自体の行を見る(openBraceLineFrom)。v2正準形
    // では「{」がヘッダ行自体の末尾に乗るため、「group Inner」ヘッダ行そのものを対象にする。
    const innerOpenBraceLine = lines.findIndex((line) => line.includes("group Inner")) + 1;

    useCadUiStore.getState().setGroupFold(branch.id, { elseExpanded: false });
    useCadUiStore.getState().setSelectedElementId(elsePoint.id);

    expect(useCadUiStore.getState().groupFoldById.get(outer.id)?.expanded).toBe(true);
    expect(useCadUiStore.getState().groupFoldById.get(branch.id)).toMatchObject({ elseExpanded: true });
    expect(useCadUiStore.getState().groupFoldById.get(inner.id)?.expanded).toBe(true);
    expect(internals.view.state.selection.main.head).toBe(internals.view.state.doc.line(lineOfElse).from);

    internals.handleFoldGutterClick(internals.view.state.doc.line(innerOpenBraceLine).from, new MouseEvent("mousedown"));
    expect(useCadUiStore.getState().groupFoldById.get(inner.id)?.expanded).toBe(false);
    expect(foldedRanges(internals.view.state as never).size).toBeGreaterThan(0);
    controller.destroy();
  });

  it("folds and unfolds every currently valid conditional target", () => {
    const source = [
      "nui 3",
      "if Choice (1) {",
      "  point Then = coordinate(x: 0, y: 0)",
      "} else {",
      "  point Else = coordinate(x: 1, y: 1)",
      "}"
    ].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const conditional = useCadDocumentStore.getState().elements[0]!;

    expect(internals.changeAllFolds(false)).toBe(true);
    expect(useCadUiStore.getState().groupFoldById.get(conditional.id)).toMatchObject({
      expanded: false,
      elseExpanded: false
    });
    expect(foldedRanges(internals.view.state as never).size).toBe(2);

    expect(internals.changeAllFolds(true)).toBe(true);
    expect(useCadUiStore.getState().groupFoldById.get(conditional.id)).toMatchObject({
      expanded: true,
      elseExpanded: true
    });
    expect(foldedRanges(internals.view.state as never).size).toBe(0);
    controller.destroy();
  });

  it("folds a multiline statement from its opening line while keeping its closing row visible", () => {
    const source = [
      "nui 3",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(",
      "  from: A,",
      "  dx: 100,",
      "  dy: 0",
      ")"
    ].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const pointB = useCadDocumentStore.getState().elements.find((element) => element.name === "B")!;
    const openingLine = internals.view.state.doc.line(3);
    const closeLine = internals.view.state.doc.line(7);

    expect(internals.handleFoldGutterClick(openingLine.from, new MouseEvent("mousedown"))).toBe(true);
    expect(useCadUiStore.getState().groupFoldById.get(pointB.id)?.statementExpanded).toBe(false);
    const ranges: Array<{ from: number; to: number }> = [];
    foldedRanges(internals.view.state as never).between(0, internals.view.state.doc.length, (from, to) => {
      ranges.push({ from, to });
    });
    expect(ranges).toEqual([{ from: openingLine.to, to: closeLine.from }]);

    expect(internals.handleFoldGutterClick(openingLine.from, new MouseEvent("mousedown"))).toBe(true);
    expect(foldedRanges(internals.view.state as never).size).toBe(0);
    controller.destroy();
  });

  it("expands only the statement target when jumping to a parameter inside a folded multiline statement", () => {
    const source = [
      "nui 3",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(",
      "  from: A,",
      "  dx: 100,",
      "  dy: 0",
      ")",
      "group G {",
      "  point C = coordinate(x: 2, y: 2)",
      "}"
    ].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    document.body.append(parent);
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const pointB = useCadDocumentStore.getState().elements.find((element) => element.name === "B")!;
    const group = useCadDocumentStore.getState().elements.find((element) => element.name === "G")!;
    const openingLine = internals.view.state.doc.line(3);
    const closeLine = internals.view.state.doc.line(7);

    useCadUiStore.getState().setFoldTargetExpanded({ elementId: pointB.id, branch: "statement" }, false);
    const foldedBefore: Array<{ from: number; to: number }> = [];
    foldedRanges(internals.view.state as never).between(0, internals.view.state.doc.length, (from, to) => {
      foldedBefore.push({ from, to });
    });
    expect(foldedBefore).toContainEqual({ from: openingLine.to, to: closeLine.from });

    expect(controller.jumpToParameterValue(pointB.id, "dx")).toBe(true);

    expect(useCadUiStore.getState().groupFoldById.get(pointB.id)?.statementExpanded).toBe(true);
    expect(useCadUiStore.getState().groupFoldById.get(group.id)).toBeUndefined();
    const head = internals.view.state.selection.main.head;
    expect(head).toBeGreaterThan(openingLine.to);
    expect(head).toBeLessThan(closeLine.from);
    const ranges: Array<{ from: number; to: number }> = [];
    foldedRanges(internals.view.state as never).between(0, internals.view.state.doc.length, (from, to) => {
      ranges.push({ from, to });
    });
    expect(ranges).not.toContainEqual({ from: openingLine.to, to: closeLine.from });

    controller.destroy();
    parent.remove();
  });

  it("renders a fold gutter marker for an initially expanded multiline statement", () => {
    const source = [
      "nui 3",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(",
      "  from: A",
      ")"
    ].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);

    expect(parent.querySelector(".cm-foldGutter")?.textContent).toContain("⌄");
    controller.destroy();
  });

  it("folds every physical row of a vertical child statement", () => {
    const source = dslTextForElements([
      { id: "g", name: "G", type: "group", activity: "visible" },
      { ...freePoint("a", "A", 0, 0), parentGroupId: "g" }
    ]);
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const group = useCadDocumentStore.getState().elements.find((element) => element.name === "G")!;
    const lines = internals.view.state.doc.toString().split("\n");
    const childHeader = internals.view.state.doc.line(lines.findIndex((line) => line.includes("point A =")) + 1);
    const childClose = internals.view.state.doc.line(childHeader.number + 3);

    useCadUiStore.getState().setGroupFold(group.id, { expanded: false });
    const ranges: Array<{ from: number; to: number }> = [];
    foldedRanges(internals.view.state as never).between(0, internals.view.state.doc.length, (from, to) => {
      ranges.push({ from, to });
    });
    expect(ranges.some((range) => range.from <= childHeader.from && range.to >= childClose.to)).toBe(true);
    controller.destroy();
  });

  it("consumes gutter clicks on lines without a fold target", () => {
    const source = ["nui 3", "point A = coordinate(x: 0, y: 0)"].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const foldedBefore = foldedRanges(internals.view.state as never).size;
    const foldsBefore = useCadUiStore.getState().groupFoldById;
    const event = new MouseEvent("mousedown", { cancelable: true });

    const handled = internals.handleFoldGutterClick(internals.view.state.doc.line(1).from, event);

    expect(handled).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(foldedRanges(internals.view.state as never).size).toBe(foldedBefore);
    expect(useCadUiStore.getState().groupFoldById).toBe(foldsBefore);
    controller.destroy();
  });

  it("applies Fold All and Unfold All as a single store update", () => {
    const source = [
      "nui 3",
      "if Choice (1) {",
      "  point Then = coordinate(x: 0, y: 0)",
      "} else {",
      "  point Else = coordinate(x: 1, y: 1)",
      "}",
      "point B = offset(",
      "  from: Then,",
      "  dx: 100,",
      "  dy: 0",
      ")"
    ].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const conditional = useCadDocumentStore.getState().elements.find((element) => element.name === "Choice")!;
    const pointB = useCadDocumentStore.getState().elements.find((element) => element.name === "B")!;
    const targetCount = [...internals.statementRanges.values()]
      .reduce((sum, range) => sum + range.foldTargets.length, 0);
    expect(targetCount).toBe(3);

    let count = 0;
    const unsub = useCadUiStore.subscribe(() => { count += 1; });

    expect(internals.changeAllFolds(false)).toBe(true);
    expect(count).toBe(1);
    expect(useCadUiStore.getState().groupFoldById.get(conditional.id)).toMatchObject({
      expanded: false,
      elseExpanded: false
    });
    expect(useCadUiStore.getState().groupFoldById.get(pointB.id)?.statementExpanded).toBe(false);
    expect(foldedRanges(internals.view.state as never).size).toBe(targetCount);

    count = 0;
    expect(internals.changeAllFolds(true)).toBe(true);
    expect(count).toBe(1);
    expect(foldedRanges(internals.view.state as never).size).toBe(0);

    unsub();
    controller.destroy();
  });

  it("unfolds via a placeholder click through the app fold state", () => {
    const source = ["nui 3", "group G {", "  point A = coordinate(x: 0, y: 0)", "}"].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    document.body.append(parent);
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const group = useCadDocumentStore.getState().elements.find((element) => element.name === "G")!;

    const placeholder = parent.querySelector<HTMLElement>(".cm-foldPlaceholder");
    expect(placeholder).not.toBeNull();
    placeholder!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(useCadUiStore.getState().groupFoldById.get(group.id)?.expanded).toBe(true);
    expect(foldedRanges(internals.view.state as never).size).toBe(0);
    controller.destroy();
    parent.remove();
  });

  it("keeps a child statement fold independent of its parent group fold", () => {
    const source = [
      "nui 3",
      "point A = coordinate(x: 0, y: 0)",
      "group G {",
      "  point B = offset(",
      "    from: A,",
      "    dx: 100,",
      "    dy: 0",
      "  )",
      "}"
    ].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const group = useCadDocumentStore.getState().elements.find((element) => element.name === "G")!;
    const pointB = useCadDocumentStore.getState().elements.find((element) => element.name === "B")!;
    const openingLine = internals.view.state.doc.line(4);
    const closeLine = internals.view.state.doc.line(8);
    const rangesOf = () => {
      const ranges: Array<{ from: number; to: number }> = [];
      foldedRanges(internals.view.state as never).between(0, internals.view.state.doc.length, (from, to) => {
        ranges.push({ from, to });
      });
      return ranges;
    };

    // The group folds by default; folding the nested statement too must add a
    // second, independent fold range rather than replacing the parent's.
    useCadUiStore.getState().setFoldTargetExpanded({ elementId: pointB.id, branch: "statement" }, false);
    expect(rangesOf()).toContainEqual({ from: openingLine.to, to: closeLine.from });
    expect(foldedRanges(internals.view.state as never).size).toBe(2);

    // Expanding the parent group must not unfold the still-collapsed child statement.
    useCadUiStore.getState().setFoldTargetExpanded({ elementId: group.id, branch: "primary" }, true);
    expect(rangesOf()).toEqual([{ from: openingLine.to, to: closeLine.from }]);

    useCadUiStore.getState().setFoldTargetExpanded({ elementId: pointB.id, branch: "statement" }, true);
    expect(foldedRanges(internals.view.state as never).size).toBe(0);
    controller.destroy();
  });

  it("restores fold state after a dirty anchor edit is undone and recommitted", () => {
    const source = ["nui 3", "group G {", "  point A = coordinate(x: 0, y: 0)", "}"].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const openBrace = internals.view.state.doc.toString().indexOf("{");
    const braceLine = internals.view.state.doc.line(2);
    const closeLine = internals.view.state.doc.line(4);

    expect(foldedRanges(internals.view.state as never).size).toBeGreaterThan(0);

    internals.view.dispatch({ changes: { from: openBrace, to: openBrace + 1, insert: "[" } });
    expect(foldedRanges(internals.view.state as never).size).toBe(0);

    let undoResult = false;
    expect(() => { undoResult = internals.runUndo(); }).not.toThrow();
    expect(undoResult).toBe(true);
    expect(internals.view.state.doc.toString()).toContain("{");

    // Reverting the buffer restores CM's own text, but the dropped fold target
    // is only rediscovered once statementRanges rebuilds from a fresh committed
    // snapshot — an identical-text recommit is a store no-op, so force a real
    // commit cycle (append then let it settle) to exercise that rebuild.
    const restoredText = internals.view.state.doc.toString();
    useCadDocumentStore.getState().commitText(`${restoredText}\n`, "test");

    expect(foldedRanges(internals.view.state as never).size).toBeGreaterThan(0);
    const ranges: Array<{ from: number; to: number }> = [];
    foldedRanges(internals.view.state as never).between(0, internals.view.state.doc.length, (from, to) => {
      ranges.push({ from, to });
    });
    expect(ranges).toEqual([{ from: braceLine.to, to: closeLine.from }]);
    controller.destroy();
  });

  it("drives fold and unfold-all through the real keymap", () => {
    const source = [
      "nui 3",
      "if Choice (1) {",
      "  point Then = coordinate(x: 0, y: 0)",
      "} else {",
      "  point Else = coordinate(x: 1, y: 1)",
      "}"
    ].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const content = parent.querySelector(".cm-content")!;
    const conditional = useCadDocumentStore.getState().elements.find((element) => element.name === "Choice")!;
    const ifLine = internals.view.state.doc.line(2);

    internals.view.dispatch({ selection: EditorSelection.cursor(ifLine.from) });
    // fireEvent.keyDown's plain `key: "["` never resolves to CM's "Ctrl-Shift-["
    // binding here: CodeMirror's isChar shift-suppression tries the unshifted
    // "Ctrl-[" combo first (already bound to outdentSelectedElements), which
    // swallows the event before the shifted lookup ever runs. A real US-layout
    // Shift+[ keypress reports key "{" with keyCode 219, which CM's w3c-keyname
    // base table maps back to "[" before adding Shift-, so reproduce that here.
    content.dispatchEvent(new KeyboardEvent("keydown", {
      key: "{", ctrlKey: true, shiftKey: true, keyCode: 219, bubbles: true, cancelable: true
    } as KeyboardEventInit));

    expect(useCadUiStore.getState().groupFoldById.get(conditional.id)?.expanded).toBe(false);
    expect(foldedRanges(internals.view.state as never).size).toBeGreaterThan(0);

    fireEvent.keyDown(content, { key: "]", ctrlKey: true, altKey: true });

    expect(useCadUiStore.getState().groupFoldById.get(conditional.id)).toMatchObject({
      expanded: true,
      elseExpanded: true
    });
    expect(foldedRanges(internals.view.state as never).size).toBe(0);
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
    useCadDocumentStore.getState().commitText(numericValueSource(), "test");
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
    useCadDocumentStore.getState().commitText(numericValueSource(), "test");
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
    useCadDocumentStore.getState().commitText(numericValueSource(), "test");
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
    useCadDocumentStore.getState().commitText(numericValueSource(), "test");
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
    useCadDocumentStore.getState().commitText(numericValueSource(), "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    // v2's canonical vertical call ends the statement on its own closing `)`
    // line, so appending at doc end no longer lands inside the numeric value -
    // insert right after "120" instead.
    const valueEnd = internals.view.state.doc.toString().lastIndexOf("120") + "120".length;
    internals.view.dispatch({ changes: { from: valueEnd, insert: "0" } });
    const text = internals.view.state.doc.toString();
    expect(text).toContain("dy: 1200");

    const handled = clickAt(internals, text.lastIndexOf("1200") + 1);

    expect(handled).toBe(true);
    const selection = internals.view.state.selection.main;
    expect(text.slice(selection.from, selection.to)).toBe("1200");
    controller.destroy();
  });

  it("falls through to a normal click when the clicked line fails to parse (fatal-safe)", () => {
    useCadDocumentStore.getState().commitText(numericValueSource(), "test");
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
    useCadDocumentStore.getState().commitText(numericValueSource(), "test");
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
    useCadDocumentStore.getState().commitText(numericValueSource(), "test");
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
    useCadDocumentStore.getState().commitText(numericValueSource(), "test");
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
    useCadDocumentStore.getState().commitText(onePointSource(0, 10), "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const text = internals.view.state.doc.toString();
    // Cursor at the exact start of x's own value span (its v2 canonical form
    // puts x/y on separate physical lines, so this is no longer right after
    // the call's opening paren).
    const xStart = text.indexOf("x: 0") + "x: ".length;
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
    useCadDocumentStore.getState().commitText(onePointSource(0, 10), "test");
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
    useCadDocumentStore.getState().commitText(twoPointSource([0, 10], [1, 1]), "test");
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
    // navigateValueSpanは「カーソルを含むstatement」内のvalue spanだけを対象に
    // 巡回する(dslDocumentValueSpansAtがstatementProjectionAtでenclosing
    // statementに絞り込むため)。そのため直前のnumericValueSource(2文)ではなく、
    // 同一statement内に3個以上の数値を持つ要素(arc: radius/start/end)を使う。
    const arcSource = dslTextForElements([
      freePoint("a", "A", 0, 0),
      { id: "arc", name: "Arc", type: "arcLine", activity: "visible", centerPoint: { mode: "coordinate", x: 0, y: 0 }, radius: 0, startAngleDeg: 0, endAngleDeg: 120 }
    ]);
    useCadDocumentStore.getState().commitText(arcSource, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    // Uncommitted edit: "end: 120" becomes "end: 1200" — one character longer
    // than the store's last-good parse still knows about. v2's canonical
    // vertical call ends the statement on its own closing `)` line, so the
    // insert targets right after "120" instead of doc end.
    const initialText = internals.view.state.doc.toString();
    const endValueEnd = initialText.lastIndexOf("120") + "120".length;
    internals.view.dispatch({ changes: { from: endValueEnd, insert: "0" } });
    const text = internals.view.state.doc.toString();
    expect(text).toContain("end: 1200");
    // arc's own "center: (0, 0)" tuple is the first value span in its
    // enclosing statement.
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
    useCadDocumentStore.getState().commitText(onePointSource(0, 10), "test");
    const { controller, content } = buildController();
    const text = controller.getText();
    const xStart = text.indexOf("x: 0") + "x: ".length;
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
    useCadDocumentStore.getState().commitText(onePointSource(0, 10), "test");
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
    useCadDocumentStore.getState().commitText(onePointSource(0, 10), "test");
    const { controller, content } = buildController();
    const internals = controller as unknown as ControllerInternals;
    const text = internals.view.state.doc.toString();
    const xStart = text.indexOf("x: 0") + "x: ".length;
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
