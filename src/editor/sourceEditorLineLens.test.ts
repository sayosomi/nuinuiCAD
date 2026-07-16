import { undoDepth, redoDepth } from "@codemirror/commands";
import { EditorSelection, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { SourceEditorController } from "./sourceEditorController";
import { lineLocalHighlightRanges, lineLensCompletionDocumentInput, splitTokenByHighlights } from "./sourceEditorLineLens";
import { setPatchHighlight } from "./sourceEditorPatchHighlight";
import { createDslCompletionSource } from "./cmAutocomplete";
import { createPrintLayoutRangeIndex, createStatementRangeIndex } from "./statementRangeIndex";
import { compileDslDocument } from "../dsl/dslDocument";
import { isElementDslStatement, parseDsl } from "../dsl/dslParser";
import type { ElementId } from "../types/geometry";

const source = [
  "nui 1",
  "point 長い基準点 = (120, -45) # 選択行レンズの実測とCanvas同期を確認するための十分に長い注釈テキストです",
  "point B = (1, 1)"
].join("\n");

const settleLens = () => new Promise((resolve) => window.setTimeout(resolve, 20));
const stepEvent = (repeat = false) => ({ key: "ArrowRight", code: "ArrowRight", altKey: true, repeat });
const pressLensStep = (view: EditorView) => {
  fireEvent.keyDown(view.contentDOM, stepEvent());
  fireEvent.keyUp(view.contentDOM, stepEvent());
};

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

  it("hands an Inspector-style parameter jump to the visible lens and keeps its edits projected", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const controller = new SourceEditorController(parent);
    const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
    const lens = parent.querySelector<HTMLElement>(".cm-source-line-lens")!;
    const measure = parent.querySelector<HTMLElement>(".cm-source-line-lens-measure")!;
    Object.defineProperty(view.contentDOM, "clientWidth", { configurable: true, value: 800 });
    Object.defineProperty(view.scrollDOM, "clientWidth", { configurable: true, value: 72 });
    Object.defineProperty(view.dom.querySelector(".cm-gutters-before")!, "offsetWidth", { configurable: true, value: 24 });
    Object.defineProperty(measure, "scrollWidth", { configurable: true, value: 480 });
    const element = useCadDocumentStore.getState().elements.find((candidate) => candidate.name === "長い基準点")!;

    expect(controller.jumpToParameterValue(element.id, "x")).toBe(true);
    await settleLens();

    expect(lens).toHaveClass("is-visible");
    const lensView = EditorView.findFromDOM(lens.querySelector<HTMLElement>(".cm-editor")!)!;
    const selected = lensView.state.selection.main;
    expect(lensView.state.doc.toString().slice(selected.from, selected.to)).toBe("120");
    expect(lensView.hasFocus).toBe(true);

    lensView.dispatch({ changes: { from: selected.from, to: selected.to, insert: "121" } });
    expect(view.state.doc.line(2).text).toContain("(121, -45)");
    controller.destroy();
    parent.remove();
  });

  it("starts the matching Canvas picker from a value selected in the visible lens", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const controller = new SourceEditorController(parent);
    const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
    const lens = parent.querySelector<HTMLElement>(".cm-source-line-lens")!;
    const measure = parent.querySelector<HTMLElement>(".cm-source-line-lens-measure")!;
    Object.defineProperty(view.contentDOM, "clientWidth", { configurable: true, value: 800 });
    Object.defineProperty(view.scrollDOM, "clientWidth", { configurable: true, value: 72 });
    Object.defineProperty(view.dom.querySelector(".cm-gutters-before")!, "offsetWidth", { configurable: true, value: 24 });
    Object.defineProperty(measure, "scrollWidth", { configurable: true, value: 480 });
    const element = useCadDocumentStore.getState().elements.find((candidate) => candidate.name === "長い基準点")!;

    expect(controller.jumpToParameterValue(element.id, "x")).toBe(true);
    await settleLens();
    const lensView = EditorView.findFromDOM(lens.querySelector<HTMLElement>(".cm-editor")!)!;

    fireEvent.keyDown(lensView.contentDOM, { key: "p", code: "KeyP", ctrlKey: true, shiftKey: true });
    expect(useCadUiStore.getState().activeNumericReferencePickTarget).toMatchObject({
      elementId: element.id,
      parameterKey: "x",
      mode: "replace"
    });

    controller.destroy();
    parent.remove();
  });

  it("keeps focus in the main editor when an Inspector-style jump does not open the lens", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const controller = new SourceEditorController(parent);
    const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
    const lens = parent.querySelector<HTMLElement>(".cm-source-line-lens")!;
    const measure = parent.querySelector<HTMLElement>(".cm-source-line-lens-measure")!;
    Object.defineProperty(view.contentDOM, "clientWidth", { configurable: true, value: 800 });
    Object.defineProperty(view.scrollDOM, "clientWidth", { configurable: true, value: 72 });
    Object.defineProperty(view.dom.querySelector(".cm-gutters-before")!, "offsetWidth", { configurable: true, value: 24 });
    Object.defineProperty(measure, "scrollWidth", { configurable: true, value: 12 });
    const element = useCadDocumentStore.getState().elements.find((candidate) => candidate.name === "B")!;

    expect(controller.jumpToParameterValue(element.id, "x")).toBe(true);
    await settleLens();

    expect(lens).not.toHaveClass("is-visible");
    expect(view.hasFocus).toBe(true);
    controller.destroy();
    parent.remove();
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

  it("projects lens selection synchronously before an editor-native value command reads main selection", async () => {
    const { controller, view, line, lensView } = await openLensOnLine(2);
    const xStart = lensView.state.doc.toString().indexOf("5");

    lensView.dispatch({ selection: EditorSelection.cursor(xStart) });
    expect(view.state.selection.main.head).toBe(line.from + xStart);

    pressLensStep(lensView);
    expect(useCadDocumentStore.getState().sourceText).toContain("point A = (6, 9)");
    await settleLens();
    expect(lensView.state.doc.toString()).toContain("point A = (6, 9)");
    expect(lensView.state.doc.toString().slice(
      lensView.state.selection.main.from,
      lensView.state.selection.main.to
    )).toBe("6");
    controller.destroy();
  });

  it("uses the same keyup Undo boundary while a Lens repeat previews each value", async () => {
    const { controller, view, lensView } = await openLensOnLine(2);
    const xStart = lensView.state.doc.toString().indexOf("5");
    lensView.dispatch({ selection: EditorSelection.cursor(xStart) });
    const pastBefore = useCadDocumentStore.getState().past.length;

    fireEvent.keyDown(lensView.contentDOM, stepEvent());
    fireEvent.keyDown(lensView.contentDOM, stepEvent(true));
    expect(view.state.doc.toString()).toContain("point A = (7, 9)");
    expect(useCadDocumentStore.getState().sourceText).toContain("point A = (5, 9)");
    expect(useCadDocumentStore.getState().previewElements?.find((element) => element.name === "A")).toMatchObject({ x: 7 });
    expect(useCadDocumentStore.getState().past).toHaveLength(pastBefore);

    fireEvent.keyUp(lensView.contentDOM, stepEvent());
    expect(useCadDocumentStore.getState().sourceText).toContain("point A = (7, 9)");
    expect(useCadDocumentStore.getState().past).toHaveLength(pastBefore + 1);
    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().sourceText).toContain("point A = (5, 9)");
    controller.destroy();
  });

  it("steps an expression literal through the Lens while preserving its quoted expression", async () => {
    const expressionSource = [
      "nui 1",
      "var 変数1 = 13 + 1",
      "point A = (0, 0)",
      'point B = offset A dx="@変数1 * 2" dy=0 steps=[dx:0.25]'
    ].join("\n");
    useCadDocumentStore.getState().commitText(expressionSource, "test");
    const { controller, lensView } = await openLensOnLine(4);
    const two = lensView.state.doc.toString().indexOf("* 2") + 2;
    lensView.dispatch({ selection: EditorSelection.cursor(two) });

    pressLensStep(lensView);

    expect(useCadDocumentStore.getState().sourceText).toContain('dx="@変数1 * 2.25"');
    await settleLens();
    expect(lensView.state.doc.toString().slice(lensView.state.selection.main.from, lensView.state.selection.main.to)).toBe("2.25");
    controller.destroy();
  });

  it("steps a Lens end-of-line value through every repeat without falling through", async () => {
    const offsetSource = [
      "nui 1",
      "point 点A = (0, 0)",
      "point 点B = offset 点A dx=130 dy=12",
      "point 次 = (1, 1)"
    ].join("\n");
    useCadDocumentStore.getState().commitText(offsetSource, "test");
    const { controller, view, lensView } = await openLensOnLine(3);
    lensView.dispatch({ selection: EditorSelection.cursor(lensView.state.doc.length) });

    expect(fireEvent.keyDown(lensView.contentDOM, stepEvent())).toBe(false);
    expect(fireEvent.keyDown(lensView.contentDOM, stepEvent(true))).toBe(false);
    expect(fireEvent.keyDown(lensView.contentDOM, stepEvent(true))).toBe(false);
    expect(view.state.doc.line(3).text).toContain("dy=15");
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(3);
    expect(view.state.doc.toString().slice(view.state.selection.main.from, view.state.selection.main.to)).toBe("15");

    fireEvent.keyUp(lensView.contentDOM, stepEvent());
    await settleLens();
    expect(useCadDocumentStore.getState().sourceText).toContain("dy=15");
    expect(lensView.state.doc.toString()).toContain("dy=15");
    controller.destroy();
  });

  it("refreshes an open lens with Source Editor shortcut overrides", async () => {
    const { controller, view, lensView } = await openLensOnLine(2);
    const xStart = lensView.state.doc.toString().indexOf("5");
    lensView.dispatch({ selection: EditorSelection.cursor(xStart) });
    useCadUiStore.getState().setShortcutSettings({
      version: 1,
      overrides: [{
        bindingId: "sourceEditor.stepSourceValueForward",
        chords: [{ key: "ArrowRight", mod: false, alt: true, shift: true }]
      }]
    });

    pressLensStep(lensView);
    expect(view.state.doc.toString()).toContain("point A = (5, 9)");
    lensView.dispatch({ selection: EditorSelection.cursor(xStart) });
    fireEvent.keyDown(lensView.contentDOM, { key: "ArrowRight", code: "ArrowRight", altKey: true, shiftKey: true });
    fireEvent.keyUp(lensView.contentDOM, { key: "ArrowRight", code: "ArrowRight", altKey: true, shiftKey: true });
    expect(useCadDocumentStore.getState().sourceText).toContain("point A = (6, 9)");
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

  it("consumes editor-native value commands during lens IME composition", async () => {
    const { controller, view, lensView } = await openLensOnLine(2);
    const xStart = lensView.state.doc.toString().indexOf("5");
    lensView.dispatch({ selection: EditorSelection.cursor(xStart) });
    const before = view.state.doc.toString();

    fireEvent.compositionStart(lensView.contentDOM);
    fireEvent.keyDown(lensView.contentDOM, { key: "ArrowRight", altKey: true });

    expect(view.state.doc.toString()).toBe(before);
    fireEvent.compositionEnd(lensView.contentDOM);
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

describe("Line lens @variable completion", () => {
  it("lineLensCompletionDocumentInput resolves the real document's line, not the lens's own line 1", () => {
    const mainDoc = Text.of(["nui 1", "var Width = 10", "point P = (0, 0)"]);
    const lineThreeFrom = mainDoc.line(3).from;
    const input = lineLensCompletionDocumentInput(mainDoc, lineThreeFrom, "point P = offset A dx=@Wi", 26);
    expect(input).toMatchObject({ cursorLineNumber: 3, lineText: "point P = offset A dx=@Wi", localPos: 26 });
    expect(input?.source).toBe(mainDoc.toString());
  });

  it("lineLensCompletionDocumentInput returns null when the lens isn't currently visible/synced", () => {
    const mainDoc = Text.of(["nui 1", "point P = (0, 0)"]);
    expect(lineLensCompletionDocumentInput(mainDoc, null, "point P = (0, 0)", 5)).toBeNull();
  });

  const seedAndOpenLensOnLine = async (source: string, lineNumber: number) => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.getState().commitText(source, "test");
    Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });

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
    view.dispatch({ selection: EditorSelection.cursor(line.from + line.length) });
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(lens).toHaveClass("is-visible");
    const lensView = EditorView.findFromDOM(lens.querySelector<HTMLElement>(".cm-editor")!)!;

    // Rebuilds the same StatementRangeIndex the controller wires internally, from
    // the same committed source, so the completion source under test sees real
    // compiled identities exactly as the running controller would.
    const compiled = compileDslDocument(source);
    const statementRanges = createStatementRangeIndex(view.state.doc, compiled.statementMap!);
    const printLayoutRanges = createPrintLayoutRangeIndex(view.state.doc, compiled.statementMap!);
    const completionSource = createDslCompletionSource({
      elements: () => useCadDocumentStore.getState().elements,
      statementRanges: () => statementRanges,
      printLayouts: () => useCadDocumentStore.getState().printLayouts,
      printLayoutRanges: () => printLayoutRanges,
      isComposing: () => false,
      computedVariables: () => undefined,
      computedGeometry: () => undefined,
      effectiveEnabledElementIds: () => undefined,
      evaluationErrors: () => undefined,
      documentInput: (context) => lineLensCompletionDocumentInput(view.state.doc, line.from, context.state.doc.toString(), context.pos)
    });

    return { controller, view, lens, lensView, completionSource };
  };

  it("offers @Width from a dirty, uncommitted lens edit without any compile step", async () => {
    const source = ["nui 1", "var Width = 10", "point P = offset A dx=10"].join("\n");
    const { controller, lensView, completionSource } = await seedAndOpenLensOnLine(source, 3);

    lensView.dispatch({ changes: { from: lensView.state.doc.length, to: lensView.state.doc.length, insert: "+@Wi" } });
    const pos = lensView.state.doc.length;
    const result = await Promise.resolve(completionSource({ state: lensView.state, pos, explicit: true } as never));
    expect(result).not.toBeNull();
    expect(result?.options.some((option) => option.label === "@Width")).toBe(true);
    controller.destroy();
  });

  it("keeps the @token replacement range anchored to `from` while `to` advances as more is typed", async () => {
    // Candidate FILTERING by the typed prefix is CodeMirror's own job (via
    // `validFor` against the returned `from`/`to` range) — the pure candidate
    // layer always returns every currently-valid variable and lets CM narrow
    // the displayed list client-side. What must track the live, dirty buffer
    // here is the replacement range itself.
    const source = ["nui 1", "var Width = 10", "var Height = 20", "point P = offset A dx=10"].join("\n");
    const { controller, lensView, completionSource } = await seedAndOpenLensOnLine(source, 4);

    lensView.dispatch({ changes: { from: lensView.state.doc.length, to: lensView.state.doc.length, insert: "+@W" } });
    const atPos = lensView.state.doc.length;
    const afterW = await Promise.resolve(completionSource({ state: lensView.state, pos: atPos, explicit: true } as never));
    expect(afterW?.options.map((option) => option.label)).toEqual(expect.arrayContaining(["@Width", "@Height"]));
    expect(afterW?.to).toBe(atPos);
    const tokenFrom = afterW!.from;

    lensView.dispatch({ changes: { from: lensView.state.doc.length, to: lensView.state.doc.length, insert: "id" } });
    const afterWidPos = lensView.state.doc.length;
    const afterWid = await Promise.resolve(completionSource({ state: lensView.state, pos: afterWidPos, explicit: true } as never));
    expect(afterWid?.from).toBe(tokenFrom);
    expect(afterWid?.to).toBe(afterWidPos);
    controller.destroy();
  });

  it("does not open completion while IME composition is in progress in the lens", async () => {
    const source = ["nui 1", "var Width = 10", "point P = offset A dx=10"].join("\n");
    const { controller, lensView, completionSource } = await seedAndOpenLensOnLine(source, 3);

    lensView.dispatch({ changes: { from: lensView.state.doc.length, to: lensView.state.doc.length, insert: "+@Wi" } });
    fireEvent.compositionStart(lensView.contentDOM);
    const pos = lensView.state.doc.length;
    const result = await Promise.resolve(completionSource({
      state: lensView.state,
      pos,
      explicit: true,
      view: { compositionStarted: true }
    } as never));
    expect(result).toBeNull();
    controller.destroy();
  });
});

describe("Line lens element-parameter completion", () => {
  const docSource = ["nui 1", "point A = (0, 0)", "point B = (10, 0)", "line 直線AB = A -> B", "point P = offset A dx=10"].join("\n");

  // The store's own committed compile assigns element ids independently of
  // any later compileDslDocument call (ids aren't content-derived, so two
  // compiles of the identical source produce two different id strings). A
  // fresh compile used only for statement ranges must reuse the store's real
  // ids via assignedElementIds - matched to store elements by shared
  // document order - or `compiled` lookups inside the module under test
  // would never find a match and every candidate would come back empty.
  const seedAndOpenLensOnLine = async (lineNumber: number) => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.getState().commitText(docSource, "test");
    Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });

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
    view.dispatch({ selection: EditorSelection.cursor(line.from + line.length) });
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(lens).toHaveClass("is-visible");
    const lensView = EditorView.findFromDOM(lens.querySelector<HTMLElement>(".cm-editor")!)!;

    const storeElements = useCadDocumentStore.getState().elements;
    const preParsed = parseDsl(docSource);
    const assignedElementIds = new Map<number, ElementId>();
    let elementCursor = 0;
    preParsed.statements.forEach((statement, index) => {
      if (isElementDslStatement(statement) && statement.name.trim()) {
        const matched = storeElements[elementCursor];
        if (matched) assignedElementIds.set(index, matched.id);
        elementCursor += 1;
      }
    });
    const compiled = compileDslDocument(docSource, { preparsed: preParsed, assignedElementIds });
    const statementRanges = createStatementRangeIndex(view.state.doc, compiled.statementMap!);
    const printLayoutRanges = createPrintLayoutRangeIndex(view.state.doc, compiled.statementMap!);
    const elementIdByName = new Map(storeElements.map((element) => [element.name, element.id] as const));
    const abId = elementIdByName.get("直線AB")!;

    const buildCompletionSource = (overrides: {
      computedGeometry?: Map<ElementId, unknown>;
      effectiveEnabledElementIds?: Set<ElementId>;
      isComposing?: () => boolean;
    } = {}) => createDslCompletionSource({
      elements: () => useCadDocumentStore.getState().elements,
      statementRanges: () => statementRanges,
      printLayouts: () => useCadDocumentStore.getState().printLayouts,
      printLayoutRanges: () => printLayoutRanges,
      isComposing: overrides.isComposing ?? (() => false),
      computedVariables: () => undefined,
      computedGeometry: () => (overrides.computedGeometry ?? new Map()) as never,
      effectiveEnabledElementIds: () => overrides.effectiveEnabledElementIds ?? new Set(),
      evaluationErrors: () => [],
      documentInput: (context) => lineLensCompletionDocumentInput(view.state.doc, line.from, context.state.doc.toString(), context.pos)
    });

    return { controller, lensView, abId, buildCompletionSource };
  };

  const lineGeometryFixture = (elementId: ElementId) => ({
    kind: "line" as const,
    elementId,
    name: "直線AB",
    startPointId: null,
    endPointId: null,
    start: { kind: "point" as const, elementId: "a", name: "a", x: 0, y: 0 },
    end: { kind: "point" as const, elementId: "b", name: "b", x: 10, y: 0 },
    length: 10,
    startAngleDeg: 0,
    endAngleDeg: 0,
    startTangentAngleDeg: 0,
    endTangentAngleDeg: 0
  });

  it("offers 直線AB's parameters from a dirty, uncommitted lens edit without any compile step", async () => {
    const { controller, lensView, abId, buildCompletionSource } = await seedAndOpenLensOnLine(5);
    const completionSource = buildCompletionSource({
      computedGeometry: new Map([[abId, lineGeometryFixture(abId)]]),
      effectiveEnabledElementIds: new Set([abId])
    });

    lensView.dispatch({ changes: { from: lensView.state.doc.length, to: lensView.state.doc.length, insert: "+直線AB." } });
    const pos = lensView.state.doc.length;
    const result = await Promise.resolve(completionSource({ state: lensView.state, pos, explicit: true } as never));
    expect(result).not.toBeNull();
    expect(result?.options.some((option) => option.label === "length")).toBe(true);
    controller.destroy();
  });

  it("stops offering candidates once the lens's own dirty edit renames the target element away from a resolvable token", async () => {
    // The element-name pool is reconstructed from the live line text on every
    // call (elementNameTokensForContext / resolveElementName), so once the
    // typed token no longer matches any live name, candidates disappear -
    // proving this doesn't silently fall back to a stale compiled name.
    const { controller, lensView, abId, buildCompletionSource } = await seedAndOpenLensOnLine(5);
    const completionSource = buildCompletionSource({
      computedGeometry: new Map([[abId, lineGeometryFixture(abId)]]),
      effectiveEnabledElementIds: new Set([abId])
    });

    lensView.dispatch({ changes: { from: lensView.state.doc.length, to: lensView.state.doc.length, insert: "+存在しない要素." } });
    const pos = lensView.state.doc.length;
    const result = await Promise.resolve(completionSource({ state: lensView.state, pos, explicit: true } as never));
    expect(result?.options ?? []).toEqual([]);
    controller.destroy();
  });

  it("does not open element-parameter completion while IME composition is in progress in the lens", async () => {
    const { controller, lensView, abId, buildCompletionSource } = await seedAndOpenLensOnLine(5);
    const completionSource = buildCompletionSource({
      computedGeometry: new Map([[abId, lineGeometryFixture(abId)]]),
      effectiveEnabledElementIds: new Set([abId]),
      isComposing: () => true
    });

    lensView.dispatch({ changes: { from: lensView.state.doc.length, to: lensView.state.doc.length, insert: "+直線AB." } });
    const pos = lensView.state.doc.length;
    const result = await Promise.resolve(completionSource({
      state: lensView.state,
      pos,
      explicit: true,
      view: { compositionStarted: true }
    } as never));
    expect(result).toBeNull();
    controller.destroy();
  });
});
