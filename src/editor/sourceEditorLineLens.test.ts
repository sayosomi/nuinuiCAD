import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { SourceEditorController } from "./sourceEditorController";
import { lineLocalHighlightRanges, splitTokenByHighlights } from "./sourceEditorLineLens";
import { setPatchHighlight } from "./sourceEditorPatchHighlight";

const source = [
  "nui 1",
  "point 長い基準点 = (120, -45) # 選択行レンズの実測とCanvas同期を確認するための十分に長い注釈テキストです",
  "point B = (1, 1)"
].join("\n");

const settleLens = () => new Promise((resolve) => window.setTimeout(resolve, 20));

describe("SourceEditor selected-line lens", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.getState().commitText(source, "test");
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => []
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("shows only for an overflowing selected line and moves the real cursor from a lens token", async () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
    const lens = parent.querySelector<HTMLElement>(".cm-source-line-lens")!;
    const measure = parent.querySelector<HTMLElement>(".cm-source-line-lens-measure")!;
    Object.defineProperty(view.contentDOM, "clientWidth", { configurable: true, value: 800 });
    Object.defineProperty(view.scrollDOM, "clientWidth", { configurable: true, value: 72 });
    Object.defineProperty(view.dom.querySelector(".cm-gutters-before")!, "offsetWidth", { configurable: true, value: 24 });
    Object.defineProperty(measure, "scrollWidth", { configurable: true, value: 480 });
    vi.spyOn(view, "coordsAtPos").mockReturnValue({ left: 24, right: 24, top: 84, bottom: 104 });

    const longLine = view.state.doc.line(2);
    view.dispatch({ selection: EditorSelection.cursor(longLine.from + 6) });
    await settleLens();

    expect(lens).toHaveClass("is-visible");
    expect(lens.style.top).toBe("84px");
    expect(lens.style.left).toBe("24px");
    const lensView = EditorView.findFromDOM(lens.querySelector<HTMLElement>(".cm-editor")!)!;
    lensView.dispatch({ selection: EditorSelection.cursor(0) });
    expect(view.state.selection.main.head).toBe(longLine.from);

    Object.defineProperty(measure, "scrollWidth", { configurable: true, value: 12 });
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(3).from) });
    await settleLens();
    expect(lens).not.toHaveClass("is-visible");
    controller.destroy();
  });

  it("defers cursor restoration until focus returns after a Canvas-equivalent model patch", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (120, -45)\npoint B = (1, 1)", "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
    const line = view.state.doc.line(2);
    const cursor = line.from + 12;
    view.dispatch({ selection: EditorSelection.cursor(cursor) });
    const selectedBeforePatch = useCadUiStore.getState().selectedElementId;
    expect(selectedBeforePatch).toBe(useCadDocumentStore.getState().elements.find((element) => element.name === "A")?.id);
    view.scrollDOM.scrollTop = 42;
    view.scrollDOM.scrollLeft = 36;

    const elements = useCadDocumentStore.getState().elements;
    const changed = elements.map((element) =>
      element.name === "A" ? { ...element, locked: true } : element
    );
    expect(useCadDocumentStore.getState().commitDocumentChange({ elements: changed })).toEqual({ status: "applied" });
    expect(useCadDocumentStore.getState().sourceUpdate.kind).toBe("model-patch");
    expect(useCadUiStore.getState().selectedElementId).toBe(selectedBeforePatch);

    expect(view.state.selection.main.head).toBe(line.from);
    expect(view.scrollDOM.scrollTop).toBe(42);
    expect(view.scrollDOM.scrollLeft).toBe(36);
    fireEvent.focus(view.contentDOM);
    expect(view.state.selection.main.head).toBe(cursor);
    controller.destroy();
  });

  it("edits the owning source document through the lens, including a newline", async () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
    const lens = parent.querySelector<HTMLElement>(".cm-source-line-lens")!;
    const measure = parent.querySelector<HTMLElement>(".cm-source-line-lens-measure")!;
    Object.defineProperty(view.contentDOM, "clientWidth", { configurable: true, value: 800 });
    Object.defineProperty(view.scrollDOM, "clientWidth", { configurable: true, value: 72 });
    Object.defineProperty(view.dom.querySelector(".cm-gutters-before")!, "offsetWidth", { configurable: true, value: 24 });
    Object.defineProperty(measure, "scrollWidth", { configurable: true, value: 480 });

    const longLine = view.state.doc.line(2);
    view.dispatch({ selection: EditorSelection.cursor(longLine.from + 6) });
    await settleLens();
    expect(lens).toHaveClass("is-visible");
    const lensView = EditorView.findFromDOM(lens.querySelector<HTMLElement>(".cm-editor")!)!;
    const xStart = lensView.state.doc.toString().indexOf("120");
    lensView.dispatch({ changes: { from: xStart, to: xStart + 3, insert: "999" } });
    expect(view.state.doc.line(2).text).toContain("(999, -45)");

    lensView.dispatch({ changes: { from: lensView.state.doc.length, to: lensView.state.doc.length, insert: "\n# lens edit" } });
    expect(view.state.doc.toString()).toContain("# lens edit");
    await settleLens();
    controller.destroy();
  });

  it("highlights changed text and deletion markers in the editable lens after a model patch", async () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
    const lens = parent.querySelector<HTMLElement>(".cm-source-line-lens")!;
    const measure = parent.querySelector<HTMLElement>(".cm-source-line-lens-measure")!;
    Object.defineProperty(view.contentDOM, "clientWidth", { configurable: true, value: 800 });
    Object.defineProperty(view.scrollDOM, "clientWidth", { configurable: true, value: 72 });
    Object.defineProperty(view.dom.querySelector(".cm-gutters-before")!, "offsetWidth", { configurable: true, value: 24 });
    Object.defineProperty(measure, "scrollWidth", { configurable: true, value: 480 });

    // Removing point B (the last, short line) collapses the deletion point onto
    // the end of the preceding long line, which becomes the new last line.
    const elements = useCadDocumentStore.getState().elements;
    const changed = elements.filter((element) => element.name !== "B");
    expect(useCadDocumentStore.getState().commitDocumentChange({ elements: changed })).toEqual({ status: "applied" });
    expect(useCadDocumentStore.getState().sourceUpdate.kind).toBe("model-patch");

    const longLine = view.state.doc.line(view.state.doc.lines);
    view.dispatch({ selection: EditorSelection.cursor(longLine.from + 6) });
    await settleLens();

    expect(lens).toHaveClass("is-visible");
    expect(lens.querySelector(".cm-patch-highlight-line")).not.toBeNull();
    controller.destroy();
  });

  it("renders a within-line deletion marker in both the main editor and the lens", async () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
    const lens = parent.querySelector<HTMLElement>(".cm-source-line-lens")!;
    const measure = parent.querySelector<HTMLElement>(".cm-source-line-lens-measure")!;
    Object.defineProperty(view.contentDOM, "clientWidth", { configurable: true, value: 800 });
    Object.defineProperty(view.scrollDOM, "clientWidth", { configurable: true, value: 72 });
    Object.defineProperty(view.dom.querySelector(".cm-gutters-before")!, "offsetWidth", { configurable: true, value: 24 });
    Object.defineProperty(measure, "scrollWidth", { configurable: true, value: 480 });

    const longLine = view.state.doc.line(2);
    const markerPos = longLine.from + 5;
    view.dispatch({ selection: EditorSelection.cursor(longLine.from + 6) });
    await settleLens();
    expect(lens).toHaveClass("is-visible");
    expect(parent.querySelector(".cm-patch-highlight-deletion-marker")).toBeNull();
    expect(lens.querySelector(".cm-patch-highlight-deletion-marker")).toBeNull();

    view.dispatch({
      selection: EditorSelection.cursor(longLine.from + 7),
      effects: [setPatchHighlight.of({ marks: [], deletionPoints: [], deletionMarkers: [markerPos] })]
    });
    await settleLens();

    const mainMarker = parent.querySelector(".cm-patch-highlight-deletion-marker");
    expect(mainMarker).not.toBeNull();

    const lensMarker = lens.querySelector<HTMLElement>(".cm-patch-highlight-deletion-marker");
    expect(lensMarker).not.toBeNull();
    controller.destroy();
  });
});

describe("Line lens highlight range helpers", () => {
  it("clips, sorts, and merges overlapping/adjacent marks to the line bounds", () => {
    const merged = lineLocalHighlightRanges(
      [{ from: -5, to: 3 }, { from: 8, to: 12 }, { from: 10, to: 20 }, { from: 50, to: 60 }],
      0,
      15
    );
    expect(merged).toEqual([{ from: 0, to: 3 }, { from: 8, to: 15 }]);
  });

  it("splits a single token at every boundary when it contains more than one merged mark", () => {
    const segments = splitTokenByHighlights("abcdefghij", 100, [{ from: 102, to: 104 }, { from: 106, to: 108 }]);
    expect(segments).toEqual([
      { text: "ab", from: 100, highlighted: false },
      { text: "cd", from: 102, highlighted: true },
      { text: "ef", from: 104, highlighted: false },
      { text: "gh", from: 106, highlighted: true },
      { text: "ij", from: 108, highlighted: false }
    ]);
  });

  it("returns the whole token unhighlighted when no range intersects it", () => {
    expect(splitTokenByHighlights("hello", 10, [{ from: 100, to: 200 }])).toEqual([
      { text: "hello", from: 10, highlighted: false }
    ]);
  });
});
