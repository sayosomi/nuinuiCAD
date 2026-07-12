import { undoDepth, redoDepth } from "@codemirror/commands";
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

  const openLens = async () => {
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
    return { controller, view, longLine, lensView };
  };

  // handleValueClick is registered as a real CM domEventHandlers entry on the lens's own
  // contentDOM (there is no direct method handle on the ViewPlugin instance the way the
  // main SourceEditorController exposes its private methods to tests), so it must be
  // exercised through a real DOM mouseup dispatch rather than a direct method call.
  const clickLens = (lensView: EditorView, init?: MouseEventInit) =>
    fireEvent.mouseUp(lensView.contentDOM, { button: 0, ...init });

  it("selects the whole value under a plain click inside the lens and projects it outward", async () => {
    const { controller, view, longLine, lensView } = await openLens();
    const lensText = lensView.state.doc.toString();
    const valueStart = lensText.indexOf("120");

    lensView.dispatch({ selection: EditorSelection.cursor(valueStart + 1) });
    clickLens(lensView);

    const lensSelection = lensView.state.selection.main;
    expect(lensText.slice(lensSelection.from, lensSelection.to)).toBe("120");
    expect(view.state.selection.main.from).toBe(longLine.from + valueStart);
    expect(view.state.selection.main.to).toBe(longLine.from + valueStart + 3);
    controller.destroy();
  });

  it("leaves a normal cursor on a click at a non-value position in the lens", async () => {
    const { controller, lensView } = await openLens();
    const lensText = lensView.state.doc.toString();
    const namePos = lensText.indexOf("長い基準点");

    lensView.dispatch({ selection: EditorSelection.cursor(namePos) });
    clickLens(lensView);

    expect(lensView.state.selection.main.empty).toBe(true);
    expect(lensView.state.selection.main.head).toBe(namePos);
    controller.destroy();
  });

  it("does not override a drag-created range selection in the lens", async () => {
    const { controller, lensView } = await openLens();
    const lensText = lensView.state.doc.toString();
    const valueStart = lensText.indexOf("120");

    lensView.dispatch({ selection: EditorSelection.range(valueStart - 2, valueStart + 1) });
    clickLens(lensView);

    expect(lensView.state.selection.main.from).toBe(valueStart - 2);
    expect(lensView.state.selection.main.to).toBe(valueStart + 1);
    controller.destroy();
  });

  it("does not select a value on a Mod-click inside the lens", async () => {
    const { controller, lensView } = await openLens();
    const lensText = lensView.state.doc.toString();
    const valueStart = lensText.indexOf("120");

    lensView.dispatch({ selection: EditorSelection.cursor(valueStart + 1) });
    clickLens(lensView, { metaKey: true });

    expect(lensView.state.selection.main.empty).toBe(true);
    controller.destroy();
  });

  it("does not add the lens value-selection dispatch to the main view's CM undo history", async () => {
    const { controller, view, lensView } = await openLens();
    const lensText = lensView.state.doc.toString();
    const valueStart = lensText.indexOf("120");

    lensView.dispatch({ selection: EditorSelection.cursor(valueStart + 1) });
    clickLens(lensView);

    expect(lensView.state.selection.main.empty).toBe(false);
    expect(undoDepth(view.state as never)).toBe(0);
    expect(redoDepth(view.state as never)).toBe(0);
    controller.destroy();
  });
});

describe("SourceEditor selected-line lens Tab/Shift-Tab value navigation", () => {
  const multiValueSource = [
    "nui 1",
    "point A = (5, 9)",
    "point B = (1, 1)",
    "line AB = A -> B color=red locked=false",
    "# nothing to see here for tab fallthrough testing"
  ].join("\n");

  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.getState().commitText(multiValueSource, "test");
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => []
    });
  });

  afterEach(() => vi.restoreAllMocks());

  const openLensOnLine = async (lineNumber: number) => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
    const lens = parent.querySelector<HTMLElement>(".cm-source-line-lens")!;
    const measure = parent.querySelector<HTMLElement>(".cm-source-line-lens-measure")!;
    Object.defineProperty(view.contentDOM, "clientWidth", { configurable: true, value: 800 });
    Object.defineProperty(view.scrollDOM, "clientWidth", { configurable: true, value: 72 });
    Object.defineProperty(view.dom.querySelector(".cm-gutters-before")!, "offsetWidth", { configurable: true, value: 24 });
    Object.defineProperty(measure, "scrollWidth", { configurable: true, value: 480 });

    const line = view.state.doc.line(lineNumber);
    view.dispatch({ selection: EditorSelection.cursor(line.from) });
    await settleLens();
    expect(lens).toHaveClass("is-visible");
    const lensView = EditorView.findFromDOM(lens.querySelector<HTMLElement>(".cm-editor")!)!;
    return { controller, view, lens, measure, line, lensView };
  };

  it("moves between coordinate values and cycles at both ends", async () => {
    const { controller, lensView } = await openLensOnLine(2);
    const lensText = lensView.state.doc.toString();
    const xStart = lensText.indexOf("5");
    lensView.dispatch({ selection: EditorSelection.cursor(xStart) });
    const selected = () => {
      const main = lensView.state.selection.main;
      return lensText.slice(main.from, main.to);
    };

    fireEvent.keyDown(lensView.contentDOM, { key: "Tab" });
    expect(selected()).toBe("9");
    fireEvent.keyDown(lensView.contentDOM, { key: "Tab" });
    expect(selected()).toBe("5");
    fireEvent.keyDown(lensView.contentDOM, { key: "Tab", shiftKey: true });
    expect(selected()).toBe("9");
    controller.destroy();
  });

  it("walks reference and attribute values in source order", async () => {
    const { controller, lensView } = await openLensOnLine(4);
    const lensText = lensView.state.doc.toString();
    lensView.dispatch({ selection: EditorSelection.cursor(lensText.indexOf("A ->")) });
    const selected = () => {
      const main = lensView.state.selection.main;
      return lensText.slice(main.from, main.to);
    };

    const order: string[] = [];
    for (let step = 0; step < 5; step += 1) {
      fireEvent.keyDown(lensView.contentDOM, { key: "Tab" });
      order.push(selected());
    }
    expect(order).toEqual(["B", "red", "false", "A", "B"]);
    controller.destroy();
  });

  it("propagates the lens selection outward without touching the document, undo history, or store", async () => {
    const { controller, view, line, lensView } = await openLensOnLine(2);
    const lensText = lensView.state.doc.toString();
    const yStart = lensText.indexOf("9");
    lensView.dispatch({ selection: EditorSelection.cursor(yStart) });
    const before = {
      sourceText: useCadDocumentStore.getState().sourceText,
      revision: useCadDocumentStore.getState().compiledDocumentRevision,
      selectedElementId: useCadUiStore.getState().selectedElementId
    };

    fireEvent.keyDown(lensView.contentDOM, { key: "Tab" });

    expect(view.state.selection.main.from).toBe(line.from + lensText.indexOf("5"));
    expect(view.state.selection.main.to).toBe(line.from + lensText.indexOf("5") + 1);
    expect(useCadDocumentStore.getState().sourceText).toBe(before.sourceText);
    expect(useCadDocumentStore.getState().compiledDocumentRevision).toBe(before.revision);
    expect(useCadUiStore.getState().selectedElementId).toBe(before.selectedElementId);
    expect(undoDepth(view.state as never)).toBe(0);
    expect(redoDepth(view.state as never)).toBe(0);
    controller.destroy();
  });

  it("falls through without crashing on a line with no editable values", async () => {
    const { controller, lensView } = await openLensOnLine(5);
    lensView.dispatch({ selection: EditorSelection.cursor(0) });

    fireEvent.keyDown(lensView.contentDOM, { key: "Tab" });

    expect(lensView.state.selection.main.empty).toBe(true);
    expect(lensView.state.selection.main.from).toBe(0);
    controller.destroy();
  });

  it("consumes Tab during composition inside the lens and recovers after compositionend", async () => {
    const { controller, view, lensView } = await openLensOnLine(2);
    const lensText = lensView.state.doc.toString();
    const xStart = lensText.indexOf("5");
    lensView.dispatch({ selection: EditorSelection.cursor(xStart) });
    const mainBefore = view.state.doc.toString();
    const lensBefore = lensView.state.doc.toString();

    fireEvent.compositionStart(lensView.contentDOM);
    fireEvent.keyDown(lensView.contentDOM, { key: "Tab" });

    expect(lensView.state.doc.toString()).toBe(lensBefore);
    expect(lensView.state.selection.main.empty).toBe(true);
    expect(lensView.state.selection.main.from).toBe(xStart);
    expect(view.state.doc.toString()).toBe(mainBefore);

    fireEvent.compositionEnd(lensView.contentDOM);
    await new Promise((resolve) => setTimeout(resolve, 110));
    fireEvent.keyDown(lensView.contentDOM, { key: "Tab" });

    const main = lensView.state.selection.main;
    expect(lensText.slice(main.from, main.to)).toBe("9");
    controller.destroy();
  });

  it("does not regress lens open/close visibility toggling after a Tab move", async () => {
    const { controller, view, lens, measure, lensView } = await openLensOnLine(2);
    const lensText = lensView.state.doc.toString();
    lensView.dispatch({ selection: EditorSelection.cursor(lensText.indexOf("5")) });
    fireEvent.keyDown(lensView.contentDOM, { key: "Tab" });
    expect(lens).toHaveClass("is-visible");

    Object.defineProperty(measure, "scrollWidth", { configurable: true, value: 12 });
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(3).from) });
    await settleLens();

    expect(lens).not.toHaveClass("is-visible");
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
